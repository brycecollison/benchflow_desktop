// Run: node frontend/scripts/update-check.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/store/useUpdateStore.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
let state;
let fetchImpl;
const mockRequire = name => name === 'zustand' ? {
  create: init => (state = init(patch => Object.assign(state, patch), () => state)),
} : { useDialogStore: { getState: () => ({ openConfirm: async () => true }) } };
new Function('require', 'exports', 'fetch', js)(mockRequire, {}, (...args) => fetchImpl(...args));
const info = () => ({ current: '1.0.0', installed: true, available: true, installable: true, download: { state: 'ready' } });
(async () => {
  state.info = info();
  fetchImpl = async () => ({ ok: true, json: async () => ({ state: 'launched' }) });
  await state.install();
  assert.equal(state.info.download.state, 'launched');
  for (const network of [false, true]) {
    state.info = info();
    fetchImpl = async () => {
      if (network) throw new Error('offline');
      return { ok: false, json: async () => ({ detail: 'Setup refused' }) };
    };
    await state.install();
    assert.match(state.info.error, network ? /offline/ : /Setup refused/);
  }
  let finish, posts = 0;
  state.info = info();
  fetchImpl = async (_url, options) => {
    if (options?.method === 'POST') {
      posts++;
      await new Promise(resolve => { finish = resolve; });
    }
    return { ok: true, json: async () => info() };
  };
  const first = state.startDownload();
  await state.startDownload();
  assert.equal(posts, 1);
  finish();
  await first;
  console.log('PASS: update launch success, HTTP/network errors, and duplicate download prevention');
})().catch(error => { console.error(error); process.exitCode = 1; });
