'use strict';
/**
 * lib/kua/resourceCatalog/aws.js
 * The resources of an AWS account a KUA Application can hold (#281): list them by type ("every
 * S3 bucket"), search them by text, or resolve one ARN. Every item carries the identity the
 * registry accepts (ARN, account, region) in `attach`, ready for resources.attach.
 *
 * Only List/Describe/Get calls, which AWS does not charge for. Each type is read on its own: a
 * type the profile cannot read is reported in `failures` and the others still answer.
 */

const { lazyModule } = require('../../lazyModule');
const { createSnapshotPager, matchesSearch, mapLimited, catalogError, SNAPSHOT_TTL_MS } = require('./snapshots');
const { resolveAwsConfig } = require('../../awsProfileResolver');

const SDK = {
  lambda: lazyModule('@aws-sdk/client-lambda'),
  ec2: lazyModule('@aws-sdk/client-ec2'),
  s3: lazyModule('@aws-sdk/client-s3'),
  dynamodb: lazyModule('@aws-sdk/client-dynamodb'),
  sqs: lazyModule('@aws-sdk/client-sqs'),
  sns: lazyModule('@aws-sdk/client-sns'),
  sesv2: lazyModule('@aws-sdk/client-sesv2'),
  glue: lazyModule('@aws-sdk/client-glue'),
  sfn: lazyModule('@aws-sdk/client-sfn'),
  elbv2: lazyModule('@aws-sdk/client-elastic-load-balancing-v2'),
  route53: lazyModule('@aws-sdk/client-route-53'),
  cloudfront: lazyModule('@aws-sdk/client-cloudfront'),
  rds: lazyModule('@aws-sdk/client-rds'),
  apigateway: lazyModule('@aws-sdk/client-api-gateway'),
  apigatewayv2: lazyModule('@aws-sdk/client-apigatewayv2'),
  eks: lazyModule('@aws-sdk/client-eks'),
  ecs: lazyModule('@aws-sdk/client-ecs'),
  eventbridge: lazyModule('@aws-sdk/client-eventbridge'),
  sts: lazyModule('@aws-sdk/client-sts'),
};
const CLIENTS = {
  lambda: 'LambdaClient', ec2: 'EC2Client', s3: 'S3Client', dynamodb: 'DynamoDBClient', sqs: 'SQSClient',
  sns: 'SNSClient', sesv2: 'SESv2Client', glue: 'GlueClient', sfn: 'SFNClient', elbv2: 'ElasticLoadBalancingV2Client',
  route53: 'Route53Client', cloudfront: 'CloudFrontClient', rds: 'RDSClient', apigateway: 'APIGatewayClient',
  apigatewayv2: 'ApiGatewayV2Client', eks: 'EKSClient', ecs: 'ECSClient', eventbridge: 'EventBridgeClient', sts: 'STSClient',
};

const MAX_PER_TYPE = 1000;
// Types read at once when several are listed.
const CONCURRENCY = 4;

const tagName = tags => (tags || []).find(tag => tag.Key === 'Name')?.Value || '';
const lastSegment = value => String(value || '').split(/[/:]/).filter(Boolean).pop() || '';

/**
 * Lists one page after another until there is no token or `limit` items were read.
 * `call(token)` returns { items, next }.
 */
async function paginate(call, limit = MAX_PER_TYPE) {
  const items = [];
  let token;
  let truncated = false;
  do {
    const { items: page, next } = await call(token);
    items.push(...page);
    token = next || null;
    if (items.length >= limit && token) { truncated = true; break; }
  } while (token);
  return { items: items.slice(0, limit), truncated: truncated || items.length > limit };
}

