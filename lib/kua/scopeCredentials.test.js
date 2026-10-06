'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ApmDatabase } = require('../apm/database');
const { ApmScheduler } = require('../apm/scheduler');
const { normalizeScope } = require('./applicationContract');
const { applicationForResource, profilesForApplication } = require('./scopeCredentials');

function providerLessApp() {
  const database = new ApmDatabase({ filePath: ':memory:' });
  const application = database.createApplication({ name: 'App360', environment: 'dev' });
  const aws = normalizeScope({ provider: 'aws', scopeId: '073746111526', location: 'us-east-1' });
  const kube = normalizeScope({ provider: 'kubernetes', scopeId: 'desarrollo' });
  database.addApplicationScope(application.id, aws);
  database.addApplicationScope(application.id, kube);
  database.setScopeBinding(application.id, aws.key, { profileId: 'local:dev', status: 'verified' });
  database.setScopeBinding(application.id, kube.key, { profileId: 'arn:aws:eks:us-east-1:073746111526:cluster/EKS130-360-Dev', status: 'verified' });
  return { database, application: database.getApplication(application.id), aws, kube };
}

test('a legacy application keeps its own profile for every resource', () => {
  const database = new ApmDatabase({ filePath: ':memory:' });
  try {
    const application = database.createApplication({ provider: 'aws', profileId: 'local:prod', region: 'us-east-1', name: 'Orders' });
    assert.equal(applicationForResource(database, application, { type: 'lambda', name: 'x' }), application);
    assert.deepEqual([...profilesForApplication(database, application)], ['local:prod']);
  } finally { database.close(); }
})

test('an application without provider reaches AWS resources through the verified binding of their scope', () => {
  const { database, application } = providerLessApp();
  try {
    const lambda = { type: 'lambda', name: 'orders-api', arn: 'arn:aws:lambda:us-east-1:073746111526:function:orders-api', key: 'k' };
    assert.deepEqual(
      (({ profileId, region }) => ({ profileId, region }))(applicationForResource(database, application, lambda)),
      { profileId: 'local:dev', region: 'us-east-1' },
    );
    // Kubernetes needs no profile: the collector reads the resource's kube context.
    assert.equal(applicationForResource(database, application, { type: 'kubernetes', name: 'api', kubeContext: 'ctx' }).profileId, 'local');
    assert.throws(
      () => applicationForResource(database, application, { type: 'lambda', name: 'other', arn: 'arn:aws:lambda:eu-west-1:999999999999:function:other' }),
      error => error.code === 'scope_unbound',
    );
    assert.deepEqual([...profilesForApplication(database, application)].sort(), ['arn:aws:eks:us-east-1:073746111526:cluster/EKS130-360-Dev', 'local', 'local:dev']);
  } finally { database.close(); }
});

test('the scheduler collects an application without provider per scope and reports unbound resources', async () => {
  const { database, application } = providerLessApp();
  try {
    database.addResource(application.id, { type: 'kubernetes', key: 'desarrollo/api/deployment/api', kubeContext: 'arn:aws:eks:us-east-1:073746111526:cluster/EKS130-360-Dev', namespace: 'api', kind: 'Deployment', name: 'api' });
    database.addResource(application.id, { type: 'lambda', key: 'k1', arn: 'arn:aws:lambda:us-east-1:073746111526:function:orders-api', name: 'orders-api' });
    database.addResource(application.id, { type: 'lambda', key: 'k2', arn: 'arn:aws:lambda:eu-west-1:999999999999:function:other', name: 'other' });
    const seen = []
    const scheduler = new ApmScheduler({
      database,
      awsCollector: { async collect({ application: scoped, resource }) { seen.push([resource.name, scoped.profileId, scoped.region]); return { status: 'completed', requests: 1 }; } },
      kubeCollector: { async collect({ resource }) { seen.push([resource.name, resource.kubeContext]); return { status: 'completed', requests: 0 }; } },
    });
    const result = await scheduler.collectApplicationNow(application, { trigger: 'manual' });

    assert.deepEqual(seen.sort(), [['api', 'arn:aws:eks:us-east-1:073746111526:cluster/EKS130-360-Dev'], ['orders-api', 'local:dev', 'us-east-1']]);
    assert.equal(result.run.status, 'partial');
    assert.ok(result.resources.some(item => item.status === 'failed' && item.errorCode === 'scope_unbound'));
    assert.equal(database.getLatestCollectionRun(application.id).profileId, 'local');
  } finally { database.close(); }
});

test('resources discovered from CloudFormation (no ARN) collect in the region of their node, or say which region is missing', () => {
  const database = new ApmDatabase({ filePath: ':memory:' });
  try {
    const application = database.createApplication({ name: 'APP TEST' });
    const scope = normalizeScope({ provider: 'aws', scopeId: '341710078349' });
    database.addApplicationScope(application.id, scope);
    database.setScopeBinding(application.id, scope.key, { profileId: 'local:prod', status: 'verified' });
    const app = database.getApplication(application.id);
    const fromNode = database.addResource(application.id, { type: 'lambda', key: 'AWS::Lambda::Function:AnswerApiFunction', name: 'AnswerApiFunction', scopeId: '341710078349', location: 'us-east-1' });
    assert.deepEqual((({ profileId, region }) => ({ profileId, region }))(applicationForResource(database, app, fromNode)), { profileId: 'local:prod', region: 'us-east-1' });

    const unknown = database.addResource(application.id, { type: 'lambda', key: 'AWS::Lambda::Function:Other', name: 'Other', scopeId: '341710078349' });
    assert.throws(() => applicationForResource(database, app, unknown), error => error.code === 'scope_region_unknown' && /Accounts and scopes/.test(error.message));
  } finally { database.close(); }
});
