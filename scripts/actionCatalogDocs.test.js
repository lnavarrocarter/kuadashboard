'use strict';
// The action tables of docs/architecture/kuapps-action-catalog.md and its Spanish page must be
// the ones generated from frontend/src/shared/actionCatalog.json (#329).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PAGES, withTable } = require('./generate-action-catalog-docs');

for (const [lang, file] of Object.entries(PAGES)) {
  test(`${file} shows the current action catalog`, () => {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(text, withTable(text, lang), 'Run node scripts/generate-action-catalog-docs.js');
  });
}