// One entry per type: the label shown in pickers and the reader. Readers return
// { items: [{ name, arn, region?, details }], truncated }.
const TYPES = {
  ec2: {
    label: 'EC2 instances',
    async list({ client, region, account }) {
      const ec2 = client('ec2');
      return paginate(async NextToken => {
        const response = await ec2.send(new SDK.ec2.DescribeInstancesCommand({ NextToken, MaxResults: 1000 }));
        const items = (response.Reservations || []).flatMap(reservation => reservation.Instances || []).map(instance => ({
          name: tagName(instance.Tags) || instance.InstanceId,
          arn: `arn:aws:ec2:${region}:${account}:instance/${instance.InstanceId}`,
          details: { instanceId: instance.InstanceId, state: instance.State?.Name || null, instanceType: instance.InstanceType || null, availabilityZone: instance.Placement?.AvailabilityZone || null },
        }));
        return { items, next: response.NextToken };
      });
    },
  },
  'ebs-volume': {
    label: 'EBS volumes',
    async list({ client, region, account }) {
      const ec2 = client('ec2');
      return paginate(async NextToken => {
        const response = await ec2.send(new SDK.ec2.DescribeVolumesCommand({ NextToken, MaxResults: 500 }));
        const items = (response.Volumes || []).map(volume => ({
          name: tagName(volume.Tags) || volume.VolumeId,
          arn: `arn:aws:ec2:${region}:${account}:volume/${volume.VolumeId}`,
          details: {
            volumeId: volume.VolumeId, sizeGiB: volume.Size ?? null, volumeType: volume.VolumeType || null, state: volume.State || null,
            availabilityZone: volume.AvailabilityZone || null,
            attachedTo: (volume.Attachments || []).map(attachment => attachment.InstanceId).filter(Boolean),
          },
        }));
        return { items, next: response.NextToken };
      });
    },
  },
  s3: {
    label: 'S3 buckets',
    global: true,
    async list({ client }) {
      const s3 = client('s3');
      return paginate(async ContinuationToken => {
        const response = await s3.send(new SDK.s3.ListBucketsCommand({ ContinuationToken, MaxBuckets: 1000 }));
        const items = (response.Buckets || []).map(bucket => ({
          name: bucket.Name,
          arn: `arn:aws:s3:::${bucket.Name}`,
          region: bucket.BucketRegion || '',
          details: { bucketRegion: bucket.BucketRegion || null, createdAt: bucket.CreationDate ? new Date(bucket.CreationDate).toISOString() : null },
        }));
        return { items, next: response.ContinuationToken };
      });
    },
  },
  dynamodb: {
    label: 'DynamoDB tables',
    async list({ client, region, account }) {
      const dynamodb = client('dynamodb');
      return paginate(async ExclusiveStartTableName => {
        const response = await dynamodb.send(new SDK.dynamodb.ListTablesCommand({ ExclusiveStartTableName, Limit: 100 }));
        const items = (response.TableNames || []).map(name => ({ name, arn: `arn:aws:dynamodb:${region}:${account}:table/${name}`, details: {} }));
        return { items, next: response.LastEvaluatedTableName };
      });
    },
  },
  sqs: {
    label: 'SQS queues',
    async list({ client, region, account }) {
      const sqs = client('sqs');
      return paginate(async NextToken => {
        const response = await sqs.send(new SDK.sqs.ListQueuesCommand({ NextToken, MaxResults: 1000 }));
        const items = (response.QueueUrls || []).map(url => {
          const name = lastSegment(url);
          return { name, arn: `arn:aws:sqs:${region}:${account}:${name}`, details: { url, fifo: name.endsWith('.fifo') } };
        });
        return { items, next: response.NextToken };
      });
    },
  },
  sns: {
    label: 'SNS topics',
    async list({ client }) {
      const sns = client('sns');
      return paginate(async NextToken => {
        const response = await sns.send(new SDK.sns.ListTopicsCommand({ NextToken }));
        const items = (response.Topics || []).filter(topic => topic.TopicArn).map(topic => ({ name: lastSegment(topic.TopicArn), arn: topic.TopicArn, details: {} }));
        return { items, next: response.NextToken };
      });
    },
  },
  ses: {
    label: 'SES identities',
    async list({ client, region, account }) {
      const ses = client('sesv2');
      return paginate(async NextToken => {
        const response = await ses.send(new SDK.sesv2.ListEmailIdentitiesCommand({ NextToken, PageSize: 1000 }));
        const items = (response.EmailIdentities || []).map(identity => ({
          name: identity.IdentityName,
          arn: `arn:aws:ses:${region}:${account}:identity/${identity.IdentityName}`,
          details: { identityType: identity.IdentityType || null, sendingEnabled: identity.SendingEnabled ?? null, verificationStatus: identity.VerificationStatus || null },
        }));
        return { items, next: response.NextToken };
      });
    },
  },
  glue: {
    label: 'Glue jobs, crawlers and workflows',
    async list({ client, region, account }) {
      const glue = client('glue');
      const arn = (kind, name) => `arn:aws:glue:${region}:${account}:${kind}/${name}`;
      const [jobs, crawlers, workflows] = await Promise.all([
        paginate(async NextToken => {
          const response = await glue.send(new SDK.glue.ListJobsCommand({ NextToken, MaxResults: 1000 }));
          return { items: (response.JobNames || []).map(name => ({ name, arn: arn('job', name), details: { kind: 'job' } })), next: response.NextToken };
        }),
        paginate(async NextToken => {
          const response = await glue.send(new SDK.glue.ListCrawlersCommand({ NextToken, MaxResults: 1000 }));
          return { items: (response.CrawlerNames || []).map(name => ({ name, arn: arn('crawler', name), details: { kind: 'crawler' } })), next: response.NextToken };
        }),
        paginate(async NextToken => {
          const response = await glue.send(new SDK.glue.ListWorkflowsCommand({ NextToken, MaxResults: 25 }));
          return { items: (response.Workflows || []).map(name => ({ name, arn: arn('workflow', name), details: { kind: 'workflow' } })), next: response.NextToken };
        }),
      ]);
      return { items: [...jobs.items, ...crawlers.items, ...workflows.items], truncated: jobs.truncated || crawlers.truncated || workflows.truncated };
    },
  },
  stepfunctions: {
    label: 'Step Functions state machines',
    async list({ client }) {
      const sfn = client('sfn');
      return paginate(async nextToken => {
        const response = await sfn.send(new SDK.sfn.ListStateMachinesCommand({ nextToken, maxResults: 1000 }));
        const items = (response.stateMachines || []).map(machine => ({ name: machine.name, arn: machine.stateMachineArn, details: { type: machine.type || null } }));
        return { items, next: response.nextToken };
      });
    },
  },
  elb: {
    label: 'Load balancers (ALB, NLB)',
    async list({ client }) {
      const elb = client('elbv2');
      return paginate(async Marker => {
        const response = await elb.send(new SDK.elbv2.DescribeLoadBalancersCommand({ Marker, PageSize: 400 }));
        const items = (response.LoadBalancers || []).map(lb => ({
          name: lb.LoadBalancerName, arn: lb.LoadBalancerArn,
          details: { type: lb.Type || null, scheme: lb.Scheme || null, dnsName: lb.DNSName || null, state: lb.State?.Code || null },
        }));
        return { items, next: response.NextMarker };
      });
    },
  },
  targetgroup: {
    label: 'Target groups',
    async list({ client }) {
      const elb = client('elbv2');
      return paginate(async Marker => {
        const response = await elb.send(new SDK.elbv2.DescribeTargetGroupsCommand({ Marker, PageSize: 400 }));
        const items = (response.TargetGroups || []).map(group => ({
          name: group.TargetGroupName, arn: group.TargetGroupArn,
          details: { protocol: group.Protocol || null, port: group.Port ?? null, targetType: group.TargetType || null, loadBalancerArns: group.LoadBalancerArns || [] },
        }));
        return { items, next: response.NextMarker };
      });
    },
  },
  route53: {
    label: 'Route 53 hosted zones',
    global: true,
    async list({ client }) {
      const route53 = client('route53');
      return paginate(async Marker => {
        const response = await route53.send(new SDK.route53.ListHostedZonesCommand({ Marker, MaxItems: 100 }));
        const items = (response.HostedZones || []).map(zone => {
          const id = lastSegment(zone.Id);
          return {
            name: String(zone.Name || '').replace(/\.$/, ''), arn: `arn:aws:route53:::hostedzone/${id}`, region: '',
            details: { hostedZoneId: id, privateZone: !!zone.Config?.PrivateZone, recordCount: zone.ResourceRecordSetCount ?? null },
          };
        });
        return { items, next: response.IsTruncated ? response.NextMarker : null };
      });
    },
  },
  cloudfront: {
    label: 'CloudFront distributions',
    global: true,
    async list({ client }) {
      const cloudfront = client('cloudfront');
      return paginate(async Marker => {
        const response = await cloudfront.send(new SDK.cloudfront.ListDistributionsCommand({ Marker, MaxItems: 100 }));
        const list = response.DistributionList || {};
        const items = (list.Items || []).map(distribution => ({
          name: distribution.Aliases?.Items?.[0] || distribution.DomainName || distribution.Id,
          arn: distribution.ARN, region: 'global',
          details: { distributionId: distribution.Id, domainName: distribution.DomainName || null, aliases: distribution.Aliases?.Items || [], status: distribution.Status || null },
        }));
        return { items, next: list.IsTruncated ? list.NextMarker : null };
      });
    },
  },
  rds: {
    label: 'RDS databases',
    async list({ client }) {
      const rds = client('rds');
      return paginate(async Marker => {
        const response = await rds.send(new SDK.rds.DescribeDBInstancesCommand({ Marker, MaxRecords: 100 }));
        const items = (response.DBInstances || []).map(db => ({
          name: db.DBInstanceIdentifier, arn: db.DBInstanceArn,
          details: { engine: db.Engine || null, status: db.DBInstanceStatus || null, instanceClass: db.DBInstanceClass || null },
        }));
        return { items, next: response.Marker };
      });
    },
  },
  apigateway: {
    label: 'API Gateway APIs',
    async list({ client, region }) {
      const rest = client('apigateway');
      const http = client('apigatewayv2');
      const [restApis, httpApis] = await Promise.all([
        paginate(async position => {
          const response = await rest.send(new SDK.apigateway.GetRestApisCommand({ position, limit: 500 }));
          return { items: (response.items || []).map(api => ({ name: api.name || api.id, arn: `arn:aws:apigateway:${region}::/restapis/${api.id}`, details: { apiId: api.id, protocol: 'REST' } })), next: response.position };
        }),
        paginate(async NextToken => {
          const response = await http.send(new SDK.apigatewayv2.GetApisCommand({ NextToken, MaxResults: '500' }));
          return { items: (response.Items || []).map(api => ({ name: api.Name || api.ApiId, arn: `arn:aws:apigateway:${region}::/apis/${api.ApiId}`, details: { apiId: api.ApiId, protocol: api.ProtocolType || null } })), next: response.NextToken };
        }),
      ]);
      return { items: [...restApis.items, ...httpApis.items], truncated: restApis.truncated || httpApis.truncated };
    },
  },
  eks: {
    label: 'EKS clusters',
    async list({ client, region, account }) {
      const eks = client('eks');
      return paginate(async nextToken => {
        const response = await eks.send(new SDK.eks.ListClustersCommand({ nextToken, maxResults: 100 }));
        const items = (response.clusters || []).map(name => ({ name, arn: `arn:aws:eks:${region}:${account}:cluster/${name}`, details: {} }));
        return { items, next: response.nextToken };
      });
    },
  },
  ecs: {
    label: 'ECS clusters and services',
    async list({ client }) {
      const ecs = client('ecs');
      const clusters = await paginate(async nextToken => {
        const response = await ecs.send(new SDK.ecs.ListClustersCommand({ nextToken, maxResults: 100 }));
        return { items: (response.clusterArns || []).map(arn => ({ name: lastSegment(arn), arn, details: { kind: 'cluster' } })), next: response.nextToken };
      });
      const services = [];
      let truncated = clusters.truncated;
      for (const cluster of clusters.items) {
        const page = await paginate(async nextToken => {
          const response = await ecs.send(new SDK.ecs.ListServicesCommand({ cluster: cluster.arn, nextToken, maxResults: 100 }));
          return { items: (response.serviceArns || []).map(arn => ({ name: lastSegment(arn), arn, details: { kind: 'service', cluster: cluster.name } })), next: response.nextToken };
        }, MAX_PER_TYPE - services.length);
        services.push(...page.items);
        truncated ||= page.truncated;
        if (services.length >= MAX_PER_TYPE) { truncated = true; break; }
      }
      return { items: [...clusters.items, ...services], truncated };
    },
  },
  eventbridge: {
    label: 'EventBridge rules',
    async list({ client }) {
      const events = client('eventbridge');
      const buses = await paginate(async NextToken => {
        const response = await events.send(new SDK.eventbridge.ListEventBusesCommand({ NextToken, Limit: 100 }));
        return { items: (response.EventBuses || []).map(bus => bus.Name), next: response.NextToken };
      });
      const rules = [];
      for (const bus of buses.items.length ? buses.items : ['default']) {
        const page = await paginate(async NextToken => {
          const response = await events.send(new SDK.eventbridge.ListRulesCommand({ EventBusName: bus, NextToken, Limit: 100 }));
          return { items: (response.Rules || []).map(rule => ({ name: rule.Name, arn: rule.Arn, details: { eventBus: bus, state: rule.State || null, schedule: rule.ScheduleExpression || null } })), next: response.NextToken };
        }, MAX_PER_TYPE - rules.length);
        rules.push(...page.items);
        if (rules.length >= MAX_PER_TYPE) return { items: rules, truncated: true };
      }
      return { items: rules, truncated: buses.truncated };
    },
  },
  lambda: {
    label: 'Lambda functions',
    async list({ client }) {
      const lambda = client('lambda');
      return paginate(async Marker => {
        const response = await lambda.send(new SDK.lambda.ListFunctionsCommand({ Marker, MaxItems: 50 }));
        const items = (response.Functions || []).map(fn => ({ name: fn.FunctionName, arn: fn.FunctionArn, details: { runtime: fn.Runtime || null } }));
        return { items, next: response.NextMarker };
      });
    },
  },
};

