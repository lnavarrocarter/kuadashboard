'use strict';

// AWS-side infrastructure of EKS clusters: node groups, add-ons, EC2 nodes and
// the VPC/subnets/security groups they use. Clients are injected (anything with
// `send(command)`), so routes pass real SDK clients and tests pass fakes.

const {
  DescribeClusterCommand, ListNodegroupsCommand, DescribeNodegroupCommand,
  ListAddonsCommand, DescribeAddonCommand,
} = require('@aws-sdk/client-eks');
const {
  DescribeInstancesCommand, DescribeVpcsCommand, DescribeSubnetsCommand, DescribeSecurityGroupsCommand,
} = require('@aws-sdk/client-ec2');

const CLUSTER_TAG_PREFIX = 'kubernetes.io/cluster/';
const EKS_CLUSTER_TAG = 'eks:cluster-name';
const EKS_NODEGROUP_TAG = 'eks:nodegroup-name';
const LIVE_STATES = ['pending', 'running', 'stopping', 'stopped'];

function tagMap(tags) {
  if (!tags) return {};
  if (Array.isArray(tags)) return Object.fromEntries(tags.map(t => [t.Key, t.Value]));
  return { ...tags };
}

function errorMessage(err) {
  return err?.message || err?.name || String(err);
}

// ── Node groups ──────────────────────────────────────────────────────────────

function summarizeNodegroup(ng) {
  const amiType = ng.amiType || '';
  return {
    name: ng.nodegroupName,
    status: ng.status,
    architecture: amiType.includes('ARM_64') ? 'arm64' : amiType ? 'x86_64' : 'unknown',
    amiType,
    capacityType: ng.capacityType || 'ON_DEMAND',
    instanceTypes: ng.instanceTypes || [],
    scaling: ng.scalingConfig || {},
    labels: ng.labels || {},
    tags: ng.tags || {},
    version: ng.version || null,
    releaseVersion: ng.releaseVersion || null,
    diskSize: ng.diskSize ?? null,
    nodeRole: ng.nodeRole || null,
    subnets: ng.subnets || [],
    launchTemplate: ng.launchTemplate ? { id: ng.launchTemplate.id, name: ng.launchTemplate.name, version: ng.launchTemplate.version } : null,
    autoScalingGroups: (ng.resources?.autoScalingGroups || []).map(g => g.name).filter(Boolean),
    remoteAccessSecurityGroup: ng.resources?.remoteAccessSecurityGroup || null,
    healthIssues: (ng.health?.issues || []).map(i => ({ code: i.code, message: i.message })),
    createdAt: ng.createdAt || null,
  };
}

async function listNodegroupNames(eks, clusterName) {
  const names = [];
  let nextToken;
  do {
    const page = await eks.send(new ListNodegroupsCommand({ clusterName, nextToken }));
    names.push(...(page.nodegroups || []));
    nextToken = page.nextToken;
  } while (nextToken);
  return names;
}

/** Describe every managed node group; individual describe failures are skipped. */
async function describeNodegroups(eks, clusterName) {
  const names = await listNodegroupNames(eks, clusterName);
  const results = await Promise.allSettled(names.map(nodegroupName =>
    eks.send(new DescribeNodegroupCommand({ clusterName, nodegroupName }))));
  return results
    .filter(r => r.status === 'fulfilled' && r.value.nodegroup)
    .map(r => summarizeNodegroup(r.value.nodegroup));
}

// ── Add-ons ──────────────────────────────────────────────────────────────────

async function describeAddons(eks, clusterName) {
  const names = [];
  let nextToken;
  do {
    const page = await eks.send(new ListAddonsCommand({ clusterName, nextToken }));
    names.push(...(page.addons || []));
    nextToken = page.nextToken;
  } while (nextToken);
  const results = await Promise.allSettled(names.map(addonName =>
    eks.send(new DescribeAddonCommand({ clusterName, addonName }))));
  return results.map((r, i) => {
    const a = r.status === 'fulfilled' ? r.value.addon : null;
    return {
      name: a?.addonName || names[i],
      version: a?.addonVersion || null,
      status: a?.status || (r.status === 'rejected' ? 'UNKNOWN' : null),
      serviceAccountRoleArn: a?.serviceAccountRoleArn || null,
      healthIssues: (a?.health?.issues || []).map(x => ({ code: x.code, message: x.message })),
      createdAt: a?.createdAt || null,
    };
  });
}

// ── EC2 nodes ────────────────────────────────────────────────────────────────

/** Cluster names an instance belongs to, from EKS/Kubernetes tags. */
function clustersOfInstance(tags) {
  const names = new Set();
  if (tags[EKS_CLUSTER_TAG]) names.add(tags[EKS_CLUSTER_TAG]);
  for (const key of Object.keys(tags)) {
    if (key.startsWith(CLUSTER_TAG_PREFIX)) names.add(key.slice(CLUSTER_TAG_PREFIX.length));
  }
  return [...names];
}

