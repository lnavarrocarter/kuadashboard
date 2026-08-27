'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { emptyGraph, normalizeGraph } = require('./graphModel');

const MIGRATIONS = [
  {
    version: 1,
    sql: `
    CREATE TABLE architecture_projects (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      automatic_edge_threshold REAL NOT NULL DEFAULT 0.85
        CHECK (automatic_edge_threshold >= 0 AND automatic_edge_threshold <= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (profile_id, name)
    );

    CREATE TABLE architecture_graphs (
      project_id TEXT PRIMARY KEY REFERENCES architecture_projects(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
      document_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE architecture_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES architecture_projects(id) ON DELETE CASCADE,
      version INTEGER NOT NULL CHECK (version > 0),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      source_revision INTEGER NOT NULL,
      document_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (project_id, version)
    );

    CREATE INDEX idx_architecture_projects_profile ON architecture_projects(profile_id, updated_at DESC);
    CREATE INDEX idx_architecture_snapshots_project ON architecture_snapshots(project_id, version DESC);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE architecture_changes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES architecture_projects(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK (revision > 0),
        change_type TEXT NOT NULL,
        subject_type TEXT NOT NULL DEFAULT 'graph',
        subject_id TEXT,
        author TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        previous_state_json TEXT,
        new_state_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_architecture_changes_project
        ON architecture_changes(project_id, revision DESC, created_at DESC);
    `,
  },
];

function resolveDataDir() {
  return process.env.KUA_DATA_DIR || path.join(os.homedir(), '.kuadashboard');
}

function requiredString(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) throw Object.assign(new Error(`${field} is required`), { statusCode: 400 });
  return normalized;
}

function parseGraph(value, projectId) {
  try {
    return normalizeGraph(JSON.parse(value), projectId);
  } catch (error) {
    const storedError = Object.assign(new Error('Stored architecture graph is invalid'), { statusCode: 500 });
    storedError.cause = error;
    throw storedError;
  }
}

function parseStoredJson(value) {
  if (value == null) return null;
  try { return JSON.parse(value); } catch (_) {
    throw Object.assign(new Error('Stored architecture change is invalid'), { statusCode: 500 });
  }
}

class ArchitectureDatabase {
  constructor({ filePath, now = () => Date.now() } = {}) {
    this.now = now;
    this.filePath = filePath || path.join(resolveDataDir(), 'architecture.sqlite3');
    this._ensureStorage();
    this.db = new Database(this.filePath);
    if (this.filePath !== ':memory:') {
      try { fs.chmodSync(this.filePath, 0o600); } catch (_) {}
    }
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = NORMAL');
    this._migrate();
    this._prepare();
  }

