// Where an AWS resource of a map or of a KUA Application can be opened (#239): the tab of KUA's AWS
// view that lists it (with its name in that tab's search), or, for a resource KUA has no tab for
// (security groups, launch templates, IAM...), the AWS console page of that resource in its region.
// The CloudFormation type decides first: "ec2" is also the resourceType of a security group.

const TAB_BY_KIND = {
  'AWS::Lambda::Function': 'lambda',
  'AWS::EC2::Instance': 'ec2',
  'AWS::Events::Rule': 'eventbridge',
  'AWS::StepFunctions::StateMachine': 'stepfn',
  'AWS::SQS::Queue': 'sqs',
  'AWS::SNS::Topic': 'sns',
  'AWS::DynamoDB::Table': 'dynamodb',
  'AWS::S3::Bucket': 's3',
  'AWS::ECS::Service': 'ecs',
  'AWS::ECS::Cluster': 'ecs',
  'AWS::EKS::Cluster': 'eks',
  'AWS::ECR::Repository': 'ecr',
  'AWS::RDS::DBInstance': 'rds',
  'AWS::RDS::DBCluster': 'rds',
  'AWS::ApiGateway::RestApi': 'apigw',
  'AWS::ApiGatewayV2::Api': 'apigw',
  'AWS::CloudFront::Distribution': 'cloudfront',
  'AWS::Cognito::UserPool': 'cognito',
  'AWS::SecretsManager::Secret': 'secrets',
  'AWS::ElasticLoadBalancingV2::LoadBalancer': 'elb',
  'AWS::ElasticLoadBalancingV2::TargetGroup': 'elb',
  'AWS::ElasticLoadBalancing::LoadBalancer': 'elb',
  'AWS::Logs::LogGroup': 'cwlogs',
  'AWS::Glue::Job': 'glue',
  'AWS::Glue::Database': 'glue',
  'AWS::Glue::Connection': 'glue',
  'AWS::CloudWatch::Dashboard': 'cwdashboards',
  'AWS::CloudFormation::Stack': 'cloudformation',
}

// Without a CloudFormation type: the short resourceType of discovery and Observability.
const TAB_BY_TYPE = {
  lambda: 'lambda', ec2: 'ec2', eventbridge: 'eventbridge', stepfunctions: 'stepfn', sqs: 'sqs', sns: 'sns',
  dynamodb: 'dynamodb', s3: 's3', ecs: 'ecs', eks: 'eks', ecr: 'ecr', rds: 'rds', apigateway: 'apigw', apigatewayv2: 'apigw',
  'api-route': 'apigw', cloudfront: 'cloudfront', cognito: 'cognito', secretsmanager: 'secrets', loadbalancer: 'elb',
  elb: 'elb', targetgroup: 'elb', glue: 'glue', cloudformation: 'cloudformation',
}

const KIND_PREFIX = /^(AWS::[A-Za-z0-9]+::[A-Za-z0-9]+):(.+)$/

/** The CloudFormation type and the identifier of a node or registry resource. */
export function awsIdentity(resource = {}) {
  const raw = String(resource.nativeId || resource.nativeIdentifier || resource.discoveryKey || '')
  const match = KIND_PREFIX.exec(raw)
  const kind = /^AWS::/.test(String(resource.kind || '')) ? resource.kind : match?.[1] || ''
  const identifier = match?.[2] || String(resource.arn || '') || (raw.startsWith('arn:') ? raw : '') || String(resource.name || resource.displayName || '')
  return { kind, identifier }
}

function arnRegion(value) {
  const parts = String(value || '').split(':')
  return parts[0] === 'arn' ? parts[3] || '' : ''
}

/** The region of the resource: its own, its ARN's, or its registry location. */
export function awsRegion(resource = {}) {
  return resource.region || arnRegion(resource.arn) || arnRegion(awsIdentity(resource).identifier) || resource.location || ''
}