const TYPE_NAMES = Object.keys(TYPES);

/** The catalog type of an ARN, or null when the catalog does not list that kind of resource. */
function typeOfArn(arn) {
  const parts = String(arn || '').split(':');
  if (parts[0] !== 'arn' || parts.length < 6) return null;
  const service = parts[2];
  const resource = parts.slice(5).join(':');
  const byService = {
    lambda: resource.startsWith('function:') ? 'lambda' : null,
    ec2: resource.startsWith('instance/') ? 'ec2' : resource.startsWith('volume/') ? 'ebs-volume' : null,
    s3: 's3',
    dynamodb: resource.startsWith('table/') ? 'dynamodb' : null,
    sqs: 'sqs',
    sns: 'sns',
    ses: resource.startsWith('identity/') ? 'ses' : null,
    glue: /^(job|crawler|workflow)\//.test(resource) ? 'glue' : null,
    states: resource.startsWith('stateMachine:') ? 'stepfunctions' : null,
    elasticloadbalancing: resource.startsWith('loadbalancer/') ? 'elb' : resource.startsWith('targetgroup/') ? 'targetgroup' : null,
    route53: resource.startsWith('hostedzone/') ? 'route53' : null,
    cloudfront: resource.startsWith('distribution/') ? 'cloudfront' : null,
    rds: resource.startsWith('db:') ? 'rds' : null,
    apigateway: /^\/(restapis|apis)\//.test(resource) ? 'apigateway' : null,
    eks: resource.startsWith('cluster/') ? 'eks' : null,
    ecs: /^(cluster|service)\//.test(resource) ? 'ecs' : null,
    events: resource.startsWith('rule/') ? 'eventbridge' : null,
  };
  return byService[service] || null;
}

