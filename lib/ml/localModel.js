'use strict';
/**
 * lib/ml/localModel.js
 * Local text embeddings with Transformers.js (ONNX Runtime on this machine).
 * Opt-in: nothing is downloaded until the user enables it. The model is
 * downloaded once from Hugging Face (free, about 130 MB) into
 * <KUA data dir>/models and runs offline afterwards; no text leaves the
 * machine.
 *
 * Model: paraphrase-multilingual-MiniLM-L12-v2 (q8, 384 dimensions). Compared
 * on log lines with multilingual-e5-small/base, it ranked Spanish queries
 * over English logs best and spreads similarities enough for thresholds.
 */

const fs = require('node:fs');
const path = require('node:path');

const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const DTYPE = 'q8';
const DIMENSIONS = 384;
const APPROX_DOWNLOAD_BYTES = 130 * 1024 * 1024;
const BATCH = 32;

function resolveDataDir() {
  return process.env.KUA_DATA_DIR || path.join(require('node:os').homedir(), '.kuadashboard');
}

/**
 * @param options.loader   () => Transformers.js module (injectable for tests)
 * @param options.fileSystem node:fs (injectable)
 */
function createLocalModel({ dataDir = resolveDataDir(), loader = () => import('@huggingface/transformers'), fileSystem = fs } = {}) {
  const modelsDir = path.join(dataDir, 'models');
  const stateFile = path.join(dataDir, 'ml.json');
  // idle: enabled but not loaded yet (it loads on first use).
  let state = 'idle';
  let error = null;
  let progress = null;
  let extractor = null;
  let loading = null;

  function readEnabled() {
    try { return JSON.parse(fileSystem.readFileSync(stateFile, 'utf8')).enabled === true; } catch { return false; }
  }
  function writeEnabled(enabled) {
    fileSystem.mkdirSync(dataDir, { recursive: true });
    fileSystem.writeFileSync(stateFile, JSON.stringify({ enabled, model: MODEL_ID }));
  }
  let enabled = readEnabled();

  function modelBytes() {
    const dir = path.join(modelsDir, ...MODEL_ID.split('/'));
    let total = 0;
    const walk = current => {
      let entries = [];
      try { entries = fileSystem.readdirSync(current, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else { try { total += fileSystem.statSync(full).size; } catch { /* vanished */ } }
      }
    };
    walk(dir);
    return total;
  }

  /** Loads (downloading the first time) the model; progress is aggregated across files. */
  function load() {
    if (extractor) return Promise.resolve(extractor);
    if (loading) return loading;
    state = 'loading';
    error = null;
    const files = new Map();
    loading = (async () => {
      const { pipeline, env } = await loader();
      env.cacheDir = modelsDir;
      env.allowRemoteModels = true;
      extractor = await pipeline('feature-extraction', MODEL_ID, {
        dtype: DTYPE,
        progress_callback: event => {
          if (event.status !== 'progress' && event.status !== 'done') return;
          const current = files.get(event.file) || { loaded: 0, total: 0 };
          files.set(event.file, { loaded: event.loaded ?? current.total ?? 0, total: event.total ?? current.total ?? 0 });
          const values = [...files.values()];
          progress = { loaded: values.reduce((sum, f) => sum + (f.loaded || 0), 0), total: values.reduce((sum, f) => sum + (f.total || 0), 0), file: event.file };
        },
      });
      state = 'ready';
      progress = null;
      return extractor;
    })().catch(err => {
      state = 'error';
      error = err.message || String(err);
      extractor = null;
      throw err;
    }).finally(() => { loading = null; });
    return loading;
  }

  function status() {
    const bytes = modelBytes();
    return {
      enabled,
      state: enabled ? state : 'disabled',
      model: MODEL_ID,
      dimensions: DIMENSIONS,
      downloaded: bytes > 0,
      diskBytes: bytes,
      downloadBytes: APPROX_DOWNLOAD_BYTES,
      progress,
      error,
    };
  }

  /** Turns local ML on and starts loading in the background. */
  function enable() {
    enabled = true;
    writeEnabled(true);
    load().catch(() => { /* reported by status() */ });
    return status();
  }

  /** Turns it off; `remove` also deletes the downloaded model files. */
  function disable({ remove = false } = {}) {
    enabled = false;
    writeEnabled(false);
    extractor = null;
    state = 'idle';
    progress = null;
    if (remove) fileSystem.rmSync(path.join(modelsDir, ...MODEL_ID.split('/')), { recursive: true, force: true });
    return status();
  }

  const isReady = () => enabled && state === 'ready' && !!extractor;

  /** Normalized embeddings (Float32Array per text). Loads the model when enabled; throws when disabled. */
  async function embed(texts) {
    if (!enabled) throw Object.assign(new Error('Local ML is disabled'), { code: 'ML_DISABLED' });
    const model = await load();
    const vectors = [];
    for (let index = 0; index < texts.length; index += BATCH) {
      const output = await model(texts.slice(index, index + BATCH), { pooling: 'mean', normalize: true });
      const [rows, dims] = output.dims;
      for (let row = 0; row < rows; row += 1) vectors.push(Float32Array.from(output.data.subarray(row * dims, (row + 1) * dims)));
    }
    return vectors;
  }

  return { status, enable, disable, embed, isReady, load, MODEL_ID };
}

let shared = null;
function getLocalModel() {
  if (!shared) shared = createLocalModel();
  return shared;
}

module.exports = { createLocalModel, getLocalModel, MODEL_ID, DIMENSIONS };
