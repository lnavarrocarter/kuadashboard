'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readApiGateway, readEc2PublicIps, readLambdaUrls, readS3PublicBuckets } = require('./awsPublicEntrypoints');

function commands(names) { return Object.fromEntries(names.map(name => [name, class { constructor(input) { this.input = input; this.commandName = name; } }])); }

test('API Gateway REST and HTTP stages retain default and custom domain names', async () => {
  const c1 = commands(['GetRestApisCommand','GetStagesCommand','GetRestApiCommand','GetDomainNamesCommand','GetBasePathMappingsCommand']);
  const c2 = commands(['GetApisCommand','GetStagesCommand','GetDomainNamesCommand','GetApiMappingsCommand']);
  class APIGatewayClient { async send(c) {
    if (c.commandName === 'GetRestApisCommand') return { items: [{ id: 'rest123', name: 'legacy' }] };
    if (c.commandName === 'GetStagesCommand') return { item: [{ stageName: 'prod' }] };
    if (c.commandName === 'GetRestApiCommand') return { disableExecuteApiEndpoint: true };
    if (c.commandName === 'GetDomainNamesCommand') return { items: [{ domainName: 'api.example.com' }] };
    return { items: [{ restApiId: 'rest123', stage: 'prod', basePath: '(none)' }] };
  } }
  class ApiGatewayV2Client { async send(c) {
    if (c.commandName === 'GetApisCommand') return { Items: [{ ApiId: 'http123', Name: 'web', ProtocolType: 'HTTP', ApiEndpoint: 'https://http123.execute-api.us-east-1.amazonaws.com' }] };
    if (c.commandName === 'GetStagesCommand') return { Items: [{ StageName: '$default' }] };
    if (c.commandName === 'GetDomainNamesCommand') return { Items: [{ DomainName: 'v2.example.com' }] };
    return { Items: [{ ApiId: 'http123', Stage: '$default', ApiMappingKey: 'v1' }] };
  } }
  const sdk = pkg => pkg === 'client-api-gateway' ? { APIGatewayClient, ...c1 } : { ApiGatewayV2Client, ...c2 };
  const result = await readApiGateway({ region: 'us-east-1' }, { sdk });
  const rest = result.entries.find(item => item.id === 'apigateway:rest:rest123:prod');
  assert.equal(rest.hostname, 'rest123.execute-api.us-east-1.amazonaws.com');
  assert.equal(rest.endpointEnabled, false);
  assert.ok(result.entries.some(item => item.hostname === 'api.example.com' && item.hops[1].stage === 'prod'));
  assert.ok(result.entries.some(item => item.hostname === 'v2.example.com' && item.hops[1].apiMappingKey === 'v1'));
});

test('Lambda function URL with AuthType NONE is flagged unauthenticated', async () => {
  const c = commands(['ListFunctionsCommand','GetFunctionUrlConfigCommand']);
  class LambdaClient { async send(command) {
    if (command.commandName === 'ListFunctionsCommand') return { Functions: [{ FunctionName: 'public-api', FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:public-api' }] };
    return { FunctionUrl: 'https://abc.lambda-url.us-east-1.on.aws/', AuthType: 'NONE' };
  } }
  const result = await readLambdaUrls({ region: 'us-east-1' }, { sdk: () => ({ LambdaClient, ...c }) });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].public, true);
  assert.equal(result.entries[0].risk, 'unauthenticated');
});

test('EC2 public addresses include the Advisor sensitive-port classification', async () => {
  const c = commands(['DescribeInstancesCommand','DescribeSecurityGroupsCommand','DescribeAddressesCommand']);
  class EC2Client { async send(command) {
    if (command.commandName === 'DescribeInstancesCommand') return { Reservations: [{ Instances: [{ InstanceId: 'i-12345678', PublicIpAddress: '203.0.113.4', State: { Name: 'running' }, SecurityGroups: [{ GroupId: 'sg-1' }] }] }] };
    if (command.commandName === 'DescribeSecurityGroupsCommand') return { SecurityGroups: [{ GroupId: 'sg-1', IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }] }] };
    return { Addresses: [] };
  } }
  const result = await readEc2PublicIps({ region: 'us-east-1' }, { sdk: () => ({ EC2Client, ...c }) });
  assert.deepEqual(result.entries[0].openSensitivePorts, ['SSH 22']);
});

test('S3 website hosting and public policy are included as public entrypoints', async () => {
  const c = commands(['ListBucketsCommand','GetBucketLocationCommand','GetBucketWebsiteCommand','GetBucketPolicyStatusCommand','GetBucketAclCommand']);
  class S3Client { async send(command) {
    if (command.commandName === 'ListBucketsCommand') return { Buckets: [{ Name: 'public-site' }] };
    if (command.commandName === 'GetBucketLocationCommand') return { LocationConstraint: 'us-west-2' };
    if (command.commandName === 'GetBucketWebsiteCommand') return { WebsiteEndpoint: 'public-site.s3-website-us-west-2.amazonaws.com', IndexDocument: { Suffix: 'index.html' } };
    if (command.commandName === 'GetBucketPolicyStatusCommand') return { PolicyStatus: { IsPublic: true } };
    return { Grants: [] };
  } }
  const result = await readS3PublicBuckets({}, { sdk: () => ({ S3Client, ...c }) });
  assert.equal(result.entries[0].website, true);
  assert.equal(result.entries[0].public, true);
  assert.equal(result.entries[0].hostname, 'public-site.s3-website-us-west-2.amazonaws.com');
});
