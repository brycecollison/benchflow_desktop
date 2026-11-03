// Run with Playwright available: node frontend/scripts/calendar-cards-check.cjs
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const frontend = path.resolve(__dirname, '..');
  const server = spawn(process.execPath, [
    path.join(frontend, 'node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', '4179', '--strictPort',
  ], { cwd: frontend, stdio: 'ignore' });
  let browser;
  try {
    const url = 'http://127.0.0.1:4179';
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch(url)).ok) break; } catch {}
      assert(attempt < 50, 'Vite did not start');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    // Never read or write real notebook data during this check.
    await page.route('**/api/**', (route) => route.fulfill({
      json: { projects: [], papers: [] },
    }));
    await page.goto(url);
    await page.waitForSelector('header');
    await page.evaluate(async () => {
      const { useLabStore } = await import('/src/store/useLabStore.ts');
      const date = new Date();
      date.setDate(date.getDate() - date.getDay() + 1);
      const start = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      useLabStore.setState({
        view: { type: 'calendar' }, isSidebarOpen: true, sidebarWidth: 250,
        papers: [{ id: 'paper', name: 'Cohesin Injury Regulation with a long paper name', color: '#ab72b5' }],
        projects: [{ id: 'project', name: 'Card layout check', paperIds: ['paper'], exps:
          ['experimentalProtocol', 'dataAcquisition', 'dataAnalysis'].map((phase, i) => ({
            id: `exp-${i}`, name: i === 2 ? 'UnbrokenExperimentName'.repeat(5) : 'SMC3 siRNA HDAC8i in vitro 1',
            paper: 'paper', status: 'planned', priority: 'medium', deps: [], blocks: [], phases: [phase],
            [`${phase}StartDate`]: start, [`${phase}EndDate`]: start,
            [`${phase}Duration`]: '1/2 day',
          })),
        }],
      });
    });
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    for (const width of [1920, 1440, 1280, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      const failures = await page.locator('[draggable="true"][title*="Click to view experiment"]').evaluateAll((cards) => {
        const errors = [];
        for (const card of cards) {
          const bounds = card.getBoundingClientRect();
          if (card.scrollWidth > card.clientWidth + 1) errors.push('Card content overflows');
          for (const el of card.querySelectorAll('button, span[title]')) {
            const rect = el.getBoundingClientRect();
            if (rect.left < bounds.left || rect.right > bounds.right) errors.push('Badge or action outside card');
          }
          const badge = card.querySelector('span[title]');
          const actions = card.querySelector('button').parentElement;
          const a = badge.getBoundingClientRect(), b = actions.getBoundingClientRect();
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) errors.push('Phase badge overlaps actions');
        }
        if (cards.length !== 3) errors.push(`Expected 3 phase cards, got ${cards.length}`);
        return errors;
      });
      assert.deepEqual(failures, [], `Week cards at ${width}px with both sidebars open`);
      console.log(`PASS: week cards at ${width}px with both sidebars open`);
    }
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
