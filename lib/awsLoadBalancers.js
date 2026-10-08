'use strict';

// Elastic Load Balancing for the AWS view: Application, Network and Gateway
// load balancers (ELBv2) and Classic load balancers, with their listeners,
// target groups and target health, plus the detail of one load balancer
// (listener rules, attributes and tags).
//
// Costs: Elastic Load Balancing Describe* calls have no per-call charge.
// A list costs 1 + listeners per load balancer + target groups + target
// health per target group (+ instance health per Classic load balancer);
// calls run with bounded concurrency to stay under the API rate limits.

const { mapWithConcurrency, settle, failure } = require('./awsActivity');

const CONCURRENCY = 6;
const MAX_PAGES = 20;
const UNHEALTHY_SAMPLE = 10;

const LB_ARN_RE = /^arn:aws[a-z-]*:elasticloadbalancing:[a-z0-9-]+:\d{12}:loadbalancer\/(app|net|gwy)\/[A-Za-z0-9-]{1,32}\/[0-9a-f]{1,32}$/;
const CLASSIC_NAME_RE = /^[A-Za-z0-9-]{1,32}$/;

// Predefined policies that still accept TLS 1.0 or 1.1.
const OLD_TLS_POLICIES = new Set(['ELBSecurityPolicy-2016-08', 'ELBSecurityPolicy-2015-05', 'ELBSecurityPolicy-FS-2018-06']);
const OLD_TLS_RE = /(TLS-1-[01]-|TLS13-1-[01]-|FS-1-1-)/;
const HEALTHY_STATES = new Set(['healthy', 'InService']);
const UNHEALTHY_STATES = new Set(['unhealthy', 'unhealthy.draining', 'unavailable', 'OutOfService']);
const RANK = { ok: 0, info: 1, warning: 2, critical: 3 };

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400, $metadata: { httpStatusCode: 400 } });
}

function defaultSdk(pkg) {
  return require(`@aws-sdk/${pkg}`);
}

async function paginate(send, { items, tokenIn = 'Marker', tokenOut = 'NextMarker', maxPages = MAX_PAGES }) {
  const all = [];
  let token;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await send(token ? { [tokenIn]: token } : {});
    all.push(...(response[items] || []));
    token = response[tokenOut];
    if (!token) return { items: all, truncated: false };
  }
  return { items: all, truncated: true };
}

function isOldTlsPolicy(policy) {
  return !!policy && (OLD_TLS_POLICIES.has(policy) || OLD_TLS_RE.test(policy));
}

function worst(reasons) {
  return reasons.reduce((acc, reason) => (RANK[reason.level] > RANK[acc] ? reason.level : acc), 'ok');
}

function targetGroupNames(action) {
  const arns = action?.ForwardConfig?.TargetGroups?.map(item => item.TargetGroupArn) || (action?.TargetGroupArn ? [action.TargetGroupArn] : []);
  return arns.map(arn => String(arn).split('/')[1]).filter(Boolean);
}

/** One line for a listener or rule action: "forward → api", "redirect → HTTPS:443 (301)", "fixed 404". */
function describeAction(action = {}) {
  const type = action.Type || '';
  if (type === 'forward') return { type, targetGroups: targetGroupNames(action) };
  if (type === 'redirect') {
    const r = action.RedirectConfig || {};
    return { type, redirect: `${r.Protocol || '#{protocol}'}:${r.Port || '#{port}'}`, status: r.StatusCode || null, toHttps: r.Protocol === 'HTTPS' };
  }
  if (type === 'fixed-response') return { type, status: action.FixedResponseConfig?.StatusCode || null };
  return { type };
}

function mainAction(actions = []) {
  // Authentication actions run first; the one that answers is the last by order.
  const sorted = [...actions].sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0));
  return sorted[sorted.length - 1] || {};
}

function normalizeListener(listener) {
  return {
    arn: listener.ListenerArn,
    port: listener.Port ?? null,
    protocol: listener.Protocol || '',
    sslPolicy: listener.SslPolicy || null,
    oldTls: isOldTlsPolicy(listener.SslPolicy),
    certificates: (listener.Certificates || []).length,
    defaultAction: describeAction(mainAction(listener.DefaultActions)),
  };
}

function countTargets(descriptions = []) {
  const counts = { total: 0, healthy: 0, unhealthy: 0, other: 0 };
  const unhealthy = [];
  for (const item of descriptions) {
    const state = item.TargetHealth?.State || item.State || '';
    counts.total += 1;
    if (HEALTHY_STATES.has(state)) counts.healthy += 1;
    else if (UNHEALTHY_STATES.has(state)) {
      counts.unhealthy += 1;
      if (unhealthy.length < UNHEALTHY_SAMPLE) {
        unhealthy.push({
          id: item.Target?.Id || item.InstanceId || '',
          port: item.Target?.Port ?? null,
          state,
          reason: item.TargetHealth?.Reason || item.ReasonCode || null,
          description: item.TargetHealth?.Description || item.Description || null,
        });
      }
    } else counts.other += 1;
  }
  return { counts, unhealthy };
}

