// Run with Playwright available: node frontend/scripts/calendar-resize-check.cjs
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const frontend = path.resolve(__dirname, '..');
  const server = spawn(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4191', '--strictPort'], { cwd: frontend, stdio: 'ignore' });
  let browser;
  try {
    const url = 'http://127.0.0.1:4191';
    for (let i = 0; ; i++) { try { if ((await fetch(url)).ok) break; } catch {} assert(i < 80); await new Promise(r => setTimeout(r, 100)); }
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.route('**/api/**', (route) => route.fulfill({ json: { projects: [], papers: [] } }));
    await page.goto(url);
    await page.waitForSelector('header');
    const start = await page.evaluate(async () => {
      const { useLabStore } = await import('/src/store/useLabStore.ts');
      const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1);
      const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      useLabStore.setState({ view: { type: 'calendar' }, saveState: async () => {}, papers: [], projects: [{ id: 'p', name: 'Proj', exps: [{
        id: 'e', name: 'Resize me', deps: [], status: 'Planned', priority: 'Med', paper: '', blocks: [], phases: ['dataAnalysis'],
        dataAnalysisStartDate: start, dataAnalysisEndDate: start, dataAnalysisDuration: '1 day' }] }] });
      return start;
    });
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    const card = page.locator('[draggable="true"][title*="Click to view experiment"]').first();
    const before = await card.boundingBox();
    const handle = card.locator('[title="Drag right to extend duration"]');
    await card.hover();
    const hb = await handle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    // Move two day-columns right in steps, staying at card height (over where the card will be).
    const colW = before.width + 12;
    for (let i = 1; i <= 20; i++) await page.mouse.move(hb.x + (colW * 2) * i / 20, hb.y + hb.height / 2);
    await page.waitForTimeout(100);
    const mid = await card.boundingBox();
    assert(mid.width > before.width * 2.5, 'card grows while dragging over it');
    await page.mouse.up();
    await page.waitForTimeout(200);
    const saved = await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().projects[0].exps[0]);
    assert.notEqual(saved.dataAnalysisEndDate, start);
    // Cards are clickable again after the drag
    const pe = await card.evaluate((el) => getComputedStyle(el).pointerEvents);
    assert.equal(pe, 'auto');
    console.log('PASS: phase card resizes live while the cursor is over it, saves on drop, and stays clickable');
  } finally { await browser?.close(); server.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
