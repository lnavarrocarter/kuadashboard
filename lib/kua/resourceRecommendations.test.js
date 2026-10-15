'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ApmDatabase } = require('../apm/database');
const { createResourceRecommender, resourceFromValue } = require('./resourceRecommendations');

const ACCOUNT = '111111111111';
const REGION = 'us-east-1';
const CONTEXT = `arn:aws:eks:${REGION}:${ACCOUNT}:cluster/dev`;
const SFN_ARN = `arn:aws:states:${REGION}:${ACCOUNT}:stateMachine:orders`;
const LAMBDA_ARN = `arn:aws:lambda:${REGION}:${ACCOUNT}:function:api`;

// Fake AWS answering by command name, and a fake Kubernetes catalog answering by type.
function fixture({ aws = {}, kube = {} } = {}) {
  const apmDatabase = new ApmDatabase({ filePath: ':memory:' });
  const recommender = createResourceRecommender({
    apmDatabase,
    configResolver: async () => ({}),
    clientFactory: () => ({
      async send(command) {
        const answer = aws[command.constructor.name];
        if (answer instanceof Error) throw answer;
        return typeof answer === 'function' ? answer(command.input) : (answer || {});
      },
    }),
    kubernetesCatalog: {
      async list({ types }) {
        return { items: types.flatMap(type => (kube[type] || []).map(item => ({ type, ...item }))) };
      },
    },
  });
  // A legacy application with its own profile: AWS members are read with it.
  const application = apmDatabase.createApplication({ name: 'Checkout', profileId: 'local:dev', region: REGION });
  return { apmDatabase, recommender, application };
}

const attachAws = (database, application, type, arn, name) => database.attachResource(application.id, { provider: 'aws', type, key: arn, arn, name });

test('a Step Function suggests the Glue job, table and topic its definition uses (#283)', async () => {
  const subject = fixture({
    aws: {
      DescribeStateMachineCommand: {
        definition: JSON.stringify({ States: {
          Extract: { Type: 'Task', Resource: 'arn:aws:states:::glue:startJobRun.sync', Parameters: { JobName: 'nightly-etl' } },
          Save: { Type: 'Task', Resource: 'arn:aws:states:::dynamodb:putItem', Parameters: { TableName: 'orders' } },
          Notify: { Type: 'Task', Resource: 'arn:aws:states:::sns:publish', Parameters: { TopicArn: `arn:aws:sns:${REGION}:${ACCOUNT}:alerts` } },
        } }),
      },
    },
  });
  try {
    attachAws(subject.apmDatabase, subject.application, 'stepfunctions', SFN_ARN, 'orders');
    const result = await subject.recommender.recommend(subject.application.id);
    assert.deepEqual(result.suggestions.map(item => [item.resource.type, item.resource.arn, item.confidence, item.evidence[0].type]), [
      ['sns', `arn:aws:sns:${REGION}:${ACCOUNT}:alerts`, 0.98, 'asl_reference'],
      ['glue', `arn:aws:glue:${REGION}:${ACCOUNT}:job/nightly-etl`, 0.98, 'asl_reference'],
      ['dynamodb', `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/orders`, 0.98, 'asl_reference'],
    ]);
    assert.equal(result.suggestions[1].evidence[0].statePath, 'Extract');
    assert.deepEqual(result.suggestions[1].resource, { provider: 'aws', type: 'glue', key: `arn:aws:glue:${REGION}:${ACCOUNT}:job/nightly-etl`, arn: `arn:aws:glue:${REGION}:${ACCOUNT}:job/nightly-etl`, name: 'nightly-etl', scopeId: ACCOUNT, location: REGION });
  } finally { subject.apmDatabase.close(); }
});

test('members, detached resources and dismissed suggestions are not suggested again (#283)', async () => {
  const subject = fixture({
    aws: {
      GetFunctionConfigurationCommand: { Environment: { Variables: {
        QUEUE_URL: `https://sqs.${REGION}.amazonaws.com/${ACCOUNT}/orders`,
        TABLE: `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/orders`,
        TOPIC: `arn:aws:sns:${REGION}:${ACCOUNT}:alerts`,
        NOT_A_RESOURCE: 'hello',
      } } },
    },
  });
  try {
    attachAws(subject.apmDatabase, subject.application, 'lambda', LAMBDA_ARN, 'api');
    attachAws(subject.apmDatabase, subject.application, 'sqs', `arn:aws:sqs:${REGION}:${ACCOUNT}:orders`, 'orders');
    const first = await subject.recommender.recommend(subject.application.id);
    assert.deepEqual(first.suggestions.map(item => item.resource.type).sort(), ['dynamodb', 'sns'], 'the queue is already a member');
    assert.deepEqual(first.suggestions[0].evidence[0], { type: 'lambda_environment_variable', from: 'api', variable: first.suggestions[0].evidence[0].variable });
    assert.ok(!JSON.stringify(first).includes('hello'), 'environment values are never returned');

    subject.recommender.dismiss(subject.application.id, first.suggestions.find(item => item.resource.type === 'sns').identityKey);
    const second = await subject.recommender.recommend(subject.application.id);
    assert.deepEqual(second.suggestions.map(item => item.resource.type), ['dynamodb']);
  } finally { subject.apmDatabase.close(); }
});