/** Health of a load balancer: { status, reasons: [{ level, key, params }] } (keys under health.*). */
function loadBalancerHealth(lb) {
  const reasons = [];
  if (lb.state === 'failed') reasons.push({ level: 'critical', key: 'lbFailed' });
  if (lb.state === 'provisioning') reasons.push({ level: 'info', key: 'lbProvisioning' });
  // Every attached target group receives traffic (default actions or listener rules).
  const groups = lb.targetGroups;
  for (const group of groups) {
    if (group.targets.total > 0 && group.targets.healthy === 0) reasons.push({ level: 'critical', key: 'lbNoHealthyTargets', params: { group: group.name } });
  }
  const unhealthy = groups.reduce((sum, group) => sum + (group.targets.healthy > 0 ? group.targets.unhealthy : 0), 0);
  if (unhealthy) reasons.push({ level: 'warning', key: 'lbUnhealthyTargets', params: { n: unhealthy } });
  const forwards = lb.type === 'classic' || lb.listeners.some(listener => listener.defaultAction.type === 'forward');
  if (forwards && !groups.some(group => group.targets.total > 0)) reasons.push({ level: 'warning', key: 'lbNoTargets' });
  if (lb.public && lb.type === 'application') {
    for (const listener of lb.listeners) {
      if (listener.protocol === 'HTTP' && !listener.defaultAction.toHttps) reasons.push({ level: 'warning', key: 'lbHttpNotRedirected', params: { port: listener.port } });
    }
  }
  for (const listener of lb.listeners) {
    if (listener.oldTls) reasons.push({ level: 'warning', key: 'lbOldTls', params: { port: listener.port, policy: listener.sslPolicy } });
  }
  return { status: worst(reasons), reasons };
}

function normalizeV2({ lb, listeners, targetGroups, healthByGroup }) {
  const groups = targetGroups
    .filter(group => (group.LoadBalancerArns || []).includes(lb.LoadBalancerArn))
    .map(group => {
      const { counts, unhealthy } = countTargets(healthByGroup.get(group.TargetGroupArn) || []);
      return {
        arn: group.TargetGroupArn,
        name: group.TargetGroupName,
        loadBalancerArns: group.LoadBalancerArns || [],
        protocol: group.Protocol || '',
        port: group.Port ?? null,
        targetType: group.TargetType || '',
        healthCheck: group.HealthCheckPath ? `${group.HealthCheckProtocol || ''} ${group.HealthCheckPath}`.trim() : (group.HealthCheckProtocol || null),
        targets: counts,
        unhealthyTargets: unhealthy,
      };
    });
  const result = {
    id: lb.LoadBalancerArn,
    arn: lb.LoadBalancerArn,
    name: lb.LoadBalancerName,
    type: lb.Type || 'application',
    scheme: lb.Scheme || '',
    public: lb.Scheme === 'internet-facing',
    dnsName: lb.DNSName || '',
    hostedZoneId: lb.CanonicalHostedZoneId || null,
    state: lb.State?.Code || '',
    vpcId: lb.VpcId || null,
    zones: (lb.AvailabilityZones || []).map(zone => zone.ZoneName).filter(Boolean),
    securityGroups: lb.SecurityGroups || [],
    ipAddressType: lb.IpAddressType || null,
    createdAt: lb.CreatedTime ? new Date(lb.CreatedTime).toISOString() : null,
    listeners: listeners.map(normalizeListener).sort((a, b) => (a.port ?? 0) - (b.port ?? 0)),
    targetGroups: groups,
  };
  result.health = loadBalancerHealth(result);
  return result;
}

function normalizeClassic({ lb, instanceStates }) {
  const { counts, unhealthy } = countTargets(instanceStates);
  const listeners = (lb.ListenerDescriptions || []).map(({ Listener: l = {} }) => ({
    arn: null,
    port: l.LoadBalancerPort ?? null,
    protocol: l.Protocol || '',
    sslPolicy: null,
    oldTls: false,
    certificates: l.SSLCertificateId ? 1 : 0,
    defaultAction: { type: 'forward', instance: `${l.InstanceProtocol || ''}:${l.InstancePort ?? ''}` },
  })).sort((a, b) => (a.port ?? 0) - (b.port ?? 0));
  const result = {
    id: `classic:${lb.LoadBalancerName}`,
    arn: null,
    name: lb.LoadBalancerName,
    type: 'classic',
    scheme: lb.Scheme || '',
    public: lb.Scheme === 'internet-facing',
    dnsName: lb.DNSName || '',
    hostedZoneId: lb.CanonicalHostedZoneNameID || null,
    state: 'active',
    vpcId: lb.VPCId || null,
    zones: lb.AvailabilityZones || [],
    securityGroups: lb.SecurityGroups || [],
    ipAddressType: null,
    createdAt: lb.CreatedTime ? new Date(lb.CreatedTime).toISOString() : null,
    listeners,
    targetGroups: [{
      arn: null,
      name: lb.LoadBalancerName,
      protocol: listeners[0]?.defaultAction.instance?.split(':')[0] || '',
      port: null,
      targetType: 'instance',
      healthCheck: lb.HealthCheck?.Target || null,
      targets: counts,
      unhealthyTargets: unhealthy,
    }],
  };
  result.health = loadBalancerHealth(result);
  return result;
}

