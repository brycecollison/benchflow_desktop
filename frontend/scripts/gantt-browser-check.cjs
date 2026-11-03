// Requires Playwright and Chrome: node frontend/scripts/gantt-browser-check.cjs
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const frontend = path.resolve(__dirname, '..');
  const server = spawn(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', '4180', '--strictPort'], { cwd: frontend, stdio: 'ignore' });
  let browser;
  try {
    const url = 'http://127.0.0.1:4180';
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch(url)).ok) break; } catch {}
      assert(attempt < 50, 'Vite did not start');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.clock.setFixedTime(new Date(2026, 2, 8, 12));
    const base = { status: 'Planned', priority: '', paper: '', deps: [], blocks: [] };
    const state = { papers: [], projects: [
      { id: 'p1', name: 'Project One', exps: [
        { ...base, id: 'visible', name: 'Visible Experiment', experimentalProtocolStartDate: '2026-03-07',
          experimentalProtocolEndDate: '2026-03-09', dataAcquisitionStartDate: '2026-03-10',
          dataAcquisitionCompleted: true, dataAnalysisStartDate: '2026-03-12' },
        { ...base, id: 'done', name: 'Completed Experiment', dataAnalysisStartDate: '2026-03-07', dataAnalysisCompleted: true },
        { ...base, id: 'unscheduled', name: 'Unscheduled Experiment' },
        { ...base, id: 'excluded', name: 'Excluded Phase', phases: ['dataAnalysis'], experimentalProtocolStartDate: '2026-03-07' },
      ] },
      { id: 'p2', name: 'Project Two', exps: [
        { ...base, id: 'other', name: 'Other Experiment', dataAnalysisStartDate: '2026-03-15', dataAnalysisEndDate: '2026-03-26' },
      ] },
      { id: 'empty', name: 'Empty Project', exps: [] },
      { id: 'archived', name: 'Archived', archived: true, exps: [
        { ...base, id: 'hidden', name: 'Archived Experiment', dataAnalysisStartDate: '2026-03-07' },
      ] },
    ] };
    // All API traffic stays in memory, never touching real notebook data.
    await page.route('**/api/**', (route) => route.fulfill({ json: state }));
    await page.goto(url);
    await page.getByRole('heading', { name: 'Calendar & Schedule', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Gantt', exact: true }).click();
    const view = page.getByRole('region', { name: 'Gantt chart', exact: true });
    const chart = view.getByRole('region', { name: 'All projects', exact: true });
    await chart.getByText('3 scheduled phases', { exact: true }).waitFor();
    const projectOne = view.getByRole('region', { name: 'Project One', exact: true });
    const projectTwo = view.getByRole('region', { name: 'Project Two', exact: true });
    const empty = view.getByRole('region', { name: 'Empty Project', exact: true });
    const phaseButtons = (scope) => scope.getByRole('button', { name: /Experiment: / });
    assert.equal(await phaseButtons(chart).count(), 3, 'Unified chart includes all scheduled incomplete phases');
    assert.equal(await phaseButtons(projectOne).count(), 2, 'Project One only shows its phases');
    assert.equal(await phaseButtons(projectTwo).count(), 1, 'Project Two only shows its phases');
    assert.equal(await phaseButtons(empty).count(), 0, 'An empty project still gets a chart');
    assert.equal(await view.getByText('Completed Experiment', { exact: true }).count(), 0);
    assert.equal(await view.getByText('Archived Experiment', { exact: true }).count(), 0);
    const headings = await view.getByRole('heading', { level: 3 }).allTextContents();
    assert.deepEqual(headings, ['All projects', 'Project One', 'Project Two', 'Empty Project'], 'Unified chart comes first');

    async function assertStartsToday(scope) {
      const timeline = scope.getByRole('region', { name: / timeline$/ });
      const today = timeline.locator('[aria-current="date"]');
      const header = timeline.getByText('Project / Experiment / Phase', { exact: true });
      await timeline.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const positions = await today.evaluate((cell) => {
        const axis = cell.parentElement;
        const label = axis.previousElementSibling;
        return { day: cell.getBoundingClientRect().left, label: label.getBoundingClientRect().right };
      });
      assert(Math.abs(positions.day - positions.label) <= 1, 'Each chart initially starts at today');
      assert.equal(await header.count(), 1);
    }
    for (const scope of [chart, projectOne, projectTwo, empty]) await assertStartsToday(scope);
    const bars = phaseButtons(chart);
    const protocol = chart.getByRole('button', { name: /^Visible Experiment: Experimental Protocol/ });
    assert.equal((await protocol.boundingBox()).width, 50, 'Three-day bar uses inclusive width');
    assert.equal(await protocol.evaluate((button) => button.parentElement.nextElementSibling.textContent.trim()), 'Visible Experiment', 'Narrow bars have experiment names beside them');
    assert.equal(await chart.getByRole('button', { name: /^Other Experiment: / }).textContent(), 'Other Experiment', 'Wide bars show experiment names inside');
    await view.getByRole('combobox', { name: 'Gantt timescale' }).selectOption('days');
    assert.equal((await protocol.boundingBox()).width, 116, 'Day zoom preserves duration');
    for (const scope of [chart, projectOne, projectTwo, empty]) await assertStartsToday(scope);
    await protocol.click();
    assert.equal(await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().activeModalExpId), 'visible');
    await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().closeModal());

    const timeline = chart.getByRole('region', { name: 'All projects timeline', exact: true });
    for (const width of [900, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await chart.getByRole('button', { name: 'Today', exact: true }).click();
      await assertStartsToday(chart);
      await timeline.evaluate((element) => { element.scrollLeft = 200; });
      const label = chart.locator('button[title="Project One / Visible Experiment / Experimental Protocol"]');
      assert.equal(Math.round((await label.boundingBox()).x), Math.round((await timeline.boundingBox()).x), 'Row labels stay pinned while scrolling');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Timeline does not overflow the page');
    }
    await timeline.evaluate((element) => { element.scrollLeft = 0; });
    assert.equal(await timeline.evaluate((element) => element.scrollLeft), 0, 'Past phases remain accessible by scrolling left');
    await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.setState({ isDarkMode: true }));
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(await bars.count(), 3, 'Bars remain available in dark mode');
    await view.getByRole('combobox', { name: 'Gantt project' }).selectOption('p1');
    assert.equal(await bars.count(), 2);
    assert.equal(await projectTwo.count(), 0);
    await view.getByRole('textbox', { name: 'Search Gantt phases' }).fill('analysis');
    assert.equal(await bars.count(), 1);
    await view.getByRole('textbox', { name: 'Search Gantt phases' }).fill('no match');
    await view.getByRole('heading', { name: 'No scheduled incomplete phases', exact: true }).waitFor();
    await view.getByRole('textbox', { name: 'Search Gantt phases' }).fill('');
    await page.evaluate(async () => {
      const { useLabStore } = await import('/src/store/useLabStore.ts');
      useLabStore.getState().setFilterValues('status', ['Running']);
    });
    await view.getByRole('heading', { name: 'No scheduled incomplete phases', exact: true }).waitFor();
    await page.evaluate(async () => {
      const { useLabStore } = await import('/src/store/useLabStore.ts');
      useLabStore.getState().resetFilters();
      useLabStore.setState((state) => ({ projects: state.projects.map((project) => ({ ...project,
        exps: project.exps.map((exp) => ({ ...exp, experimentalProtocolCompleted: true, dataAcquisitionCompleted: true, dataAnalysisCompleted: true })),
      })) }));
    });
    await view.getByRole('heading', { name: 'No scheduled incomplete phases', exact: true }).waitFor();
    for (const savedState of [state, null]) {
      const fallback = await browser.newPage();
      await fallback.route('**/api/**', (route) => route.fulfill({ status: 503, body: '' }));
      if (savedState) {
        await fallback.addInitScript((data) => localStorage.setItem('lab', JSON.stringify(data)), savedState);
      }
      await fallback.goto(url);
      await fallback.getByRole('heading', { name: 'Calendar & Schedule', exact: true }).waitFor();
      assert.equal(await fallback.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().view.type), 'calendar', 'Calendar is the default with local or no saved data');
      await fallback.close();
    }
    console.log('PASS: calendar startup defaults, unified/project charts, today defaults, experiment labels, zoom, editor, filters, and live completion');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