test('Kubernetes workloads suggest the cluster, node instances and the volumes behind their claims (#283)', async () => {
  const subject = fixture({
    kube: {
      node: [{ name: 'ip-10-0-0-1', details: { instanceId: 'i-0aaa' } }],
      statefulset: [{ name: 'postgres', namespace: 'db', details: { claims: [], claimTemplates: ['data'] } }],
      pvc: [{ name: 'data-postgres-0', namespace: 'db', details: { volumeName: 'pv-1' }, attach: { provider: 'kubernetes', type: 'kubernetes', kind: 'PersistentVolumeClaim', key: `${CONTEXT}/db/PersistentVolumeClaim/data-postgres-0`, name: 'data-postgres-0', kubeContext: CONTEXT, namespace: 'db' } }],
      pv: [
        { name: 'pv-1', details: { phase: 'Bound', claim: 'db/data-postgres-0', backingVolume: { provider: 'aws', type: 'ebs-volume', volumeId: 'vol-1' } }, attach: { provider: 'kubernetes', type: 'kubernetes', kind: 'PersistentVolume', key: `${CONTEXT}//PersistentVolume/pv-1`, name: 'pv-1', kubeContext: CONTEXT } },
        { name: 'pv-old', details: { phase: 'Released', claim: 'db/data-postgres-0', backingVolume: { provider: 'aws', type: 'ebs-volume', volumeId: 'vol-old' } }, attach: { provider: 'kubernetes', type: 'kubernetes', kind: 'PersistentVolume', key: `${CONTEXT}//PersistentVolume/pv-old`, name: 'pv-old', kubeContext: CONTEXT } },
        { name: 'pv-other', details: { phase: 'Bound', claim: 'web/cache', backingVolume: null }, attach: { provider: 'kubernetes', type: 'kubernetes', kind: 'PersistentVolume', key: `${CONTEXT}//PersistentVolume/pv-other`, name: 'pv-other', kubeContext: CONTEXT } },
      ],
    },
  });
  try {
    subject.apmDatabase.attachResource(subject.application.id, { provider: 'kubernetes', type: 'kubernetes', kind: 'StatefulSet', key: `${CONTEXT}/db/StatefulSet/postgres`, name: 'postgres', kubeContext: CONTEXT, namespace: 'db' });
    const result = await subject.recommender.recommend(subject.application.id);
    const byName = Object.fromEntries(result.suggestions.map(item => [item.resource.name, item]));
    assert.equal(byName.dev.resource.arn, CONTEXT, 'the EKS cluster of the context');
    assert.equal(byName['ip-10-0-0-1 (i-0aaa)'].resource.arn, `arn:aws:ec2:${REGION}:${ACCOUNT}:instance/i-0aaa`);
    assert.equal(byName['data-postgres-0'].evidence[0].type, 'workload_volume');
    assert.equal(byName['pv-1'].confidence, 0.95);
    assert.equal(byName['vol-1'].resource.arn, `arn:aws:ec2:${REGION}:${ACCOUNT}:volume/vol-1`);
    assert.deepEqual([byName['pv-old'].note, byName['vol-old'].note, byName['vol-old'].confidence], ['released', 'released', 0.5], 'an earlier volume of the same claim is flagged');
    assert.equal(byName['pv-other'], undefined, 'volumes of other claims are not suggested');
  } finally { subject.apmDatabase.close(); }
});

test('a source that fails is reported without hiding the others (#283)', async () => {
  const denied = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
  const subject = fixture({ aws: { DescribeStateMachineCommand: denied, GetFunctionConfigurationCommand: { Environment: { Variables: { T: `arn:aws:sns:${REGION}:${ACCOUNT}:alerts` } } } } });
  try {
    attachAws(subject.apmDatabase, subject.application, 'stepfunctions', SFN_ARN, 'orders');
    attachAws(subject.apmDatabase, subject.application, 'lambda', LAMBDA_ARN, 'api');
    const result = await subject.recommender.recommend(subject.application.id);
    assert.deepEqual(result.failures, [{ source: 'stepfunctions', resource: 'orders', code: 'AccessDeniedException' }]);
    assert.deepEqual(result.suggestions.map(item => item.resource.type), ['sns']);
    await assert.rejects(subject.recommender.recommend('missing'), error => error.statusCode === 404);
  } finally { subject.apmDatabase.close(); }
});

test('resourceFromValue reads ARNs of known types and SQS queue URLs only (#283)', () => {
  assert.equal(resourceFromValue(`https://sqs.${REGION}.amazonaws.com/${ACCOUNT}/jobs.fifo`).arn, `arn:aws:sqs:${REGION}:${ACCOUNT}:jobs.fifo`);
  assert.equal(resourceFromValue(`arn:aws:kms:${REGION}:${ACCOUNT}:key/1`), null);
  assert.equal(resourceFromValue('postgres://db'), null);
});
