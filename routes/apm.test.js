'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { ApmDatabase } = require('../lib/apm/database');
const { createApmRouter } = require('./apm');

async function fixture({ deploymentReader } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-apm-api-'));
  const database = new ApmDatabase({
    filePath: path.join(directory, 'apm.sqlite3'),
    now: () => Date.UTC(2026, 7, 4, 12),
  });
  const auditEvents = [];
  const scheduler = {
    async collectApplication(applicationId) {
      return {
        skipped: false,
        run: {
          id: 'run-manual', applicationId, status: 'completed', requestCount: 1, backlog: false,
        },
        resources: [],
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/observability/aws', createApmRouter({
    database,
    scheduler,
    auditLog: { log(event) { auditEvents.push(event); } },
    deploymentReader,
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/observability/aws`;

  async function request(relativePath, { profile = 'local:dev', method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${relativePath}`, {
      method,
      headers: {
        'X-Profile-Id': profile,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  return {
    auditEvents,
    database,
    request,
    async close() {
      await new Promise(resolve => server.close(resolve));
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('API scopes applications, resources, topology and collection by profile', async () => {
  const subject = await fixture();
  try {
    const created = await subject.request('/applications', {
      method: 'POST',
      body: { name: 'orders', region: 'us-east-1', environment: 'dev' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.profileId, 'local:dev');
    const applicationId = created.body.id;

    const usageBeforeCandidates = subject.database.getApiUsage('local:dev').total;
    const candidates = await subject.request('/candidates', {
      method: 'POST',
      body: {
        application: { name: 'payments api', environment: 'dev' },
        resources: [
          { type: 'lambda', name: 'orders-worker', tags: { Application: 'orders' } },
          { type: 'lambda', name: 'payments-api-handler' },
        ],
      },
    });
    assert.equal(candidates.status, 200);
    assert.deepEqual(candidates.body.estimate, { awsRequests: 0, kubernetesRequests: 0 });
    assert.equal(candidates.body.candidates[0].status, 'matched');
    assert.equal(candidates.body.candidates[1].status, 'suggested');
    assert.equal(subject.database.listResources(applicationId).length, 0);
    assert.equal(subject.database.getApiUsage('local:dev').total, usageBeforeCandidates);

    const hidden = await subject.request(`/applications/${applicationId}`, { profile: 'local:other' });
    assert.equal(hidden.status, 404);

    const added = await subject.request(`/applications/${applicationId}/resources`, {
      method: 'POST',
      body: {
        type: 'lambda', key: 'arn:orders', arn: 'arn:orders', name: 'orders',
        logGroup: '/aws/lambda/orders', associationSource: 'tags',
        metadata: { Application: 'orders', privateTag: 'not-a-secret-but-not-audited' },
      },
    });
    assert.equal(added.status, 201);

    const topology = await subject.request(`/applications/${applicationId}/topology`);
    assert.equal(topology.body.resources.length, 1);
    assert.deepEqual(topology.body.edges, []);

    const defaultThresholds = await subject.request(`/applications/${applicationId}/thresholds`);
    assert.equal(defaultThresholds.body.errorRatePercent, 5);
    const updatedThresholds = await subject.request(`/applications/${applicationId}/thresholds`, {
      method: 'PATCH',
      body: { errorRatePercent: 2.5, restartDelta: null },
    });
    assert.equal(updatedThresholds.body.errorRatePercent, 2.5);
    assert.equal(updatedThresholds.body.restartDelta, null);
    const invalidThresholds = await subject.request(`/applications/${applicationId}/thresholds`, {
      method: 'PATCH',
      body: { readyPodsPercent: 101 },
    });
    assert.equal(invalidThresholds.status, 400);

    const overview = await subject.request(`/applications/${applicationId}/overview`);
    assert.equal(overview.body.health.status, 'unknown');

    const forecast = await subject.request(`/applications/${applicationId}/forecast`);
    assert.deepEqual(forecast.body, {
      lambdaCount: 1,
      cadenceMinutes: 30,
      monthlyRequestsExpected: 1440,
      monthlyRequestsMaximum: 2880,
      localMonthlyLimit: 100000,
    });

    const collection = await subject.request(`/applications/${applicationId}/collect-now`, { method: 'POST' });
    assert.equal(collection.status, 200);
    assert.equal(collection.body.run.status, 'completed');
    assert.equal(JSON.stringify(subject.auditEvents).includes('privateTag'), false);
  } finally {
    await subject.close();
  }
});

test('API requires X-Profile-Id and derives profile ownership from the header', async () => {
  const subject = await fixture();
  try {
    const response = await fetch('http://127.0.0.1/').catch(() => null);
    assert.equal(response, null);
    const missing = await fetch(`${await (async () => {
      const result = subject.request('/applications', { profile: '' });
      return result;
    })()}`).catch(() => null);
    assert.equal(missing, null);
    const result = await subject.request('/applications', { profile: '' });
    assert.equal(result.status, 400);
  } finally {
    await subject.close();
  }
});

test('deployment routes pass the profile scope and preserve explicit stack selection', async () => {
  const calls = [];
  const subject = await fixture({
    deploymentReader: {
      async listDeployments(input) {
        calls.push(['list', input]);
        return {
          scope: { ...input, accountId: '073746111526' },
          estimate: { awsRequests: 1, kubernetesRequests: 0 },
          deployments: [{ id: 'stack-1', name: 'orders', status: 'UPDATE_COMPLETE' }],
        };
      },
      async preview(input) {
        calls.push(['preview', input]);
        return {
          estimate: { awsRequests: 1, kubernetesRequests: 0 },
          resources: [{ type: 'sqs', key: 'queue-1', name: 'orders', associationSource: 'deployment' }],
        };
      },
    },
  });
  try {
    const deployments = await subject.request('/deployments?region=us-west-2');
    assert.equal(deployments.status, 200);
    assert.equal(deployments.body.scope.accountId, '073746111526');

    const resources = await subject.request('/deployment-resources', {
      method: 'POST',
      body: { region: 'us-west-2', stackNames: ['orders'] },
    });
    assert.equal(resources.status, 200);
    assert.equal(resources.body.resources[0].associationSource, 'deployment');
    assert.deepEqual(calls, [
      ['list', { profileId: 'local:dev', region: 'us-west-2' }],
      ['preview', { profileId: 'local:dev', region: 'us-west-2', stackNames: ['orders'] }],
    ]);
  } finally {
    await subject.close();
  }
});