// What to type in the tab's search: the name AWS shows in that list.
function searchTerm(tab, kind, identifier, resource) {
  const value = String(identifier || '')
  if (tab === 'elb' && value.startsWith('arn:')) return value.split('/')[value.includes(':loadbalancer/') ? 2 : 1] || resource.name
  if (tab === 'ec2' && /^i-[0-9a-f]+$/.test(resource.instanceId || '')) return resource.instanceId
  if (value.startsWith('arn:')) return value.split(/[:/]/).pop()
  return resource.name || resource.displayName || value
}

/** The tab of KUA's AWS view and the search that shows the resource, or null. */
export function awsViewTarget(resource = {}) {
  if (resource.provider && resource.provider !== 'aws') return null
  const { kind, identifier } = awsIdentity(resource)
  const tab = kind ? TAB_BY_KIND[kind] : TAB_BY_TYPE[String(resource.resourceType || '').toLowerCase()]
  if (!tab) return null
  return { tab, search: searchTerm(tab, kind, identifier, resource) }
}

/** The AWS console page of a resource KUA has no tab for, or ''. Opening it changes nothing. */
export function awsConsoleUrl(resource = {}) {
  if (resource.provider && resource.provider !== 'aws') return ''
  const { kind, identifier } = awsIdentity(resource)
  const region = awsRegion(resource) || 'us-east-1'
  const id = encodeURIComponent(String(identifier).split(/[:/]/).pop())
  const base = `https://${region}.console.aws.amazon.com`
  switch (kind) {
    case 'AWS::EC2::SecurityGroup': return `${base}/ec2/home?region=${region}#SecurityGroup:groupId=${id}`
    case 'AWS::EC2::SecurityGroupIngress':
    case 'AWS::EC2::SecurityGroupEgress': return `${base}/ec2/home?region=${region}#ModifySecurityGroupRules:securityGroupRuleId=${id}`
    case 'AWS::EC2::LaunchTemplate': return `${base}/ec2/home?region=${region}#LaunchTemplateDetails:launchTemplateId=${id}`
    case 'AWS::EC2::VPC': return `${base}/vpcconsole/home?region=${region}#VpcDetails:VpcId=${id}`
    case 'AWS::EC2::Subnet': return `${base}/vpcconsole/home?region=${region}#SubnetDetails:subnetId=${id}`
    case 'AWS::AutoScaling::AutoScalingGroup': return `${base}/ec2/home?region=${region}#AutoScalingGroupDetails:id=${id}`
    case 'AWS::EKS::AccessEntry': {
      const cluster = encodeURIComponent(String(identifier).split('|').pop())
      return `${base}/eks/home?region=${region}#/clusters/${cluster}?selectedTab=cluster-access-tab`
    }
    case 'AWS::IAM::Role': return `https://console.aws.amazon.com/iam/home#/roles/details/${id}`
    case 'AWS::IAM::ManagedPolicy': return `https://console.aws.amazon.com/iam/home#/policies/details/${encodeURIComponent(String(identifier))}`
    case 'AWS::KMS::Key': return `${base}/kms/home?region=${region}#/kms/keys/${id}`
    case 'AWS::KinesisFirehose::DeliveryStream': return `${base}/firehose/home?region=${region}#/details/${id}`
    default: return ''
  }
}

/**
 * What to tell before opening the AWS view (#239 N06): { key, params, tone } or null. The view lists
 * the region of the profile, and an ambiguous account opens with the profile selected in KUA.
 */
export function awsDestinationNotice({ resource = {}, target = {}, profileId = '', profileRegion = '' } = {}) {
  const name = target.search || resource.name || resource.displayName || ''
  if (resource.awsAmbiguous) return { key: 'app.awsDestination.ambiguous', params: { name, profile: profileId || '-' }, tone: 'warning' }
  if (resource.awsRegion && profileRegion && resource.awsRegion !== profileRegion) {
    return { key: 'app.awsDestination.otherRegion', params: { name, region: resource.awsRegion, profile: profileId, profileRegion }, tone: 'warning' }
  }
  if (!profileId) return null
  const where = [resource.awsAccountId, resource.awsRegion || profileRegion].filter(Boolean).join(' · ')
  return { key: 'app.awsDestination.opening', params: { name, where: where || '-', profile: profileId }, tone: 'info' }
}
