'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ArchitectureDatabase } = require('../architecture/database');
const { ApmDatabase } = require('../apm/database');
const { createTeamEngine } = require('./teamEngine');
const { normalizeScope } = require('../kua/applicationContract');

// The team's shared space as the account service keeps it (signatures are covered by account.test.js).
function fakeTeamSpace() {
  const items = new Map();
  let rev = 0;
  return {
    items,
    bump() { rev += 1; },
    accountFor(userId, { team = { id: 't1', name: 'Jordan360', role: 'member' } } = {}) {
      const state = { team };
      return {
        state,
        account: () => ({
          status: () => ({ entitlements: state.team ? { plan: 'team', team: state.team } : { plan: 'free' } }),
          revision: () => rev,
          team: {
            async publish(teamId, appKey, bundle) {
              state.refuse?.(bundle);
              const id = `${userId}:${appKey}`;
              const current = items.get(id);
              items.set(id, { id, ownerId: userId, version: (current?.version || 0) + 1, bundle: JSON.parse(JSON.stringify(bundle)), shared: current?.shared || false });
              rev += 1;
              return { id };
            },
            async unpublish(appKey) { items.delete(`${userId}:${appKey}`); rev += 1; },
            async catalog() {
              return { team: { id: 't1' }, items: [...items.values()].filter(item => item.shared || item.ownerId === userId).map(({ id, ownerId, version }) => ({ id, version, owner: { email: `${ownerId}@example.com` } })) };
            },
            async content(_team, itemId) { const item = items.get(itemId); return { version: item.version, bundle: JSON.parse(JSON.stringify(item.bundle)) }; },
          },
        }),
      };
    },
  };
}

function computer(space, userId, options) {
  const database = new ArchitectureDatabase({ filePath: ':memory:' });
  const apmDatabase = new ApmDatabase({ filePath: ':memory:' });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `kua-team-${userId}-`));
  const { account, state } = space.accountFor(userId, options);
  const engine = createTeamEngine({ account, database, apmDatabase, dataDir, log: { warn() {} } });
  const createApp = name => {
    const application = apmDatabase.createApplication({ profileId: 'local:p', provider: 'aws', region: 'us-east-1', name });
    const project = database.createProject({ profileId: 'local:p', name: `${name} architecture` });
    apmDatabase.updateArchitectureProjectLink(application.id, project.id);
    database.saveGraph(project.id, { projectId: project.id, nodes: [{ id: 'api', name: 'api' }] }, { expectedRevision: 0 });
    return apmDatabase.getApplication(application.id);
  };
  const setNodes = (application, names) => {
    const projectId = apmDatabase.getApplication(application.id).architectureProjectId;
    const current = database.getGraph(projectId);
    database.saveGraph(projectId, { ...current.document, nodes: names.map(n => ({ id: n, name: n })) }, { expectedRevision: current.revision });
  };
  const nodes = application => database.getGraph(apmDatabase.getApplication(application.id).architectureProjectId).document.nodes.map(n => n.name).sort();
  const refuse = check => { state.refuse = check; };
  return { engine, state, refuse, apmDatabase, createApp, setNodes, nodes, close() { database.close(); apmDatabase.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

test('members publish their applications when they change; shared items imported elsewhere stay up to date', async () => {
  const space = fakeTeamSpace();
  const ana = computer(space, 'ana');
  const bob = computer(space, 'bob');
  try {
    const orders = ana.createApp('Orders');
    const billing = ana.createApp('Billing');
    const taskDetails = [];
    ana.engine.start(100000, { task: { setDetail: detail => taskDetails.push(detail) } });
    assert.deepEqual(await ana.engine.pass(), { published: 2, updated: 0 });
    ana.engine.stop();
    assert.ok(taskDetails.some(detail => detail.includes('Orders') && detail.includes('Billing')));
    assert.deepEqual(await ana.engine.pass(), { published: 0, updated: 0 }, 'unchanged: nothing sent');

    // An admin shares Orders and bob, a member, imports it.
    const ordersItem = [...space.items.values()].find(item => item.bundle.application.name === 'Orders');
    ordersItem.shared = true;
    const { application: copy } = await bob.engine.importItem(ordersItem.id, 'local:p');
    assert.deepEqual(bob.nodes(copy), ['api']);
    assert.equal((await bob.engine.pass()).published, 0, 'imported team items are not published again');

    ana.setNodes(orders, ['api', 'db']);
    assert.deepEqual(await ana.engine.pass(), { published: 1, updated: 0 });
    assert.deepEqual(await bob.engine.pass(), { published: 0, updated: 1 });
    assert.deepEqual(bob.nodes(copy), ['api', 'db']);

    // Deleted on ana's computer: no longer published.
    ana.apmDatabase.deleteApplication(billing.id);
    await ana.engine.pass();
    assert.deepEqual([...space.items.values()].map(item => item.bundle.application.name), ['Orders']);

    // Not shared any more: bob keeps its copy, unlinked (owner and admins would still see it).
    space.items.get(ordersItem.id).shared = false;
    space.bump();
    await bob.engine.pass();
    assert.deepEqual(bob.engine.importedHere(), {});
    assert.ok(bob.apmDatabase.getApplication(copy.id));

    // Leaving the team: nothing more is published.
    ana.state.team = null;
    ana.setNodes(orders, ['api', 'db', 'queue']);
    assert.deepEqual(await ana.engine.pass(), { published: 0, updated: 0 });
  } finally { ana.close(); bob.close(); }
});

test('an application without provider is published with its scopes (#153)', async () => {
  const space = fakeTeamSpace();
  const ana = computer(space, 'ana');
  try {
    const checkout = ana.apmDatabase.createApplication({ name: 'Checkout' });
    ana.apmDatabase.addApplicationScope(checkout.id, normalizeScope({ provider: 'kubernetes', scopeId: 'prod-cluster' }));
    ana.createApp('Orders');
    assert.deepEqual(await ana.engine.pass(), { published: 2, updated: 0 });
    const published = [...space.items.values()].find(item => item.bundle.application.name === 'Checkout');
    assert.equal(published.bundle.application.provider, undefined);
    assert.deepEqual(published.bundle.application.scopes.map(scope => scope.scopeId), ['prod-cluster']);
  } finally { ana.close(); }
});

test('a bundle the account service refuses is not sent again until the application changes', async () => {
  const space = fakeTeamSpace();
  const ana = computer(space, 'ana');
  try {
    ana.apmDatabase.createApplication({ name: 'Checkout' });
    let attempts = 0;
    ana.refuse((bundle) => { if (!bundle.application.provider) { attempts += 1; throw Object.assign(new Error('The bundle has no valid application'), { code: 'INVALID_BUNDLE' }); } });
    assert.deepEqual(await ana.engine.pass(), { published: 0, updated: 0 });
    assert.deepEqual(await ana.engine.pass(), { published: 0, updated: 0 });
    assert.equal(attempts, 1);
    const [checkout] = ana.apmDatabase.listApplications();
    ana.apmDatabase.updateApplication(checkout.id, { team: 'Payments' });
    await ana.engine.pass();
    assert.equal(attempts, 2);
  } finally { ana.close(); }
});
