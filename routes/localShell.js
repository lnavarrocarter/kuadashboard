'use strict';
/**
 * routes/localShell.js
 * REST endpoints for the local file-system browser.
 * The interactive shell WebSocket (/ws/shell) lives in server.js
 * alongside the other WebSocket servers.
 *
 * Endpoints:
 *   GET /api/local/home             → { path: string }
 *   GET /api/local/drives           → [{ label, path }]  (Windows only)
 *   GET /api/local/ls?path=<dir>    → { path, parent, entries: [...] }
 *   GET /api/local/read?path=<file> → { path, content, lines, size }
 *   GET /api/local/stat?path=<any>  → { path, exists, isDir, size, mtime }
 */

const express = require('express');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise + validate a user-supplied path. Throws on bad input. */
function safePath(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('path is required');
  const p = path.normalize(raw.trim());
  if (p.includes('\0')) throw new Error('Invalid path');
  return p;
}

/** Human-readable file size */
function fmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Map file extension → icon token (rendered client-side) */
function iconFor(name, isDir) {
  if (isDir) return 'dir';
  const ext = path.extname(name).toLowerCase().slice(1);
  const map = {
    js: 'code', ts: 'code', jsx: 'code', tsx: 'code', vue: 'code',
    json: 'json', yaml: 'config', yml: 'config', toml: 'config', env: 'config',
    md: 'doc', txt: 'doc', rst: 'doc',
    html: 'web', css: 'web', scss: 'web',
    sh: 'script', bash: 'script', ps1: 'script', bat: 'script', cmd: 'script',
    jpg: 'img', jpeg: 'img', png: 'img', gif: 'img', svg: 'img', ico: 'img',
    zip: 'archive', gz: 'archive', tar: 'archive', rar: 'archive', '7z': 'archive',
    pdf: 'pdf',
    go: 'code', py: 'code', rb: 'code', java: 'code', rs: 'code', c: 'code', cpp: 'code',
    lock: 'lock', gitignore: 'git', gitattributes: 'git',
  };
  return map[ext] || 'file';
}

/** Get all filesystem entries in a directory, sorted: dirs first then files */
async function listDir(dirPath) {
  const raw = await fs.promises.readdir(dirPath, { withFileTypes: true });

  const entries = await Promise.allSettled(
    raw.map(async entry => {
      let size = null, mtime = null, isSymlink = false;
      try {
        const stat = await fs.promises.stat(path.join(dirPath, entry.name));
        size  = stat.size;
        mtime = stat.mtime.toISOString();
      } catch (_) {}
      isSymlink = entry.isSymbolicLink();

      return {
        name:     entry.name,
        isDir:    entry.isDirectory(),
        isFile:   entry.isFile(),
        isSymlink,
        icon:     iconFor(entry.name, entry.isDirectory()),
        size,
        sizeHuman: fmtSize(size),
        mtime,
      };
    })
  );

  return entries
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/local/home → { path } */
router.get('/home', (_req, res) => {
  res.json({ path: os.homedir() });
});

/**
 * GET /api/local/drives (Windows only)
 * Returns available drive letters. On non-Windows returns [{ label: '/', path: '/' }]
 */
router.get('/drives', async (_req, res) => {
  if (process.platform !== 'win32') {
    return res.json([{ label: '/', path: '/' }]);
  }
  // On Windows enumerate A-Z
  const drives = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    const drivePath = `${letter}:\\`;
    try {
      await fs.promises.access(drivePath);
      drives.push({ label: `${letter}:`, path: drivePath });
    } catch (_) {}
  }
  res.json(drives);
});

/**
 * GET /api/local/ls?path=<dir>
 * Lists directory contents.
 */
router.get('/ls', async (req, res) => {
  try {
    const dirPath = safePath(req.query.path || os.homedir());
    const entries = await listDir(dirPath);
    const parent  = path.dirname(dirPath);
    res.json({
      path:    dirPath,
      parent:  parent === dirPath ? null : parent,  // null at filesystem root
      sep:     path.sep,
      entries,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/local/read?path=<file>
 * Returns file content as text. Max 512 KB to protect memory.
 */
router.get('/read', async (req, res) => {
  const MAX = 512 * 1024;
  try {
    const filePath = safePath(req.query.path);
    const stat     = await fs.promises.stat(filePath);
    if (stat.isDirectory()) return res.status(400).json({ error: 'Path is a directory' });
    if (stat.size > MAX) return res.status(413).json({ error: `File too large (${fmtSize(stat.size)}). Max 512 KB.` });

    const content = await fs.promises.readFile(filePath, 'utf8');
    res.json({
      path:    filePath,
      content,
      lines:   content.split('\n').length,
      size:    stat.size,
      sizeHuman: fmtSize(stat.size),
    });
  } catch (err) {
    const code = err.code === 'ENOENT' ? 404 : 400;
    res.status(code).json({ error: err.message });
  }
});

/**
 * GET /api/local/stat?path=<any>
 * Returns metadata about a path (for autocomplete decisions).
 */
router.get('/stat', async (req, res) => {
  try {
    const p = safePath(req.query.path);
    try {
      const stat = await fs.promises.stat(p);
      res.json({
        path:  p,
        exists: true,
        isDir:  stat.isDirectory(),
        size:   stat.size,
        mtime:  stat.mtime.toISOString(),
      });
    } catch (_) {
      res.json({ path: p, exists: false });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
