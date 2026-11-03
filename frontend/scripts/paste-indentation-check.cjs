// Requires Playwright and Chrome: node frontend/scripts/paste-indentation-check.cjs
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const frontend = path.resolve(__dirname, '..');
  const server = spawn(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4185', '--strictPort'], { cwd: frontend, stdio: 'ignore' });
  let browser;
  try {
    const url = 'http://127.0.0.1:4185';
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch(url)).ok) break; } catch {}
      assert(attempt < 50, 'Vite did not start');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let saved = { papers: [], projects: [{ id: 'p', name: 'Paste project', exps: [{ id: 'e', name: 'Paste experiment', status: 'Planned', priority: '', paper: '', deps: [], blocks: [], phases: [] }] }] };
    await page.route('**/api/**', (route) => {
      if (route.request().method() === 'POST') saved = route.request().postDataJSON();
      return route.fulfill({ json: route.request().method() === 'POST' ? { status: 'success' } : saved });
    });
    await page.goto(url);
    await page.getByRole('heading', { name: 'Calendar & Schedule', exact: true }).waitFor();
    await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().openModal('e', true));
    const editor = page.getByRole('textbox', { name: 'Purpose editor', exact: true });
    await editor.waitFor();
    const lines = ['Parent', '    Four spaces', '\tOne tab', '  Two spaces'];
    const readLines = () => editor.locator(':scope > p').allTextContents();
    const paste = async (plain, html = '') => {
      await editor.evaluate((element, { plain, html }) => {
        element.editor.commands.clearContent();
        element.editor.commands.focus();
        const clipboard = new DataTransfer();
        clipboard.setData('text/plain', plain);
        if (html) clipboard.setData('text/html', html);
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
      }, { plain, html });
    };
    const reloadContent = async () => editor.evaluate((element) => element.editor.commands.setContent(element.editor.getMarkdown(), { contentType: 'markdown' }));
    const protocol = `6 Conditions: Veh, 1 nM PCI, 3 nM PCI, 10 nM PCI, 20 nM PCI, 1 uM MS275
    NOTE: DMSO content reduced from 0.10% to 0.001% for all conditions

1/2 mouse per well per condition per rep
    6 conditions * 1/2 mouse per condition * 3 bio reps = 9 mice

Pool 3 mice after neuronal enrichment, just before plating. Split evenly across 6 wells

Allow 2 hours for adherence, then apply additional DRG culture media supplemented with 2X final concentration of DMSO vehicle or drug to achieve desired final concentration upon 1:1 addition with initial plating media

Keep lysis volume minimal to maximize final protein concentration

Lyse in 50 ul of 1X RIPA buffer supplemented with SDS powder to 2%, then boil
    In lieu of tip sonication to keep sample volumes low
    NOTE: changed to RIPA + 2% SDS to enable BCA, used Laemmli previously which contains 2-ME. Pierce kit compatible with up to 5% SDS per Thermo
${'    '}
BCA lysate after boiling

Prepare samples for WB by adding 2-ME to 5% final of well volume, boil 95C 5 min, then load
    NOTE: no bromophenol blue will be added; relying on ladders to indicate approximate front position and prevent sample run-off
${'    '}
WB for acSMC3, H3K27ac
    Will need to split samples across two gels, reps 1 and 2 in gel 1, rep 3 in gel 2
    NOTE: Terminate slightly earlier than normal (when 10 kDa marker is ~ 1 cm above bottom of gel) to prevent sample loss`;
    await paste(protocol);
    assert.equal(await editor.locator('em').count(), 0, 'Multiplication asterisks in plain text are not converted to italics');
    assert.deepEqual(await readLines(), protocol.split('\n'), 'Protocol paste preserves every line, blank line, and indentation');
    await reloadContent();
    assert.deepEqual(await readLines(), protocol.split('\n'), 'Protocol text survives reload without reinterpretation');
    const protocolHTML = protocol.split('\n').map((line) => `<p>${line.replace('volume minimal', 'volume\nminimal').replace('NOTE: changed', 'NOTE:\nchanged')}</p>`).join('\n');
    await paste(protocol, protocolHTML);
    assert.deepEqual(await readLines(), protocol.split('\n'), 'Rich protocol paste does not turn HTML source wrapping into hard line breaks');
    assert.equal(await editor.locator('em').count(), 0, 'Rich protocol multiplication remains literal');
    await reloadContent();
    assert.deepEqual(await readLines(), protocol.split('\n'), 'Rich protocol text survives reload unchanged');
    await paste('First\n  Second', '<p style="white-space: pre-wrap">First\n  Second</p>');
    assert.equal(await editor.locator('p').textContent(), 'First\n  Second', 'Explicitly preformatted HTML retains intentional newlines');
    await paste(lines.join('\n'));
    assert.deepEqual(await readLines(), lines, 'Plain text paste keeps spaces and tabs');
    await reloadContent();
    assert.deepEqual(await readLines(), lines, 'Plain text indentation survives Markdown reload');
    await paste(lines.join('\n'), '<p>Parent</p><p>    <strong>Four spaces</strong></p><p>\tOne tab</p><p>  Two spaces</p>');
    assert.deepEqual(await readLines(), lines, 'Rich text paste keeps spaces and tabs');
    assert.equal(await editor.locator('strong').textContent(), 'Four spaces', 'Indented rich text keeps its formatting');
    await reloadContent();
    assert.deepEqual(await readLines(), lines, 'Rich text indentation survives Markdown reload');
    assert.equal(await editor.locator('strong').textContent(), 'Four spaces', 'Rich formatting survives reload');
    await page.waitForResponse((response) => response.url().includes('/api/') && response.request().method() === 'POST');
    await page.reload();
    await page.getByRole('heading', { name: 'Calendar & Schedule', exact: true }).waitFor();
    await page.evaluate(async () => (await import('/src/store/useLabStore.ts')).useLabStore.getState().openModal('e', true));
    await editor.waitFor();
    assert.deepEqual(await readLines(), lines, 'Pasted indentation survives saving and reopening the app');
    await paste('First\n    Second', '<p>First<br>    Second</p>');
    assert.equal(await editor.locator('p').textContent(), 'First    Second', 'Indentation after a line break is preserved');
    await reloadContent();
    assert.equal(await editor.locator('p').textContent(), 'First    Second', 'Indentation after a line break survives reload');
    await paste('    Heading', '<h2>    Heading</h2>');
    await reloadContent();
    assert.equal(await editor.locator('h2').textContent(), '    Heading', 'Heading indentation survives reload');
    assert.equal(await editor.locator('h2').evaluate((element) => getComputedStyle(element).whiteSpace), 'pre-wrap', 'Heading indentation is visible');
    await paste('Parent\nChild', '<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>');
    assert.equal(await editor.locator('ul ul').count(), 1, 'Rich list paste retains structural indentation');
    await reloadContent();
    assert.equal(await editor.locator('ul ul').count(), 1, 'Nested list indentation survives reload');
    const longText = 'Wrapped continuation lines should keep the same indentation as the first line. '.repeat(8).trim();
    const checkWrappedLines = async () => {
      await page.waitForFunction((element) => parseFloat(element.querySelector('p').style.paddingInlineStart) > 0, await editor.elementHandle());
      const starts = await editor.locator('p').evaluate((paragraph) => {
        const lines = new Map();
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          for (let offset = 0; offset < text.textContent.length; offset++) {
            if (/\s/.test(text.textContent[offset])) continue;
            const range = document.createRange();
            range.setStart(text, offset);
            range.setEnd(text, offset + 1);
            const bounds = range.getBoundingClientRect();
            const top = Math.round(bounds.top);
            lines.set(top, Math.min(lines.get(top) ?? Infinity, bounds.left));
          }
        }
        return Array.from(lines.values());
      });
      assert(starts.length > 1, 'Test text wraps onto multiple lines');
      assert(starts.every((left) => Math.abs(left - starts[0]) < 1), `All wrapped lines share the first line's indent: ${starts}`);
    };
    for (const prefix of ['    ', '\t', '\u2003']) {
      await paste(prefix + longText);
      await checkWrappedLines();
      await reloadContent();
      await checkWrappedLines();
      assert.deepEqual(await readLines(), [prefix + longText], 'Wrapped indentation does not modify saved text');
    }
    await paste('    ' + longText, `<p><span style="font-size: 24px">    ${longText}</span></p>`);
    await checkWrappedLines();
    await page.setViewportSize({ width: 900, height: 900 });
    await checkWrappedLines();
    await reloadContent();
    await checkWrappedLines();
    await editor.press('Control+Home');
    await editor.press('Shift+Tab');
    await page.waitForFunction((element) => !element.querySelector('p').style.paddingInlineStart, await editor.elementHandle());
    assert.deepEqual(await readLines(), [longText], 'Outdenting removes both the leading whitespace and wrapped-line inset');
    for (const prefix of ['    ', '\t', '\u2003', '\u00a0\u00a0']) {
      await paste(prefix + 'Indented paragraph');
      await editor.press('Control+End');
      await editor.press('Enter');
      assert.deepEqual(await readLines(), [prefix + 'Indented paragraph', prefix], 'Enter carries the exact indentation into the new paragraph');
      await editor.pressSequentially('Continuation');
      await reloadContent();
      assert.deepEqual(await readLines(), [prefix + 'Indented paragraph', prefix + 'Continuation'], 'Inherited indentation survives typing and reload');
    }
    await paste('    Indented paragraph');
    await editor.press('Control+End');
    await editor.press('Enter');
    await editor.press('Enter');
    assert.deepEqual(await readLines(), ['    Indented paragraph', '    ', '    '], 'Repeated Enter keeps indentation on blank paragraphs');
    await editor.press('Shift+Tab');
    assert.deepEqual(await readLines(), ['    Indented paragraph', '    ', ''], 'Shift+Tab can remove the inherited indentation');
    await paste('    First second');
    await editor.evaluate((element) => element.editor.commands.setTextSelection(11));
    await editor.press('Enter');
    assert.deepEqual(await readLines(), ['    First ', '    second'], 'Splitting a paragraph carries indentation to the remaining text');
    await paste('    First');
    await editor.press('Control+End');
    await editor.press('Shift+Enter');
    await editor.pressSequentially('Second');
    assert.equal(await editor.locator('p').count(), 1, 'Shift+Enter remains a line break within the paragraph');
    assert.equal(await editor.locator('br:not(.ProseMirror-trailingBreak)').count(), 1, 'Shift+Enter keeps the native hard break');
    await paste('Plain paragraph');
    await editor.press('Control+End');
    await editor.press('Enter');
    assert.deepEqual(await readLines(), ['Plain paragraph', ''], 'Unindented paragraphs stay unindented');
    await paste('List item', '<ul><li><p>List item</p></li></ul>');
    await editor.locator('li p').click();
    await editor.press('End');
    await editor.press('Enter');
    assert.equal(await editor.locator('li').count(), 2, 'List Enter still creates a new list item');
    await editor.evaluate((element) => {
      element.editor.commands.setContent('```\n    code\n```', { contentType: 'markdown' });
      element.editor.commands.setTextSelection(1 + element.editor.state.doc.firstChild.content.size);
      element.editor.commands.focus();
    });
    await editor.press('Enter');
    assert.equal(await editor.locator('pre code').textContent(), '    code\n', 'Code-block Enter keeps its native behavior');
    const group = ['First line', '    Second line', 'Third line'];
    await paste(group.join('\n'));
    await editor.press('Control+a');
    await editor.press('Tab');
    assert.deepEqual(await readLines(), group.map((line) => '\u2003' + line), 'Tab indents every selected paragraph without replacing text');
    assert.equal(await editor.evaluate((element) => element.editor.state.selection.empty), false, 'Group indentation keeps the selection');
    await editor.press('Tab');
    assert.deepEqual(await readLines(), group.map((line) => '\u2003\u2003' + line), 'Repeated Tab continues to indent the entire group');
    await editor.press('Shift+Tab');
    await editor.press('Shift+Tab');
    assert.deepEqual(await readLines(), group, 'Group outdent removes one level from each selected paragraph');
    await reloadContent();
    assert.deepEqual(await readLines(), group, 'Selected-line edits preserve all content through reload');
    await paste('Single selected line');
    await editor.evaluate((element) => element.editor.commands.setTextSelection({ from: 3, to: 9 }));
    await editor.press('Tab');
    assert.deepEqual(await readLines(), ['\u2003Single selected line'], 'A partial selection indents its line without deleting the selected characters');
    await paste('First\nSecond\nThird');
    await editor.evaluate((element) => element.editor.commands.setTextSelection({ from: 1, to: 16 }));
    await editor.press('Tab');
    assert.deepEqual(await readLines(), ['\u2003First', '\u2003Second', 'Third'], 'A selection ending at the next line start does not indent that line');
    await paste('First\nSecond', '<p><strong>First</strong><br><em>Second</em></p>');
    await editor.press('Control+a');
    await editor.press('Tab');
    assert.equal(await editor.locator('p').textContent(), '\u2003First\u2003Second', 'Tab indents selected hard-break lines without removing either line');
    assert.equal((await editor.locator('strong').textContent()).replace(/\u2003/g, ''), 'First', 'Group indentation preserves bold formatting');
    assert.equal((await editor.locator('em').textContent()).replace(/\u2003/g, ''), 'Second', 'Group indentation preserves italic formatting');
    await editor.press('Shift+Tab');
    assert.equal(await editor.locator('p').textContent(), 'FirstSecond', 'Group outdent handles hard-break lines');
    await editor.evaluate((element) => {
      element.editor.commands.setContent('```\nFirst\nSecond\nThird\n```', { contentType: 'markdown' });
      element.editor.commands.setTextSelection({ from: 1, to: element.editor.state.doc.firstChild.content.size + 1 });
      element.editor.commands.focus();
    });
    await editor.press('Tab');
    assert.equal(await editor.locator('pre code').textContent(), '\tFirst\n\tSecond\n\tThird', 'Selected code lines each receive a tab without deleting the code');
    await editor.press('Shift+Tab');
    assert.equal(await editor.locator('pre code').textContent(), 'First\nSecond\nThird', 'Selected code lines outdent together');
    assert.deepEqual(errors, [], 'No browser errors');
    console.log('PASS: exact protocol plain/rich paste, literal multiplication, blank lines, HTML source wrapping, preformatted newlines, pasted spaces/tabs, formatting, nested lists, Markdown/app reload, wrapped-line indentation, inherited Enter indentation, native list/code Enter, selected-line indentation, preserved selections/formatting, resizing, and outdenting');
  } finally { await browser?.close(); server.kill(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
