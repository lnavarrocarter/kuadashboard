'use strict';
// The pricing pages of the website (docs/pricing.md, docs/es/pricing.md and the
// plans section of both home pages) must show the numbers of lib/plans.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PLANS, FREE_LIMITS_FROM } = require('../lib/plans');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'docs', file), 'utf8');
const size = mb => (mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`);
const noticeDate = FREE_LIMITS_FROM.slice(0, 10);

// Prices are not in lib/plans.js: they are the ones of docs/terms.md and the control plane.
const PRICES = {
  en: { pro: 'USD 9 per month or USD 90 per year', team: 'USD 29 per month or USD 290 per year' },
  es: { pro: 'USD 9 al mes o USD 90 al año', team: 'USD 29 al mes o USD 290 al año' },
};
const WORDS = {
  en: { upTo: 'Up to', unlimited: 'Unlimited', minutes: n => `every ${n} minute${n === 1 ? '' : 's'} or more`, apps: n => `up to ${n} KUA Applications` },
  es: { upTo: 'Hasta', unlimited: 'Ilimitadas', minutes: n => `cada ${n} minuto${n === 1 ? '' : 's'} o más`, apps: n => `hasta ${n} KUA Applications` },
};
const rowOf = (text, label) => {
  const line = text.split('\n').find(l => l.startsWith(`| ${label} |`));
  assert.ok(line, `row "${label}" missing`);
  return line.split('|').slice(2, 5).map(cell => cell.trim());
};

for (const [lang, file, labels, termsFile] of [
  ['en', 'pricing.md', { apps: 'KUA Applications', cache: 'Log cache', refresh: 'Log refresh', price: 'Price' }, 'terms.md'],
  ['es', 'es/pricing.md', { apps: 'KUA Applications', cache: 'Caché de logs', refresh: 'Refresco de logs', price: 'Precio' }, 'es/terms.md'],
]) {
  test(`${file} matches lib/plans.js`, () => {
    const text = read(file);
    const w = WORDS[lang];
    const [free, pro, team] = ['free', 'pro', 'team'].map(name => PLANS[name]);

    const [priceFree, priceProCell, priceTeamCell] = rowOf(text, labels.price);
    assert.equal(priceFree, 'USD 0');
    assert.equal(priceProCell, PRICES[lang].pro);
    assert.equal(priceTeamCell, PRICES[lang].team);

    assert.deepEqual(rowOf(text, labels.apps), [
      `${w.upTo} ${free.limits.kuaApps}`,
      pro.limits.kuaApps === null ? w.unlimited : String(pro.limits.kuaApps),
      team.limits.kuaApps === null ? w.unlimited : String(team.limits.kuaApps),
    ]);
    assert.deepEqual(rowOf(text, labels.cache), [free, pro, team].map(plan => size(plan.limits.logCacheMaxMb)));

    const [refreshFree, refreshPro, refreshTeam] = rowOf(text, labels.refresh);
    assert.ok(free.limits.logRefreshMinMinutes === null && !free.features.logAutoRefresh);
    assert.ok(refreshFree.length > 0);
    assert.ok(refreshPro.endsWith(w.minutes(pro.limits.logRefreshMinMinutes)), refreshPro);
    assert.ok(refreshTeam.endsWith(w.minutes(team.limits.logRefreshMinMinutes)), refreshTeam);

    assert.ok(text.includes(noticeDate), 'notice date');
    assert.ok(text.includes(`${PRICES[lang].pro}`) && text.includes(`${PRICES[lang].team}`));
  });

  test(`${file} prices match ${termsFile}`, () => {
    const terms = read(termsFile);
    assert.ok(terms.includes(PRICES[lang].pro), 'Pro price in terms');
    assert.ok(terms.includes(PRICES[lang].team), 'Team price in terms');
  });
}

for (const [lang, file] of [['en', 'index.md'], ['es', 'es/index.md']]) {
  test(`${file} plans section matches lib/plans.js`, () => {
    const text = read(file);
    const w = WORDS[lang];
    const { free, pro, team } = PLANS;
    assert.ok(text.includes(w.apps(free.limits.kuaApps)));
    assert.ok(text.includes(`${size(free.limits.logCacheMaxMb)}`));
    assert.ok(text.includes(size(pro.limits.logCacheMaxMb)));
    assert.ok(text.includes(size(team.limits.logCacheMaxMb)));
    assert.ok(text.includes(PRICES[lang].pro) && text.includes(PRICES[lang].team));
    assert.ok(text.includes(w.minutes(pro.limits.logRefreshMinMinutes)));
    assert.ok(text.includes(noticeDate));
  });
}
