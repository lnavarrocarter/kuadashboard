'use strict';
/**
 * lib/kua/resourceRecommendations.js
 * What else belongs to a KUA Application (#283), from what it already holds:
 *   Step Functions → the Lambdas, Glue jobs, tables, queues and topics of its definition
 *   Lambda         → the ARNs and queue URLs in its environment (weaker evidence)
 *   load balancer  → its target groups → the EC2 instances behind them
 *   EC2            → its EBS volumes
 *   Kubernetes     → the EKS cluster and the EC2 instances of its nodes, and
 *                    workload → PVC → PV → EBS volume or GCP disk (released PVs are flagged)
 *
 * Suggestions are never applied here: each one carries the attach input, the evidence and a
 * confidence, and the user (or an agent through a previewed change) decides. Members, resources
 * the user detached and dismissed suggestions are left out. Only Describe/Get/List calls, which
 * AWS and Kubernetes do not charge for.
 */

const { lazyModule } = require('../lazyModule');
const { resolveAwsConfig } = require('../awsProfileResolver');
const { extractAslReferences, arnContext } = require('../apm/aslReferences');
const { applicationForResource } = require('./scopeCredentials');
const { canonicalFromApm } = require('./applicationRegistryService');
const { typeOfArn } = require('./resourceCatalog/aws');

const SDK = {
  sfn: lazyModule('@aws-sdk/client-sfn'),
  lambda: lazyModule('@aws-sdk/client-lambda'),
  elbv2: lazyModule('@aws-sdk/client-elastic-load-balancing-v2'),
  ec2: lazyModule('@aws-sdk/client-ec2'),
};
const CLIENTS = { sfn: 'SFNClient', lambda: 'LambdaClient', elbv2: 'ElasticLoadBalancingV2Client', ec2: 'EC2Client' };

const WORKLOAD_KINDS = new Set(['deployment', 'statefulset', 'daemonset', 'cronjob', 'job']);
const EKS_CONTEXT = /^arn:aws:eks:([^:]+):(\d{12}):cluster\/(.+)$/;
const lastSegment = value => String(value || '').split(/[/:]/).filter(Boolean).pop() || '';

const awsResource = (type, arn, name, extra = {}) => {
  const { region, account } = arnContext(arn);
  const global = type === 's3' || type === 'route53';
  return { provider: 'aws', type, key: arn, arn, name, ...(!global && account ? { scopeId: account } : {}), ...(region ? { location: region } : {}), ...extra };
};

/** The AWS resource an environment value names: an ARN of a known type, or an SQS queue URL. */
function resourceFromValue(value) {
  const text = String(value || '').trim();
  if (text.startsWith('arn:aws:')) {
    const type = typeOfArn(text);
    return type ? awsResource(type, text, lastSegment(text)) : null;
  }
  const queue = text.match(/^https:\/\/sqs\.([a-z0-9-]+)\.amazonaws\.com\/(\d{12})\/([^/?\s]+)$/);
  if (queue) return awsResource('sqs', `arn:aws:sqs:${queue[1]}:${queue[2]}:${queue[3]}`, queue[3]);
  return null;
}

