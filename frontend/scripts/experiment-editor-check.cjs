// Requires Playwright and Chrome: node frontend/scripts/experiment-editor-check.cjs
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const frontend = path.resolve(__dirname, '..');
  const server = spawn(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4181', '--strictPort'], { cwd: frontend, stdio: 'ignore' });
  let browser;
  try {
    const url = 'http://127.0.0.1:4181';
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch(url)).ok) break; } catch {}
      assert(attempt < 50, 'Vite did not start');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => { errors.push(error.message); console.error('Browser error:', error.message); });
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yL1cAAAAASUVORK5CYII=', 'base64');
    const base = { status: 'Planned', priority: '', paper: '', deps: [], blocks: [] };
    let saved = { papers: [{ id: 'paper', name: 'Test paper' }], projects: [{ id: 'p', name: 'Editor project', exps: [
      { ...base, id: 'e1', name: 'Full experiment', purpose: Array.from({ length: 80 }, (_, index) => `Purpose line ${index}`).join('\n'), expectedResults: 'Expected readout', dataAcquisition: 'Rate $\\frac{a}{b}$ and code `$literal$`.\n\n$$\n\\sum_{i=1}^{n} i\n$$', experimentalProtocol: '1. Prepare cells\n2. Measure response', phases: ['experimentalProtocol', 'dataAcquisition', 'dataAnalysis', 'validation'], customPhases: [{ id: 'validation', name: 'Validation', content: 'Validate results' }], blocks: [
        { type: 'txt', name: 'legacy note', text: 'Preserved Results note' },
        { type: 'img', name: 'legacy.png', src: `data:image/png;base64,${image.toString('base64')}` },
      ] },
      { ...base, id: 'e2', name: 'Second experiment', phases: ['experimentalProtocol'], purpose: 'Second rationale' },
    ] }, { id: 'completed', name: 'Completed project', exps: [{ ...base, id: 'finished', name: 'Finished experiment', status: 'Done' }] }] };
    let releaseUpload;
    const delayedUpload = new Promise((resolve) => { releaseUpload = resolve; });
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      if (request.url().endsWith('/upload')) {
        const body = request.postDataBuffer().toString('latin1');
        const filename = body.match(/filename="([^"]+)"/)[1];
        if (filename === 'reject.txt') return route.fulfill({ status: 503, body: 'Unavailable' });
        if (filename === 'gateway.png') return route.fulfill({ status: 502, body: 'Bad Gateway' });
        if (filename === 'late.txt') await delayedUpload;
        const mime = filename.endsWith('.png') ? 'image/png' : filename.endsWith('.pdf') ? 'application/pdf' : filename.endsWith('.csv') ? 'text/csv' : 'text/plain';
        return route.fulfill({ json: { filename, url: `/uploads/${filename}`, raw_url: `/uploads/${filename}`, content_type: mime, size: 64 } });
      }
      if (request.method() === 'POST') saved = request.postDataJSON();
      return route.fulfill({ json: request.method() === 'POST' ? { status: 'success' } : saved });
    });
    await page.route('**/uploads/**', (route) => route.fulfill({ contentType: 'image/png', body: image }));
    await page.goto(url);
    await page.getByRole('heading', { name: 'Calendar & Schedule', exact: true }).waitFor();
    const open = async (id, full = false) => page.evaluate(async ({ id, full }) => (await import('/src/store/useLabStore.ts')).useLabStore.getState().openModal(id, full), { id, full });
    const experiment = async () => page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().projects[0].exps[0]);
    await page.evaluate(async () => {
      const store = (await import('/src/store/useLabStore.ts')).useLabStore.getState();
      store.setView({ type: 'all' });
      store.setFilterValues('status', ['Planned', 'Done']);
      store.setFilterValues('priority', ['-']);
      store.setFilterValues('paper', ['-']);
    });
    await page.getByRole('heading', { name: 'Completed project', exact: true }).waitFor();
    const activeFilter = page.getByRole('button', { name: 'Active', exact: true });
    const readFilters = () => page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().filters);
    const beforeActive = await readFilters();
    const inactiveAppearance = await activeFilter.evaluate((button) => ({ color: getComputedStyle(button).color, border: getComputedStyle(button).borderTopColor }));
    const checkActiveColors = async (textToken) => {
      const expected = await page.evaluate((token) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${token})`;
        probe.style.borderColor = 'var(--color-emerald-500)';
        document.body.append(probe);
        const style = getComputedStyle(probe);
        const colors = { color: style.color, border: style.borderTopColor };
        probe.remove();
        return colors;
      }, textToken);
      await page.waitForFunction(({ button, colors }) => {
        const style = getComputedStyle(button);
        return style.color === colors.color && style.borderTopColor === colors.border;
      }, { button: await activeFilter.elementHandle(), colors: expected }, { timeout: 3000 });
    };
    await activeFilter.click();
    assert.deepEqual(await readFilters(), { ...beforeActive, status: ['Done'], statusNot: true }, 'Active replaces the status filter with NOT Done and preserves other filters');
    assert.equal(await activeFilter.getAttribute('aria-pressed'), 'true');
    await checkActiveColors('--color-emerald-700');
    await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.setState({ isDarkMode: true }));
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await checkActiveColors('--color-emerald-400');
    await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.setState({ isDarkMode: false }));
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.getByRole('heading', { name: 'Completed project', exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: 'Editor project', exact: true }).waitFor();
    await activeFilter.click();
    const defaultFilters = await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).DEFAULT_FILTERS);
    assert.deepEqual(await readFilters(), defaultFilters, 'Clicking Active again clears all filters');
    assert.equal(await activeFilter.getAttribute('aria-pressed'), 'false');
    await page.waitForFunction(({ button, colors }) => {
      const style = getComputedStyle(button);
      return style.color === colors.color && style.borderTopColor === colors.border;
    }, { button: await activeFilter.elementHandle(), colors: inactiveAppearance });
    await page.getByRole('heading', { name: 'Completed project', exact: true }).waitFor();
    await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().setView({ type: 'calendar' }));
    await activeFilter.waitFor({ state: 'hidden' });
    await open('e1');
    const popup = page.getByRole('dialog', { name: 'Experiment editor', exact: true });
    await popup.getByRole('button', { name: /^Purpose/ }).click();
    assert.equal(await popup.getByRole('region', { name: 'Expected Results section', exact: true }).count(), 0);
    assert.equal(await popup.getByRole('navigation', { name: 'Experiment navigation' }).count(), 0, 'Navigation is only shown in fullscreen');
    await popup.getByTitle('Full screen', { exact: true }).click();
    const full = page.getByRole('dialog', { name: 'Full-screen experiment editor', exact: true });
    const navigation = full.getByRole('navigation', { name: 'Experiment navigation', exact: true });
    const editorProject = navigation.locator('details').filter({ has: page.getByText('Editor project', { exact: true }) });
    const completedProject = navigation.locator('details').filter({ has: page.getByText('Completed project', { exact: true }) });
    assert.equal(await editorProject.getAttribute('open'), '', 'Current parent project starts expanded');
    assert.equal(await completedProject.getAttribute('open'), null, 'Other projects start collapsed');
    for (const button of await navigation.locator('button[data-experiment-open]').all()) {
      assert.deepEqual(await button.evaluate((element) => ({ justify: getComputedStyle(element).justifyContent, text: getComputedStyle(element).textAlign })), { justify: 'flex-start', text: 'left' }, 'Experiment titles are left aligned');
    }
    assert.equal(await navigation.getByRole('button', { name: 'Full experiment', exact: true }).getAttribute('aria-current'), 'page');
    await page.waitForFunction((element) => element.getBoundingClientRect().y === 0, await navigation.elementHandle());
    const editorSurface = full.getByRole('region', { name: 'Primary experiment editor', exact: true });
    await editorSurface.evaluate((element) => { element.scrollTop = 500; });
    assert((await editorSurface.evaluate((element) => element.scrollTop)) > 0, 'Editor content scrolls independently');
    assert.equal((await navigation.boundingBox()).y, 0, 'Navigation stays at the top while editor content scrolls');
    await navigation.getByRole('button', { name: 'Second experiment', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('input[aria-label="Experiment name"]')?.value === 'Second experiment');
    assert.equal(await full.count(), 1, 'Sidebar navigation keeps the editor fullscreen');
    assert.equal(await editorSurface.evaluate((element) => element.scrollTop), 0, 'Switching experiments resets editor scrolling');
    assert.equal(await full.getByRole('textbox', { name: 'Purpose editor', exact: true }).textContent(), 'Second rationale');
    await completedProject.locator('summary').focus();
    await page.keyboard.press('Enter');
    await navigation.getByRole('button', { name: 'Finished experiment', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('input[aria-label="Experiment name"]')?.value === 'Finished experiment');
    assert.equal(await completedProject.getAttribute('open'), '', 'New parent project is expanded after switching projects');
    assert.equal(await editorProject.getAttribute('open'), null, 'Previous parent project is collapsed after switching projects');
    await editorProject.locator('summary').click();
    await navigation.getByRole('button', { name: 'Full experiment', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('input[aria-label="Experiment name"]')?.value === 'Full experiment');
    assert.equal(await completedProject.getAttribute('open'), null, 'Manually expanded projects reset when opening an experiment');
    const navigationBounds = await navigation.boundingBox();
    const editorBounds = await full.getByRole('textbox', { name: 'Experiment name', exact: true }).boundingBox();
    assert.equal(navigationBounds.x, 0, 'Navigation is on the left edge');
    assert(editorBounds.x >= navigationBounds.x + navigationBounds.width, 'Editor sits beside navigation');
    const sidebar = full.getByRole('complementary', { name: 'Experiment sidebar', exact: true });
    const resize = full.getByRole('separator', { name: 'Resize experiment sidebar', exact: true });
    const initialWidth = (await sidebar.boundingBox()).width;
    await resize.focus();
    await resize.press('ArrowRight');
    assert.equal((await sidebar.boundingBox()).width, initialWidth + 24, 'Sidebar supports keyboard resizing');
    const handle = await resize.boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, 250);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 60, 250, { steps: 4 });
    await page.mouse.up();
    assert((await sidebar.boundingBox()).width > initialWidth + 70, 'Dragging the sidebar edge changes its width');
    for (let index = 0; index < 20; index++) await resize.press('ArrowLeft');
    assert.equal((await sidebar.boundingBox()).width, 160, 'Sidebar width has a lower bound');
    for (let index = 0; index < 4; index++) await resize.press('ArrowRight');
    assert.equal((await sidebar.boundingBox()).width, initialWidth, 'Sidebar can be resized back');

    const primary = full.getByRole('region', { name: 'Primary experiment editor', exact: true });
    const secondary = full.getByRole('region', { name: 'Secondary experiment editor', exact: true });
    const splitButton = primary.getByRole('button', { name: 'Splitscreen', exact: true });
    assert.equal(await splitButton.evaluate((element) => element.nextElementSibling.title), 'Exit full screen', 'Splitscreen is immediately before Exit Full Screen');
    await splitButton.click();
    const picker = full.getByRole('region', { name: 'Choose second experiment', exact: true });
    const pickerNavigation = picker.getByRole('navigation', { name: 'Split screen experiment selection', exact: true });
    assert.equal(await pickerNavigation.locator('details[open]').count(), 1, 'Split picker uses the same project grouping and expansion defaults');
    assert.equal(await primary.getByRole('textbox', { name: 'Experiment name', exact: true }).inputValue(), 'Full experiment', 'Current experiment stays on the left');
    await pickerNavigation.getByRole('button', { name: 'Second experiment', exact: true }).click();
    await secondary.getByRole('textbox', { name: 'Purpose editor', exact: true }).waitFor();
    assert.equal(await picker.count(), 0, 'Choosing an experiment replaces the picker');
    const leftBounds = await primary.boundingBox();
    const rightBounds = await secondary.boundingBox();
    assert(rightBounds.x >= leftBounds.x + leftBounds.width - 1, 'Editors are side by side');
    assert(Math.abs(leftBounds.width - rightBounds.width) < 2, 'Editors share the available width equally');
    for (const pane of [primary, secondary]) {
      assert.equal(await pane.getByRole('textbox', { name: 'Experiment name', exact: true }).count(), 1, 'Each pane has its own title');
      for (const label of ['Status', 'Priority', 'Paper']) assert.equal(await pane.getByRole('combobox', { name: label, exact: true }).count(), 1, `Each pane has its own ${label} control`);
      assert.equal(await pane.getByRole('button', { name: 'All Sections', exact: true }).count(), 1, 'Each pane has its own section indicators');
      assert.equal(await pane.getByRole('toolbar', { name: 'Experiment formatting', exact: true }).count(), 1, 'Each pane has its own formatting toolbar');
    }
    await secondary.getByRole('textbox', { name: 'Experiment name', exact: true }).fill('Renamed second experiment');
    assert.equal(await primary.getByRole('textbox', { name: 'Experiment name', exact: true }).inputValue(), 'Full experiment', 'Renaming the right experiment does not rename the left');
    await navigation.getByRole('button', { name: 'Renamed second experiment', exact: true }).waitFor();
    await secondary.getByRole('textbox', { name: 'Experiment name', exact: true }).fill('Second experiment');
    await secondary.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Running');
    await secondary.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('High');
    await secondary.getByRole('combobox', { name: 'Paper', exact: true }).selectOption('paper');
    const pair = await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().projects[0].exps);
    assert.deepEqual([pair[0].status, pair[0].priority, pair[0].paper], ['Planned', '', ''], 'Right metadata changes do not affect the left');
    assert.deepEqual([pair[1].status, pair[1].priority, pair[1].paper], ['Running', 'High', 'paper'], 'Right metadata changes are saved to the right experiment');
    const rightPurpose = secondary.getByRole('textbox', { name: 'Purpose editor', exact: true });
    await rightPurpose.fill('Right rationale');
    await rightPurpose.press('Control+a');
    const rightTools = secondary.getByRole('toolbar', { name: 'Experiment formatting', exact: true });
    await rightTools.getByRole('button', { name: 'Bold', exact: true }).click();
    assert.equal(await rightPurpose.locator('strong').textContent(), 'Right rationale', 'Right toolbar formats right text');
    assert.equal(await primary.getByRole('textbox', { name: 'Purpose editor', exact: true }).locator('strong').count(), 0, 'Right formatting does not leak into left text');
    const leftExpected = primary.getByRole('textbox', { name: 'Expected Results editor', exact: true });
    await leftExpected.fill('Left readout');
    await leftExpected.press('Control+a');
    const leftTools = primary.getByRole('toolbar', { name: 'Experiment formatting', exact: true });
    await leftTools.getByRole('button', { name: 'Italic', exact: true }).click();
    assert.equal(await leftExpected.locator('em').textContent(), 'Left readout', 'Left toolbar formats left text');
    assert.equal(await rightPurpose.locator('em').count(), 0, 'Left formatting does not leak into right text');
    assert.equal(await leftTools.getAttribute('data-section'), 'Expected Results', 'Left toolbar follows its own active section');
    assert.equal(await rightTools.getAttribute('data-section'), 'Purpose', 'Right toolbar retains its own active section');
    await rightPurpose.evaluate((element) => element.editor.commands.setContent('Second rationale', { contentType: 'markdown' }));
    await leftExpected.evaluate((element) => element.editor.commands.setContent('Expected readout', { contentType: 'markdown' }));
    await secondary.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Planned');
    await secondary.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('');
    await secondary.getByRole('combobox', { name: 'Paper', exact: true }).selectOption('');
    await primary.evaluate((element) => { element.scrollTop = 0; });
    await secondary.getByRole('button', { name: /^Notes/ }).click();
    await page.waitForFunction((element) => {
      const section = element.querySelector('[id$="-experiment-section-notes"]').getBoundingClientRect();
      const toolbar = element.querySelector('[role="toolbar"]').getBoundingClientRect();
      return Math.abs(section.top - toolbar.bottom - 8) < 2;
    }, await secondary.elementHandle());
    assert.equal(await primary.evaluate((element) => element.scrollTop), 0, 'Right section navigation does not scroll the left pane');
    const rightTitle = await secondary.locator('[aria-label="Experiment title"]').boundingBox();
    assert.equal(rightTitle.y, 0, 'Right title stays pinned during right-pane scrolling');
    assert.equal((await rightTools.boundingBox()).y, rightTitle.y + rightTitle.height, 'Right toolbar stays pinned below its own title');
    await primary.evaluate((element) => { element.scrollTop = 500; });
    const rightScroll = await secondary.evaluate((element) => element.scrollTop);
    await primary.evaluate((element) => { element.scrollTop = 0; });
    assert.equal(await secondary.evaluate((element) => element.scrollTop), rightScroll, 'Editor scrolling is independent');
    const sectionIds = await full.locator('[id*="-experiment-section-"]').evaluateAll((elements) => elements.map((element) => element.id));
    assert.equal(new Set(sectionIds).size, sectionIds.length, 'Split panes have unique section IDs');
    await secondary.getByTitle('Close split screen', { exact: true }).click();
    assert.equal(await secondary.count(), 0, 'Closing split view preserves the primary editor');

    const hoverSplit = navigation.getByRole('button', { name: 'Open Second experiment in split screen', exact: true });
    await navigation.getByRole('button', { name: 'Second experiment', exact: true }).hover();
    await page.waitForFunction((element) => getComputedStyle(element).opacity === '1', await hoverSplit.elementHandle());
    await hoverSplit.click();
    await secondary.getByRole('textbox', { name: 'Purpose editor', exact: true }).waitFor();
    assert.equal(await secondary.getByRole('textbox', { name: 'Experiment name', exact: true }).inputValue(), 'Second experiment', 'Hover action opens the selected experiment directly');
    await completedProject.locator('summary').click();
    await navigation.getByRole('button', { name: 'Finished experiment', exact: true }).hover();
    await navigation.getByRole('button', { name: 'Open Finished experiment in split screen', exact: true }).click();
    assert.equal(await secondary.getByRole('textbox', { name: 'Experiment name', exact: true }).inputValue(), 'Finished experiment', 'Hover action can replace the right experiment across projects');
    await navigation.getByRole('button', { name: 'Second experiment', exact: true }).click();
    assert.equal(await secondary.getByRole('textbox', { name: 'Experiment name', exact: true }).inputValue(), 'Finished experiment', 'Normal sidebar navigation only changes the primary experiment');
    await navigation.getByRole('button', { name: 'Full experiment', exact: true }).click();
    await primary.getByTitle('Exit full screen', { exact: true }).click();
    await popup.getByTitle('Full screen', { exact: true }).click();
    assert.equal(await secondary.count(), 0, 'Leaving fullscreen clears split view');
    await page.waitForFunction((element) => element.getBoundingClientRect().y === 0, await navigation.elementHandle());
    const purpose = full.getByRole('textbox', { name: 'Purpose editor', exact: true });
    await purpose.waitFor();
    const tools = full.getByRole('toolbar', { name: 'Experiment formatting', exact: true });
    await tools.waitFor();
    const uploadedContent = full.getByRole('region', { name: 'Uploaded content', exact: true });
    const labels = ['Purpose', 'Expected Results', 'Experimental Design', 'Experimental Protocol', 'Data Acquisition', 'Data Analysis', 'Validation', 'Results', 'Notes'];
    for (const label of labels) {
      const section = full.getByRole('region', { name: `${label} section`, exact: true });
      const heading = await section.getByRole('heading', { name: label, exact: true }).boundingBox();
      const text = await section.getByRole('textbox', { name: `${label} editor`, exact: true }).boundingBox();
      const end = await section.getByRole('separator', { name: `${label} end`, exact: true }).boundingBox();
      assert(heading.y < text.y && text.y < end.y, `${label}: heading, text, and ending rule appear in order`);
      assert.equal(await section.getByRole('toolbar').count(), 0, 'Phase text has no repeated formatting toolbar');
      assert.equal(await section.getByRole('button', { name: 'Upload files', exact: true }).count(), 0, 'Uploads are no longer repeated within the text sections');
      const uploads = uploadedContent.getByRole('region', { name: `${label} attachments`, exact: true });
      assert.equal(await uploads.count(), 1, `${label}: one group in the combined upload block`);
      assert((await uploads.boundingBox()).y > end.y, 'Uploads follow all phase text');
    }
    const bounds = await full.boundingBox();
    assert.equal(bounds.x, 0); assert.equal(bounds.y, 0); assert.equal(bounds.width, 1280); assert.equal(bounds.height, 900);
    assert.equal(await purpose.evaluate((element) => element.scrollHeight <= element.clientHeight + 1), true, 'Long sections expand without inner scrolling');
    assert.equal(await purpose.textContent(), Array.from({ length: 80 }, (_, index) => `Purpose line ${index}`).join(''), 'All imported lines are rendered');
    const title = full.locator('[aria-label="Experiment title"]');
    const titleBox = await title.boundingBox();
    const toolbarBox = await tools.boundingBox();
    assert.equal(titleBox.y, 0, 'Title container starts at the top of the screen');
    const titlePadding = await title.evaluate((element) => ({ top: getComputedStyle(element).paddingTop, bottom: getComputedStyle(element).paddingBottom }));
    assert.equal(titlePadding.top, titlePadding.bottom, 'Title has symmetric top and bottom padding');
    assert(parseFloat(titlePadding.top) > 0, 'Title padding is nonzero');
    assert.equal(toolbarBox.y, titleBox.y + titleBox.height, 'One toolbar sits immediately below the title');
    assert.equal(await full.getByRole('toolbar').count(), 1, 'Only one formatting toolbar exists');
    const selectionTools = full.getByRole('toolbar', { name: 'Text selection formatting', exact: true });
    assert.equal(await selectionTools.count(), 0, 'Selection toolbar is hidden with no highlighted text');
    await purpose.fill('Hypothesis');
    await purpose.press('Control+a');
    await selectionTools.waitFor({ state: 'visible' });
    const selectionBox = await selectionTools.boundingBox();
    assert(selectionBox.x >= 0 && selectionBox.y >= 0 && selectionBox.x + selectionBox.width <= 1280 && selectionBox.y + selectionBox.height <= 900, 'Selection toolbar stays inside the viewport');
    await selectionTools.getByRole('button', { name: 'Bold', exact: true }).click();
    assert.equal(await purpose.locator('strong').textContent(), 'Hypothesis');
    assert.equal(await tools.getByRole('button', { name: 'Bold', exact: true }).getAttribute('aria-pressed'), 'true', 'Shared toolbar reflects active formatting');
    await tools.getByRole('button', { name: 'Bold', exact: true }).focus();
    await full.getByRole('textbox', { name: 'Experiment name', exact: true }).focus();
    assert.equal(await tools.getAttribute('data-section'), 'Purpose', 'Toolbar retains the last phase when focus leaves its text');
    const expectedText = full.getByRole('textbox', { name: 'Expected Results editor', exact: true });
    await expectedText.press('Control+a');
    await page.waitForFunction((element) => element.dataset.section === 'Expected Results', await tools.elementHandle());
    await tools.getByRole('button', { name: 'Italic', exact: true }).click();
    assert.equal(await expectedText.locator('em').textContent(), 'Expected readout', 'Shared toolbar formats the newly focused phase');
    assert.equal(await purpose.locator('em').count(), 0, 'Switching phases does not format the previous phase');
    await tools.getByRole('button', { name: 'Undo', exact: true }).click();
    await selectionTools.waitFor({ state: 'visible' });
    await selectionTools.getByRole('button', { name: 'Underline', exact: true }).click();
    assert.equal(await expectedText.locator('u').textContent(), 'Expected readout', 'Selection toolbar follows the newly focused section');
    assert.equal(await purpose.locator('u').count(), 0, 'Selection toolbar does not format the previous section');
    await tools.getByRole('button', { name: 'Undo', exact: true }).click();
    await expectedText.press('ArrowRight');
    await selectionTools.waitFor({ state: 'hidden' });
    await purpose.press('Control+a');
    await tools.getByRole('button', { name: 'Link', exact: true }).click();
    const selectionLinkDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Insert link', exact: true }) });
    await selectionLinkDialog.getByRole('textbox').focus();
    await page.keyboard.press('Escape');
    await selectionLinkDialog.waitFor({ state: 'hidden' });
    await purpose.evaluate((element) => { element.editor.view.focus(); element.editor.commands.selectAll(); });
    await selectionTools.waitFor({ state: 'visible' });
    assert.equal(await tools.count(), 1, 'Selecting text keeps the pinned toolbar alongside the selection toolbar');
    assert.equal((await experiment()).purpose, '**Hypothesis**');
    await tools.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await purpose.locator('strong').count(), 0);
    await tools.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.equal(await purpose.locator('strong').count(), 1);
    await selectionTools.getByRole('button', { name: 'Highlight', exact: true }).click();
    assert.equal(await purpose.locator('mark').textContent(), 'Hypothesis', 'Selection toolbar highlights text');
    assert.equal(await tools.getByRole('button', { name: 'Highlight', exact: true }).getAttribute('aria-pressed'), 'true', 'Pinned toolbar reflects highlighting');
    assert((await experiment()).purpose.includes('<mark>'), 'Highlight is persisted in the Markdown field');
    await tools.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await purpose.locator('mark').count(), 0, 'Highlight supports undo');
    await tools.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.equal(await purpose.locator('mark').textContent(), 'Hypothesis', 'Highlight supports redo');
    await tools.getByRole('button', { name: 'Highlight', exact: true }).click();
    assert.equal(await purpose.locator('mark').count(), 0, 'Highlight toggles off without removing bold');
    assert.equal(await purpose.locator('strong').textContent(), 'Hypothesis');
    await tools.getByRole('button', { name: 'Highlight', exact: true }).click();
    await selectionTools.getByRole('button', { name: 'Clear formatting', exact: true }).click();
    assert.equal(await purpose.locator('mark').count(), 0, 'Clear formatting removes highlights');
    await tools.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await purpose.locator('mark').textContent(), 'Hypothesis');

    const design = full.getByRole('textbox', { name: 'Experimental Design editor', exact: true });
    await design.fill('First');
    await tools.getByRole('button', { name: 'Bullet list', exact: true }).click();
    await design.press('End'); await design.press('Enter'); await design.pressSequentially('Second');
    await design.press('Tab');
    assert.equal(await design.locator('ul ul').count(), 1, 'Tab nests a list item');
    await design.press('Shift+Tab');
    assert.equal(await design.locator('ul ul').count(), 0, 'Shift+Tab outdents a list item');
    const selectDesignItem = async (text) => {
      await design.getByText(text, { exact: true }).click();
      await page.waitForFunction(({ element, text }) => element.editor.state.selection.$from.parent.textContent === text,
        { element: await design.elementHandle(), text });
    };
    for (const tag of ['ul', 'ol']) {
      await design.evaluate((element, listTag) => element.editor.commands.setContent(`<${listTag}><li><p>First</p></li><li><p>Parent</p><${listTag}><li><p>Child A</p></li><li><p>Child B</p><${listTag}><li><p>Grandchild</p></li></${listTag}></li></${listTag}></li><li><p>Last</p></li></${listTag}>`), tag);
      const depths = () => design.evaluate((element) => Object.fromEntries(Array.from(element.querySelectorAll('li')).map((item) => {
        let depth = 0;
        for (let parent = item.parentElement; parent && parent !== element; parent = parent.parentElement) {
          if (parent.matches('ul, ol')) depth++;
        }
        return [item.querySelector('p').textContent, depth];
      })));
      const initialDepths = { First: 1, Parent: 1, 'Child A': 2, 'Child B': 2, Grandchild: 3, Last: 1 };
      await selectDesignItem('Parent');
      await design.press('Tab');
      assert.deepEqual(await depths(), { First: 1, Parent: 2, 'Child A': 3, 'Child B': 3, Grandchild: 4, Last: 1 }, `${tag}: Tab moves the parent and its entire subtree`);
      await design.press('Shift+Tab');
      assert.deepEqual(await depths(), initialDepths, `${tag}: Shift+Tab moves the subtree back without changing siblings`);
      await selectDesignItem('First');
      const firstText = await design.textContent();
      await design.press('Tab');
      assert.equal(await design.textContent(), firstText, `${tag}: Tab on the first item never inserts spaces`);
      assert.deepEqual(await depths(), initialDepths, `${tag}: An item without a preceding sibling stays at its current level`);
    }
    for (const marker of ['-', '1.']) {
      const ccc = "Lin's Concordance Correlation Coefficient (CCC): how closely a scatter plot of BRINE vs manual follows the line of identity (y = x)";
      const rho = 'rho is the correlation coefficient between x and y';
      const explanation = "overcomes limitation of Pearson's r";
      const equation = String.raw`\rho_c = \frac{2 \rho \sigma_x \sigma_y}{\sigma_x^2 + \sigma_y^2 + (\mu_x - \mu_y)^2}`;
      const markdown = `${marker} ${ccc}\n\n$$\n${equation}\n$$\n\n${marker} ${rho}\n  ${marker} ${explanation}\n${marker} Following metric`;
      await design.evaluate((element, content) => element.editor.commands.setContent(content, { contentType: 'markdown' }), markdown);
      assert.equal(await design.locator(':scope > ul, :scope > ol').count(), 2, 'Display math splits the original metric lists');
      await selectDesignItem(rho);
      await design.press('Tab');
      const readMetricDepths = () => design.evaluate((element) => Object.fromEntries(Array.from(element.querySelectorAll('li')).map((item) => {
        let depth = 0;
        for (let parent = item.parentElement; parent && parent !== element; parent = parent.parentElement) {
          if (parent.matches('ul, ol')) depth++;
        }
        return [item.querySelector('p').textContent, depth];
      })));
      assert.deepEqual(await readMetricDepths(), { [ccc]: 1, [rho]: 2, [explanation]: 3, 'Following metric': 1 }, 'Tab nests rho and its child beneath CCC across the equation');
      assert.equal(await design.locator('.section-math-block').getAttribute('data-latex'), equation, 'Indentation preserves the equation source');
      assert.equal(await design.locator('.section-math-block').evaluate((element) => element.closest('li').querySelector('p').textContent), ccc, 'The equation belongs to the preceding CCC item');
      await design.evaluate((element) => element.editor.commands.setContent(element.editor.getMarkdown(), { contentType: 'markdown' }));
      assert.deepEqual(await readMetricDepths(), { [ccc]: 1, [rho]: 2, [explanation]: 3, 'Following metric': 1 }, 'Math-separated list indentation survives Markdown reload');
      await selectDesignItem(rho); await design.press('Shift+Tab');
      assert.deepEqual(await readMetricDepths(), { [ccc]: 1, [rho]: 1, [explanation]: 2, 'Following metric': 1 }, 'Shift+Tab outdents rho with its child without moving the following metric');
      assert.equal(await design.locator('.section-math-block svg').count(), 1, 'The equation remains rendered after outdenting');
    }
    await design.evaluate((element) => element.editor.commands.setContent('- Previous metric\n\nSeparate explanation\n\n- Rho line', { contentType: 'markdown' }));
    await selectDesignItem('Rho line');
    const separatedMarkdown = await design.evaluate((element) => element.editor.getMarkdown());
    await design.press('Tab');
    assert.equal(await design.evaluate((element) => element.editor.getMarkdown()), separatedMarkdown, 'Tab does not move unrelated prose into a preceding list');
    await design.press('Control+a'); await design.press('Backspace');
    await design.fill('Indented text'); await design.press('Control+Home'); await design.press('Tab');
    assert.equal(await design.evaluate((element) => element === document.activeElement), true, 'Tab stays in the current phase');
    assert((await design.textContent()).includes('\u2003'), `Tab inserts a single indentation character: ${await design.innerHTML()}`);
    await design.press('Backspace');
    assert.equal(await design.textContent(), 'Indented text', 'One Backspace removes all whitespace inserted by Tab');
    await design.press('Tab'); await design.press('Tab'); await design.press('Shift+Tab');
    assert.equal((await design.textContent()).split('\u2003').length - 1, 1, 'Shift+Tab removes one indentation level, not all levels');
    await design.press('End'); await design.press('Shift+Tab');
    assert.equal(await design.textContent(), 'Indented text', 'Shift+Tab removes leading indentation even after typing');
    const designTools = tools;
    await designTools.getByRole('button', { name: 'Code block', exact: true }).click();
    await design.press('Control+Home'); await design.press('Tab');
    assert((await design.locator('code').textContent()).includes('\t'), 'Code-block Tab inserts one literal tab');
    await design.press('Backspace');
    assert.equal(await design.locator('code').textContent(), 'Indented text', 'One Backspace removes a code-block Tab');
    await designTools.getByRole('button', { name: 'Code block', exact: true }).click();
    await design.press('Control+Home'); await design.press('Tab');
    assert((await experiment()).experimentalDesign.includes('\u2003'), `Indented Markdown is saved before switching phases: ${JSON.stringify((await experiment()).experimentalDesign)}`);

    const expected = full.getByRole('textbox', { name: 'Expected Results editor', exact: true });
    await expected.press('End');
    await full.getByLabel('Insert images into Expected Results', { exact: true }).setInputFiles({ name: 'inline.png', mimeType: 'image/png', buffer: image });
    await expected.getByRole('img', { name: 'inline.png', exact: true }).waitFor();
    const inlineCaption = expected.locator('.section-image-filename').getByText('inline.png', { exact: true });
    await inlineCaption.waitFor();
    const inlineImageBounds = await expected.getByRole('img', { name: 'inline.png', exact: true }).boundingBox();
    const inlineCaptionBounds = await inlineCaption.boundingBox();
    assert(inlineCaptionBounds.y >= inlineImageBounds.y + inlineImageBounds.height, 'Filename footer appears below its inline image');
    assert.equal(await inlineCaption.evaluate((element) => getComputedStyle(element).fontSize), '10px', 'Filename footer uses small text');
    assert.equal(await inlineCaption.evaluate((element) => element.closest('.section-image-preview').contentEditable), 'false', 'Filename footer is not editable document text');
    assert((await experiment()).expectedResults.includes('/uploads/inline.png'), 'Inline image persists as Markdown');
    assert((await experiment()).blocks.some((block) => block.name === 'inline.png' && block.section === 'expectedResults'), 'Inline image is also a section attachment');
    const enlargeInline = expected.getByRole('button', { name: 'Enlarge inline.png', exact: true });
    await page.mouse.move(0, 0);
    assert.equal(await enlargeInline.evaluate((element) => getComputedStyle(element).opacity), '0.5');
    assert.deepEqual(await enlargeInline.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, color: style.color, padding: style.padding, radius: style.borderRadius };
    }), { background: 'rgba(209, 213, 219, 0.5)', color: 'rgb(107, 114, 128)', padding: '5px', radius: '5px' });
    await expected.getByRole('img', { name: 'inline.png', exact: true }).hover();
    await page.waitForFunction((element) => getComputedStyle(element).opacity === '1', await enlargeInline.elementHandle());
    assert.notEqual(await enlargeInline.evaluate((element) => getComputedStyle(element).transform), 'none');
    await enlargeInline.click();
    const enlargedInline = page.getByRole('dialog', { name: 'Enlarged preview: inline.png', exact: true });
    await enlargedInline.waitFor();
    assert(Math.abs((await enlargedInline.getByRole('img').boundingBox()).height - 810) < 2, 'Enlarged image occupies 90% of viewport height');
    await enlargedInline.getByRole('button', { name: 'Close enlarged preview', exact: true }).click();
    await enlargedInline.waitFor({ state: 'hidden' });
    await enlargeInline.click();
    await page.keyboard.press('Escape');
    await enlargedInline.waitFor({ state: 'hidden' });
    assert.equal(await full.count(), 1, 'Escape closes only the enlarged preview');
    await expected.evaluate((element, encoded) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], 'pasted.png', { type: 'image/png' }));
      Object.defineProperty(data, 'files', { value: [] }); // Screenshot image exposed only via clipboard items.
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, image.toString('base64'));
    await expected.getByRole('img', { name: 'pasted.png', exact: true }).waitFor();
    await expected.locator('.section-image-filename').getByText('pasted.png', { exact: true }).waitFor();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
    const screenshot = await page.screenshot({ clip: { x: 0, y: 0, width: 10, height: 10 } });
    await page.evaluate(async (encoded) => {
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    }, screenshot.toString('base64'));
    await expected.focus();
    await expected.press('Control+v');
    await expected.locator('img').nth(2).waitFor();
    assert.equal((await experiment()).blocks.filter((block) => block.section === 'expectedResults').length, 3, 'Ctrl+V uploads one screenshot into the active section');
    await expected.evaluate((element, encoded) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], 'dropped.png', { type: 'image/png' }));
      const box = element.getBoundingClientRect();
      element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: box.x + 20, clientY: box.y + 20, bubbles: true, cancelable: true }));
    }, image.toString('base64'));
    await expected.getByRole('img', { name: 'dropped.png', exact: true }).waitFor();
    await expected.evaluate((element, encoded) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], 'gateway.png', { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, image.toString('base64'));
    await full.getByRole('region', { name: 'Expected Results section', exact: true }).getByRole('alert').filter({ hasText: 'Upload service unavailable (502)' }).waitFor();
    assert.equal((await experiment()).blocks.some((block) => block.name === 'gateway.png'), false, 'Gateway failures do not create phantom attachments');
    assert.equal(await expected.getByRole('img').count(), 4);

    const notes = full.getByRole('textbox', { name: 'Notes editor', exact: true });
    await notes.fill('Reference'); await notes.press('Control+a');
    const noteTools = tools;
    await noteTools.getByRole('button', { name: 'Link', exact: true }).click();
    const linkDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Insert link', exact: true }) });
    await linkDialog.getByRole('textbox').fill('https://example.com/paper');
    await linkDialog.getByRole('button', { name: 'OK', exact: true }).click();
    assert.equal(await notes.locator('a').getAttribute('href'), 'https://example.com/paper');
    await noteTools.getByRole('button', { name: 'Link', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await full.count(), 1, 'Dismissing a link dialog does not exit fullscreen');
    await linkDialog.waitFor({ state: 'hidden' });
    await notes.press('Control+a');
    await noteTools.getByRole('button', { name: 'Bold', exact: true }).click();
    const fontSize = noteTools.getByRole('combobox', { name: 'Font size', exact: true });
    await fontSize.selectOption('24');
    assert.equal(await notes.locator('span[style*="font-size"]').evaluate((element) => getComputedStyle(element).fontSize), '24px', 'Font size changes the rendered selection while preserving bold');
    assert((await experiment()).notes.includes('font-size: 24px'), 'Font size is saved in the existing Markdown field');
    await noteTools.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await notes.locator('[style*="font-size"]').count(), 0, 'Font size supports undo');
    await noteTools.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.equal(await notes.locator('span[style*="font-size"]').evaluate((element) => getComputedStyle(element).fontSize), '24px', 'Font size supports redo');
    await fontSize.selectOption('');
    assert.equal(await notes.locator('[style*="font-size"]').count(), 0, 'Default removes the explicit font size');
    assert.equal(await notes.locator('strong').textContent(), 'Reference', 'Default font size preserves bold');
    assert.equal(await notes.locator('a').getAttribute('href'), 'https://example.com/paper', 'Default font size preserves links');
    await notes.press('Control+a');
    await fontSize.selectOption('18');
    assert.equal(await notes.locator('span[style*="font-size"]').evaluate((element) => getComputedStyle(element).fontSize), '18px', 'Shared toolbar changes font size');
    await full.evaluate((dialog) => {
      const text = dialog.querySelector('[aria-label="Notes editor"]');
      const caret = text.editor.view.coordsAtPos(text.editor.state.selection.head);
      dialog.querySelector('[data-experiment-scroll]').scrollTop += caret.top - dialog.querySelector('[role="toolbar"]').getBoundingClientRect().bottom / 2;
    });
    await fontSize.selectOption('24');
    await page.waitForFunction((dialog) => {
      const text = dialog.querySelector('[aria-label="Notes editor"]');
      const caret = text.editor.view.coordsAtPos(text.editor.state.selection.head);
      return caret.top >= dialog.querySelector('[role="toolbar"]').getBoundingClientRect().bottom + 4;
    }, await full.elementHandle(), { timeout: 3000 });
    await fontSize.selectOption('18');
    const protocolText = full.getByRole('textbox', { name: 'Experimental Protocol editor', exact: true });
    const protocolTools = tools;
    const protocolSize = protocolTools.getByRole('combobox', { name: 'Font size', exact: true });
    await protocolText.evaluate((element) => element.editor.commands.setContent('Normal Sized Normal', { contentType: 'markdown' }));
    await protocolText.evaluate((element) => { element.editor.view.focus(); element.editor.commands.setTextSelection({ from: 8, to: 13 }); });
    await protocolSize.selectOption('24');
    assert.equal(await protocolText.locator('[style*="font-size"]').textContent(), 'Sized', 'Font size affects only highlighted text');
    await protocolText.evaluate((element) => element.editor.commands.setTextSelection(13));
    await protocolSize.selectOption('20');
    await protocolText.pressSequentially(' typed');
    assert.equal(await protocolText.locator('[style*="20px"]').textContent(), ' typed', 'With no selection, font size applies to newly typed text');
    assert.equal(await protocolText.locator('[style*="24px"]').textContent(), 'Sized', 'Newly typed text does not resize existing text');
    await protocolText.press('Control+a');
    await protocolTools.getByRole('button', { name: 'Clear formatting', exact: true }).click();
    assert.equal(await protocolText.locator('[style*="font-size"]').count(), 0, 'Clear formatting removes all explicit font sizes');
    await protocolText.press('Control+a');
    await protocolTools.getByRole('combobox', { name: 'Text style', exact: true }).selectOption('2');
    await protocolSize.selectOption('28');
    assert.equal(await protocolText.locator('h2 [style*="font-size"]').evaluate((element) => getComputedStyle(element).fontSize), '28px', 'Font sizes also apply within headings');
    await full.getByRole('textbox', { name: 'Data Analysis editor', exact: true }).focus();
    const analysisTools = tools;
    await analysisTools.getByRole('button', { name: 'Insert table', exact: true }).click();
    assert.equal(await full.getByRole('textbox', { name: 'Data Analysis editor', exact: true }).locator('table').count(), 1);

    const acquisition = full.getByRole('textbox', { name: 'Data Acquisition editor', exact: true });
    const mathTools = tools;
    assert.equal(await acquisition.locator('.section-math svg').count(), 2, 'Imported inline and display LaTeX render with MathJax');
    assert.equal(await acquisition.locator('code').textContent(), '$literal$', 'Math inside code stays literal');
    const pastedEquation = String.raw`$$\rho_c = \frac{2 \rho \sigma_x \sigma_y}{\sigma_x^2 + \sigma_y^2 + (\mu_x - \mu_y)^2}$$`;
    const pasteText = async (text) => {
      await page.evaluate((value) => navigator.clipboard.writeText(value), text);
      await acquisition.focus();
      await acquisition.press('Control+v');
    };
    await acquisition.focus(); await acquisition.press('Control+a'); await acquisition.press('Backspace');
    await pasteText(pastedEquation);
    await acquisition.locator('.section-math-block svg').waitFor();
    assert.equal(await acquisition.locator('.section-math-block').getAttribute('data-latex'), pastedEquation.slice(2, -2), 'Pasted display equation preserves the exact LaTeX source');
    assert((await experiment()).dataAcquisition.includes(pastedEquation.slice(2, -2)), 'Pasted equation saves as Markdown');
    await mathTools.getByRole('button', { name: 'Undo', exact: true }).click();
    assert(!(await experiment()).dataAcquisition.includes(pastedEquation.slice(2, -2)), 'Equation paste supports undo');
    await mathTools.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.equal(await acquisition.locator('.section-math-block svg').count(), 1, 'Equation paste supports redo');
    await acquisition.focus(); await acquisition.press('Control+a'); await acquisition.press('Backspace');
    await pasteText('Rate $x^2$\n\n$$\ny^2\n$$');
    await acquisition.locator('.section-math-block svg').waitFor();
    assert.equal(await acquisition.locator('.section-math-inline svg').count(), 1, 'Pasting prose and multiline equations renders both math types');
    await acquisition.focus(); await acquisition.press('Control+a'); await acquisition.press('Backspace');
    await mathTools.getByRole('button', { name: 'Code block', exact: true }).click();
    await pasteText(pastedEquation);
    assert.equal(await acquisition.locator('.section-math').count(), 0, 'Pasting equations into code blocks stays literal');
    assert.equal(await acquisition.locator('code').textContent(), pastedEquation);
    await mathTools.getByRole('button', { name: 'Code block', exact: true }).click();
    await acquisition.fill('Rate ');
    await acquisition.press('End');
    await acquisition.pressSequentially('$x^2$');
    assert.equal(await acquisition.locator('.section-math-inline svg').count(), 1, 'Typing inline delimiters creates an equation');
    assert((await experiment()).dataAcquisition.includes('$x^2$'), 'Typed equation is saved as LaTeX Markdown');
    await acquisition.press('End'); await acquisition.press('Enter');
    await acquisition.pressSequentially('$$y^2$$');
    assert.equal(await acquisition.locator('.section-math-block svg').count(), 1, 'Typing display delimiters creates a block equation');
    await acquisition.locator('.section-math-inline').click();
    assert.equal(await full.getByRole('toolbar').count(), 1, 'Equation selection keeps the same single toolbar');
    await mathTools.getByRole('button', { name: 'Inline equation', exact: true }).click();
    const equationDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Edit equation', exact: true }) });
    await page.waitForFunction((input) => input.value === 'x^2', await equationDialog.getByRole('textbox').elementHandle());
    assert.equal(await equationDialog.getByRole('textbox').inputValue(), 'x^2');
    await equationDialog.getByRole('textbox').fill(String.raw`\frac{a}{b}`);
    await equationDialog.getByRole('button', { name: 'OK', exact: true }).click();
    assert((await experiment()).dataAcquisition.includes(String.raw`$\frac{a}{b}$`), 'Editing an equation preserves LaTeX backslashes');
    await mathTools.getByRole('button', { name: 'Undo', exact: true }).click();
    assert((await experiment()).dataAcquisition.includes('$x^2$'), 'Equation edits support undo');
    await mathTools.getByRole('button', { name: 'Redo', exact: true }).click();
    assert((await experiment()).dataAcquisition.includes(String.raw`$\frac{a}{b}$`), 'Equation edits support redo');
    await mathTools.getByRole('button', { name: 'Display equation', exact: true }).click();
    const insertEquation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Insert equation', exact: true }) });
    await insertEquation.getByRole('textbox').fill('E=mc^2');
    await insertEquation.getByRole('button', { name: 'OK', exact: true }).click();
    assert((await experiment()).dataAcquisition.includes('E=mc^2'), 'Toolbar inserts display equations');

    const results = full.getByRole('textbox', { name: 'Results editor', exact: true });
    const richMathHtml = String.raw`<h2>Branchpoint validation</h2><ol>
<li><p><strong>Proportional Bias Check (Log-Ratio Bland-Altman):</strong> Branchpoint error almost always exhibits <em>heteroscedasticity</em>—variance increases sharply as arbor complexity grows. Plotting $\log_{10}(\frac{\text{Auto} + 1}{\text{Manual} + 1})$ on the Bland-Altman Y-axis stabilizes variance.</p></li>
<li><p><strong>Overdispersion / Variance Ratio ($\frac{\sigma^2_{\text{auto}}}{\sigma^2_{\text{manual}}}$):</strong> Automated pruning thresholds can artificially compress variance (missing complex arbors) or inflate it via noise spurs.</p></li>
<li><p><strong style="font-size: 20px">Spatial Point-Matching ($F_1$ Score):</strong> Image-level counts can hide compensatory errors (e.g., missing $10$ true distal branches while inventing $10$ false soma-adjacent spurs yields a "perfect" image count). If $(x,y)$ coordinates are available, match automated branchpoints to manual ones within a tolerance radius (e.g., $3\text{–}5\text{ }\mu\text{m}$) using the <a href="https://example.com/matching">Hungarian algorithm</a>, then report Precision (resistance to noise spurs), Recall (sensitivity to true bifurcations), and $F_1$.<br>Keep this line break.</p></li>
</ol><p><code>$literal$</code></p><pre><code>$$literal display$$</code></pre><p>$$E=mc^2$$</p><p><span style="font-size: 999px">Default-size text</span></p>`;
    await page.evaluate(async (html) => {
      const container = document.createElement('div');
      container.innerHTML = html;
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([container.textContent], { type: 'text/plain' }),
      })]);
    }, richMathHtml);
    await results.fill(''); await results.focus(); await results.press('Control+v');
    const checkRichMath = async () => {
      assert.equal(await results.locator('h2').textContent(), 'Branchpoint validation', 'Rich math paste retains headings');
      assert.equal(await results.locator('ol > li').count(), 3, 'Rich math paste retains list structure');
      for (const title of ['Proportional Bias Check', 'Overdispersion / Variance Ratio', 'Spatial Point-Matching']) {
        assert.equal(await results.locator('strong').filter({ hasText: title }).count(), 1, 'Rich math paste retains bold headings');
      }
      assert.equal(await results.locator('em').textContent(), 'heteroscedasticity', 'Rich math paste retains italics');
      assert.equal(await results.locator('strong').filter({ hasText: 'Spatial Point-Matching' }).evaluate((element) => getComputedStyle(element.querySelector('[style*="font-size"]') || element).fontSize), '20px', 'Pasted font sizes survive alongside bold and inline equations');
      assert.equal(await results.locator('[style*="999px"]').count(), 0, 'Unsupported pasted sizes are discarded');
      assert.equal(await results.locator('a').getAttribute('href'), 'https://example.com/matching', 'Rich math paste retains links');
      assert.equal(await results.locator('ol > li').nth(2).locator('br:not(.ProseMirror-trailingBreak)').count(), 1, 'Rich math paste retains line breaks');
      assert.equal(await results.locator('.section-math-inline svg').count(), 8, 'All inline equations render without flattening surrounding formatting');
      assert.equal(await results.locator('.section-math-block svg').count(), 1, 'Rich text display equations render');
      assert.equal(await results.locator('p code').textContent(), '$literal$', 'Rich text inline code stays literal');
      assert.equal(await results.locator('pre code').textContent(), '$$literal display$$', 'Rich text code blocks stay literal');
    };
    await checkRichMath();

    const validation = full.getByRole('textbox', { name: 'Validation editor', exact: true });
    await validation.fill('Custom rationale'); await validation.press('Control+a');
    await tools.getByRole('button', { name: 'Bold', exact: true }).click();
    assert.equal((await experiment()).customPhases[0].content, '**Custom rationale**', 'Shared toolbar targets custom phase text');
    const validationFiles = uploadedContent.getByRole('region', { name: 'Validation attachments', exact: true });
    await validationFiles.getByLabel('Upload files to Validation', { exact: true }).setInputFiles({ name: 'validation.txt', mimeType: 'text/plain', buffer: Buffer.from('validation') });
    await validationFiles.getByRole('article', { name: 'validation.txt', exact: true }).waitFor();
    assert((await experiment()).blocks.some((block) => block.name === 'validation.txt' && block.section === 'validation' && block.phase === 'validation'), 'Bottom upload groups preserve custom phase ownership');
    const purposeFiles = full.getByRole('region', { name: 'Purpose attachments', exact: true });
    const protocolFiles = full.getByRole('region', { name: 'Experimental Protocol attachments', exact: true });
    const resultsFiles = full.getByRole('region', { name: 'Results attachments', exact: true });
    await purposeFiles.getByLabel('Upload files to Purpose', { exact: true }).setInputFiles({ name: 'reference.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
    await purposeFiles.getByRole('article', { name: 'reference.pdf', exact: true }).waitFor();
    await protocolFiles.getByLabel('Upload files to Experimental Protocol', { exact: true }).setInputFiles([
      { name: 'protocol.png', mimeType: 'image/png', buffer: image },
      { name: 'measurements.csv', mimeType: 'text/csv', buffer: Buffer.from('Sample,Value\nA,10\nB,20') },
    ]);
    await protocolFiles.getByRole('article', { name: 'measurements.csv', exact: true }).waitFor();
    assert.equal(await purposeFiles.getByRole('article').count(), 1);
    for (const files of [purposeFiles, protocolFiles]) {
      const upload = await files.getByRole('button', { name: 'Upload files', exact: true }).boundingBox();
      for (const preview of await files.getByRole('article').all()) {
        const box = await preview.boundingBox();
        assert(upload.y + upload.height <= box.y, 'Phase upload controls sit above their previews within the combined block');
      }
    }
    assert.equal(await resultsFiles.getByRole('article').count(), 2, 'Legacy attachments stay in Results');
    const uploaded = (await experiment()).blocks.filter((block) => block.section === 'experimentalProtocol');
    assert.equal(uploaded.length, 2);
    assert(uploaded.every((block) => block.phase === 'experimentalProtocol'));
    assert.equal(uploaded[1].src, '/uploads/measurements.csv', 'Original CSV remains downloadable');
    await protocolFiles.getByRole('button', { name: 'Enlarge protocol.png', exact: true }).click();
    const enlargedAttachment = page.getByRole('dialog', { name: 'Enlarged preview: protocol.png', exact: true });
    await enlargedAttachment.getByRole('button', { name: 'Open in viewer', exact: true }).click();
    await enlargedAttachment.waitFor({ state: 'hidden' });
    await full.getByTitle('Download original raw scientific file').waitFor();
    assert.equal(await full.getByTitle('Download original raw scientific file').getAttribute('href'), '/uploads/protocol.png');
    await page.keyboard.press('Escape');
    assert.equal(await full.count(), 1);
    await purposeFiles.getByLabel('Upload files to Purpose', { exact: true }).setInputFiles({ name: 'reject.txt', mimeType: 'text/plain', buffer: Buffer.from('fail') });
    await purposeFiles.getByRole('alert').waitFor();
    assert.equal((await experiment()).blocks.some((block) => block.name === 'reject.txt'), false, 'Failed uploads do not create fake saved attachments');

    await protocolFiles.getByLabel('Upload files to Experimental Protocol', { exact: true }).setInputFiles({ name: 'late.txt', mimeType: 'text/plain', buffer: Buffer.from('late') });
    await protocolFiles.getByRole('status').waitFor();
    await open('e2', true);
    await full.getByRole('textbox', { name: 'Purpose editor', exact: true }).waitFor();
    const savedLate = page.waitForResponse((response) => response.url().endsWith('/api/lab/state') && response.request().method() === 'POST' && response.request().postData()?.includes('late.txt'));
    releaseUpload();
    await page.waitForFunction(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().projects[0].exps[0].blocks.some((block) => block.name === 'late.txt'));
    assert.equal(await full.getByRole('textbox', { name: 'Data Analysis editor', exact: true }).count(), 0, 'Excluded phases stay hidden');
    assert.equal(await uploadedContent.getByRole('region', { name: 'Data Analysis attachments', exact: true }).count(), 0, 'Excluded phase upload groups stay hidden');
    await tools.waitFor();
    assert.equal(await full.getByRole('toolbar').count(), 1, 'Switching experiments retains exactly one toolbar');
    assert.equal(await tools.getAttribute('data-section'), 'Purpose', 'A phase absent from the next experiment cannot remain the toolbar target');
    assert.equal(await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().projects[0].exps[1].blocks.length), 0, 'Late uploads stay assigned to the original experiment');
    await (await savedLate).finished();
    assert(saved.projects[0].exps[0].blocks.some((block) => block.name === 'late.txt'), 'Late upload reaches the state API before reload');
    await page.reload(); await page.getByRole('heading', { name: 'Calendar & Schedule', exact: true }).waitFor();
    await open('e1', true);
    await purpose.locator('strong').waitFor();
    assert.equal(await purpose.locator('mark').textContent(), 'Hypothesis', 'Highlight and bold survive saving and reopening');
    assert.equal(await notes.locator('a').getAttribute('href'), 'https://example.com/paper', 'Rich text formatting survives reload');
    assert.equal(await notes.locator('strong').textContent(), 'Reference', 'Bold inside sized text survives Markdown reload');
    assert.equal(await notes.locator('span[style*="font-size"]').evaluate((element) => getComputedStyle(element).fontSize), '18px', 'Selected font size survives saving and reloading');
    assert.equal(await protocolText.locator('h2 [style*="font-size"]').evaluate((element) => getComputedStyle(element).fontSize), '28px', 'Sized headings survive saving and reloading');
    await checkRichMath();
    assert.equal(await protocolFiles.getByRole('article').count(), 3, 'Section ownership survives reload');
    assert.equal(await expected.getByRole('img').count(), 4, 'Inline images and pasted screenshots survive reload');
    assert.equal(await expected.locator('.section-image-filename').count(), 4, 'Every inline image has a filename footer after reload');
    await expected.locator('.section-image-filename').getByText('inline.png', { exact: true }).waitFor();
    assert.equal(await acquisition.locator('.section-math-block svg').count(), 2, 'Display equations survive reload');
    assert((await experiment()).dataAcquisition.includes('E=mc^2'), 'Equation source survives reload');
    assert((await design.textContent()).includes('\u2003'), `Indentation survives Markdown reload: ${await design.innerHTML()} / ${JSON.stringify((await experiment()).experimentalDesign)}`);
    await design.evaluate((element) => {
      element.editor.state.doc.descendants((node, position) => {
        if (node.isText && node.text.includes('\u2003')) element.editor.commands.setTextSelection(position + node.text.indexOf('\u2003') + 1);
      });
      element.editor.view.focus();
    });
    await design.press('Backspace');
    assert.equal(await design.textContent(), 'Indented text', 'A saved Tab still deletes with one Backspace after reload');
    await protocolFiles.getByRole('article', { name: 'measurements.csv', exact: true }).getByRole('button', { name: 'Remove', exact: true }).click();
    const removeDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Remove attachment', exact: true }) });
    await removeDialog.getByRole('button', { name: 'Remove', exact: true }).click();
    assert.equal((await experiment()).blocks.some((block) => block.name === 'measurements.csv'), false);
    assert.equal((await experiment()).blocks.some((block) => block.name === 'reference.pdf'), true, 'Removing a section attachment uses its original block index');
    for (const width of [390, 900, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await editorSurface.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      assert.equal(await full.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true, `Fullscreen editor fits ${width}px screens`);
      const pinnedTitle = await title.boundingBox();
      const pinnedTools = await tools.boundingBox();
      assert.equal(pinnedTitle.y, 0, 'Title stays flush to the screen top after scrolling');
      assert.equal(pinnedTools.y, pinnedTitle.y + pinnedTitle.height, 'Toolbar remains pinned directly under the title after scrolling and resizing');
      assert(pinnedTools.x >= 0 && pinnedTools.x + pinnedTools.width <= width, 'Toolbar fits the viewport');
      assert.equal(await full.getByRole('toolbar').count(), 1, 'Resizing never duplicates the toolbar');
      await editorSurface.evaluate((element) => { element.scrollTop = 0; });
      await full.getByRole('button', { name: /^Notes/ }).click();
      await page.waitForFunction((dialog) => {
        const section = dialog.querySelector('[id$="-experiment-section-notes"]').getBoundingClientRect();
        const toolbar = dialog.querySelector('[role="toolbar"]').getBoundingClientRect();
        return Math.abs(section.top - toolbar.bottom - 8) < 2;
      }, await full.elementHandle());
    }
    await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.setState({ isDarkMode: true }));
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(await full.getByRole('textbox', { name: 'Purpose editor', exact: true }).locator('strong').count(), 1, 'Rich content remains available in dark mode');
    await full.getByTitle('Exit full screen', { exact: true }).click();
    assert.equal(await popup.getByRole('toolbar').count(), 0, 'Shared rich-text toolbar is fullscreen-only');
    assert.equal(await popup.getByRole('region', { name: 'Uploaded content', exact: true }).count(), 0, 'Popup keeps its existing per-section attachments');
    assert.equal(await popup.getByRole('separator', { name: 'Purpose end', exact: true }).count(), 0, 'Popup keeps its existing card layout');
    assert.equal(await popup.getByRole('textbox', { name: 'Purpose text', exact: true }).inputValue(), (await experiment()).purpose, 'Popup preserves saved HTML-backed highlight formatting');
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log('PASS: resizable sidebar, split-view picker and hover entry, independent experiment controls/toolbars/scrolling, grouped fullscreen experiment navigation, All Projects Active filter, fullscreen sections, flush pinned title and shared toolbar, grouped bottom uploads, list subtree indentation and atomic tabs, persistent font sizes and highlights, rich formatting, MathJax import/paste/typing/editing/undo/reload, tables, section uploads, previews, failure handling, and experiment isolation');
  } finally { await browser?.close(); server.kill(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
