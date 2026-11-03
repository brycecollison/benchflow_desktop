// Run: node frontend/scripts/backup-browse-check.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/components/Views/SettingsView.tsx'), 'utf8');
const start = source.indexOf('  const browseBackup = async () => {');
const end = source.indexOf('\n  const blast', start);
const makeBrowse = new Function('fetch', 'bdir', 'setBrowsing', 'setBerr', 'setBdir',
  `${source.slice(start, end).replace('catch (e: any)', 'catch (e)')}\nreturn browseBackup;`);

(async () => {
  for (const scenario of ['selected', 'cancelled', 'error', 'network']) {
    const busy = [], errors = [], paths = [];
    const fetch = async (url, options) => {
      assert.equal(url, '/api/backup/browse');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { dir: 'old path' });
      if (scenario === 'network') throw new Error('offline');
      return {
        ok: scenario !== 'error',
        json: async () => scenario === 'error' ? { detail: 'No desktop' } : { dir: scenario === 'selected' ? 'new path' : null },
      };
    };
    await makeBrowse(fetch, 'old path', v => busy.push(v), v => errors.push(v), v => paths.push(v))();
    assert.deepEqual(busy, [true, false]);
    assert.deepEqual(paths, scenario === 'selected' ? ['new path'] : []);
    assert.deepEqual(errors, scenario === 'error' ? [null, 'No desktop'] : scenario === 'network' ? [null, 'offline'] : [null]);
  }
  assert.ok(!source.includes('SharePoint Backup'));
  assert.ok(source.includes('htmlFor="backup-folder"'));
  console.log('PASS: Browse selection, cancellation, errors, busy reset, and hidden SharePoint tile');
})().catch(error => { console.error(error); process.exitCode = 1; });
