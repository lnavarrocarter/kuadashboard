'use strict';
/**
 * lib/ml/semantic.js
 * What KUA does with local embeddings (lib/ml/localModel.js) on the sanitized
 * error signatures of cached log groups:
 *
 *   search       rank signatures by meaning ("timeouts contra la base de
 *                datos" finds "ETIMEDOUT <ip>:5432")
 *   clusters     merge signatures that say the same thing in different words
 *                (cosine ≥ 0.6, single link: conservative on purpose)
 *   suggestions  a likely category for signatures the rules left as
 *                other_error / other_warning (best prototype ≥ 0.40 and ahead
 *                of the second by ≥ 0.03; otherwise no suggestion)
 *
 * Thresholds come from a comparison on real log lines (see the model notes).
 * Vectors are cached in SQLite by model and text hash, so each signature is
 * embedded once.
 */

const crypto = require('node:crypto');

const CLUSTER_THRESHOLD = 0.6;
const SUGGEST_THRESHOLD = 0.4;
const SUGGEST_MARGIN = 0.03;
const SEARCH_MIN_SCORE = 0.4;

// Prototype descriptions per category (English: the model maps other languages onto them).
const CATEGORY_PROTOTYPES = {
  timeout: 'the operation timed out; request took too long; deadline exceeded',
  out_of_memory: 'out of memory; heap limit reached; memory exhausted',
  throttling: 'rate limit exceeded; too many requests; throttled; throughput exceeded',
  access_denied: 'access denied; not authorized; permission denied; forbidden',
  connection: 'connection refused; connection reset; socket closed; network unreachable; host not found',
  crash: 'process crashed; runtime exited; killed by signal; fatal error',
  configuration: 'missing configuration; environment variable not set; module not found; invalid setting',
  database: 'database error; SQL query failed; deadlock; database connection lost',
  code_exception: 'programming error; undefined is not a function; null reference; unhandled exception in code',
  not_found: 'resource not found; 404; no such key',
  validation: 'invalid input; validation failed; bad request; malformed parameter',
};
const UNCATEGORIZED = new Set(['other_error', 'other_warning']);

function cosine(a, b) {
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) sum += a[index] * b[index];
  return sum;
}

const hash = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);

// JSON fields that carry the message of a structured line ("log" wraps container stdout).
const MESSAGE_FIELD_RE = /"(log|msg|message|error|err|errorMessage|reason|detail|stack)"\s*:\s*"((?:[^"\\]|\\.)*)/g;

function unescapeJson(value) {
  try { return JSON.parse('"' + value.replace(/\\$/, '') + '"'); } catch {
    return value.replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\\[ntr]/g, ' ').replace(/\\(.)/g, '$1');
  }
}

/**
 * Message of a structured (JSON) line, also when JSON is nested as an escaped
 * string or the sample was cut: values of message-like fields, innermost first.
 */
function jsonMessage(text) {
  let current = text;
  for (let depth = 0; depth < 3; depth += 1) {
    const values = [...current.matchAll(MESSAGE_FIELD_RE)].map(match => unescapeJson(match[2])).filter(value => value.trim());
    if (!values.length) return depth ? current : null;
    current = values.join('. ');
  }
  return current;
}

/**
 * Text as embedded: what the error says, without log plumbing. Removes ANSI
 * colors, KUA placeholders (<n>, <timestamp>…), dates, times, ids, levels,
 * thread and logger prefixes, takes the message out of JSON lines and splits
 * CamelCase and snake_case so "ServerSelectionTimeoutError" reads as words.
 */
