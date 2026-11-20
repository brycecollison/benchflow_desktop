import type { Experiment } from '../../frontend/src/types/lab.ts';
import { diffUnits, phoneMayEdit, stable, withUnits } from './units.ts';

// The phone's notebook. What the desktop last sent is stored per record (the base); every edit
// becomes an op in a queue; what the screen shows is base + queued ops. A sync pushes the queue,
// pulls what changed, and in one transaction stores the new bases and drops the ops the desktop
// took. Nothing is merged here: the desktop merges (docs/adr/0002-mobile-sync.md).

export interface Db {
  query(sql: string, values?: unknown[]): Promise<any[]>;
  /** All statements in one transaction. */
  batch(statements: { sql: string; values?: unknown[] }[]): Promise<void>;
}
export interface Http {
  json(method: 'GET' | 'POST', url: string, token?: string, body?: unknown): Promise<{ status: number; data: any }>;
  /** File body as base64, or null when it is not there. */
  base64(url: string, token: string): Promise<string | null>;
}
export interface Files {
  read(name: string): Promise<string | null>;
  write(name: string, base64: string): Promise<void>;
  exists(name: string): Promise<boolean>;
}

export interface Op { op_id: string; experiment_id: string; unit: string; base_value: unknown; new_value: unknown; at: string; seq: number }
export interface Desktop { url: string; token: string; desktopId: string }
export interface ProjectRec { id: string; name: string; archived: boolean; rev: number }
export interface ProjectView { id: string; name: string; archived: boolean; exps: Experiment[] }
export interface Conflict { id: string; experiment_id: string; experiment_name: string; unit: string; kept: unknown; parked: unknown; source: string; created_at: string }
export interface SyncResult { at: string; ok: boolean; detail: string; applied?: number; conflicts?: number }

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, rev INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (kind, id))',
  'CREATE TABLE IF NOT EXISTS ops (op_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS uploads (name TEXT PRIMARY KEY, filename TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
];
const FLUSH_MS = 400; // edits reach the disk within this; also flushed when the app is paused

const meta = (key: string, value: unknown) => ({ sql: 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', values: [key, JSON.stringify(value)] });
const uuid = () => crypto.randomUUID().replace(/-/g, '');

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Same name the desktop gives an upload (backend/app/mobile_sync/api.py upload_name). */
export async function uploadName(b64: string, filename: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', base64ToBytes(b64) as BufferSource));
  const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  const original = filename.replace(/\\/g, '/').split('/').pop() || '';
  return `${hex.slice(0, 16)}_${original.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120) || 'upload'}`;
}

const MD_ANGLE = /\]\(<\/uploads\/([^>\n]+)>/g; // ![x](</uploads/name with spaces (1).png> "title")
const MD_BARE = /\]\(\/uploads\/([^\s)]+)/g; // ![x](/uploads/name.png), percent-encoded

/** /uploads/<name> files an experiment shows: block images and previews, and links in its text.
 * Not raw_url: that is the original (a TIFF can be 15 MB), and nothing on the phone displays it. */
export function attachmentRefs(exp: Experiment): string[] {
  const names = new Set<string>();
  const up = (v: unknown) => typeof v === 'string' && v.startsWith('/uploads/') && names.add(v.slice(9));
  for (const b of exp.blocks ?? []) { up((b as any).src); up((b as any).preview_url); }
  const text = (v: unknown) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(MD_ANGLE)) names.add(m[1]);
      for (const m of v.matchAll(MD_BARE)) names.add(decodeOr(m[1]));
    } else if (Array.isArray(v)) v.forEach(text);
    else if (v && typeof v === 'object') Object.values(v).forEach(text);
  };
  text({ ...exp, blocks: undefined });
  return [...names];
}

const decodeOr = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

export class Repo {
  deviceId = '';
  desktops: Desktop[] = [];
  lastSync: SyncResult | null = null;
  conflicts: Conflict[] = [];
  projects = new Map<string, ProjectRec>();
  private bases = new Map<string, { exp: Experiment; projectId: string; rev: number }>();
  private ops: Op[] = [];
  private uploads: { name: string; filename: string }[] = [];
  private since = 0;
  private seq = 0;
  private dirtyOps = new Set<string>();
  private droppedOps = new Set<string>();
  private sending = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private syncing: Promise<SyncResult> | null = null;
  private listeners = new Set<() => void>();
  private viewCache: ProjectView[] | null = null;
  version = 0;

  private db: Db;
  private http: Http;
  private files: Files;

  constructor(db: Db, http: Http, files: Files) {
    this.db = db;
    this.http = http;
    this.files = files;
  }

