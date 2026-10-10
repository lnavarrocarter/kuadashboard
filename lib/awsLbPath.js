'use strict';

// Network path of an ELBv2 load balancer, for "why does this target time out?":
// load balancer → its subnets and their default route → target groups → each
// target's instance, subnet and default route → whether the target's security
// groups let the load balancer reach the traffic port and the health check port.
//
// Deterministic and evidence-based: every verdict names the rule that allows
// it, or says that no rule does. What KUA cannot see is said, never guessed:
// network ACLs are not evaluated, a Network Load Balancer without security
// groups gives no source to check, and IP targets outside the VPC are unknown.
//
// Costs: Describe* calls of Elastic Load Balancing and EC2 have no per-call
// charge. One run: 1 DescribeLoadBalancers + 1 DescribeTargetGroups + target
// health per group (≤ MAX_GROUPS) + DescribeInstances + DescribeSubnets +
// DescribeRouteTables + DescribeSecurityGroups.

const MAX_GROUPS = 10;
const MAX_TARGETS = 50;

// ── Address helpers (IPv4) ──────────────────────────────────────────────────

function ipToInt(ip) {
  const parts = String(ip || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function parseCidr(cidr) {
  const [ip, bits] = String(cidr || '').split('/');
  const base = ipToInt(ip);
  const size = Number(bits);
  if (base == null || !Number.isInteger(size) || size < 0 || size > 32) return null;
  const mask = size === 0 ? 0 : (0xFFFFFFFF << (32 - size)) >>> 0;
  return { start: (base & mask) >>> 0, end: ((base & mask) | (~mask >>> 0)) >>> 0 };
}

/** True when the CIDR `outer` contains every address of `inner` (a CIDR or a single IP). */
function cidrContains(outer, inner) {
  const a = parseCidr(outer);
  const b = String(inner || '').includes('/') ? parseCidr(inner) : (() => { const ip = ipToInt(inner); return ip == null ? null : { start: ip, end: ip }; })();
  return !!a && !!b && a.start <= b.start && b.end <= a.end;
}

// ── Rules ───────────────────────────────────────────────────────────────────

function ruleCoversPort(rule, port) {
  if (rule.IpProtocol === '-1') return true;
  if (!['tcp', '6'].includes(String(rule.IpProtocol))) return false;
  if (rule.FromPort == null) return true;
  return port >= rule.FromPort && port <= rule.ToPort;
}

/**
 * The first inbound rule of `groups` that lets traffic from the load balancer
 * reach `port`: a reference to one of its security groups, or a CIDR that
 * contains every subnet the load balancer runs in.
 */
function findIngress(groups, port, { sourceGroups = [], sourceCidrs = [] }) {
  for (const group of groups) {
    for (const rule of group.IpPermissions || []) {
      if (!ruleCoversPort(rule, port)) continue;
      const pair = (rule.UserIdGroupPairs || []).find(item => sourceGroups.includes(item.GroupId));
      if (pair) return { groupId: group.GroupId, via: 'group', source: pair.GroupId };
      const range = (rule.IpRanges || []).find(item => sourceCidrs.length && sourceCidrs.every(cidr => cidrContains(item.CidrIp, cidr)));
      if (range) return { groupId: group.GroupId, via: 'cidr', source: range.CidrIp };
    }
  }
  return null;
}

/** Same idea for the load balancer's own egress towards the target. */
function findEgress(groups, port, targetCidr) {
  for (const group of groups) {
    for (const rule of group.IpPermissionsEgress || []) {
      if (!ruleCoversPort(rule, port)) continue;
      if ((rule.IpRanges || []).some(item => cidrContains(item.CidrIp, targetCidr))) return { groupId: group.GroupId };
      if ((rule.UserIdGroupPairs || []).length) return { groupId: group.GroupId, via: 'group' };
    }
  }
  return null;
}

// ── Routes ──────────────────────────────────────────────────────────────────

/** Route table of a subnet: its explicit association, or the main table of the VPC. */
function routeTableFor(subnetId, routeTables) {
  return routeTables.find(table => (table.Associations || []).some(item => item.SubnetId === subnetId))
    || routeTables.find(table => (table.Associations || []).some(item => item.Main))
    || null;
}

function defaultRoute(table) {
  const route = (table?.Routes || []).find(item => item.DestinationCidrBlock === '0.0.0.0/0' && item.State !== 'blackhole');
  if (!route) return { kind: 'none', target: null };
  if (route.GatewayId?.startsWith('igw-')) return { kind: 'internet', target: route.GatewayId };
  if (route.NatGatewayId) return { kind: 'nat', target: route.NatGatewayId };
  if (route.TransitGatewayId) return { kind: 'transit', target: route.TransitGatewayId };
  return { kind: 'other', target: route.GatewayId || route.InstanceId || route.NetworkInterfaceId || route.VpcPeeringConnectionId || null };
}

function subnetView(subnetId, { subnets, routeTables }) {
  const subnet = subnets.find(item => item.SubnetId === subnetId);
  const table = routeTableFor(subnetId, routeTables);
  return {
    id: subnetId,
    cidr: subnet?.CidrBlock || null,
    zone: subnet?.AvailabilityZone || null,
    routeTableId: table?.RouteTableId || null,
    defaultRoute: defaultRoute(table),
  };
}

// ── Analysis ────────────────────────────────────────────────────────────────

/**
 * @param data { loadBalancer, targetGroups: [{ group, health }], instances, subnets, routeTables, securityGroups }
 *   in the shapes the AWS SDK returns.
 * @returns { loadBalancer, groups, findings, notes }
 */
function analyzeLbPath({ loadBalancer: lb, targetGroups = [], instances = [], subnets = [], routeTables = [], securityGroups = [] }) {
  const sgById = new Map(securityGroups.map(group => [group.GroupId, group]));
  const lbGroups = (lb.SecurityGroups || []).map(id => sgById.get(id)).filter(Boolean);
  const lbSubnets = (lb.AvailabilityZones || []).map(zone => zone.SubnetId).filter(Boolean).map(id => subnetView(id, { subnets, routeTables }));
  const lbCidrs = lbSubnets.map(subnet => subnet.cidr).filter(Boolean);
  const publicLb = lb.Scheme === 'internet-facing';
  const hasSecurityGroups = (lb.SecurityGroups || []).length > 0;
  const findings = [];
  const notes = ['nacl'];
  if (!hasSecurityGroups) notes.push('noLbSecurityGroups');

  if (publicLb) {
    for (const subnet of lbSubnets.filter(item => item.defaultRoute.kind !== 'internet')) {
      findings.push({ level: 'critical', key: 'publicLbPrivateSubnet', params: { subnet: subnet.id, route: subnet.defaultRoute.kind } });
    }
  }

  const instanceById = new Map(instances.map(instance => [instance.InstanceId, instance]));
  let shown = 0;
  const groups = targetGroups.slice(0, MAX_GROUPS).map(({ group, health = [] }) => {
    const healthPort = group.HealthCheckPort && group.HealthCheckPort !== 'traffic-port' ? Number(group.HealthCheckPort) : null;
    const targets = health.slice(0, Math.max(0, MAX_TARGETS - shown)).map(item => {
      const port = item.Target?.Port ?? group.Port ?? null;
      const checkPort = healthPort ?? port;
      const target = {
        id: item.Target?.Id || '',
        port,
        healthCheckPort: checkPort,
        state: item.TargetHealth?.State || null,
        reason: item.TargetHealth?.Reason || null,
        instance: null,
        subnet: null,
        securityGroups: [],
        traffic: { verdict: 'unknown', rule: null },
        healthCheck: { verdict: 'unknown', rule: null },
      };
      if (group.TargetType === 'instance') {
        const instance = instanceById.get(target.id);
        if (instance) {
          target.instance = { state: instance.State?.Name || null, privateIp: instance.PrivateIpAddress || null, name: (instance.Tags || []).find(tag => tag.Key === 'Name')?.Value || null };
          target.subnet = instance.SubnetId ? subnetView(instance.SubnetId, { subnets, routeTables }) : null;
          target.securityGroups = (instance.SecurityGroups || []).map(item => item.GroupId);
        }
      } else if (group.TargetType === 'ip') {
        const subnet = subnets.find(item => cidrContains(item.CidrBlock, target.id));
        target.subnet = subnet ? subnetView(subnet.SubnetId, { subnets, routeTables }) : null;
      }
      // Without the load balancer's security groups (or the target's) there is nothing to check.
      const targetSgs = target.securityGroups.map(id => sgById.get(id)).filter(Boolean);
      if (hasSecurityGroups && targetSgs.length && port != null) {
        const source = { sourceGroups: lb.SecurityGroups || [], sourceCidrs: lbCidrs };
        const traffic = findIngress(targetSgs, port, source);
        target.traffic = { verdict: traffic ? 'allowed' : 'blocked', rule: traffic };
        const check = checkPort === port ? traffic : findIngress(targetSgs, checkPort, source);
        target.healthCheck = { verdict: check ? 'allowed' : 'blocked', rule: check };
        if (!traffic) findings.push({ level: 'critical', key: 'targetPortBlocked', params: { target: target.id, port, group: group.TargetGroupName } });
        else if (!check) findings.push({ level: 'critical', key: 'healthPortBlocked', params: { target: target.id, port: checkPort, group: group.TargetGroupName } });
        const targetCidr = target.instance?.privateIp ? `${target.instance.privateIp}/32` : target.subnet?.cidr;
        if (traffic && targetCidr && lbGroups.length && !findEgress(lbGroups, port, targetCidr)) {
          findings.push({ level: 'critical', key: 'lbEgressBlocked', params: { target: target.id, port } });
        }
      }
      return target;
    });
    shown += targets.length;
    return {
      arn: group.TargetGroupArn,
      name: group.TargetGroupName,
      targetType: group.TargetType || '',
      protocol: group.Protocol || '',
      port: group.Port ?? null,
      healthCheck: { protocol: group.HealthCheckProtocol || null, port: group.HealthCheckPort || 'traffic-port', path: group.HealthCheckPath || null },
      targets,
      truncated: health.length > targets.length,
    };
  });
  if (targetGroups.length > MAX_GROUPS) notes.push('groupsTruncated');

  return {
    loadBalancer: {
      arn: lb.LoadBalancerArn,
      name: lb.LoadBalancerName,
      type: lb.Type || 'application',
      public: publicLb,
      vpcId: lb.VpcId || null,
      securityGroups: lb.SecurityGroups || [],
      subnets: lbSubnets,
    },
    groups,
    findings,
    notes,
  };
}

// ── Collection ──────────────────────────────────────────────────────────────

const LB_ARN_RE = /^arn:aws[a-z-]*:elasticloadbalancing:[a-z0-9-]+:\d{12}:loadbalancer\/(app|net)\/[A-Za-z0-9-]{1,32}\/[0-9a-f]{1,32}$/;

async function collectLbPath(cfg, arn, { sdk = pkg => require(`@aws-sdk/${pkg}`) } = {}) {
  if (!LB_ARN_RE.test(arn || '')) throw Object.assign(new Error('Invalid load balancer ARN (Application or Network)'), { status: 400, $metadata: { httpStatusCode: 400 } });
  const v2 = sdk('client-elastic-load-balancing-v2');
  const ec2 = sdk('client-ec2');
  const elb = new v2.ElasticLoadBalancingV2Client(cfg);
  const compute = new ec2.EC2Client(cfg);

  const [{ LoadBalancers: [loadBalancer] = [] }, { TargetGroups: groups = [] }] = await Promise.all([
    elb.send(new v2.DescribeLoadBalancersCommand({ LoadBalancerArns: [arn] })),
    elb.send(new v2.DescribeTargetGroupsCommand({ LoadBalancerArn: arn })),
  ]);
  if (!loadBalancer) throw Object.assign(new Error('Load balancer not found'), { status: 404, $metadata: { httpStatusCode: 404 } });
  const targetGroups = await Promise.all(groups.slice(0, MAX_GROUPS).map(async group => {
    const { TargetHealthDescriptions: health = [] } = await elb.send(new v2.DescribeTargetHealthCommand({ TargetGroupArn: group.TargetGroupArn }));
    return { group, health };
  }));
  if (groups.length > MAX_GROUPS) targetGroups.push(...groups.slice(MAX_GROUPS).map(group => ({ group, health: [] })));

  const instanceIds = [...new Set(targetGroups.filter(item => item.group.TargetType === 'instance').flatMap(item => item.health.map(h => h.Target?.Id)).filter(Boolean))].slice(0, MAX_TARGETS);
  const instances = instanceIds.length
    ? (await compute.send(new ec2.DescribeInstancesCommand({ InstanceIds: instanceIds }))).Reservations?.flatMap(r => r.Instances || []) || []
    : [];
  const vpcFilter = [{ Name: 'vpc-id', Values: [loadBalancer.VpcId] }];
  const [{ Subnets: subnets = [] }, { RouteTables: routeTables = [] }] = await Promise.all([
    compute.send(new ec2.DescribeSubnetsCommand({ Filters: vpcFilter })),
    compute.send(new ec2.DescribeRouteTablesCommand({ Filters: vpcFilter })),
  ]);
  const groupIds = [...new Set([...(loadBalancer.SecurityGroups || []), ...instances.flatMap(instance => (instance.SecurityGroups || []).map(item => item.GroupId))])];
  const securityGroups = groupIds.length
    ? (await compute.send(new ec2.DescribeSecurityGroupsCommand({ GroupIds: groupIds }))).SecurityGroups || []
    : [];
  return analyzeLbPath({ loadBalancer, targetGroups, instances, subnets, routeTables, securityGroups });
}

module.exports = { analyzeLbPath, collectLbPath, cidrContains, findIngress, defaultRoute, routeTableFor };
