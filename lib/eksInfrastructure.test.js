'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  clustersOfInstance, nodegroupOfInstance, listEksInstances, getEksDetails, summarizeClusters,
} = require('./eksInfrastructure');

// ── Fakes ────────────────────────────────────────────────────────────────────

function fakeClient(handlers) {
  const calls = [];
  return {
    calls,
    count: name => calls.filter(c => c.name === name).length,
    async send(cmd) {
      const name = cmd.constructor.name;
      calls.push({ name, input: cmd.input });
      const handler = handlers[name];
      if (!handler) throw new Error(`unexpected command ${name}`);
      return handler(cmd.input);
    },
  };
}

const CLUSTER = {
  name: 'prod',
  arn: 'arn:aws:eks:us-east-1:123:cluster/prod',
  status: 'ACTIVE',
  version: '1.30',
  platformVersion: 'eks.5',
  endpoint: 'https://ABC.gr7.us-east-1.eks.amazonaws.com',
  roleArn: 'arn:aws:iam::123:role/eks',
  identity: { oidc: { issuer: 'https://oidc.eks/abc' } },
  kubernetesNetworkConfig: { serviceIpv4Cidr: '172.20.0.0/16', ipFamily: 'ipv4' },
  logging: { clusterLogging: [{ types: ['api', 'audit'], enabled: true }, { types: ['scheduler'], enabled: false }] },
  resourcesVpcConfig: {
    vpcId: 'vpc-1',
    subnetIds: ['subnet-a', 'subnet-b'],
    securityGroupIds: ['sg-extra'],
    clusterSecurityGroupId: 'sg-cluster',
    endpointPublicAccess: true,
    endpointPrivateAccess: false,
    publicAccessCidrs: ['0.0.0.0/0'],
  },
  tags: { team: 'platform' },
};

const NODEGROUPS = {
  general: {
    nodegroupName: 'general', status: 'ACTIVE', amiType: 'AL2023_x86_64_STANDARD', capacityType: 'ON_DEMAND',
    instanceTypes: ['m6i.large'], scalingConfig: { minSize: 2, maxSize: 4, desiredSize: 2 },
    subnets: ['subnet-a', 'subnet-c'], nodeRole: 'arn:aws:iam::123:role/node',
    resources: { autoScalingGroups: [{ name: 'eks-general-asg' }], remoteAccessSecurityGroup: 'sg-remote' },
    health: { issues: [] },
  },
  arm: {
    nodegroupName: 'arm', status: 'DEGRADED', amiType: 'AL2_ARM_64', capacityType: 'SPOT',
    instanceTypes: ['m7g.large'], scalingConfig: { minSize: 0, maxSize: 2, desiredSize: 1 },
    subnets: ['subnet-b'], resources: {},
    health: { issues: [{ code: 'AsgInstanceLaunchFailures', message: 'capacity' }] },
  },
};

function instance(id, tags, extra = {}) {
  return {
    InstanceId: id, InstanceType: 'm6i.large', State: { Name: 'running' },
    Placement: { AvailabilityZone: 'us-east-1a' }, PrivateIpAddress: '10.0.1.10', SubnetId: 'subnet-a',
    Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })), ...extra,
  };
}

const INSTANCES = [
  instance('i-1', { Name: 'prod-general-1', 'eks:cluster-name': 'prod', 'eks:nodegroup-name': 'general', 'kubernetes.io/cluster/prod': 'owned' }),
  instance('i-2', { 'eks:cluster-name': 'prod', 'eks:nodegroup-name': 'general' }),
  instance('i-3', { 'kubernetes.io/cluster/prod': 'owned', 'karpenter.sh/nodepool': 'default' }, { InstanceLifecycle: 'spot', SubnetId: 'subnet-d' }),
  instance('i-4', { 'eks:cluster-name': 'staging', 'eks:nodegroup-name': 'ng' }),
];

function eksHandlers(overrides = {}) {
  return {
    DescribeClusterCommand: ({ name }) => ({ cluster: name === 'prod' ? CLUSTER : { ...CLUSTER, name } }),
    ListNodegroupsCommand: ({ clusterName }) => ({ nodegroups: clusterName === 'prod' ? ['general', 'arm'] : ['ng'] }),
    DescribeNodegroupCommand: ({ nodegroupName }) => ({ nodegroup: NODEGROUPS[nodegroupName] }),
    ListAddonsCommand: () => ({ addons: ['vpc-cni', 'coredns'] }),
    DescribeAddonCommand: ({ addonName }) => ({
      addon: { addonName, addonVersion: 'v1.0.0-eksbuild.1', status: addonName === 'coredns' ? 'DEGRADED' : 'ACTIVE', health: { issues: [] } },
    }),
    ...overrides,
  };
}