function nodegroupOfInstance(tags) {
  if (tags[EKS_NODEGROUP_TAG]) return tags[EKS_NODEGROUP_TAG];
  const pool = tags['karpenter.sh/nodepool'] || tags['karpenter.sh/provisioner-name'];
  if (pool) return `karpenter/${pool}`;
  return 'self-managed';
}

function summarizeInstance(inst) {
  const tags = tagMap(inst.Tags);
  return {
    id: inst.InstanceId,
    name: tags.Name || null,
    type: inst.InstanceType,
    state: inst.State?.Name || 'unknown',
    az: inst.Placement?.AvailabilityZone || null,
    privateIp: inst.PrivateIpAddress || null,
    subnetId: inst.SubnetId || null,
    lifecycle: inst.InstanceLifecycle === 'spot' ? 'spot' : 'on-demand',
    launchTime: inst.LaunchTime || null,
    nodegroup: nodegroupOfInstance(tags),
    clusters: clustersOfInstance(tags),
  };
}

/**
 * EC2 instances tagged as EKS nodes, grouped by cluster name. One paginated
 * DescribeInstances call covers every cluster (managed, self-managed, Karpenter).
 */
async function listEksInstances(ec2, clusterNames = null) {
  const tagKeys = clusterNames?.length
    ? [...clusterNames.map(n => `${CLUSTER_TAG_PREFIX}${n}`), EKS_CLUSTER_TAG]
    : [`${CLUSTER_TAG_PREFIX}*`, EKS_CLUSTER_TAG];
  const byCluster = new Map((clusterNames || []).map(n => [n, []]));
  let NextToken;
  do {
    const page = await ec2.send(new DescribeInstancesCommand({
      Filters: [
        { Name: 'tag-key', Values: tagKeys },
        { Name: 'instance-state-name', Values: LIVE_STATES },
      ],
      NextToken,
    }));
    for (const reservation of page.Reservations || []) {
      for (const inst of reservation.Instances || []) {
        const summary = summarizeInstance(inst);
        for (const cluster of summary.clusters) {
          if (clusterNames && !byCluster.has(cluster)) continue;
          if (!byCluster.has(cluster)) byCluster.set(cluster, []);
          byCluster.get(cluster).push(summary);
        }
      }
    }
    NextToken = page.NextToken;
  } while (NextToken);
  return byCluster;
}

// ── Network ──────────────────────────────────────────────────────────────────

async function describeNetwork(ec2, { vpcId, subnetIds, securityGroupIds }) {
  const [vpc, subnets, sgs] = await Promise.allSettled([
    vpcId ? ec2.send(new DescribeVpcsCommand({ VpcIds: [vpcId] })) : Promise.resolve({ Vpcs: [] }),
    subnetIds.length ? ec2.send(new DescribeSubnetsCommand({ SubnetIds: subnetIds })) : Promise.resolve({ Subnets: [] }),
    securityGroupIds.length ? ec2.send(new DescribeSecurityGroupsCommand({ GroupIds: securityGroupIds })) : Promise.resolve({ SecurityGroups: [] }),
  ]);
  return { vpc, subnets, sgs };
}

// ── Cluster detail ───────────────────────────────────────────────────────────

