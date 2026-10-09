'use strict';
/**
 * lib/architecture/awsDrift.js
 * Whether the AWS resources drawn in a map still exist (#239).
 *
 * Each drawn resource with a CloudFormation type (AWS::EC2::SecurityGroup, ...) and an identifier is
 * read with AWS Cloud Control GetResource, with the profile of this computer bound to its account:
 * a read with no charge of its own, nothing changes in the account. A resource Cloud Control says
 * does not exist is "gone"; one it cannot read (type not supported, no connection here, access
 * denied, throttled) is "not verified", never gone. Classic load balancers, which Cloud Control
 * does not support, are read with DescribeLoadBalancers.
 */

const { lazyModule } = require('../lazyModule');
const cloudControlSdk = lazyModule('@aws-sdk/client-cloudcontrol');
const elbSdk = lazyModule('@aws-sdk/client-elastic-load-balancing');
const { resolveAwsConfig } = require('../awsProfileResolver');

const CONCURRENCY = 4;
const MAX_RESOURCES = 300;
const NOT_FOUND = new Set(['ResourceNotFoundException', 'NotFoundException', 'LoadBalancerNotFound', 'AccessPointNotFoundException']);
const UNSUPPORTED = new Set(['UnsupportedActionException', 'TypeNotFoundException', 'GeneralServiceException']);

