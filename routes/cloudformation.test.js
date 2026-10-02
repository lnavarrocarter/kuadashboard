'use strict';

// Guards of the CloudFormation operations in routes/aws.js: previews are
// re-read server-side, destructive actions need the typed stack name, blocked
// deletes are refused, and every operation is audit-logged.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

function stubModule(request, exports) {
  const resolved = require.resolve(request);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const audit = [];
const sent = [];
let state;

function resetState(overrides = {}) {
  state = {
    stack: { StackId: 'arn:aws:cloudformation:us-east-1:111111111111:stack/orders/12345678-1234-1234-1234-123456789012', StackName: 'orders', StackStatus: 'UPDATE_COMPLETE', EnableTerminationProtection: false, Parameters: [{ ParameterKey: 'Memory', ParameterValue: '128' }, { ParameterKey: 'Env', ParameterValue: 'prod' }], Outputs: [] },
    changes: [{ ResourceChange: { Action: 'Modify', LogicalResourceId: 'Fn', ResourceType: 'AWS::Lambda::Function', Replacement: 'False' } }],
    resources: [{ LogicalResourceId: 'Table', PhysicalResourceId: 'orders-table', ResourceType: 'AWS::DynamoDB::Table', ResourceStatus: 'CREATE_COMPLETE' }],
    template: 'Resources:\n  Table:\n    Type: AWS::DynamoDB::Table\n',
    ...overrides,
  };
}
resetState();

const commandNames = [
  'DescribeStacks', 'DescribeChangeSet', 'ExecuteChangeSet', 'DeleteChangeSet', 'CreateChangeSet', 'UpdateTerminationProtection',
  'ListStackResources', 'GetTemplate', 'ListImports', 'DeleteStack', 'ListChangeSets', 'ListExports',
];
const sdk = { CloudFormationClient: class { async send(command) { sent.push([command.name, command.input]); return handle(command.name, command.input); } } };
for (const name of commandNames) sdk[`${name}Command`] = class { constructor(input) { this.input = input; this.name = name; } };

function handle(name, input) {
  switch (name) {
    case 'DescribeStacks': return { Stacks: [state.stack] };
    case 'DescribeChangeSet': return { ChangeSetId: 'cs-id', ChangeSetName: input.ChangeSetName, Status: 'CREATE_COMPLETE', ExecutionStatus: 'AVAILABLE', Changes: state.changes };
    case 'ListStackResources': return { StackResourceSummaries: state.resources };
    case 'GetTemplate': return { TemplateBody: state.template };
    case 'ListImports': throw Object.assign(new Error('Export orders-url is not imported by any stack.'), { name: 'ValidationError' });
    case 'CreateChangeSet': return { Id: 'arn:aws:cloudformation:us-east-1:111111111111:changeSet/kua-1/abc' };
    default: return {};
  }
}

stubModule('../lib/awsProfileResolver', {
  awsProfilePaths: () => ({}),
  readLocalAwsProfiles: () => [],
  resolveAwsConfig: async () => ({ region: 'us-east-1', credentials: { accessKeyId: 'AKIA', secretAccessKey: 'x' } }),
});
stubModule('@aws-sdk/client-cloudformation', sdk);
stubModule('../lib/auditLog', { log: entry => audit.push(entry), getLogs: () => audit.map((e, i) => ({ id: String(i), ...e })) });

const router = require('./aws');

async function request(method, path, body) {
  const app = express();
  app.use(express.json());
  app.use('/api/cloud/aws', router);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    return await new Promise((resolve, reject) => {
      const req = http.request({ port, path, method, headers: { 'X-Profile-Id': 'p1', 'Content-Type': 'application/json' } }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  } finally {
    server.close();
  }
}

const executed = () => sent.filter(([name]) => name === 'ExecuteChangeSet').length;

test('a low-risk change set executes without typing the name and is audited', async t => {
  t.mock.method(console, 'error', () => {});
  resetState(); audit.length = 0; sent.length = 0;
  const { status, body } = await request('POST', '/api/cloud/aws/cloudformation/change-set/execute', { stack: 'orders', changeSet: 'kua-1' });
  assert.equal(status, 200);
  assert.equal(body.risk.level, 'low');
  assert.equal(executed(), 1);
  assert.equal(audit[0].action, 'CloudFormation change set executed');
  assert.equal(audit[0].details.stack, 'orders');
});

test('a change set that replaces a data-bearing resource needs the typed stack name', async t => {
  t.mock.method(console, 'error', () => {});
  resetState({ changes: [{ ResourceChange: { Action: 'Modify', LogicalResourceId: 'Table', ResourceType: 'AWS::DynamoDB::Table', Replacement: 'True' } }] });
  audit.length = 0; sent.length = 0;
  const refused = await request('POST', '/api/cloud/aws/cloudformation/change-set/execute', { stack: 'orders', changeSet: 'kua-1', confirm: 'order' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'ConfirmationRequired');
  assert.equal(refused.body.risk.level, 'high');
  assert.equal(executed(), 0);
  assert.equal(audit.length, 0);
  const ok = await request('POST', '/api/cloud/aws/cloudformation/change-set/execute', { stack: 'orders', changeSet: 'kua-1', confirm: 'orders', reason: 'resize' });
  assert.equal(ok.status, 200);
  assert.equal(executed(), 1);
  assert.equal(audit[0].level, 'warning');
});

test('parameter preview keeps the other parameters and audits the change set', async t => {
  t.mock.method(console, 'error', () => {});
  resetState(); audit.length = 0; sent.length = 0;
  const { status, body } = await request('POST', '/api/cloud/aws/cloudformation/stack/parameter-change-set', { stack: 'orders', parameters: { Memory: 512 } });
  assert.equal(status, 200);
  assert.match(body.changeSetName, /^kua-\d{14}$/);
  const input = sent.find(([name]) => name === 'CreateChangeSet')[1];
  assert.equal(input.UsePreviousTemplate, true);
  assert.deepEqual(input.Parameters, [{ ParameterKey: 'Memory', ParameterValue: '512' }, { ParameterKey: 'Env', UsePreviousValue: true }]);
  assert.equal(audit[0].action, 'CloudFormation change set created (preview)');
  const unknown = await request('POST', '/api/cloud/aws/cloudformation/stack/parameter-change-set', { stack: 'orders', parameters: { Nope: 1 } });
  assert.equal(unknown.status, 400);
});

test('termination protection: turning it off needs the typed name', async t => {
  t.mock.method(console, 'error', () => {});
  resetState(); audit.length = 0; sent.length = 0;
  assert.equal((await request('POST', '/api/cloud/aws/cloudformation/stack/termination-protection', { stack: 'orders', enabled: false })).status, 400);
  assert.equal((await request('POST', '/api/cloud/aws/cloudformation/stack/termination-protection', { stack: 'orders', enabled: false, confirm: 'orders' })).status, 200);
  assert.equal((await request('POST', '/api/cloud/aws/cloudformation/stack/termination-protection', { stack: 'orders', enabled: true })).status, 200);
  assert.deepEqual(audit.map(e => [e.action, e.level]), [
    ['CloudFormation termination protection disabled', 'warning'],
    ['CloudFormation termination protection enabled', 'info'],
  ]);
});

test('delete: preview shows data-bearing removals; blocked stacks and missing confirmation are refused', async t => {
  t.mock.method(console, 'error', () => {});
  resetState(); audit.length = 0; sent.length = 0;
  const preview = await request('GET', '/api/cloud/aws/cloudformation/stack/delete-preview?stack=orders');
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.summary.dataBearingRemoved, ['Table']);
  assert.equal(preview.body.risk, 'high');
  assert.equal((await request('POST', '/api/cloud/aws/cloudformation/stack/delete', { stack: 'orders', confirm: 'orders' })).status, 400, 'reason required');
  assert.equal((await request('POST', '/api/cloud/aws/cloudformation/stack/delete', { stack: 'orders', reason: 'retired', confirm: 'nope' })).status, 400);
  resetState({ stack: { ...state.stack, EnableTerminationProtection: true } });
  const blocked = await request('POST', '/api/cloud/aws/cloudformation/stack/delete', { stack: 'orders', reason: 'retired', confirm: 'orders' });
  assert.equal(blocked.status, 409);
  assert.deepEqual(blocked.body.blockers, ['termination_protection']);
  assert.equal(sent.filter(([name]) => name === 'DeleteStack').length, 0);
  resetState({ template: 'Resources:\n  Table:\n    Type: AWS::DynamoDB::Table\n    DeletionPolicy: Retain\n' });
  const ok = await request('POST', '/api/cloud/aws/cloudformation/stack/delete', { stack: 'orders', reason: 'retired', confirm: 'orders' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.summary.retained, 1);
  assert.equal(audit.at(-1).action, 'CloudFormation stack deletion requested');
  assert.equal(audit.at(-1).details.reason, 'retired');
});

test('stack history returns only this stack\'s CloudFormation operations', async () => {
  audit.length = 0;
  audit.push({ category: 'aws', action: 'x', details: { kind: 'cloudformation', stack: 'orders' } });
  audit.push({ category: 'aws', action: 'y', details: { kind: 'cloudformation', stack: 'orders-2' } });
  audit.push({ category: 'aws', action: 'z', details: {} });
  const { body } = await request('GET', '/api/cloud/aws/cloudformation/stack/history?name=orders');
  assert.deepEqual(body.entries.map(e => e.action), ['x']);
});