function errorCode(error) {
  const name = String(error?.name || error?.Code || '');
  if (/AccessDenied|UnauthorizedOperation|AuthorizationError|not authorized/i.test(`${name} ${error?.message || ''}`)) return 'access_denied';
  if (/ExpiredToken|InvalidClientTokenId|UnrecognizedClient/i.test(name)) return 'credentials';
  return name || 'list_failed';
}

function createAwsResourceCatalog({
  configResolver = resolveAwsConfig,
  clientFactory = (service, config) => new SDK[service][CLIENTS[service]](config),
  now = () => Date.now(),
  snapshotTtlMs = SNAPSHOT_TTL_MS,
} = {}) {
  const pager = createSnapshotPager({ now, ttlMs: snapshotTtlMs });

  function types() {
    return TYPE_NAMES.map(type => ({ type, label: TYPES[type].label, global: !!TYPES[type].global }));
  }

  async function read({ profileId, region, types: requested }) {
    const config = { ...await configResolver(profileId), region };
    const clients = new Map();
    const client = service => {
      if (!clients.has(service)) clients.set(service, clientFactory(service, config));
      return clients.get(service);
    };
    const identity = await client('sts').send(new SDK.sts.GetCallerIdentityCommand({}));
    const account = String(identity?.Account || '');
    if (!/^\d{12}$/.test(account)) throw catalogError('The AWS account of this profile could not be verified', 502, 'ACCOUNT_UNKNOWN');
    const failures = [];
    const truncatedTypes = [];
    const lists = await mapLimited(requested, CONCURRENCY, async type => {
      try {
        const result = await TYPES[type].list({ client, region, account });
        if (result.truncated) truncatedTypes.push(type);
        return result.items.map(item => {
          const location = TYPES[type].global ? (item.region || '') : region;
          const scopeId = type === 's3' || type === 'route53' ? '' : account;
          return {
            type, name: item.name, arn: item.arn, account, region: location, details: item.details || {},
            attach: { provider: 'aws', type, key: item.arn, arn: item.arn, name: item.name, ...(scopeId ? { scopeId } : {}), ...(location ? { location } : {}) },
          };
        });
      } catch (error) {
        failures.push({ type, code: errorCode(error) });
        return [];
      }
    });
    return { account, items: lists.flat(), failures, truncatedTypes };
  }

  /**
   * One page of the catalog. A new search reads AWS; `cursor` continues the same snapshot for five
   * minutes. `arn` resolves one resource (found: false when it does not exist or is not readable).
   */
  async function list({ profileId, region, types: requestedTypes, search, arn, limit, cursor } = {}) {
    if (cursor) {
      const { snapshot, offset } = pager.resume(cursor, profileId);
      return pager.page(snapshot, { offset, limit, owner: profileId });
    }
    if (!profileId) throw catalogError('profile is required', 400, 'INVALID');
    let types = Array.isArray(requestedTypes) && requestedTypes.length ? [...new Set(requestedTypes)] : TYPE_NAMES;
    let wanted = null;
    if (arn) {
      const type = typeOfArn(arn);
      if (!type) throw catalogError(`The catalog does not list this kind of ARN: ${arn}`, 400, 'UNSUPPORTED_ARN');
      types = [type];
      wanted = String(arn);
      // The region of the ARN, when it has one (S3, Route 53 and CloudFront are global).
      const arnRegion = wanted.split(':')[3];
      if (arnRegion) region = arnRegion;
    }
    const unknown = types.filter(type => !TYPES[type]);
    if (unknown.length) throw catalogError(`Unknown type(s): ${unknown.join(', ')}. Known: ${TYPE_NAMES.join(', ')}`, 400, 'INVALID');
    region = region || 'us-east-1';
    const result = await read({ profileId, region, types });
    const items = result.items.filter(item => (!wanted || item.arn === wanted) && matchesSearch(item, search));
    const snapshot = {
      generatedAt: new Date(now()).toISOString(), account: result.account, region, types,
      failures: result.failures, truncatedTypes: result.truncatedTypes, items,
      ...(wanted ? { arn: wanted, found: items.length > 0 } : {}),
    };
    return pager.page(snapshot, { offset: 0, limit, owner: profileId });
  }

  return { types, list };
}

module.exports = { createAwsResourceCatalog, typeOfArn, AWS_CATALOG_TYPES: TYPE_NAMES };
