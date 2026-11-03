// Requires Playwright and Chrome: node frontend/scripts/project-flow-width-check.cjs
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const frontend = path.resolve(__dirname, '..');
  const server = spawn(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4182', '--strictPort'], { cwd: frontend, stdio: 'ignore' });
  let browser;
  try {
    const url = 'http://127.0.0.1:4182';
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch(url)).ok) break; } catch {}
      assert(attempt < 50, 'Vite did not start');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const exp = (id, deps = [], status = 'Planned') => ({ id, name: `Experiment ${id}`, deps, status, priority: '', paper: '', blocks: [] });
    const state = { papers: [
      { id: 'paper', name: 'Sidebar paper', color: '#2f6f5e' },
      { id: 'archived-paper', name: 'Archived sidebar paper', color: '#2f6f5e', archived: true },
    ], projects: [
      { id: 'small', name: 'Small project', paperIds: ['paper'], exps: [{ ...exp('single'), paper: 'paper' }] },
      { id: 'archived-project', name: 'Archived sidebar project', archived: true, exps: [] },
      { id: 'wide', name: 'Wide project', exps: Array.from({ length: 8 }, (_, i) => exp(`chain-${i}`, i ? [`chain-${i - 1}`] : [], i % 2 ? 'Done' : 'Planned')) },
      { id: 'empty', name: 'Empty project', exps: [] },
    ] };
    await page.route('**/api/**', (route) => route.fulfill({ json: route.request().method() === 'POST' ? { status: 'success' } : state }));
    await page.goto(url);
    await page.getByRole('heading', { name: 'Calendar & Schedule', exact: true }).waitFor();
    await page.evaluate(async () => {
      const store = (await import('/src/store/useLabStore.ts')).useLabStore.getState();
      store.resetFilters();
      store.setView({ type: 'all' });
    });
    const sidebar = page.locator('aside');
    await sidebar.getByTitle('Expand project', { exact: true }).first().click();
    await sidebar.getByTitle('Click to filter by "Sidebar paper", double-click to rename', { exact: true }).waitFor();
    await sidebar.getByRole('button', { name: 'Archived (2)', exact: true }).click();
    await sidebar.getByText('Archived sidebar project', { exact: true }).waitFor();
    await sidebar.getByText('Archived sidebar paper', { exact: true }).waitFor();
    assert.equal(await sidebar.locator('button[title]').evaluateAll((buttons) => buttons.filter((button) => /^(Rename|Assign|Archive |Delete|Restore|Unassign)/.test(button.title)).length), 0, 'Active, nested, and archived sidebar entries have no quick action buttons');
    assert.equal(await sidebar.getByTitle('Create new project', { exact: true }).count(), 1);
    assert.equal(await sidebar.getByTitle('Create new paper', { exact: true }).count(), 1);
    await sidebar.getByTitle('Click to view paper, double-click to rename', { exact: true }).click();
    assert.deepEqual(await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().view), { type: 'pp', id: 'paper' }, 'Paper navigation remains available');
    await sidebar.getByTitle('Small project — Double-click to rename', { exact: true }).click();
    assert.deepEqual(await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().view), { type: 'p', id: 'small' }, 'Project navigation remains available');
    await sidebar.getByText('All projects', { exact: true }).click();
    const search = page.getByPlaceholder('Search projects & experiments...');
    await search.waitFor();
    assert(await search.evaluate((input) => {
      const icon = input.parentElement.querySelector('svg').getBoundingClientRect();
      const textLeft = input.getBoundingClientRect().left + parseFloat(getComputedStyle(input).paddingLeft);
      return textLeft >= icon.right + 4;
    }), 'Search placeholder and typed text clear the magnifying glass icon');
    await search.fill('Small');
    await page.getByRole('heading', { name: 'Wide project', exact: true }).waitFor({ state: 'hidden' });
    await page.getByTitle('Clear search', { exact: true }).click();
    const small = page.getByRole('group', { name: 'Small project flowchart', exact: true });
    const wide = page.getByRole('group', { name: 'Wide project flowchart', exact: true });
    const checkLayout = async (chart) => {
      await chart.waitFor();
      const bounds = await chart.evaluate((container) => {
        const card = container.parentElement;
        const list = card.parentElement.parentElement;
        const view = list.parentElement;
        const style = getComputedStyle(view);
        const available = view.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const canvas = container.firstElementChild;
        const nodes = Array.from(canvas.children).filter((child) => child.tagName === 'DIV');
        return {
          available, listWidth: list.getBoundingClientRect().width, cardWidth: card.getBoundingClientRect().width,
          chartWidth: container.getBoundingClientRect().width,
          heights: nodes.map((node) => node.getBoundingClientRect().height),
          fonts: nodes.map((node) => getComputedStyle(node.querySelector('b')).fontSize),
          transform: getComputedStyle(canvas).transform,
          viewOverflow: view.scrollWidth - view.clientWidth,
        };
      });
      assert(Math.abs(bounds.listWidth - bounds.available * 0.9) < 2, 'Project list uses 90% of the available view width');
      assert(Math.abs(bounds.cardWidth - bounds.listWidth) < 2, 'All project cards fill the project list');
      assert(bounds.chartWidth > bounds.cardWidth * 0.8, 'Flowchart viewport fills most of the card');
      assert(bounds.heights.every((height) => height === 74), 'Nodes retain their native height in every chart');
      assert(bounds.fonts.every((font) => font === '13px'), 'All charts retain the same text scale');
      assert.equal(bounds.transform, 'none', 'Flowcharts are never scaled to fit');
      assert(bounds.viewOverflow <= 1, 'Wide charts do not overflow the All Projects view');
    };
    for (const width of [1920, 1280, 640]) {
      await page.setViewportSize({ width, height: 900 });
      await checkLayout(small);
      await checkLayout(wide);
      assert.equal(await wide.locator('svg > g').count(), 7, 'Connections remain rendered after resizing');
      assert(await wide.evaluate((container) => container.scrollWidth > container.clientWidth), 'Wide flowcharts scroll instead of shrinking');
      assert(await wide.evaluate((container) => { container.scrollLeft = container.scrollWidth; return container.scrollLeft > 0; }), 'Overflowing nodes are reachable by horizontal scrolling');
    }
    await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().setFilterValues('status', ['Planned']));
    await checkLayout(wide);
    assert.equal(await wide.getByText('Experiment chain-1', { exact: true }).count(), 0, 'Filters still hide nonmatching nodes');
    await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().setFilterValues('status', ['Done']));
    await small.waitFor({ state: 'hidden' });
    await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().resetFilters());
    await checkLayout(small);
    await small.getByText('Experiment single', { exact: true }).click();
    await page.getByRole('dialog', { name: 'Experiment editor', exact: true }).waitFor();
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log('PASS: Project cards use 90% width; flowcharts keep a uniform native scale, scroll horizontally, retain connections, filter correctly, and open experiments; sidebar row actions are removed while navigation remains');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