async function getEksDetails({ eks, ec2 }, clusterName) {
  const { cluster } = await eks.send(new DescribeClusterCommand({ name: clusterName }));
  if (!cluster) throw Object.assign(new Error(`EKS cluster ${clusterName} not found`), { statusCode: 404 });

  const warnings = [];
  const [ngResult, addonResult, instResult] = await Promise.allSettled([
    describeNodegroups(eks, clusterName),
    describeAddons(eks, clusterName),
    listEksInstances(ec2, [clusterName]),
  ]);
  const nodegroups = ngResult.status === 'fulfilled' ? ngResult.value : [];
  if (ngResult.status === 'rejected') warnings.push({ section: 'nodegroups', message: errorMessage(ngResult.reason) });
  const addons = addonResult.status === 'fulfilled' ? addonResult.value : [];
  if (addonResult.status === 'rejected') warnings.push({ section: 'addons', message: errorMessage(addonResult.reason) });
  const instances = instResult.status === 'fulfilled' ? (instResult.value.get(clusterName) || []) : [];
  if (instResult.status === 'rejected') warnings.push({ section: 'instances', message: errorMessage(instResult.reason) });

  for (const ng of nodegroups) ng.instanceCount = instances.filter(i => i.nodegroup === ng.name).length;

  // Who uses each subnet / security group
  const vpcCfg = cluster.resourcesVpcConfig || {};
  const subnetUse = new Map();
  const addUse = (map, id, who) => {
    if (!id) return;
    if (!map.has(id)) map.set(id, new Set());
    map.get(id).add(who);
  };
  for (const id of vpcCfg.subnetIds || []) addUse(subnetUse, id, 'control plane');
  for (const ng of nodegroups) for (const id of ng.subnets) addUse(subnetUse, id, `node group ${ng.name}`);
  for (const inst of instances) addUse(subnetUse, inst.subnetId, 'EC2 nodes');

  const sgUse = new Map();
  for (const id of vpcCfg.securityGroupIds || []) addUse(sgUse, id, 'additional (control plane)');
  addUse(sgUse, vpcCfg.clusterSecurityGroupId, 'cluster security group');
  for (const ng of nodegroups) addUse(sgUse, ng.remoteAccessSecurityGroup, `remote access ${ng.name}`);

  const net = await describeNetwork(ec2, {
    vpcId: vpcCfg.vpcId,
    subnetIds: [...subnetUse.keys()],
    securityGroupIds: [...sgUse.keys()],
  });
  for (const [section, r] of [['vpc', net.vpc], ['subnets', net.subnets], ['securityGroups', net.sgs]]) {
    if (r.status === 'rejected') warnings.push({ section, message: errorMessage(r.reason) });
  }

  const vpcRaw = net.vpc.status === 'fulfilled' ? net.vpc.value.Vpcs?.[0] : null;
  const subnetsRaw = net.subnets.status === 'fulfilled' ? net.subnets.value.Subnets || [] : [];
  const sgsRaw = net.sgs.status === 'fulfilled' ? net.sgs.value.SecurityGroups || [] : [];
  const subnetById = new Map(subnetsRaw.map(s => [s.SubnetId, s]));
  const sgById = new Map(sgsRaw.map(g => [g.GroupId, g]));

  return {
    cluster: {
      name: cluster.name,
      arn: cluster.arn,
      status: cluster.status,
      version: cluster.version,
      platformVersion: cluster.platformVersion || null,
      endpoint: cluster.endpoint || null,
      endpointPublicAccess: !!vpcCfg.endpointPublicAccess,
      endpointPrivateAccess: !!vpcCfg.endpointPrivateAccess,
      publicAccessCidrs: vpcCfg.publicAccessCidrs || [],
      roleArn: cluster.roleArn || null,
      oidcIssuer: cluster.identity?.oidc?.issuer || null,
      serviceIpv4Cidr: cluster.kubernetesNetworkConfig?.serviceIpv4Cidr || null,
      ipFamily: cluster.kubernetesNetworkConfig?.ipFamily || null,
      authenticationMode: cluster.accessConfig?.authenticationMode || null,
      logging: (cluster.logging?.clusterLogging || []).filter(l => l.enabled).flatMap(l => l.types || []),
      createdAt: cluster.createdAt || null,
      tags: cluster.tags || {},
    },
    network: {
      vpc: vpcCfg.vpcId ? {
        id: vpcCfg.vpcId,
        cidr: vpcRaw?.CidrBlock || null,
        name: tagMap(vpcRaw?.Tags).Name || null,
        state: vpcRaw?.State || null,
      } : null,
      subnets: [...subnetUse.entries()].map(([id, users]) => {
        const s = subnetById.get(id);
        return {
          id,
          name: tagMap(s?.Tags).Name || null,
          cidr: s?.CidrBlock || null,
          az: s?.AvailabilityZone || null,
          availableIps: s?.AvailableIpAddressCount ?? null,
          mapPublicIp: s?.MapPublicIpOnLaunch ?? null,
          usedBy: [...users],
        };
      }),
      securityGroups: [...sgUse.entries()].map(([id, roles]) => {
        const g = sgById.get(id);
        return {
          id,
          name: g?.GroupName || null,
          description: g?.Description || null,
          inboundRules: g?.IpPermissions?.length ?? null,
          outboundRules: g?.IpPermissionsEgress?.length ?? null,
          roles: [...roles],
        };
      }),
    },
    nodegroups,
    instances,
    addons,
    warnings,
  };
}

// ── Cluster list enrichment ──────────────────────────────────────────────────

/**
 * Node groups and EC2 node counts for the EKS table: one ListNodegroups per
 * cluster plus a single DescribeInstances for all of them. Failures leave the
 * fields null instead of breaking the cluster list.
 */
async function summarizeClusters({ eks, ec2 }, clusterNames) {
  const [ngResults, instResult] = await Promise.all([
    Promise.allSettled(clusterNames.map(name => listNodegroupNames(eks, name))),
    listEksInstances(ec2, clusterNames).then(v => ({ ok: true, v }), () => ({ ok: false })),
  ]);
  const summary = new Map();
  clusterNames.forEach((name, i) => {
    const ng = ngResults[i];
    summary.set(name, {
      nodegroups: ng.status === 'fulfilled' ? ng.value : null,
      instanceCount: instResult.ok ? (instResult.v.get(name) || []).length : null,
    });
  });
  return summary;
}

module.exports = {
  summarizeNodegroup,
  describeNodegroups,
  describeAddons,
  clustersOfInstance,
  nodegroupOfInstance,
  listEksInstances,
  getEksDetails,
  summarizeClusters,
};
