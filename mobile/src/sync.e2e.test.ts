// Cross-side check: the phone's Repo against the real desktop servers (window API + sync app) from
// backend/, on a throwaway notebook. Skipped when the backend venv is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { withPhaseUpdate } from '../../frontend/src/utils/experimentUpdates.ts';
import { Repo, type Db, type Files, type Http } from './repo.ts';

const backend = resolve(import.meta.dirname, '../../backend');
const python = [resolve(backend, '../venv/Scripts/python.exe'), resolve(backend, '../venv/bin/python')].find(existsSync);

function nodeDb(path: string): Db {
  const db = new DatabaseSync(path);
  return {
    query: async (sql, values = []) => db.prepare(sql).all(...(values as any[])),
    batch: async (statements) => {
      db.exec('BEGIN');
      try { for (const s of statements) db.prepare(s.sql).run(...((s.values ?? []) as any[])); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
function nodeFiles(dir: string): Files {
  mkdirSync(dir, { recursive: true });
  return {
    read: async (n) => (existsSync(join(dir, n)) ? readFileSync(join(dir, n)).toString('base64') : null),
    write: async (n, b64) => writeFileSync(join(dir, n), Buffer.from(b64, 'base64')),
    exists: async (n) => existsSync(join(dir, n)),
  };
}
const nodeHttp: Http = {
  json: async (method, url, token, body) => {
    const res = await fetch(url, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null) };
  },
  base64: async (url, token) => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return res.ok ? Buffer.from(await res.arrayBuffer()).toString('base64') : null;
  },
};

async function serve(module: string, port: number, env: NodeJS.ProcessEnv, health: string): Promise<ChildProcess> {
  const proc = spawn(python!, ['-m', 'uvicorn', module, '--host', '127.0.0.1', '--port', String(port)], { cwd: backend, env, stdio: 'ignore' });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}${health}`)).ok) return proc; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error(`${module} did not start`);
}

test('phone and desktop sync through the real servers', { skip: !python && 'backend venv not found', timeout: 120_000 }, async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'benchflow-phone-'));
  const env = { ...process.env, BENCHFLOW_DATA_DIR: join(tmp, 'data'), BENCHFLOW_UPLOAD_DIR: join(tmp, 'uploads'),
    BENCHFLOW_APP_DATA: tmp, BENCHFLOW_CONFIG_DIR: tmp };
  const port = 20000 + Math.floor(Math.random() * 20000);
  const main = `http://127.0.0.1:${port}`;
  const sync = `http://127.0.0.1:${port + 1}`;
  const procs = [await serve('app.main:app', port, env, '/api/health')];
  t.after(() => procs.forEach((p) => p.kill()));
  procs.push(await serve('app.mobile_sync.api:app', port + 1, env, '/api/mobile/health'));

  const post = async (url: string, body?: unknown) => (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })).json();
  const desktopExp = async (id: string) => {
    const state = await (await fetch(`${main}/api/lab/state`)).json();
    return { state, exp: state.projects.flatMap((p: any) => p.exps).find((e: any) => e.id === id) };
  };
  const desktopEdit = async (id: string, changes: object) => { // what a merge-aware window sends
    const { state, exp } = await desktopExp(id);
    const edited = { ...state, since: state.rev, bases: { [id]: exp } };
    edited.projects = state.projects.map((p: any) => ({ ...p, exps: p.exps.map((e: any) => (e.id === id ? { ...e, ...changes } : e)) }));
    await post(`${main}/api/lab/state`, edited);
  };
  const openRepo = async () => { const r = new Repo(nodeDb(join(tmp, 'phone.db')), nodeHttp, nodeFiles(join(tmp, 'phone-files'))); await r.open(); return r; };
  const ID = 'exp-t7-assay';

  // pair with a one-time code from the window, then the first sync pulls the notebook
  let repo = await openRepo();
  await repo.pair(sync, (await post(`${main}/api/mobile/pairing`)).code, 'test phone');
  assert.ok((await repo.sync()).ok);
  assert.equal(repo.view().flatMap((p) => p.exps).length, 5);

  // typing is coalesced into one op per field, and it survives the app being killed
  for (const text of ['obs', 'obs 1', 'obs 12']) repo.update(ID, (e) => withPhaseUpdate(e, 'experimentalProtocol', { content: text }));
  repo.update(ID, (e) => withPhaseUpdate(e, 'experimentalProtocol', { completed: true }));
  await repo.flush();
  repo = await openRepo();
  assert.equal(repo.pendingCount, 2);
  assert.equal(repo.experiment(ID)!.experimentalProtocol, 'obs 12');

  // meanwhile the desktop edits another field; both survive the sync
  await desktopEdit(ID, { notes: 'desk note' });
  const first = await repo.sync();
  assert.ok(first.ok, first.detail);
  assert.equal(repo.pendingCount, 0);
  const merged = (await desktopExp(ID)).exp;
  assert.equal(merged.experimentalProtocol, 'obs 12');
  assert.equal(merged.experimentalProtocolCompleted, true);
  assert.equal(merged.notes, 'desk note');
  assert.equal(repo.experiment(ID)!.notes, 'desk note');

  // same paragraph on both sides: desktop text kept, phone text parked, resolvable from the phone
  await desktopEdit(ID, { notes: 'desk rewrote it' });
  repo.update(ID, (e) => ({ ...e, notes: 'phone rewrote it' }));
  assert.ok((await repo.sync()).ok);
  assert.equal(repo.experiment(ID)!.notes, 'desk rewrote it');
  assert.equal(repo.conflicts.length, 1);
  await repo.resolveConflict(repo.conflicts[0].id, 'other');
  assert.equal((await desktopExp(ID)).exp.notes, 'phone rewrote it');
  assert.equal(repo.conflicts.length, 0);

  // a photo: uploaded before the op that points at it, under the same name on both sides
  const name = await repo.addFile('bench photo.jpg', Buffer.from('not really a jpeg').toString('base64'));
  repo.update(ID, (e) => ({ ...e, blocks: [...e.blocks, { id: 'ph1', type: 'img', name: 'bench photo.jpg', src: `/uploads/${name}`,
    section: 'experimentalProtocol', phase: 'experimentalProtocol' } as any] }));
  assert.ok((await repo.sync()).ok);
  assert.equal(await (await fetch(`${main}/uploads/${name}`)).text(), 'not really a jpeg');
  assert.ok((await desktopExp(ID)).exp.blocks.some((b: any) => b.id === 'ph1' && b.src === `/uploads/${name}`));

  // a fresh phone gets the attachment for offline use
  const other = new Repo(nodeDb(join(tmp, 'phone2.db')), nodeHttp, nodeFiles(join(tmp, 'phone2-files')));
  await other.open();
  await other.pair(sync, (await post(`${main}/api/mobile/pairing`)).code, 'second phone');
  await other.sync();
  assert.equal(await other.fetchAttachments([other.experiment(ID)!]), 1);

  // pairing with a computer not seen before starts from a full pull; re-pairing the same one does not
  const since = () => (other as any).since as number;
  assert.ok(since() > 0);
  await other.pair(sync, (await post(`${main}/api/mobile/pairing`)).code, 'second phone');
  assert.ok(since() > 0);
  other.desktops[0].desktopId = 'some-other-pc';
  await other.pair(sync, (await post(`${main}/api/mobile/pairing`)).code, 'second phone');
  assert.equal(since(), 0);

  // revoked: the sync fails, the edit stays queued
  const devices = await (await fetch(`${main}/api/mobile/devices`)).json();
  await fetch(`${main}/api/mobile/devices/${devices.find((d: any) => d.name === 'test phone').id}`, { method: 'DELETE' });
  repo.update(ID, (e) => ({ ...e, results: 'after revoke' }));
  const refused = await repo.sync();
  assert.ok(!refused.ok && /not paired/.test(refused.detail));
  assert.equal(repo.pendingCount, 1);
});
