'use strict';
/**
 * lib/sync/syncEngine.js
 * Keeps the KUA Applications marked for sync in step between the computers of
 * a KUA account (Pro and Team), over the account service's /api/sync.
 *
 * Each synced application has a link here (sync.json in the data directory):
 *   applicationId → { syncId, version, hash, profileId }
 * profileId is null for a KUA Application without provider: it has no profile of its own and
 * shows in every profile, like in KUApps.
 * version is the cloud version this computer last matched and hash the
 * content it had then. On each pass:
 *   - only the cloud changed            → take the new version (pull)
 *   - only this computer changed        → save a new version (push)
 *   - both changed                      → conflict: nothing is overwritten;
 *                                         the user picks mine or theirs and the
 *                                         other one is kept as a snapshot.
 * The cloud is only asked when something may have changed: the account
 * revision moved (another computer saved) or a local copy differs.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validateKuaAppBundle } = require('../kua/kuaAppBundle');
const { createKuaAppIo, contentHash } = require('../kua/kuaAppIo');

const PASS_EVERY_MS = 2 * 60 * 1000;

function createSyncEngine({ account, database, apmDatabase, dataDir, fileSystem = fs, now = () => Date.now(), log = console }) {
  const io = createKuaAppIo({ database, apmDatabase });
  const stateFile = path.join(dataDir, 'sync.json');
  let state = read();
  let lastRevision = null;
  let running = null;
  let timer = null;
  let taskHandle = null;

  function read() {
    try { return { links: {}, conflicts: {}, ...JSON.parse(fileSystem.readFileSync(stateFile, 'utf8')) }; } catch { return { links: {}, conflicts: {} }; }
  }
  function save() {
    fileSystem.mkdirSync(dataDir, { recursive: true });
    fileSystem.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }

  const localHash = application => contentHash(io.exportBundle(application));
  const appOf = id => apmDatabase.getApplication(id);

  async function push(application, link) {
    const bundle = io.exportBundle(application);
    try {
      const saved = await account().sync.put(link.syncId, bundle, link.version);
      state.links[application.id] = { ...link, version: saved.version, hash: contentHash(bundle), syncedAt: new Date(now()).toISOString() };
      delete state.conflicts[application.id];
      return 'pushed';
    } catch (err) {
      if (err.code !== 'SYNC_CONFLICT') throw err;
      state.conflicts[application.id] = { remote: err.details?.current || null, detectedAt: new Date(now()).toISOString() };
      return 'conflict';
    }
  }

  async function pull(application, link, version) {
    const { version: got, bundle } = await account().sync.download(link.syncId, version);
    validateKuaAppBundle(bundle);
    const updated = io.applyBundle(application, bundle);
    state.links[application.id] = { ...link, version: got, hash: localHash(updated), syncedAt: new Date(now()).toISOString() };
    delete state.conflicts[application.id];
    return 'pulled';
  }

  /** One pass over the linked applications; returns what happened to each. */
  async function pass({ force = false } = {}) {
    const links = Object.entries(state.links);
    taskHandle?.setDetail(links.map(([id]) => appOf(id)?.name || id).join(', '));
    if (!links.length) return { results: {} };
    const changedHere = links.filter(([id, link]) => { const app = appOf(id); return app && localHash(app) !== link.hash; });
    const revision = account().revision();
    if (!force && !changedHere.length && revision === lastRevision) return { results: {} };

    const remote = await account().sync.list();
    lastRevision = revision;
    const bySyncId = new Map(remote.items.map(item => [item.syncId, item]));
    const results = {};
    for (const [id, link] of links) {
      const application = appOf(id);
      if (!application) { delete state.links[id]; delete state.conflicts[id]; continue; }
      const cloud = bySyncId.get(link.syncId);
      // Stopped on another computer: the local copy stays, unlinked.
      if (!cloud) { delete state.links[id]; delete state.conflicts[id]; results[id] = 'unlinked'; continue; }
      const mine = localHash(application) !== link.hash;
      const theirs = cloud.version > link.version;
      try {
        if (mine && theirs) {
          state.conflicts[id] = { remote: cloud, detectedAt: new Date(now()).toISOString() };
          results[id] = 'conflict';
        } else if (theirs) results[id] = await pull(application, link, cloud.version);
        else if (mine) results[id] = await push(application, link);
      } catch (err) {
        results[id] = 'error';
        log.warn?.('[sync]', application.name, err.message);
      }
    }
    save();
    return { results };
  }

  async function syncNow() {
    if (!running) running = pass({ force: true }).finally(() => { running = null; });
    return running;
  }

  function start({ task = null } = {}) {
    if (timer) return;
    if (task) taskHandle = task;
    timer = setInterval(() => {
      if (running) return;
      const run = task ? task.run(() => pass()) : pass();
      running = run.catch(err => { if (err.code !== 'SIGNED_OUT' && err.code !== 'OFFLINE') log.warn?.('[sync]', err.message); }).finally(() => { running = null; });
    }, PASS_EVERY_MS);
    timer.unref?.();
  }
  function stop() { clearInterval(timer); timer = null; }
  function pause() { stop(); }
  function resume() { start({ task: taskHandle }); }

  /** Starts syncing an application: version 1 in the cloud. */
  async function enable(application, { profileId = application.profileId } = {}) {
    if (state.links[application.id]) return status(profileId);
    const link = { syncId: crypto.randomBytes(12).toString('base64url'), version: 0, hash: null, profileId: application.profileId || null };
    const result = await push(application, link);
    if (result === 'conflict') throw Object.assign(new Error('This application is already synced'), { statusCode: 409 });
    save();
    return status(profileId);
  }

  async function disable(application, { everywhere = false, profileId = application.profileId } = {}) {
    const link = state.links[application.id];
    if (!link) return status(profileId);
    if (everywhere) await account().sync.remove(link.syncId).catch(err => { if (err.statusCode !== 404) throw err; });
    delete state.links[application.id];
    delete state.conflicts[application.id];
    save();
    return status(profileId);
  }

  /** The user's pick in a conflict; the other version stays as a snapshot. */
  async function resolve(application, choice, { profileId = application.profileId } = {}) {
    const link = state.links[application.id];
    const conflict = state.conflicts[application.id];
    if (!link || !conflict) throw Object.assign(new Error('There is no sync conflict for this application'), { statusCode: 409 });
    const { version, bundle } = await account().sync.download(link.syncId);
    validateKuaAppBundle(bundle);
    const stamp = new Date(now()).toISOString().slice(0, 16).replace('T', ' ');
    if (choice === 'theirs') {
      io.snapshotCurrent(application, `This computer before sync (${stamp})`);
      await pull(application, link, version);
    } else {
      io.snapshotBundle(application, bundle, `Other computer, version ${version} (${stamp})`);
      state.links[application.id] = { ...link, version };
      const result = await push(appOf(application.id), state.links[application.id]);
      if (result === 'conflict') { save(); throw Object.assign(new Error('Another computer saved again: review the new version'), { statusCode: 409, code: 'SYNC_CONFLICT' }); }
    }
    save();
    return status(profileId);
  }

  /** An application synced from another computer, as a new application here. */
  async function add(syncId, profileId) {
    const { version, bundle } = await account().sync.download(syncId);
    const validated = validateKuaAppBundle(bundle);
    // An application without provider is one per computer, whichever profile adds it.
    const providerLess = !validated.application.provider;
    if (Object.values(state.links).some(link => link.syncId === syncId && (providerLess || link.profileId === profileId))) {
      throw Object.assign(new Error('This application already syncs in this profile'), { statusCode: 409 });
    }
    const result = io.importBundle(profileId, validated, { reason: 'Synced from another computer' });
    state.links[result.application.id] = { syncId, version, hash: localHash(result.application), profileId: result.application.profileId || null, syncedAt: new Date(now()).toISOString() };
    save();
    return { application: result.application, ...await status(profileId) };
  }

  /** What syncs in this profile, the conflicts and what other computers have. */
  async function status(profileId) {
    let remote = null;
    try { remote = await account().sync.list(); } catch (err) { if (!['SIGNED_OUT', 'OFFLINE'].includes(err.code)) throw err; }
    const linkedHere = new Set(Object.values(state.links).map(link => link.syncId));
    const applications = Object.entries(state.links)
      .filter(([, link]) => link.profileId === profileId || !link.profileId)
      .map(([applicationId, link]) => {
        const cloud = remote?.items.find(item => item.syncId === link.syncId) || null;
        const app = appOf(applicationId);
        return {
          applicationId, syncId: link.syncId, version: link.version, syncedAt: link.syncedAt || null,
          changedHere: app ? localHash(app) !== link.hash : false,
          cloud, conflict: state.conflicts[applicationId] || null,
        };
      });
    return {
      enabled: remote ? remote.enabled : null,
      signedIn: remote !== null,
      applications,
      available: (remote?.items || []).filter(item => !linkedHere.has(item.syncId)),
    };
  }

  return { pass, syncNow, start, stop, pause, resume, health: () => ({ running: !!timer }), enable, disable, resolve, add, status, state: () => state };
}

module.exports = { createSyncEngine, PASS_EVERY_MS };
