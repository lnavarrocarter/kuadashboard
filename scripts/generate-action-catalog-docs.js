'use strict';
// Writes the action table of docs/architecture/kuapps-action-catalog.md (and the Spanish page)
// from frontend/src/shared/actionCatalog.json (#329). The text around the markers is written by
// hand; scripts/actionCatalogDocs.test.js fails when a table is out of date.
//   node scripts/generate-action-catalog-docs.js

const fs = require('node:fs');
const path = require('node:path');
const { ACTIONS } = require('../lib/kua/actionCatalog');

const START = '<!-- action-catalog:start -->';
const END = '<!-- action-catalog:end -->';
const PAGES = { en: 'docs/architecture/kuapps-action-catalog.md', es: 'docs/es/architecture/kuapps-action-catalog.md' };
const HEADERS = {
  en: ['Action', 'Route', 'Kind', 'Writes', 'Recomputes', 'Revision', 'UI reloads', 'Notes'],
  es: ['Acción', 'Ruta', 'Tipo', 'Escribe', 'Recalcula', 'Revisión', 'Recarga en la UI', 'Notas'],
};
const NOTES = {
  en: { batchable: 'batch', destructive: 'destructive', audit: 'audited', cost: 'cost' },
  es: { batchable: 'en lote', destructive: 'destructiva', audit: 'auditada', cost: 'costo' },
};

const escape = value => String(value).replace(/\|/g, '\\|');
const list = values => (values.length ? values.map(value => `\`${value}\``).join(', ') : '—');

function renderTable(lang) {
  const words = NOTES[lang];
  const rows = Object.entries(ACTIONS)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, action]) => {
      const notes = [
        action.destructive && words.destructive,
        action.batchable && words.batchable,
        action.audit && words.audit,
        action.cost && `${words.cost}: ${action.cost.api}`,
      ].filter(Boolean).join(' · ') || '—';
      const routes = action.routes.map(route => `\`${route}\``).join('<br>');
      return `| \`${key}\` | ${routes} | ${action.kind} | ${list(action.stores)} | ${list(action.derives)} | ${action.revision} | ${list(action.invalidates)} | ${escape(notes)} |`;
    });
  const header = HEADERS[lang];
  return [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows].join('\n');
}

function withTable(text, lang) {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < start) throw new Error(`Markers ${START} / ${END} not found`);
  return `${text.slice(0, start + START.length)}\n\n${renderTable(lang)}\n\n${text.slice(end)}`;
}

if (require.main === module) {
  for (const [lang, file] of Object.entries(PAGES)) {
    const target = path.join(__dirname, '..', file);
    fs.writeFileSync(target, withTable(fs.readFileSync(target, 'utf8'), lang));
    console.log(`Updated ${file}`);
  }
}

module.exports = { renderTable, withTable, PAGES, START, END };