function ec2Handlers(overrides = {}) {
  return {
    DescribeInstancesCommand: () => ({ Reservations: [{ Instances: INSTANCES }] }),
    DescribeVpcsCommand: () => ({ Vpcs: [{ VpcId: 'vpc-1', CidrBlock: '10.0.0.0/16', State: 'available', Tags: [{ Key: 'Name', Value: 'main' }] }] }),
    DescribeSubnetsCommand: ({ SubnetIds }) => ({
      Subnets: SubnetIds.map((id, i) => ({ SubnetId: id, CidrBlock: `10.0.${i}.0/24`, AvailabilityZone: 'us-east-1a', AvailableIpAddressCount: 200, MapPublicIpOnLaunch: false })),
    }),
    DescribeSecurityGroupsCommand: ({ GroupIds }) => ({
      SecurityGroups: GroupIds.map(id => ({ GroupId: id, GroupName: `${id}-name`, Description: 'd', IpPermissions: [{}], IpPermissionsEgress: [{}, {}] })),
    }),
    ...overrides,
  };
}

// ── Tag helpers ──────────────────────────────────────────────────────────────

test('attributes instances to clusters from eks:cluster-name and kubernetes.io/cluster/* tags', () => {
  assert.deepEqual(clustersOfInstance({ 'eks:cluster-name': 'a', 'kubernetes.io/cluster/a': 'owned' }), ['a']);
  assert.deepEqual(clustersOfInstance({ 'kubernetes.io/cluster/b': 'shared' }), ['b']);
  assert.deepEqual(clustersOfInstance({ Name: 'x' }), []);
});

test('classifies node origin: managed node group, Karpenter or self-managed', () => {
  assert.equal(nodegroupOfInstance({ 'eks:nodegroup-name': 'general' }), 'general');
  assert.equal(nodegroupOfInstance({ 'karpenter.sh/nodepool': 'default' }), 'karpenter/default');
  assert.equal(nodegroupOfInstance({ 'kubernetes.io/cluster/a': 'owned' }), 'self-managed');
});

// ── EC2 listing ──────────────────────────────────────────────────────────────

test('lists EKS instances with tag and live-state filters, following pagination', async () => {
  let page = 0;
  const ec2 = fakeClient({
    DescribeInstancesCommand: () => (page++ === 0
      ? { Reservations: [{ Instances: INSTANCES.slice(0, 2) }], NextToken: 't' }
      : { Reservations: [{ Instances: INSTANCES.slice(2) }] }),
  });
  const byCluster = await listEksInstances(ec2, ['prod']);
  assert.deepEqual(byCluster.get('prod').map(i => i.id), ['i-1', 'i-2', 'i-3']);
  assert.equal(byCluster.has('staging'), false);
  const { Filters } = ec2.calls[0].input;
  assert.deepEqual(Filters[0], { Name: 'tag-key', Values: ['kubernetes.io/cluster/prod', 'eks:cluster-name'] });
  assert.deepEqual(Filters[1].Values, ['pending', 'running', 'stopping', 'stopped']);
  assert.equal(ec2.count('DescribeInstancesCommand'), 2);
});

// ── Details ──────────────────────────────────────────────────────────────────

