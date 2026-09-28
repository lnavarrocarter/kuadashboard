'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { classifyAwsError, commandToAction, extractRouteCatalog, buildAccessRequest } = require('./awsAccess');

const deniedMessage = (action, resource) =>
  `User: arn:aws:iam::123456789012:user/dev is not authorized to perform: ${action} on resource: ${resource} because no identity-based policy allows the ${action} action`;

test('classifyAwsError reads the action, resource and principal of a denial', () => {
  const err = Object.assign(new Error(deniedMessage('states:ListStateMachines', 'arn:aws:states:us-east-1:123456789012:stateMachine:*')), { name: 'AccessDeniedException' });
  assert.deepEqual(classifyAwsError(err), {
    kind: 'denied',
    message: err.message,
    action: 'states:ListStateMachines',
    resource: 'arn:aws:states:us-east-1:123456789012:stateMachine:*',
    principal: 'arn:aws:iam::123456789012:user/dev',
  });
});

test('classifyAwsError reads assumed-role principals', () => {
  const err = Object.assign(new Error('User: arn:aws:sts::123456789012:assumed-role/ReadOnly/nacho is not authorized to perform: dynamodb:Scan on resource: arn:aws:dynamodb:us-east-1:123456789012:table/orders'), { name: 'AccessDeniedException' });
  const result = classifyAwsError(err);
  assert.equal(result.principal, 'arn:aws:sts::123456789012:assumed-role/ReadOnly/nacho');
  assert.equal(result.action, 'dynamodb:Scan');
  assert.equal(result.resource, 'arn:aws:dynamodb:us-east-1:123456789012:table/orders');
});

test('commandToAction maps SDK operations to IAM action names', () => {
  assert.equal(commandToAction('client-lambda', 'ListFunctions'), 'lambda:ListFunctions');
  assert.equal(commandToAction('client-lambda', 'Invoke'), 'lambda:InvokeFunction');
  assert.equal(commandToAction('client-sfn', 'ListStateMachines'), 'states:ListStateMachines');
  assert.equal(commandToAction('client-eventbridge', 'ListRules'), 'events:ListRules');
  assert.equal(commandToAction('client-cloudwatch-logs', 'FilterLogEvents'), 'logs:FilterLogEvents');
  assert.equal(commandToAction('client-cognito-identity-provider', 'ListUsers'), 'cognito-idp:ListUsers');
  assert.equal(commandToAction('client-docdb', 'DescribeDBClusters'), 'rds:DescribeDBClusters');
  assert.equal(commandToAction('client-s3', 'ListBuckets'), 's3:ListAllMyBuckets');
  assert.equal(commandToAction('client-s3', 'ListObjectsV2'), 's3:ListBucket');
  assert.equal(commandToAction('client-s3', 'GetBucketEncryption'), 's3:GetEncryptionConfiguration');
  assert.equal(commandToAction('client-api-gateway', 'GetRestApis'), 'apigateway:GET');
  assert.equal(commandToAction('client-apigatewayv2', 'DeleteRoute'), 'apigateway:DELETE');
  assert.equal(commandToAction('client-sts', 'GetCallerIdentity'), null);
  assert.equal(commandToAction('client-sso-oidc', 'CreateToken'), null);
});

test('extractRouteCatalog collects the actions each route sends', () => {
  const source = `
router.get('/things', async (req, res) => {
  const { LambdaClient, ListFunctionsCommand, GetFunctionCommand } = require('@aws-sdk/client-lambda');
  await client.send(new ListFunctionsCommand({}));
  await client.send(new GetFunctionCommand({}));
});

router.post('/things/:id/run', async (req, res) => {
  const { SFNClient, StartExecutionCommand: Start } = require('@aws-sdk/client-sfn');
  const { ListClustersCommand } = require('@aws-sdk/client-eks');
  await client.send(new ListClustersCommand({}));
});

router.get('/local', (req, res) => res.json([]));
`;
  assert.deepEqual(extractRouteCatalog(source), {
    'GET /things': ['lambda:GetFunction', 'lambda:ListFunctions'],
    'POST /things/:id/run': ['eks:ListClusters'],
  });
});

test('the bundled catalog is in sync with routes/aws.js (run scripts/generate-aws-iam-catalog.js)', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/aws.js'), 'utf8');
  assert.deepEqual(require('./awsIamCatalog.json'), extractRouteCatalog(source));
});

test('the bundled catalog covers the main AWS list routes', () => {
  const catalog = require('./awsIamCatalog.json');
  assert.deepEqual(catalog['GET /ec2'], ['ec2:DescribeInstances']);
  assert.deepEqual(catalog['GET /lambda'], ['lambda:ListFunctions']);
  assert.ok(catalog['GET /s3'].includes('s3:ListAllMyBuckets'));
  assert.deepEqual(catalog['POST /lambda/:name/invoke'], ['lambda:InvokeFunction']);
});

test('buildAccessRequest grants the failed action on its resource plus the rest of the screen', () => {
  const error = classifyAwsError(Object.assign(new Error(deniedMessage('lambda:GetFunction', 'arn:aws:lambda:us-east-1:123456789012:function:api')), { name: 'AccessDeniedException' }));
  const catalog = { 'GET /lambda/:name/details': ['lambda:GetFunction', 'lambda:GetPolicy', 'lambda:ListTags'] };
  const access = buildAccessRequest({ error, route: 'GET /lambda/:name/details', catalog, account: '123456789012', region: 'us-east-1' });

  assert.equal(access.failedAction, 'lambda:GetFunction');
  assert.deepEqual(access.actions, ['lambda:GetFunction', 'lambda:GetPolicy', 'lambda:ListTags']);
  assert.equal(access.source, 'error');
  assert.equal(access.principal, 'arn:aws:iam::123456789012:user/dev');
  assert.deepEqual(access.policy, {
    Version: '2012-10-17',
    Statement: [
      { Sid: 'KuaFailedAction', Effect: 'Allow', Action: ['lambda:GetFunction'], Resource: 'arn:aws:lambda:us-east-1:123456789012:function:api' },
      { Sid: 'KuaScreenActions', Effect: 'Allow', Action: ['lambda:GetPolicy', 'lambda:ListTags'], Resource: '*' },
    ],
  });
});

test('buildAccessRequest falls back to the route catalog when AWS hides the action', () => {
  const error = classifyAwsError(Object.assign(new Error('You are not authorized to perform this operation. Encoded authorization failure message: abc'), { name: 'UnauthorizedOperation' }));
  const access = buildAccessRequest({ error, route: 'GET /ec2', catalog: { 'GET /ec2': ['ec2:DescribeInstances'] } });
  assert.equal(access.failedAction, null);
  assert.equal(access.source, 'route');
  assert.deepEqual(access.policy.Statement, [{ Sid: 'KuaAccess', Effect: 'Allow', Action: ['ec2:DescribeInstances'], Resource: '*' }]);
});

test('buildAccessRequest returns no policy when nothing is known, and nothing for other errors', () => {
  const unknown = buildAccessRequest({ error: { kind: 'denied', message: 'Access Denied' }, route: 'GET /nope', catalog: {} });
  assert.equal(unknown.policy, null);
  assert.equal(unknown.source, 'unknown');
  assert.equal(buildAccessRequest({ error: { kind: 'error', message: 'boom' } }), null);
});