/**
 * Every load balancer of the region. A source that fails (e.g. no permission
 * for Classic load balancers) is reported in `unavailable` without hiding the rest.
 * Returns { loadBalancers, truncated, unavailable: [{ source, error, access }] }.
 */
async function listLoadBalancers(cfg, { sdk = defaultSdk, beforeRequest = () => {} } = {}) {
  const v2 = sdk('client-elastic-load-balancing-v2');
  const classic = sdk('client-elastic-load-balancing');
  const client = new v2.ElasticLoadBalancingV2Client(cfg);
  const classicClient = new classic.ElasticLoadBalancingClient(cfg);
  const unavailable = [];
  let truncated = false;
  let requests = 0;

  async function send(target, command) {
    beforeRequest({ operation: command.constructor.name.replace(/Command$/, '') });
    requests += 1;
    return target.send(command);
  }

  const loadV2 = async () => {
    const lbs = await paginate(input => send(client, new v2.DescribeLoadBalancersCommand({ PageSize: 400, ...input })), { items: 'LoadBalancers' });
    const groups = await paginate(input => send(client, new v2.DescribeTargetGroupsCommand({ PageSize: 400, ...input })), { items: 'TargetGroups' });
    truncated = truncated || lbs.truncated || groups.truncated;
    const listeners = await mapWithConcurrency(lbs.items, CONCURRENCY, async lb => (
      await paginate(input => send(client, new v2.DescribeListenersCommand({ LoadBalancerArn: lb.LoadBalancerArn, ...input })), { items: 'Listeners' })
    ).items);
    // Target groups not attached to a load balancer have no health to read.
    const attached = groups.items.filter(group => (group.LoadBalancerArns || []).length);
    const healthByGroup = new Map();
    let healthFailure = null;
    await mapWithConcurrency(attached, CONCURRENCY, async group => {
      const result = await settle(send(client, new v2.DescribeTargetHealthCommand({ TargetGroupArn: group.TargetGroupArn })));
      if (result.ok) healthByGroup.set(group.TargetGroupArn, result.value.TargetHealthDescriptions || []);
      else healthFailure = healthFailure || result.error;
    });
    if (healthFailure) unavailable.push({ source: 'targetHealth', ...failure(healthFailure, 'GET /elb') });
    return lbs.items.map((lb, index) => normalizeV2({ lb, listeners: listeners[index], targetGroups: groups.items, healthByGroup }));
  };

  const loadClassic = async () => {
    const lbs = await paginate(input => send(classicClient, new classic.DescribeLoadBalancersCommand({ PageSize: 400, ...input })), { items: 'LoadBalancerDescriptions' });
    truncated = truncated || lbs.truncated;
    return mapWithConcurrency(lbs.items, CONCURRENCY, async lb => {
      const result = await settle(send(classicClient, new classic.DescribeInstanceHealthCommand({ LoadBalancerName: lb.LoadBalancerName })));
      return normalizeClassic({ lb, instanceStates: result.ok ? result.value.InstanceStates || [] : [] });
    });
  };

  const [modern, legacy] = await Promise.all([settle(loadV2()), settle(loadClassic())]);
  if (!modern.ok) unavailable.push({ source: 'elbv2', ...failure(modern.error, 'GET /elb') });
  if (!legacy.ok) unavailable.push({ source: 'classic', ...failure(legacy.error, 'GET /elb') });
  if (!modern.ok && !legacy.ok) throw modern.error;
  const loadBalancers = [...(modern.ok ? modern.value : []), ...(legacy.ok ? legacy.value : [])]
    .sort((a, b) => RANK[b.health.status] - RANK[a.health.status] || a.name.localeCompare(b.name));
  return { loadBalancers, truncated, unavailable, requests };
}