test('details combine cluster, network, node groups, EC2 nodes and add-ons', async () => {
  const eks = fakeClient(eksHandlers());
  const ec2 = fakeClient(ec2Handlers());
  const d = await getEksDetails({ eks, ec2 }, 'prod');

  assert.equal(d.cluster.version, '1.30');
  assert.deepEqual(d.cluster.logging, ['api', 'audit']);
  assert.equal(d.cluster.endpointPublicAccess, true);
  assert.equal(d.cluster.oidcIssuer, 'https://oidc.eks/abc');

  assert.deepEqual(d.network.vpc, { id: 'vpc-1', cidr: '10.0.0.0/16', name: 'main', state: 'available' });
  const subnet = id => d.network.subnets.find(s => s.id === id);
  assert.deepEqual(subnet('subnet-a').usedBy, ['control plane', 'node group general', 'EC2 nodes']);
  assert.deepEqual(subnet('subnet-c').usedBy, ['node group general']);
  assert.deepEqual(subnet('subnet-d').usedBy, ['EC2 nodes']);
  assert.equal(subnet('subnet-a').availableIps, 200);

  const sg = id => d.network.securityGroups.find(g => g.id === id);
  assert.deepEqual(sg('sg-cluster').roles, ['cluster security group']);
  assert.deepEqual(sg('sg-extra').roles, ['additional (control plane)']);
  assert.deepEqual(sg('sg-remote').roles, ['remote access general']);
  assert.equal(sg('sg-cluster').outboundRules, 2);

  const ng = name => d.nodegroups.find(n => n.name === name);
  assert.equal(ng('general').instanceCount, 2);
  assert.equal(ng('arm').architecture, 'arm64');
  assert.equal(ng('arm').healthIssues[0].code, 'AsgInstanceLaunchFailures');
  assert.deepEqual(ng('general').autoScalingGroups, ['eks-general-asg']);

  assert.deepEqual(d.instances.map(i => [i.id, i.nodegroup, i.lifecycle]), [
    ['i-1', 'general', 'on-demand'], ['i-2', 'general', 'on-demand'], ['i-3', 'karpenter/default', 'spot'],
  ]);
  assert.deepEqual(d.addons.map(a => [a.name, a.status]), [['vpc-cni', 'ACTIVE'], ['coredns', 'DEGRADED']]);
  assert.deepEqual(d.warnings, []);
});

test('details reuse the VPC queries: one call each for VPC, subnets and security groups', async () => {
  const eks = fakeClient(eksHandlers());
  const ec2 = fakeClient(ec2Handlers());
  await getEksDetails({ eks, ec2 }, 'prod');
  assert.equal(ec2.count('DescribeVpcsCommand'), 1);
  assert.equal(ec2.count('DescribeSubnetsCommand'), 1);
  assert.equal(ec2.count('DescribeSecurityGroupsCommand'), 1);
  assert.deepEqual(ec2.calls.find(c => c.name === 'DescribeSubnetsCommand').input.SubnetIds.sort(),
    ['subnet-a', 'subnet-b', 'subnet-c', 'subnet-d']);
});

test('details degrade per section with warnings when a permission is missing', async () => {
  const denied = () => { throw Object.assign(new Error('not authorized to perform ec2:DescribeInstances'), { name: 'UnauthorizedOperation' }); };
  const eks = fakeClient(eksHandlers({ ListAddonsCommand: () => { throw new Error('AccessDenied addons'); } }));
  const ec2 = fakeClient(ec2Handlers({ DescribeInstancesCommand: denied }));
  const d = await getEksDetails({ eks, ec2 }, 'prod');
  assert.deepEqual(d.instances, []);
  assert.deepEqual(d.addons, []);
  assert.equal(d.nodegroups.length, 2);
  assert.deepEqual(d.warnings.map(w => w.section).sort(), ['addons', 'instances']);
  assert.match(d.warnings.find(w => w.section === 'instances').message, /DescribeInstances/);
});

test('details fail when the cluster itself cannot be described', async () => {
  const eks = fakeClient(eksHandlers({ DescribeClusterCommand: () => { throw new Error('ResourceNotFoundException'); } }));
  await assert.rejects(getEksDetails({ eks, ec2: fakeClient(ec2Handlers()) }, 'missing'), /ResourceNotFound/);
});

// ── Table summary ────────────────────────────────────────────────────────────

test('table summary: node groups per cluster and a single DescribeInstances for all clusters', async () => {
  const eks = fakeClient(eksHandlers());
  const ec2 = fakeClient(ec2Handlers());
  const summary = await summarizeClusters({ eks, ec2 }, ['prod', 'staging']);
  assert.deepEqual(summary.get('prod'), { nodegroups: ['general', 'arm'], instanceCount: 3 });
  assert.deepEqual(summary.get('staging'), { nodegroups: ['ng'], instanceCount: 1 });
  assert.equal(ec2.count('DescribeInstancesCommand'), 1);
});

test('table summary leaves fields null instead of failing the cluster list', async () => {
  const eks = fakeClient(eksHandlers({ ListNodegroupsCommand: () => { throw new Error('denied'); } }));
  const ec2 = fakeClient(ec2Handlers({ DescribeInstancesCommand: () => { throw new Error('denied'); } }));
  const summary = await summarizeClusters({ eks, ec2 }, ['prod']);
  assert.deepEqual(summary.get('prod'), { nodegroups: null, instanceCount: null });
});