// The types KUA verifies and the shape of the Cloud Control identifier each expects. A node whose
// identifier does not have that shape (a name drawn in a diagram, a template's logical id) is not
// verified: asking Cloud Control for it would answer "not found" for a resource that exists.
const lastSegment = value => String(value).split(/[:/]/).pop();
const ARN = /^arn:aws[a-z-]*:/;
const VERIFIED_TYPES = {
  'AWS::EC2::SecurityGroup': { shape: /^sg-[0-9a-f]{8,17}$/ },
  'AWS::EC2::SecurityGroupIngress': { shape: /^sgr-[0-9a-f]{8,17}$/ },
  'AWS::EC2::SecurityGroupEgress': { shape: /^sgr-[0-9a-f]{8,17}$/ },
  'AWS::EC2::LaunchTemplate': { shape: /^lt-[0-9a-f]{8,17}$/ },
  'AWS::EC2::Instance': { shape: /^i-[0-9a-f]{8,17}$/ },
  'AWS::AutoScaling::AutoScalingGroup': { shape: /^[\w.-]{1,255}$/ },
  'AWS::EKS::Cluster': { shape: /^[\w-]{1,100}$/, fromArn: true },
  'AWS::EKS::AccessEntry': { shape: /^arn:aws[a-z-]*:iam::\d{12}:[^|]+\|[\w-]+$/ },
  'AWS::ElasticLoadBalancing::LoadBalancer': { shape: /^[a-zA-Z0-9-]{1,32}$/ },
  'AWS::ElasticLoadBalancingV2::LoadBalancer': { shape: /^arn:aws[a-z-]*:elasticloadbalancing:.+:loadbalancer\// },
  'AWS::ElasticLoadBalancingV2::TargetGroup': { shape: /^arn:aws[a-z-]*:elasticloadbalancing:.+:targetgroup\// },
  'AWS::Lambda::Function': { shape: /^[\w-]{1,64}$/, fromArn: true },
  'AWS::DynamoDB::Table': { shape: /^[\w.-]{3,255}$/, fromArn: true },
  'AWS::S3::Bucket': { shape: /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, fromArn: true },
  'AWS::SNS::Topic': { shape: ARN },
  'AWS::SQS::Queue': { shape: /^https:\/\/sqs\./, build: (identifier, location) => (/^https:/.test(identifier) ? identifier
    : location?.accountId && location?.region ? `https://sqs.${location.region}.amazonaws.com/${location.accountId}/${lastSegment(identifier)}` : '') },
  'AWS::SecretsManager::Secret': { shape: ARN },
  'AWS::KMS::Key': { shape: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/ },
  'AWS::Logs::LogGroup': { shape: /^[\w./#-]{1,512}$/ },
  'AWS::ECR::Repository': { shape: /^[a-z0-9][a-z0-9._/-]{1,255}$/ },
  'AWS::CloudFront::Distribution': { shape: /^E[A-Z0-9]{8,20}$/ },
  'AWS::ApiGateway::RestApi': { shape: /^[a-z0-9]{10}$/ },
  'AWS::ApiGatewayV2::Api': { shape: /^[a-z0-9]{10}$/ },
  'AWS::Cognito::UserPool': { shape: /^[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]+$/ },
  'AWS::StepFunctions::StateMachine': { shape: /^arn:aws[a-z-]*:states:/ },
  'AWS::Events::Rule': { shape: /^arn:aws[a-z-]*:events:/ },
  'AWS::IAM::Role': { shape: /^[\w+=,.@-]{1,64}$/, fromArn: true },
  'AWS::IAM::ManagedPolicy': { shape: /^arn:aws[a-z-]*:iam::\d{12}:policy\// },
  'AWS::KinesisFirehose::DeliveryStream': { shape: /^[\w.-]{1,64}$/, fromArn: true },
};
// "apigateway-129", "cognito-081": names a diagram gave a component, not AWS identifiers.
const PLACEHOLDER = /^[a-z0-9]+-\d{3}$/;

/** The Cloud Control identifier of a drawn node, or '' when KUA does not verify it. */
function awsIdentifier(node, location = null) {
  const kind = String(node.kind || '');
  const type = VERIFIED_TYPES[kind];
  if (!type) return '';
  const value = String(node.nativeId || node.discoveryKey || '');
  let identifier = value.startsWith(`${kind}:`) ? value.slice(kind.length + 1) : '';
  if (!identifier && node.physicalId) identifier = String(node.physicalId);
  if (!identifier && node.arn) identifier = String(node.arn);
  if (!identifier) return '';
  if (type.fromArn && ARN.test(identifier)) identifier = lastSegment(identifier);
  if (type.build) identifier = type.build(identifier, location);
  if (!identifier || PLACEHOLDER.test(identifier) || !type.shape.test(identifier)) return '';
  return identifier;
}

function awsNodes(document) {
  return (document?.nodes || []).filter(node => node.provider === 'aws' && /^AWS::[A-Za-z0-9]+::[A-Za-z0-9]+$/.test(String(node.kind || '')));
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function defaultReader() {
  const clients = new Map();
  async function client(kind, { profileId, region }) {
    const key = `${kind}|${profileId}|${region}`;
    if (!clients.has(key)) {
      const config = await resolveAwsConfig(profileId);
      const options = { ...config, region: region || config.region, maxAttempts: 2 };
      clients.set(key, kind === 'elb' ? new elbSdk.ElasticLoadBalancingClient(options) : new cloudControlSdk.CloudControlClient(options));
    }
    return clients.get(key);
  }
  return {
    async exists(node, location, identifier) {
      if (node.kind === 'AWS::ElasticLoadBalancing::LoadBalancer') {
        const elb = await client('elb', location);
        await elb.send(new elbSdk.DescribeLoadBalancersCommand({ LoadBalancerNames: [identifier] }));
        return true;
      }
      const cloudControl = await client('cloudcontrol', location);
      await cloudControl.send(new cloudControlSdk.GetResourceCommand({ TypeName: node.kind, Identifier: identifier }));
      return true;
    },
  };
}

/**
 * @param document  the map
 * @param locate    node → { profileId, region } of the connection bound on this computer, or null
 * @param reader    { exists(node, location) } — throws the AWS error when it cannot read
 */
async function checkAwsMap(document, { locate, reader = defaultReader() } = {}) {
  const nodes = awsNodes(document).slice(0, MAX_RESOURCES);
  const changes = [];
  const notVerified = { unsupported: 0, noConnection: 0, denied: 0, failed: 0 };
  let present = 0;
  const outcomes = await mapLimit(nodes, CONCURRENCY, async node => {
    const location = locate ? locate(node) : null;
    // Without the account, an SQS URL cannot be built: the type decides first, then the connection.
    if (!awsIdentifier(node, { accountId: '000000000000', region: 'us-east-1' })) return { node, outcome: 'unsupported' };
    if (!location?.profileId) return { node, outcome: 'noConnection' };
    const identifier = awsIdentifier(node, location);
    if (!identifier) return { node, outcome: 'noConnection' };
    try {
      await reader.exists(node, location, identifier);
      return { node, outcome: 'present' };
    } catch (error) {
      const name = error?.name || error?.Code || '';
      if (NOT_FOUND.has(name) || /does not exist|not found/i.test(error?.message || '') && !/profile/i.test(error?.message || '')) return { node, outcome: 'gone' };
      if (UNSUPPORTED.has(name) || /not supported|unsupported/i.test(error?.message || '')) return { node, outcome: 'unsupported' };
      if (/AccessDenied|UnauthorizedOperation|NotAuthorized/i.test(name)) return { node, outcome: 'denied' };
      return { node, outcome: 'failed', error: error?.message || name };
    }
  });
  for (const { node, outcome } of outcomes) {
    if (outcome === 'present') present += 1;
    else if (outcome === 'gone') {
      changes.push({ nodeId: node.id, name: node.name, provider: 'aws', resourceType: node.resourceType, kind: node.kind, namespace: '', context: '', change: 'gone', successors: [] });
    } else notVerified[outcome] += 1;
  }
  return { checked: nodes.length, present, changes, notVerified };
}

module.exports = { awsIdentifier, awsNodes, checkAwsMap, VERIFIED_TYPES };
