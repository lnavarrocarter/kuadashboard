'use strict';
/**
 * lib/sync/teamEngine.js
 * KUA Desktop's part of the team's shared space (Team plan).
 *
 * - Publishes a sanitized copy of every KUA Application of this computer to
 *   the team (the team's owner and admins see them; the member is told so).
 *   Only when an application changed: hashing is local, the network is used
 *   only to send what changed.
 * - Keeps the applications imported from the team up to date: a newer version
 *   is applied after verifying the author's and the team's signatures.
 * State: team.json in the data directory.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validateKuaAppBundle } = require('../kua/kuaAppBundle');
const { createKuaAppIo, contentHash } = require('../kua/kuaAppIo');

function createTeamEngine({ account, database, apmDatabase, dataDir, fileSystem = fs, log = console }) {
  const io = createKuaAppIo({ database, apmDatabase });
  const stateFile = path.join(dataDir, 'team.json');
  const empty = () => ({ teamId: null, published: {}, imported: {} });
  let state = read();
  let lastRevision = null;

  function read() {
    try { return { ...empty(), ...JSON.parse(fileSystem.readFileSync(stateFile, 'utf8')) }; } catch { return empty(); }
  }
  function save() {
    fileSystem.mkdirSync(dataDir, { recursive: true });
    fileSystem.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }
  const teamOf = () => account().status().entitlements?.team || null;

  /** One pass: publish what changed here, update what was imported from the team. */
  async function pass({ force = false } = {}) {
    const team = teamOf();
    if (!team) {
      if (state.teamId) { state = { ...empty(), imported: {} }; save(); } // left the team: copies stay, unlinked
      return { published: 0, updated: 0 };
    }
    // Another team than before: start over (a first pass only records the team).
    if (state.teamId && state.teamId !== team.id) state = empty();
    state.teamId = team.id;

    let published = 0;
    const local = apmDatabase.listApplications();
    const ids = new Set(local.map(application => application.id));
    for (const application of local) {
      if (state.imported[application.id]) continue; // the team's own items are not published again
      const bundle = io.exportBundle(application);
      const hash = contentHash(bundle);
      const entry = state.published[application.id] || { appKey: crypto.randomBytes(12).toString('base64url') };
      if (entry.hash === hash) continue;
      try {
        await account().team.publish(team.id, entry.appKey, bundle);
        state.published[application.id] = { ...entry, hash };
        published += 1;
      } catch (err) {
        log.warn?.('[team] publish', application.name, err.message);
        if (['SIGNED_OUT', 'OFFLINE', 'NO_TEAM', 'PLAN_REQUIRED'].includes(err.code)) break;
      }
    }
    // Deleted here: no longer published.
    for (const [applicationId, entry] of Object.entries(state.published)) {
      if (ids.has(applicationId)) continue;
      await account().team.unpublish(entry.appKey).catch(err => log.warn?.('[team] unpublish', err.message));
      delete state.published[applicationId];
    }

    // Imported items: ask the team only when the account revision moved.
    let updated = 0;
    const revision = account().revision();
    if (Object.keys(state.imported).length && (force || revision !== lastRevision)) {
      lastRevision = revision;
      const catalog = await account().team.catalog();
      for (const [applicationId, link] of Object.entries(state.imported)) {
        const application = apmDatabase.getApplication(applicationId);
        const item = catalog.items.find(candidate => candidate.id === link.itemId);
        if (!application || !item) { delete state.imported[applicationId]; continue; } // no longer shared with this account: the copy stays
        if (item.version <= link.version) continue;
        try {
          const { version, bundle } = await account().team.content(catalog.team, item.id);
          io.applyBundle(application, validateKuaAppBundle(bundle), { reason: 'Updated from the team' });
          state.imported[applicationId] = { ...link, version };
          updated += 1;
        } catch (err) { log.warn?.('[team] update', application.name, err.message); }
      }
    }
    save();
    return { published, updated };
  }

  /** A team item (shared, or any for a manager) as a new application of this profile, kept up to date. */
  async function importItem(itemId, profileId) {
    const catalog = await account().team.catalog();
    const item = catalog.items.find(candidate => candidate.id === itemId);
    if (!item) throw Object.assign(new Error('This KUA Application is not available to you in the team'), { statusCode: 404 });
    const { version, bundle } = await account().team.content(catalog.team, itemId);
    const result = io.importBundle(profileId, validateKuaAppBundle(bundle), { reason: `Imported from the team (${item.owner.email})` });
    state.imported[result.application.id] = { itemId, version, profileId };
    save();
    return result;
  }

  /** A team backup restored as a new application (not linked). */
  async function restoreBackup(itemId, backupId, profileId) {
    const catalog = await account().team.catalog();
    const { bundle } = await account().team.backupContent(catalog.team, itemId, backupId);
    return io.importBundle(profileId, validateKuaAppBundle(bundle), { reason: 'Restored from a team backup' });
  }

  /** applicationId → itemId of what was imported here. */
  const importedHere = () => Object.fromEntries(Object.entries(state.imported).map(([applicationId, link]) => [link.itemId, applicationId]));

  let timer = null;
  let running = null;
  function start(everyMs = 2 * 60 * 1000) {
    if (timer) return;
    timer = setInterval(() => {
      if (running) return;
      running = pass().catch(err => { if (!['SIGNED_OUT', 'OFFLINE'].includes(err.code)) log.warn?.('[team]', err.message); }).finally(() => { running = null; });
    }, everyMs);
    timer.unref?.();
  }
  function stop() { clearInterval(timer); timer = null; }

  return { pass, start, stop, importItem, restoreBackup, importedHere, state: () => state };
}

module.exports = { createTeamEngine };
