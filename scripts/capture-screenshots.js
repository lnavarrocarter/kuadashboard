/**
 * Capture KuaDashboard screenshots for documentation.
 * Usage: node scripts/capture-screenshots.js
 * Requires the app running on http://localhost:7190
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:7190';
const OUT_DIR = path.join(__dirname, '..', 'docs', 'public', 'screenshots');
const VP = { width: 1440, height: 900 };

async function dismissModals(page) {
  // Close any sponsor/modal overlay
  try {
    const closeBtn = await page.$('.modal-close, .close-btn, [aria-label="Close"], button.btn-close');
    if (closeBtn) { await closeBtn.click(); await new Promise(r => setTimeout(r, 500)); }
  } catch (_) {}
  // Click "Quizás después" if present
  try {
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.includes('después')) { await btn.click(); await new Promise(r => setTimeout(r, 500)); break; }
    }
  } catch (_) {}
}

async function clickSidebar(page, label) {
  const links = await page.$$('.sidebar a, .sidebar li, nav a, [class*="sidebar"] a, [class*="sidebar"] li');
  for (const link of links) {
    const text = await page.evaluate(el => el.textContent.trim(), link);
    if (text === label) { await link.click(); await new Promise(r => setTimeout(r, 1500)); return true; }
  }
  return false;
}

const SCREENSHOTS = [
  { name: 'dashboard-main.png', nav: 'Pods' },
  { name: 'dashboard-deployments.png', nav: 'Deployments' },
  { name: 'dashboard-services.png', nav: 'Services' },
  { name: 'dashboard-nodes.png', nav: 'Nodes' },
];

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: VP,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  await dismissModals(page);
  await new Promise(r => setTimeout(r, 500));

  for (const shot of SCREENSHOTS) {
    if (shot.nav) await clickSidebar(page, shot.nav);
    await new Promise(r => setTimeout(r, 1000));

    const outPath = path.join(OUT_DIR, shot.name);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`✓ ${shot.name}`);
  }

  await browser.close();
  console.log(`\nScreenshots saved to ${OUT_DIR}`);
})();