function createResourceRecommender({
  apmDatabase,
  kubernetesCatalog = null,
  configResolver = resolveAwsConfig,
  clientFactory = (service, config) => new SDK[service][CLIENTS[service]](config),
} = {}) {
  if (!apmDatabase) throw new TypeError('apmDatabase is required');
  const kubernetes = () => kubernetesCatalog || (kubernetesCatalog = require('./resourceCatalog/kubernetes').createKubernetesResourceCatalog());

  async function recommend(applicationId) {
    const application = apmDatabase.getApplication(applicationId);
    if (!application) throw Object.assign(new Error('Application not found'), { statusCode: 404, code: 'NOT_FOUND' });
    const members = apmDatabase.listResources(application.id);
    const identityOf = resource => { try { return canonicalFromApm(application, resource).identityKey; } catch { return null; } };
    const excluded = new Set([
      ...members.map(identityOf).filter(Boolean),
      ...apmDatabase.listRegistryDetachmentKeys(application.id),
      ...apmDatabase.listRecommendationDismissals(application.id),
    ]);
    const suggestions = new Map();
    const failures = [];

    function suggest(resource, { confidence, evidence, note = null }) {
      const identityKey = identityOf(resource);
      if (!identityKey || excluded.has(identityKey)) return;
      const current = suggestions.get(identityKey);
      if (current) {
        current.confidence = Math.max(current.confidence, confidence);
        if (!current.evidence.some(item => JSON.stringify(item) === JSON.stringify(evidence))) current.evidence.push(evidence);
        if (note && !current.note) current.note = note;
        return;
      }
      suggestions.set(identityKey, { identityKey, resource, confidence, evidence: [evidence], ...(note ? { note } : {}) });
    }

    // ── AWS members, read with the profile that reaches each one ──
    const clients = new Map();
    async function client(member, service) {
      const scoped = applicationForResource(apmDatabase, application, member);
      const region = arnContext(member.arn).region || scoped.region;
      const key = `${scoped.profileId}\u0000${region}\u0000${service}`;
      if (!clients.has(key)) clients.set(key, clientFactory(service, { ...await configResolver(scoped.profileId), region }));
      return clients.get(key);
    }
    async function attempt(source, member, work) {
      try { await work(); } catch (error) { failures.push({ source, resource: member.name, code: error.code || error.name || 'read_failed' }); }
    }

    for (const member of members.filter(item => item.type === 'stepfunctions' && item.arn)) {
      await attempt('stepfunctions', member, async () => {
        const sfn = await client(member, 'sfn');
        const detail = await sfn.send(new SDK.sfn.DescribeStateMachineCommand({ stateMachineArn: member.arn }));
        for (const reference of extractAslReferences(detail.definition, arnContext(member.arn))) {
          if (!String(reference.arn || '').startsWith('arn:aws:') && reference.type !== 's3') continue;
          const resource = reference.type === 's3'
            ? awsResource('s3', `arn:aws:s3:::${reference.name}`, reference.name)
            : awsResource(reference.type, reference.arn, reference.name);
          suggest(resource, { confidence: 0.98, evidence: { type: 'asl_reference', from: member.name, statePath: reference.statePath, relation: reference.relationType } });
        }
      });
    }

    for (const member of members.filter(item => item.type === 'lambda' && item.arn)) {
      await attempt('lambda', member, async () => {
        const lambda = await client(member, 'lambda');
        const config = await lambda.send(new SDK.lambda.GetFunctionConfigurationCommand({ FunctionName: member.arn }));
        for (const [variable, value] of Object.entries(config.Environment?.Variables || {})) {
          const resource = resourceFromValue(value);
          // The variable name is evidence; its value is never returned.
          if (resource) suggest(resource, { confidence: 0.6, evidence: { type: 'lambda_environment_variable', from: member.name, variable } });
        }
      });
    }

    for (const member of members.filter(item => item.type === 'elb' && item.arn)) {
      await attempt('elb', member, async () => {
        const elb = await client(member, 'elbv2');
        const groups = await elb.send(new SDK.elbv2.DescribeTargetGroupsCommand({ LoadBalancerArn: member.arn }));
        for (const group of groups.TargetGroups || []) {
          suggest(awsResource('targetgroup', group.TargetGroupArn, group.TargetGroupName), { confidence: 0.95, evidence: { type: 'elb_target_group', from: member.name } });
          if (group.TargetType !== 'instance') continue;
          const health = await elb.send(new SDK.elbv2.DescribeTargetHealthCommand({ TargetGroupArn: group.TargetGroupArn }));
          const { region, account } = arnContext(group.TargetGroupArn);
          for (const target of health.TargetHealthDescriptions || []) {
            const id = target.Target?.Id;
            if (/^i-[0-9a-f]+$/.test(id || '')) {
              suggest(awsResource('ec2', `arn:aws:ec2:${region}:${account}:instance/${id}`, id), { confidence: 0.9, evidence: { type: 'target_group_target', from: group.TargetGroupName, state: target.TargetHealth?.State || null } });
            }
          }
        }
      });
    }

    for (const member of members.filter(item => item.type === 'ec2' && item.arn)) {
      await attempt('ec2', member, async () => {
        const ec2 = await client(member, 'ec2');
        const instanceId = lastSegment(member.arn);
        const { region, account } = arnContext(member.arn);
        const volumes = await ec2.send(new SDK.ec2.DescribeVolumesCommand({ Filters: [{ Name: 'attachment.instance-id', Values: [instanceId] }] }));
        for (const volume of volumes.Volumes || []) {
          suggest(awsResource('ebs-volume', `arn:aws:ec2:${region}:${account}:volume/${volume.VolumeId}`, volume.VolumeId), { confidence: 0.95, evidence: { type: 'ec2_attachment', from: member.name } });
        }
      });
    }

    // ── Kubernetes members: their cluster, nodes and volumes ──
    const kubeMembers = members.filter(item => item.type === 'kubernetes' && item.kubeContext);
    for (const context of [...new Set(kubeMembers.map(item => item.kubeContext))]) {
      const inContext = kubeMembers.filter(item => item.kubeContext === context);
      const eks = context.match(EKS_CONTEXT);
      if (eks) {
        const [, region, account, cluster] = eks;
        suggest(awsResource('eks', `arn:aws:eks:${region}:${account}:cluster/${cluster}`, cluster), { confidence: 0.99, evidence: { type: 'eks_context', from: context } });
      }
      try {
        const read = async types => (await kubernetes().list({ context, types, limit: 500 })).items;
        const [nodes, workloads, claims, volumes] = await Promise.all([
          eks ? read(['node']) : Promise.resolve([]),
          read([...WORKLOAD_KINDS]),
          read(['pvc']),
          read(['pv']),
        ]);
        if (eks) {
          const [, region, account] = eks;
          for (const node of nodes.filter(item => item.details.instanceId)) {
            suggest(awsResource('ec2', `arn:aws:ec2:${region}:${account}:instance/${node.details.instanceId}`, `${node.name} (${node.details.instanceId})`), { confidence: 0.95, evidence: { type: 'kubernetes_node', from: node.name } });
          }
        }
        // The workloads of the application, as the cluster describes them now.
        const memberKeys = new Set(inContext.map(item => `${item.namespace || ''}/${String(item.kind || '').toLowerCase()}/${item.name}`));
        const memberWorkloads = workloads.filter(item => memberKeys.has(`${item.namespace || ''}/${item.type}/${item.name}`));
        const wantedClaims = new Map(); // namespace/claim → workload name
        for (const workload of memberWorkloads) {
          for (const claim of workload.details.claims || []) wantedClaims.set(`${workload.namespace}/${claim}`, workload.name);
          for (const template of workload.details.claimTemplates || []) {
            const pattern = new RegExp(`^${template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-${workload.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`);
            for (const claim of claims.filter(item => item.namespace === workload.namespace && pattern.test(item.name))) wantedClaims.set(`${claim.namespace}/${claim.name}`, workload.name);
          }
        }
        // PVCs already in the application count too, so their PVs and volumes are suggested.
        for (const member of inContext.filter(item => String(item.kind || '').toLowerCase() === 'persistentvolumeclaim')) wantedClaims.set(`${member.namespace}/${member.name}`, member.name);
        const boundVolumes = new Set();
        for (const claim of claims.filter(item => wantedClaims.has(`${item.namespace}/${item.name}`))) {
          suggest(claim.attach, { confidence: 0.95, evidence: { type: 'workload_volume', from: wantedClaims.get(`${claim.namespace}/${claim.name}`) } });
          if (claim.details.volumeName) boundVolumes.add(claim.details.volumeName);
        }
        for (const pv of volumes) {
          const claimed = pv.details.claim && wantedClaims.has(pv.details.claim);
          if (!boundVolumes.has(pv.name) && !claimed) continue;
          const released = pv.details.phase === 'Released';
          // A released PV of the same claim is an earlier volume of this workload: flagged to review.
          const note = released ? 'released' : null;
          suggest(pv.attach, { confidence: released ? 0.5 : 0.95, evidence: { type: released ? 'released_volume' : 'pvc_binding', from: pv.details.claim }, note });
          const backing = pv.details.backingVolume;
          if (backing?.type === 'ebs-volume' && eks) {
            const [, region, account] = eks;
            suggest(awsResource('ebs-volume', `arn:aws:ec2:${region}:${account}:volume/${backing.volumeId}`, backing.volumeId), { confidence: released ? 0.5 : 0.95, evidence: { type: 'csi_volume', from: pv.name }, note });
          } else if (backing?.type === 'gcp-disk') {
            const project = String(backing.name).split('/')[1] || '';
            if (project) suggest({ provider: 'gcp', type: 'gcp-disk', key: backing.name, name: lastSegment(backing.name), scopeId: project, location: String(backing.name).split('/')[3] || '' }, { confidence: released ? 0.5 : 0.95, evidence: { type: 'csi_volume', from: pv.name }, note });
          }
        }
      } catch (error) {
        failures.push({ source: 'kubernetes', resource: context, code: error.code || error.name || 'read_failed' });
      }
    }

    const items = [...suggestions.values()].sort((left, right) => right.confidence - left.confidence || String(left.resource.name).localeCompare(String(right.resource.name)));
    return { applicationId: application.id, generatedAt: new Date().toISOString(), suggestions: items, failures };
  }

  function dismiss(applicationId, identityKey) {
    if (!apmDatabase.getApplication(applicationId)) throw Object.assign(new Error('Application not found'), { statusCode: 404, code: 'NOT_FOUND' });
    if (typeof identityKey !== 'string' || !identityKey) throw Object.assign(new Error('identityKey is required'), { statusCode: 400, code: 'INVALID' });
    return { dismissed: apmDatabase.dismissRecommendation(applicationId, identityKey) };
  }

  return { recommend, dismiss };
}

module.exports = { createResourceRecommender, resourceFromValue };
