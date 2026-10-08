'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ArchitectureDatabase } = require('../architecture/database');
const { ApmDatabase } = require('../apm/database');
const { createSyncEngine } = require('./syncEngine');

// The account service as both computers see it: numbered versions, 409 on a stale base.
function fakeCloud() {
  const items = new Map();
  let rev = 0;
  const conflict = current => Object.assign(new Error('Another computer saved a newer version'), { code: 'SYNC_CONFLICT', statusCode: 409, details: { current } });
  const meta = (syncId, item) => ({ syncId, name: item.bundle.application.name, applicationName: item.bundle.application.name, version: item.version, updatedAt: new Date().toISOString(), signedBy: { device: item.device } });
  return {
    items,
    accountFor(device) {
      return () => ({
        revision: () => rev,
        sync: {
          async list() { return { enabled: true, items: [...items].map(([id, item]) => meta(id, item)) }; },
          async put(syncId, bundle, baseVersion) {
            const current = items.get(syncId);
            if ((current?.version || 0) !== baseVersion) throw conflict(current && meta(syncId, current));
            const next = { version: baseVersion + 1, bundle: JSON.parse(JSON.stringify(bundle)), device, history: [...(current?.history || []), bundle] };
            items.set(syncId, next);
            rev += 1;
            return meta(syncId, next);
          },
          async download(syncId) {
            const item = items.get(syncId);
            if (!item) throw Object.assign(new Error('not found'), { statusCode: 404 });
            return { version: item.version, bundle: JSON.parse(JSON.stringify(item.bundle)) };
          },
          async remove(syncId) { items.delete(syncId); rev += 1; },
        },
      });
    },
  };
}