function embeddingText(raw) {
  // Real escape, escaped in JSON (\u001b) or left as text by an earlier pass (u001b).
  const ansi = /(\u001b|\\u001b|\bu001b)\[?[0-9;]*m?/g;
  let text = String(raw || '').replace(ansi, ' ');
  text = (jsonMessage(text) || text).replace(ansi, ' ');
  text = text
    .replace(/<[a-z_]+>/gi, ' ')                                              // KUA placeholders
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}(:\d{2})?([.,]\d+)?Z?/g, ' ')  // 2026-10-02 07:02:11,975 / ISO
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?([.,]\d+)?(\s?[AP]M)?\b/gi, ' ')          // 1:49:35 AM
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, ' ')                        // 10/03/2026
    .replace(/\b[EWIF]\d{4}\b/g, ' ')                                          // klog E1002
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' ')
    .replace(/\b[0-9a-f]{16,}\b/gi, ' ')
    .replace(/\[[^\]]{0,80}\]/g, ' ')                                         // [main], [thread-1]
    .replace(/\([\w$.]+\.(scala|java|kt|py|js|ts|go)(:[\w$<>() ]*)?\)+/gi, ' ')  // (Logging.scala:logError(<n>))
    .replace(/\b[\w-]+\.(go|py|js|ts|scala|java):\d+\b/g, ' ')                  // reflector.go:158
    .replace(/\b(TRACE|DEBUG|VERBOSE|LOG|INFO|NOTICE|WARN(ING)?|ERROR|FATAL|CRITICAL)\b:?|\b[EWI]!|\b[AP]M\b/g, ' ')
    .replace(/^[\s:,-]*(?:[a-z][\w$]*\.)+[A-Z][\w$]*\s*:?/, ' ')              // logger prefix: glue.ProcessLauncher:
    .replace(/\b[a-z][\w$]*(\.[a-z][\w$]*)+\.([A-Z][\w$]*)\b/g, '$2')           // org.apache.spark.Executor → Executor
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')                                   // camelCase → camel Case
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')                                // HTTPError → HTTP Error
    .replace(/[_/\\]+/g, ' ')
    .replace(/\b\d+([.,:]\d+)*\b/g, ' ')                                       // bare numbers, versions, ip:port
    .replace(/[^\p{L}.,:;!?'" -]+/gu, ' ')
    .replace(/(\s[-.,:;]+)+\s/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 300);
}

/** Signature text as embedded: the cleaned sanitized sample (the most complete line), else the signature. */
function signatureText(signature) {
  const cleanSample = signature.sample ? embeddingText(signature.sample) : '';
  const cleanSignature = embeddingText(signature.signature);
  return (cleanSample.length > cleanSignature.length ? cleanSample : cleanSignature) || String(signature.signature || '').slice(0, 300);
}

/**
 * SQLite-backed vector cache around an embedder.
 * @param options.database () => better-sqlite3 handle
 * @param options.model    { embed(texts) => Float32Array[], MODEL_ID }
 */
function createVectorCache({ database, model }) {
  let ready = false;
  function db() {
    const handle = database();
    if (!ready) {
      handle.exec(`CREATE TABLE IF NOT EXISTS ml_text_vectors (
        model TEXT NOT NULL, hash TEXT NOT NULL, vector BLOB NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (model, hash)) WITHOUT ROWID`);
      ready = true;
    }
    return handle;
  }

  /** Vectors for texts (same order), embedding only those not cached yet. */
  async function vectors(texts) {
    const handle = db();
    const read = handle.prepare('SELECT vector FROM ml_text_vectors WHERE model = ? AND hash = ?');
    const keys = texts.map(hash);
    const result = keys.map(key => {
      const row = read.get(model.MODEL_ID, key);
      return row ? new Float32Array(row.vector.buffer.slice(row.vector.byteOffset, row.vector.byteOffset + row.vector.byteLength)) : null;
    });
    const missing = [...new Set(result.map((vector, index) => (vector ? null : index)).filter(index => index != null).map(index => texts[index]))];
    if (missing.length) {
      const embedded = await model.embed(missing);
      const write = handle.prepare('INSERT OR REPLACE INTO ml_text_vectors (model, hash, vector, created_at) VALUES (?, ?, ?, ?)');
      const byText = new Map(missing.map((text, index) => [text, embedded[index]]));
      handle.transaction(() => {
        for (const [text, vector] of byText) write.run(model.MODEL_ID, hash(text), Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength), Date.now());
      })();
      texts.forEach((text, index) => { if (!result[index]) result[index] = byText.get(text); });
    }
    return result;
  }

  /** Removes vectors of other models (after switching models). */
  function prune() {
    db().prepare('DELETE FROM ml_text_vectors WHERE model <> ?').run(model.MODEL_ID);
  }

  return { vectors, prune };
}

function normalize(vector) {
  const norm = Math.hypot(...vector) || 1;
  return vector.map(value => value / norm);
}

/**
 * Centroid clusters: signatures, most frequent first, join the cluster whose
 * centroid they are closest to when the cosine is ≥ threshold. Comparing with
 * the whole cluster (not its nearest member) avoids chaining different errors
 * through intermediate ones. Only clusters of 2 or more are returned.
 */