function describeCondition(condition = {}) {
  const field = condition.Field || '';
  const values = condition.HostHeaderConfig?.Values || condition.PathPatternConfig?.Values
    || condition.HttpRequestMethodConfig?.Values || condition.SourceIpConfig?.Values
    || (condition.HttpHeaderConfig ? [`${condition.HttpHeaderConfig.HttpHeaderName}: ${(condition.HttpHeaderConfig.Values || []).join(', ')}`] : null)
    || (condition.QueryStringConfig ? condition.QueryStringConfig.Values.map(v => `${v.Key ? `${v.Key}=` : ''}${v.Value}`) : null)
    || condition.Values || [];
  return { field, values };
}

function attributeMap(attributes = []) {
  return Object.fromEntries(attributes.map(item => [item.Key, item.Value]));
}

/**
 * Detail of one ELBv2 load balancer: listener rules, attributes and tags.
 * Classic load balancers return their attributes and policies.
 */
async function describeLoadBalancer(cfg, { arn = null, name = null }, { sdk = defaultSdk } = {}) {
  if (arn) {
    if (!LB_ARN_RE.test(arn)) throw badRequest('Invalid load balancer ARN');
    const v2 = sdk('client-elastic-load-balancing-v2');
    const client = new v2.ElasticLoadBalancingV2Client(cfg);
    const [listeners, attributes, tags] = await Promise.all([
      paginate(input => client.send(new v2.DescribeListenersCommand({ LoadBalancerArn: arn, ...input })), { items: 'Listeners' }),
      settle(client.send(new v2.DescribeLoadBalancerAttributesCommand({ LoadBalancerArn: arn }))),
      settle(client.send(new v2.DescribeTagsCommand({ ResourceArns: [arn] }))),
    ]);
    const rules = await mapWithConcurrency(listeners.items, CONCURRENCY, async listener => {
      const result = await settle(paginate(input => client.send(new v2.DescribeRulesCommand({ ListenerArn: listener.ListenerArn, ...input })), { items: 'Rules' }));
      return result.ok ? result.value.items : null;
    });
    const attrs = attributes.ok ? attributeMap(attributes.value.Attributes) : null;
    return {
      arn,
      listeners: listeners.items.map((listener, index) => ({
        ...normalizeListener(listener),
        rules: rules[index] == null ? null : rules[index]
          .filter(rule => !rule.IsDefault)
          .map(rule => ({
            priority: rule.Priority,
            conditions: (rule.Conditions || []).map(describeCondition),
            action: describeAction(mainAction(rule.Actions)),
          }))
          .sort((a, b) => Number(a.priority) - Number(b.priority)),
      })).sort((a, b) => (a.port ?? 0) - (b.port ?? 0)),
      attributes: attrs && {
        deletionProtection: attrs['deletion_protection.enabled'] === 'true',
        accessLogs: attrs['access_logs.s3.enabled'] === 'true' ? (attrs['access_logs.s3.bucket'] || true) : false,
        dropInvalidHeaders: attrs['routing.http.drop_invalid_header_fields.enabled'] == null ? null : attrs['routing.http.drop_invalid_header_fields.enabled'] === 'true',
        idleTimeoutSeconds: attrs['idle_timeout.timeout_seconds'] ? Number(attrs['idle_timeout.timeout_seconds']) : null,
        crossZone: attrs['load_balancing.cross_zone.enabled'] == null ? null : attrs['load_balancing.cross_zone.enabled'] === 'true',
      },
      tags: tags.ok ? (tags.value.TagDescriptions?.[0]?.Tags || []).map(tag => ({ key: tag.Key, value: tag.Value })) : null,
    };
  }
  if (!CLASSIC_NAME_RE.test(name || '')) throw badRequest('Invalid load balancer name');
  const classic = sdk('client-elastic-load-balancing');
  const client = new classic.ElasticLoadBalancingClient(cfg);
  const [attributes, tags] = await Promise.all([
    settle(client.send(new classic.DescribeLoadBalancerAttributesCommand({ LoadBalancerName: name }))),
    settle(client.send(new classic.DescribeTagsCommand({ LoadBalancerNames: [name] }))),
  ]);
  const a = attributes.ok ? attributes.value.LoadBalancerAttributes || {} : null;
  return {
    name,
    listeners: null,
    attributes: a && {
      deletionProtection: null,
      accessLogs: a.AccessLog?.Enabled ? (a.AccessLog.S3BucketName || true) : false,
      dropInvalidHeaders: null,
      idleTimeoutSeconds: a.ConnectionSettings?.IdleTimeout ?? null,
      crossZone: a.CrossZoneLoadBalancing?.Enabled ?? null,
    },
    tags: tags.ok ? (tags.value.TagDescriptions?.[0]?.Tags || []).map(tag => ({ key: tag.Key, value: tag.Value })) : null,
  };
}

module.exports = {
  LB_ARN_RE,
  CLASSIC_NAME_RE,
  isOldTlsPolicy,
  describeAction,
  loadBalancerHealth,
  normalizeV2,
  normalizeClassic,
  listLoadBalancers,
  describeLoadBalancer,
};