  async open(): Promise<void> {
    await this.db.batch(SCHEMA.map((sql) => ({ sql })));
    for (const r of await this.db.query('SELECT kind, rev, json FROM records')) {
      const v = JSON.parse(r.json);
      if (r.kind === 'project') this.projects.set(v.id, v);
      else this.bases.set(v.exp.id, v);
    }
    this.ops = (await this.db.query('SELECT json FROM ops ORDER BY seq')).map((r) => JSON.parse(r.json));
    this.seq = Math.max(0, ...this.ops.map((o) => o.seq));
    this.uploads = await this.db.query('SELECT name, filename FROM uploads');
    const m = Object.fromEntries((await this.db.query('SELECT key, value FROM meta')).map((r) => [r.key, JSON.parse(r.value)]));
    this.since = m.since ?? 0;
    this.desktops = m.desktops ?? [];
    this.lastSync = m.last_sync ?? null;
    this.conflicts = m.conflicts ?? [];
    this.deviceId = m.device_id ?? `phone-${uuid().slice(0, 12)}`;
    if (!m.device_id) await this.db.batch([meta('device_id', this.deviceId)]);
    this.changed();
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private changed() {
    this.version++;
    this.viewCache = null;
    this.listeners.forEach((fn) => fn());
  }

  get pendingCount() { return this.ops.length + this.uploads.length; }

  experiment(id: string): Experiment | undefined {
    const base = this.bases.get(id);
    if (!base) return undefined;
    const mine = this.ops.filter((o) => o.experiment_id === id);
    return mine.length ? withUnits(base.exp, mine.map((o) => ({ unit: o.unit, value: o.new_value }))) : base.exp;
  }

  view(): ProjectView[] {
    if (this.viewCache) return this.viewCache;
    const exps = new Map<string, Experiment[]>();
    for (const [id, b] of this.bases) {
      if (!exps.has(b.projectId)) exps.set(b.projectId, []);
      exps.get(b.projectId)!.push(this.experiment(id)!);
    }
    this.viewCache = [...this.projects.values()].map((p) => ({ id: p.id, name: p.name, archived: p.archived, exps: exps.get(p.id) ?? [] }));
    return this.viewCache;
  }

  /** Edit an experiment: each changed unit becomes an op, or updates the unsent op for that unit. */
  update(expId: string, edit: (e: Experiment) => Experiment): void {
    const before = this.experiment(expId);
    if (!before) return;
    const changes = diffUnits(before, edit(before)).filter((c) => phoneMayEdit(c.unit));
    if (!changes.length) return;
    const at = new Date().toISOString();
    for (const c of changes) {
      const last = [...this.ops].reverse().find((o) => o.experiment_id === expId && o.unit === c.unit);
      if (last && !this.sending.has(last.op_id)) {
        last.new_value = c.after;
        last.at = at;
        if (stable(last.new_value) === stable(last.base_value)) { // edited back: nothing to send
          this.ops = this.ops.filter((o) => o !== last);
          this.droppedOps.add(last.op_id);
          this.dirtyOps.delete(last.op_id);
        } else this.dirtyOps.add(last.op_id);
      } else {
        const op = { op_id: uuid(), experiment_id: expId, unit: c.unit, base_value: c.before, new_value: c.after, at, seq: ++this.seq };
        this.ops.push(op);
        this.dirtyOps.add(op.op_id);
      }
    }
    this.changed();
    if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), FLUSH_MS);
  }

  async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const write = this.ops.filter((o) => this.dirtyOps.has(o.op_id));
    const drop = [...this.droppedOps];
    this.dirtyOps.clear();
    this.droppedOps.clear();
    if (!write.length && !drop.length) return;
    await this.db.batch([
      ...write.map((o) => ({ sql: 'INSERT OR REPLACE INTO ops (op_id, seq, json) VALUES (?, ?, ?)', values: [o.op_id, o.seq, JSON.stringify(o)] })),
      ...drop.map((id) => ({ sql: 'DELETE FROM ops WHERE op_id = ?', values: [id] })),
    ]);
  }

  async pair(url: string, code: string, name: string): Promise<void> {
    url = url.trim().replace(/\/+$/, '');
    const r = await this.http.json('POST', `${url}/api/mobile/pair`, undefined, { code: code.trim(), device_id: this.deviceId, name });
    if (r.status !== 200) throw new Error(r.data?.detail || `Pairing failed (HTTP ${r.status})`);
    // A computer not seen before may hold another notebook: pull it all, not just what changed after our rev.
    if (!this.desktops.some((d) => d.desktopId === r.data.desktop_id)) this.since = 0;
    this.desktops = [...this.desktops.filter((d) => d.url !== url && d.desktopId !== r.data.desktop_id),
      { url, token: r.data.token, desktopId: r.data.desktop_id }];
    await this.db.batch([meta('desktops', this.desktops), meta('since', this.since)]);
    this.changed();
  }

  async unpair(url: string): Promise<void> {
    this.desktops = this.desktops.filter((d) => d.url !== url);
    await this.db.batch([meta('desktops', this.desktops)]);
    this.changed();
  }

  /** A photo taken on the phone: stored under the name the desktop will give it, queued for upload. */
  async addFile(filename: string, b64: string): Promise<string> {
    const name = await uploadName(b64, filename);
    if (!(await this.files.exists(name))) await this.files.write(name, b64);
    if (!this.uploads.some((u) => u.name === name)) {
      await this.db.batch([{ sql: 'INSERT OR REPLACE INTO uploads (name, filename) VALUES (?, ?)', values: [name, filename] }]);
      this.uploads.push({ name, filename });
      this.changed();
    }
    return name;
  }

  sync(): Promise<SyncResult> {
    this.syncing ??= this.syncOnce().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private async syncOnce(): Promise<SyncResult> {
    await this.flush();
    let detail = this.desktops.length ? '' : 'Not paired with a computer yet';
    for (const d of this.desktops) {
      try {
        return this.finish(await this.syncWith(d));
      } catch (e) {
        detail = `${d.url}: ${(e as Error).message}`;
      } finally {
        this.sending.clear();
      }
    }
    return this.finish({ at: new Date().toISOString(), ok: false, detail });
  }

  private async finish(result: SyncResult): Promise<SyncResult> {
    this.lastSync = result;
    await this.db.batch([meta('last_sync', result)]);
    this.changed();
    return result;
  }

  /** One push + pull against one computer. */
  private async syncWith(d: Desktop): Promise<SyncResult> {
    const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
      const r = await this.http.json(method, d.url + path, d.token, body);
      if (r.status === 401) throw new Error('this phone is not paired with that computer any more; pair again');
      if (r.status !== 200) throw new Error(r.data?.detail || `HTTP ${r.status}`);
      return r.data;
    };
    for (const u of [...this.uploads]) { // before the ops that point at them
      const data = await this.files.read(u.name);
      if (data !== null) await call('POST', '/api/mobile/uploads', { filename: u.filename, data });
      await this.db.batch([{ sql: 'DELETE FROM uploads WHERE name = ?', values: [u.name] }]);
      this.uploads = this.uploads.filter((x) => x.name !== u.name);
    }
    const batch = this.ops.slice(0, 500);
    batch.forEach((o) => this.sending.add(o.op_id));
    const pushed = await call('POST', '/api/mobile/ops', { ops: batch.map(({ seq: _seq, ...o }) => o) });
    if (pushed.deferred) throw new Error(`${pushed.detail || 'The computer deferred the sync'} Your edits are kept here.`);
    const acked = new Set<string>(pushed.results.map((r: { op_id: string }) => r.op_id));
    const changes = await call('GET', `/api/mobile/changes?since=${this.since}`);
    const conflicts: Conflict[] = await call('GET', '/api/mobile/conflicts');

    const keep = new Set(this.ops.filter((o) => !acked.has(o.op_id)).map((o) => o.experiment_id));
    const gone = changes.deleted.filter((t: any) => !(t.kind === 'experiment' && keep.has(t.id))); // a pending edit restores it
    await this.db.batch([
      ...changes.projects.map((p: any) => ({ sql: 'INSERT OR REPLACE INTO records (kind, id, rev, json) VALUES (?, ?, ?, ?)',
        values: ['project', p.id, p.rev, JSON.stringify({ id: p.id, name: p.name, archived: p.archived, rev: p.rev })] })),
      ...changes.experiments.map(({ projectId, rev, ...exp }: any) => ({ sql: 'INSERT OR REPLACE INTO records (kind, id, rev, json) VALUES (?, ?, ?, ?)',
        values: ['experiment', exp.id, rev, JSON.stringify({ exp, projectId, rev })] })),
      ...gone.map((t: any) => ({ sql: 'DELETE FROM records WHERE kind = ? AND id = ?', values: [t.kind, t.id] })),
      ...[...acked].map((id) => ({ sql: 'DELETE FROM ops WHERE op_id = ?', values: [id] })),
      meta('since', changes.rev),
      meta('conflicts', conflicts),
    ]);
    for (const p of changes.projects) this.projects.set(p.id, { id: p.id, name: p.name, archived: p.archived, rev: p.rev });
    for (const { projectId, rev, ...exp } of changes.experiments) this.bases.set(exp.id, { exp, projectId, rev });
    for (const t of gone) (t.kind === 'project' ? this.projects : this.bases).delete(t.id);
    this.ops = this.ops.filter((o) => !acked.has(o.op_id));
    this.since = changes.rev;
    this.conflicts = conflicts;
    const results: { result: string }[] = pushed.results;
    return { at: new Date().toISOString(), ok: true, detail: `Synced with ${d.url}`,
      applied: results.length, conflicts: results.filter((r) => r.result === 'conflict').length };
  }

  async resolveConflict(id: string, choice: 'keep' | 'other'): Promise<void> {
    const d = this.desktops[0];
    if (!d) return;
    const r = await this.http.json('POST', `${d.url}/api/mobile/conflicts/${encodeURIComponent(id)}/resolve`, d.token, { choice });
    if (r.status !== 200) throw new Error(r.data?.detail || `HTTP ${r.status}`);
    await this.sync();
  }

  /** Download the attachments these experiments use, so they show offline. Best effort. */
  async fetchAttachments(exps: Experiment[]): Promise<number> {
    const d = this.desktops[0];
    if (!d) return 0;
    let got = 0;
    for (const name of new Set(exps.flatMap(attachmentRefs))) {
      if (await this.files.exists(name)) continue;
      const data = await this.http.base64(`${d.url}/api/mobile/uploads/${encodeURIComponent(name)}`, d.token).catch(() => null);
      if (data !== null) { await this.files.write(name, data); got++; }
    }
    return got;
  }
}