  _ensureStorage() {
    if (this.filePath === ':memory:') return;
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directory, 0o700); } catch (_) {}
  }

  _migrate() {
    const currentVersion = this.db.pragma('user_version', { simple: true });
    for (const migration of MIGRATIONS) {
      if (migration.version <= currentVersion) continue;
      this.db.transaction(() => {
        this.db.exec(migration.sql);
        this.db.pragma(`user_version = ${migration.version}`);
      })();
    }
    if (this.db.pragma('foreign_key_check').length) {
      throw new Error('Architecture database migration produced invalid references');
    }
  }

  _prepare() {
    this.createProjectTransaction = this.db.transaction(input => {
      const timestamp = new Date(this.now()).toISOString();
      const project = {
        id: input.id || crypto.randomUUID(),
        profileId: requiredString(input.profileId, 'profileId'),
        name: requiredString(input.name, 'name'),
        description: String(input.description || '').trim(),
        automaticEdgeThreshold: input.automaticEdgeThreshold == null ? 0.85 : Number(input.automaticEdgeThreshold),
      };
      if (!Number.isFinite(project.automaticEdgeThreshold) || project.automaticEdgeThreshold < 0 || project.automaticEdgeThreshold > 1) {
        throw Object.assign(new Error('automaticEdgeThreshold must be between 0 and 1'), { statusCode: 400 });
      }
      this.db.prepare(`
        INSERT INTO architecture_projects (
          id, profile_id, name, description, automatic_edge_threshold, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(project.id, project.profileId, project.name, project.description, project.automaticEdgeThreshold, timestamp, timestamp);
      this.db.prepare(`
        INSERT INTO architecture_graphs (project_id, revision, document_json, updated_at)
        VALUES (?, 0, ?, ?)
      `).run(project.id, JSON.stringify(emptyGraph(project.id)), timestamp);
      return this.getProject(project.id);
    });

    this.saveGraphTransaction = this.db.transaction((projectId, graph, expectedRevision, change) => {
      const current = this.db.prepare(`
        SELECT revision, document_json FROM architecture_graphs WHERE project_id = ?
      `).get(projectId);
      if (!current) throw Object.assign(new Error('Architecture project not found'), { statusCode: 404 });
      if (expectedRevision != null && current.revision !== Number(expectedRevision)) {
        throw Object.assign(new Error('Architecture graph revision conflict'), { statusCode: 409 });
      }
      const revision = current.revision + 1;
      const timestamp = new Date(this.now()).toISOString();
      this.db.prepare(`
        UPDATE architecture_graphs SET revision = ?, document_json = ?, updated_at = ? WHERE project_id = ?
      `).run(revision, JSON.stringify(normalizeGraph(graph, projectId)), timestamp, projectId);
      this.db.prepare('UPDATE architecture_projects SET updated_at = ? WHERE id = ?').run(timestamp, projectId);
      this._insertChange(projectId, revision, change, timestamp);
      return this.getGraph(projectId);
    });

    this.createSnapshotTransaction = this.db.transaction((projectId, input) => {
      const graph = this.getGraph(projectId);
      if (!graph) throw Object.assign(new Error('Architecture project not found'), { statusCode: 404 });
      const versionRow = this.db.prepare(`
        SELECT COALESCE(MAX(version), 0) + 1 AS version FROM architecture_snapshots WHERE project_id = ?
      `).get(projectId);
      const timestamp = new Date(this.now()).toISOString();
      const snapshotId = input.id || crypto.randomUUID();
      this.db.prepare(`
        INSERT INTO architecture_snapshots (
          id, project_id, version, name, description, source_revision, document_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        snapshotId, projectId, versionRow.version, requiredString(input.name, 'name'),
        String(input.description || '').trim(), graph.revision, JSON.stringify(graph.document), timestamp,
      );
      return this.getSnapshot(projectId, snapshotId);
    });

    this.importSnapshotTransaction = this.db.transaction((projectId, input) => {
      const project = this.getProject(projectId);
      if (!project) throw Object.assign(new Error('Architecture project not found'), { statusCode: 404 });
      const document = normalizeGraph(input.document, projectId);
      const version = this.db.prepare(`
        SELECT COALESCE(MAX(version), 0) + 1 AS version FROM architecture_snapshots WHERE project_id = ?
      `).get(projectId).version;
      const timestamp = new Date(this.now()).toISOString();
      const snapshotId = input.id || crypto.randomUUID();
      this.db.prepare(`
        INSERT INTO architecture_snapshots (
          id, project_id, version, name, description, source_revision, document_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        snapshotId, projectId, version, requiredString(input.name, 'name'),
        String(input.description || '').trim(), Number(input.sourceRevision) || 0,
        JSON.stringify(document), timestamp,
      );
      return this.getSnapshot(projectId, snapshotId);
    });

    this.revertSnapshotTransaction = this.db.transaction((projectId, snapshotId, expectedRevision, input) => {
      const current = this.db.prepare(`
        SELECT revision, document_json FROM architecture_graphs WHERE project_id = ?
      `).get(projectId);
      if (!current) throw Object.assign(new Error('Architecture project not found'), { statusCode: 404 });
      if (expectedRevision != null && current.revision !== Number(expectedRevision)) {
        throw Object.assign(new Error('Architecture graph revision conflict'), { statusCode: 409 });
      }
      const source = this.db.prepare(`
        SELECT * FROM architecture_snapshots WHERE id = ? AND project_id = ?
      `).get(snapshotId, projectId);
      if (!source) throw Object.assign(new Error('Architecture snapshot not found'), { statusCode: 404 });

      const document = parseGraph(source.document_json, projectId);
      const revision = current.revision + 1;
      const timestamp = new Date(this.now()).toISOString();
      this.db.prepare(`
        UPDATE architecture_graphs SET revision = ?, document_json = ?, updated_at = ? WHERE project_id = ?
      `).run(revision, JSON.stringify(document), timestamp, projectId);
      this.db.prepare('UPDATE architecture_projects SET updated_at = ? WHERE id = ?').run(timestamp, projectId);
      this._insertChange(projectId, revision, {
        type: 'snapshot.revert',
        subjectType: 'snapshot',
        subjectId: snapshotId,
        author: input.author,
        reason: input.reason,
        previousState: { revision: current.revision },
        newState: { revision, sourceSnapshotId: snapshotId, sourceSnapshotVersion: source.version },
      }, timestamp);

      const version = this.db.prepare(`
        SELECT COALESCE(MAX(version), 0) + 1 AS version FROM architecture_snapshots WHERE project_id = ?
      `).get(projectId).version;
      const newSnapshotId = input.id || crypto.randomUUID();
      this.db.prepare(`
        INSERT INTO architecture_snapshots (
          id, project_id, version, name, description, source_revision, document_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newSnapshotId, projectId, version,
        String(input.name || `Revert to v${source.version}`).trim(),
        String(input.description || '').trim(), revision, JSON.stringify(document), timestamp,
      );
      return {
        graph: this.getGraph(projectId),
        snapshot: this.getSnapshot(projectId, newSnapshotId),
      };
    });
  }

  _insertChange(projectId, revision, change = {}, timestamp) {
    const entry = {
      id: change.id || crypto.randomUUID(),
      type: String(change.type || 'graph.replace').trim(),
      subjectType: String(change.subjectType || 'graph').trim(),
      subjectId: change.subjectId == null ? null : String(change.subjectId).trim(),
      author: String(change.author || 'local').trim(),
      reason: String(change.reason || '').trim(),
    };
    this.db.prepare(`
      INSERT INTO architecture_changes (
        id, project_id, revision, change_type, subject_type, subject_id, author,
        reason, previous_state_json, new_state_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id, projectId, revision, entry.type, entry.subjectType, entry.subjectId,
      entry.author, entry.reason,
      change.previousState == null ? null : JSON.stringify(change.previousState),
      change.newState == null ? null : JSON.stringify(change.newState), timestamp,
    );
  }

  createProject(input) {
    return this.createProjectTransaction(input || {});
  }

  getProject(projectId) {
    const row = this.db.prepare('SELECT * FROM architecture_projects WHERE id = ?').get(projectId);
    return row ? this._project(row) : null;
  }

  listProjects({ profileId } = {}) {
    const rows = profileId
      ? this.db.prepare('SELECT * FROM architecture_projects WHERE profile_id = ? ORDER BY updated_at DESC').all(profileId)
      : this.db.prepare('SELECT * FROM architecture_projects ORDER BY updated_at DESC').all();
    return rows.map(row => this._project(row));
  }

  deleteProject(projectId) {
    const result = this.db.prepare('DELETE FROM architecture_projects WHERE id = ?').run(projectId);
    return result.changes === 1;
  }

  getGraph(projectId) {
    const row = this.db.prepare('SELECT * FROM architecture_graphs WHERE project_id = ?').get(projectId);
    return row ? {
      projectId: row.project_id,
      revision: row.revision,
      document: parseGraph(row.document_json, row.project_id),
      updatedAt: row.updated_at,
    } : null;
  }

  saveGraph(projectId, graph, { expectedRevision, change } = {}) {
    return this.saveGraphTransaction(projectId, graph, expectedRevision, change);
  }

  createSnapshot(projectId, input) {
    return this.createSnapshotTransaction(projectId, input || {});
  }

  importSnapshot(projectId, input) {
    return this.importSnapshotTransaction(projectId, input || {});
  }

  getSnapshot(projectId, snapshotId) {
    const row = this.db.prepare(`
      SELECT * FROM architecture_snapshots WHERE id = ? AND project_id = ?
    `).get(snapshotId, projectId);
    return row ? this._snapshot(row, true) : null;
  }

  listSnapshots(projectId) {
    return this.db.prepare(`
      SELECT * FROM architecture_snapshots WHERE project_id = ? ORDER BY version DESC
    `).all(projectId).map(row => this._snapshot(row, false));
  }

  revertToSnapshot(projectId, snapshotId, { expectedRevision, ...input } = {}) {
    return this.revertSnapshotTransaction(projectId, snapshotId, expectedRevision, input);
  }

  listChanges(projectId, { limit = 100 } = {}) {
    const boundedLimit = Math.min(500, Math.max(1, Number(limit) || 100));
    return this.db.prepare(`
      SELECT * FROM architecture_changes
      WHERE project_id = ? ORDER BY revision DESC, created_at DESC LIMIT ?
    `).all(projectId, boundedLimit).map(row => this._change(row));
  }

  health() {
    return {
      ready: this.db.open,
      schemaVersion: this.db.pragma('user_version', { simple: true }),
      journalMode: this.db.pragma('journal_mode', { simple: true }),
    };
  }

  close() {
    if (this.db?.open) this.db.close();
  }

  _project(row) {
    return {
      id: row.id,
      profileId: row.profile_id,
      name: row.name,
      description: row.description,
      automaticEdgeThreshold: row.automatic_edge_threshold,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  _snapshot(row, includeDocument) {
    const snapshot = {
      id: row.id,
      projectId: row.project_id,
      version: row.version,
      name: row.name,
      description: row.description,
      sourceRevision: row.source_revision,
      createdAt: row.created_at,
    };
    if (includeDocument) snapshot.document = parseGraph(row.document_json, row.project_id);
    return snapshot;
  }

  _change(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      revision: row.revision,
      type: row.change_type,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      author: row.author,
      reason: row.reason,
      previousState: parseStoredJson(row.previous_state_json),
      newState: parseStoredJson(row.new_state_json),
      createdAt: row.created_at,
    };
  }
}

let singleton = null;

function getArchitectureDatabase(options) {
  if (!singleton) singleton = new ArchitectureDatabase(options);
  return singleton;
}

function closeArchitectureDatabase() {
  if (!singleton) return;
  singleton.close();
  singleton = null;
}

module.exports = {
  ArchitectureDatabase,
  closeArchitectureDatabase,
  getArchitectureDatabase,
  resolveDataDir,
};