function computer(cloud, name) {
  const database = new ArchitectureDatabase({ filePath: ':memory:' });
  const apmDatabase = new ApmDatabase({ filePath: ':memory:' });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `kua-sync-${name}-`));
  const engine = createSyncEngine({ account: cloud.accountFor(name), database, apmDatabase, dataDir, log: { warn() {} } });
  const graphOf = application => database.getGraph(apmDatabase.getApplication(application.id).architectureProjectId).document;
  const setNodes = (application, names) => {
    const projectId = apmDatabase.getApplication(application.id).architectureProjectId;
    const current = database.getGraph(projectId);
    database.saveGraph(projectId, { ...current.document, nodes: names.map(n => ({ id: n, name: n })) }, { expectedRevision: current.revision });
  };
  const nodeNames = application => graphOf(application).nodes.map(n => n.name).sort();
  return {
    database, apmDatabase, engine, setNodes, nodeNames,
    close() { database.close(); apmDatabase.close(); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}

function createApp(pc, profileId = 'local:p') {
  const application = pc.apmDatabase.createApplication({ profileId, provider: 'aws', region: 'us-east-1', name: 'Orders', environment: 'production' });
  const project = pc.database.createProject({ profileId, name: 'Orders architecture' });
  pc.apmDatabase.updateArchitectureProjectLink(application.id, project.id);
  pc.database.saveGraph(project.id, { projectId: project.id, nodes: [{ id: 'api', name: 'api' }] }, { expectedRevision: 0 });
  return pc.apmDatabase.getApplication(application.id);
}

test('an application synced on one computer appears on the other and changes travel both ways', async () => {
  const cloud = fakeCloud();
  const a = computer(cloud, 'laptop');
  const b = computer(cloud, 'desktop');
  try {
    const appA = createApp(a);
    await a.engine.enable(appA);
    assert.equal([...cloud.items.values()][0].version, 1);

    const taskDetails = [];
    a.engine.start({ task: { setDetail: detail => taskDetails.push(detail) } });
    await a.engine.pass({ force: true });
    a.engine.stop();
    assert.equal(taskDetails[0], 'Orders');

    const statusB = await b.engine.status('local:p');
    assert.deepEqual(statusB.available.map(item => item.name), ['Orders']);
    const { application: appB } = await b.engine.add(statusB.available[0].syncId, 'local:p');
    assert.deepEqual(b.nodeNames(appB), ['api']);
    assert.deepEqual((await b.engine.status('local:p')).available, [], 'now linked here');

    // Nothing changed: a pass does not even ask the cloud for a new version.
    assert.deepEqual((await a.engine.pass()).results, {});

    a.setNodes(appA, ['api', 'db']);
    assert.deepEqual((await a.engine.pass()).results, { [appA.id]: 'pushed' });
    assert.deepEqual((await b.engine.pass()).results, { [appB.id]: 'pulled' });
    assert.deepEqual(b.nodeNames(appB), ['api', 'db']);

    b.setNodes(appB, ['api', 'db', 'queue']);
    await b.engine.pass();
    await a.engine.pass();
    assert.deepEqual(a.nodeNames(appA), ['api', 'db', 'queue']);
    // Pulling does not look like a local change afterwards.
    assert.deepEqual((await a.engine.pass({ force: true })).results, {});
  } finally { a.close(); b.close(); }
});

test('both computers changed: a conflict, nothing overwritten; the version not chosen is kept as a snapshot', async () => {
  const cloud = fakeCloud();
  const a = computer(cloud, 'laptop');
  const b = computer(cloud, 'desktop');
  try {
    const appA = createApp(a);
    await a.engine.enable(appA);
    const { application: appB } = await b.engine.add((await b.engine.status('local:p')).available[0].syncId, 'local:p');

    a.setNodes(appA, ['api', 'from-laptop']);
    b.setNodes(appB, ['api', 'from-desktop']);
    await a.engine.pass();
    assert.deepEqual((await b.engine.pass()).results, { [appB.id]: 'conflict' });
    assert.deepEqual(b.nodeNames(appB), ['api', 'from-desktop'], 'not overwritten');
    const conflict = (await b.engine.status('local:p')).applications[0].conflict;
    assert.equal(conflict.remote.version, 2);
    assert.equal(conflict.remote.signedBy.device, 'laptop');

    // Keep this computer's version: the laptop's goes to a snapshot and desktop's becomes version 3.
    await b.engine.resolve(appB, 'mine');
    assert.equal([...cloud.items.values()][0].version, 3);
    const projectB = b.apmDatabase.getApplication(appB.id).architectureProjectId;
    assert.ok(b.database.listSnapshots(projectB).some(s => s.name.startsWith('Other computer, version 2')));

    // The laptop changed again meanwhile: conflict there; it takes the other one.
    a.setNodes(appA, ['api', 'from-laptop', 'again']);
    assert.deepEqual((await a.engine.pass()).results, { [appA.id]: 'conflict' });
    await a.engine.resolve(appA, 'theirs');
    assert.deepEqual(a.nodeNames(appA), ['api', 'from-desktop']);
    const projectA = a.apmDatabase.getApplication(appA.id).architectureProjectId;
    assert.ok(a.database.listSnapshots(projectA).some(s => s.name.startsWith('This computer before sync')));
  } finally { a.close(); b.close(); }
});

test('stopping sync everywhere unlinks it on the other computers; their copies stay', async () => {
  const cloud = fakeCloud();
  const a = computer(cloud, 'laptop');
  const b = computer(cloud, 'desktop');
  try {
    const appA = createApp(a);
    await a.engine.enable(appA);
    const { application: appB } = await b.engine.add((await b.engine.status('local:p')).available[0].syncId, 'local:p');
    await a.engine.disable(appA, { everywhere: true });
    assert.equal(cloud.items.size, 0);
    assert.deepEqual((await b.engine.pass()).results, { [appB.id]: 'unlinked' });
    assert.ok(b.apmDatabase.getApplication(appB.id), 'the local copy stays');
    assert.deepEqual((await b.engine.status('local:p')).applications, []);
  } finally { a.close(); b.close(); }
});

test('an application without provider syncs from any profile, with its scopes and membership; a detachment travels (#153)', async () => {
  const { normalizeScope } = require('../kua/applicationContract');
  const { ApplicationRegistryService } = require('../kua/applicationRegistryService');
  const cloud = fakeCloud();
  const a = computer(cloud, 'laptop');
  const b = computer(cloud, 'desktop');
  const lambda = name => ({ provider: 'aws', type: 'lambda', key: `arn:aws:lambda:us-east-1:111111111111:function:${name}`, arn: `arn:aws:lambda:us-east-1:111111111111:function:${name}`, name, scopeId: '111111111111', location: 'us-east-1' });
  const members = pc => pc.apmDatabase.listResources(pc.appId).map(resource => resource.name).sort();
  try {
    const registryA = new ApplicationRegistryService({ database: a.apmDatabase, architectureDatabase: a.database });
    const appA = a.apmDatabase.createApplication({ name: 'Checkout' });
    a.appId = appA.id;
    a.apmDatabase.addApplicationScope(appA.id, normalizeScope({ provider: 'aws', scopeId: '111111111111', location: 'us-east-1' }));
    registryA.attachResource(a.apmDatabase.getApplication(appA.id), lambda('api'));
    registryA.attachResource(a.apmDatabase.getApplication(appA.id), lambda('worker'));

    // Enabled from one profile, visible from another: the application has no profile of its own.
    await a.engine.enable(a.apmDatabase.getApplication(appA.id), { profileId: 'local:one' });
    assert.equal((await a.engine.status('local:two')).applications.length, 1);

    const offer = (await b.engine.status('local:p')).available[0];
    const { application: appB } = await b.engine.add(offer.syncId, 'local:p');
    b.appId = appB.id;
    assert.equal(appB.profileId, null);
    assert.deepEqual(members(b), ['api', 'worker']);
    assert.equal(b.apmDatabase.listApplicationScopes(appB.id).length, 1);
    await assert.rejects(b.engine.add(offer.syncId, 'local:other'), /already syncs/);

    // The desktop detaches the worker; the laptop takes that decision and keeps the rest.
    const registryB = new ApplicationRegistryService({ database: b.apmDatabase, architectureDatabase: b.database });
    const worker = b.apmDatabase.listResources(appB.id).find(resource => resource.name === 'worker');
    registryB.detachResource(b.apmDatabase.getApplication(appB.id), worker.id);
    assert.deepEqual((await b.engine.pass({ force: true })).results, { [appB.id]: 'pushed' });
    assert.deepEqual((await a.engine.pass({ force: true })).results, { [appA.id]: 'pulled' });
    assert.deepEqual(members(a), ['api']);
    assert.equal(a.apmDatabase.listRegistryDetachmentKeys(appA.id).length, 1);

    // A member added on the laptop reaches the desktop; nothing more travels back and forth.
    registryA.attachResource(a.apmDatabase.getApplication(appA.id), lambda('billing'));
    assert.deepEqual((await a.engine.pass({ force: true })).results, { [appA.id]: 'pushed' });
    assert.deepEqual((await b.engine.pass({ force: true })).results, { [appB.id]: 'pulled' });
    assert.deepEqual(members(b), ['api', 'billing']);
    assert.deepEqual((await a.engine.pass({ force: true })).results, {});
    assert.deepEqual((await b.engine.pass({ force: true })).results, {});
  } finally { a.close(); b.close(); }
});
