'use strict';
/**
 * vscode/src/texts.js
 * KUA's own texts for what the editor shows of an application (#303), so a resource or an issue
 * reads the same as in KUA. esbuild.mjs copies the keys it needs from frontend/src/locales into
 * dist/texts.json ({ en, es }); interpolation is KUA's: "{name}".
 */

const fs = require('node:fs');
const path = require('node:path');

// Prefixes of the keys the extension uses (also read by esbuild.mjs).
const TEXT_PREFIXES = ['advisor.', 'agentBrief.', 'kuapps.issue.', 'kuapps.signalState.', 'apm.threshold.', 'apm.signal.'];

function loadTexts(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { en: {}, es: {} }; }
}

/** t(key, params) in `lang` (es when the editor is in Spanish), English when a key is missing. */
function translator(texts, lang = 'en') {
  const language = String(lang || '').toLowerCase().startsWith('es') ? 'es' : 'en';
  const locale = texts?.[language] || {};
  const fallback = texts?.en || {};
  return (key, params) => {
    const text = locale[key] ?? fallback[key] ?? key;
    if (!params || typeof text !== 'string') return text;
    return text.replace(/\{(\w+)\}/g, (_, name) => (params[name] ?? `{${name}}`));
  };
}

const textsFile = extensionPath => path.join(extensionPath, 'dist', 'texts.json');

module.exports = { TEXT_PREFIXES, loadTexts, textsFile, translator };