function clusterSignatures(signatures, vectors, { threshold = CLUSTER_THRESHOLD, maxShown = 5 } = {}) {
  const order = signatures.map((_, index) => index).sort((a, b) => signatures[b].occurrences - signatures[a].occurrences);
  const clusters = [];
  for (const index of order) {
    let best = null;
    let bestScore = threshold;
    for (const cluster of clusters) {
      const score = cosine(vectors[index], cluster.centroid);
      if (score >= bestScore) { best = cluster; bestScore = score; }
    }
    if (!best) {
      clusters.push({ members: [index], sum: Float32Array.from(vectors[index]), centroid: vectors[index], minScore: 1 });
      continue;
    }
    best.members.push(index);
    best.minScore = Math.min(best.minScore, bestScore);
    for (let d = 0; d < best.sum.length; d += 1) best.sum[d] += vectors[index][d];
    best.centroid = normalize(best.sum);
  }
  return clusters
    .filter(cluster => cluster.members.length > 1)
    .map(cluster => {
      const items = cluster.members.map(index => signatures[index]);
      return {
        occurrences: items.reduce((sum, item) => sum + item.occurrences, 0),
        size: items.length,
        minScore: Math.round(cluster.minScore * 100) / 100,
        signatures: items.slice(0, maxShown).map(({ signature, occurrences, category, level }) => ({ signature, occurrences, category, level })),
      };
    })
    .sort((a, b) => b.occurrences - a.occurrences);
}

/** Likely category of uncategorized signatures, from the closest category prototype. */
function suggestCategories(signatures, vectors, prototypeVectors, { threshold = SUGGEST_THRESHOLD, margin = SUGGEST_MARGIN } = {}) {
  const categories = Object.keys(prototypeVectors);
  const suggestions = [];
  signatures.forEach((signature, index) => {
    if (!UNCATEGORIZED.has(signature.category || 'other_error')) return;
    const ranked = categories.map(category => [category, cosine(vectors[index], prototypeVectors[category])]).sort((a, b) => b[1] - a[1]);
    const [[category, score], second = [null, 0]] = ranked;
    if (score < threshold || score - second[1] < margin) return;
    suggestions.push({ signature: signature.signature, category, score: Math.round(score * 100) / 100 });
  });
  return suggestions;
}

/** Ranks candidates ({ text, ...data }) by similarity to the query vector. */
function rank(queryVector, candidates, vectors, { limit = 20, minScore = SEARCH_MIN_SCORE } = {}) {
  return candidates
    .map((candidate, index) => ({ ...candidate, score: Math.round(cosine(queryVector, vectors[index]) * 1000) / 1000 }))
    .filter(candidate => candidate.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * The semantic layer over a log cache: clusters and suggestions for one
 * group, and search across groups.
 */
function createSemantic({ vectorCache, model }) {
  let prototypes = null;
  async function prototypeVectors() {
    if (!prototypes) {
      const categories = Object.keys(CATEGORY_PROTOTYPES);
      const vectors = await vectorCache.vectors(categories.map(category => CATEGORY_PROTOTYPES[category]));
      prototypes = Object.fromEntries(categories.map((category, index) => [category, vectors[index]]));
    }
    return prototypes;
  }

  /** Clusters and category suggestions for the signatures of one group (null when ML is not ready). */
  async function analyze(signatures) {
    if (!model.isReady() || !signatures?.length) return null;
    const list = signatures.slice(0, 100);
    const vectors = await vectorCache.vectors(list.map(signatureText));
    return {
      clusters: clusterSignatures(list, vectors),
      suggestions: suggestCategories(list, vectors, await prototypeVectors()),
    };
  }

  /** Signatures across groups ranked by meaning: groups = [{ logGroup, signatures }]. */
  async function search(query, groups, options) {
    const candidates = groups.flatMap(({ logGroup, signatures }) => (signatures || []).map(signature => ({ logGroup, ...signature })));
    if (!candidates.length) return [];
    const [queryVector] = await model.embed([String(query).slice(0, 500)]);
    const vectors = await vectorCache.vectors(candidates.map(signatureText));
    return rank(queryVector, candidates, vectors, options)
      .map(({ logGroup, signature, sample, occurrences, category, level, lastSeen, score }) => ({ logGroup, signature, sample, occurrences, category, level, lastSeen, score }));
  }

  return { analyze, search };
}

module.exports = {
  createVectorCache, createSemantic, clusterSignatures, suggestCategories, rank, cosine, signatureText, embeddingText,
  CATEGORY_PROTOTYPES, CLUSTER_THRESHOLD, SUGGEST_THRESHOLD,
};
