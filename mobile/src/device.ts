import { CapacitorHttp } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { Db, Files, Http } from './repo';

// The Repo's three ports on Android. Attachments live in <files>/attachments/, which
// MainActivity serves to the WebView as /uploads/<name>, so notebook text renders unchanged.

export async function sqliteDb(): Promise<Db> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  await sqlite.checkConnectionsConsistency().catch(() => undefined);
  const db = (await sqlite.isConnection('benchflow', false)).result
    ? await sqlite.retrieveConnection('benchflow', false)
    : await sqlite.createConnection('benchflow', false, 'no-encryption', 1, false);
  await db.open();
  return {
    query: async (sql, values = []) => (await db.query(sql, values as any[])).values ?? [],
    batch: async (statements) => {
      await db.executeSet(statements.map((s) => ({ statement: s.sql, values: (s.values ?? []) as any[] })), true);
    },
  };
}

export const nativeHttp: Http = {
  json: async (method, url, token, body) => {
    const r = await CapacitorHttp.request({
      method, url, data: body, connectTimeout: 10_000, readTimeout: 60_000,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    });
    return { status: r.status, data: typeof r.data === 'string' ? safeJson(r.data) : r.data };
  },
  base64: async (url, token) => {
    const r = await CapacitorHttp.request({ method: 'GET', url, responseType: 'blob', headers: { Authorization: `Bearer ${token}` },
      connectTimeout: 10_000, readTimeout: 120_000 });
    return r.status === 200 && typeof r.data === 'string' ? r.data : null;
  },
};

function safeJson(text: string) {
  try { return JSON.parse(text); } catch { return { detail: text.slice(0, 200) }; }
}

const at = (name: string) => ({ path: `attachments/${name}`, directory: Directory.Data });

export const appFiles: Files = {
  read: async (name) => (await Filesystem.readFile(at(name)).catch(() => null))?.data as string ?? null,
  write: async (name, b64) => { await Filesystem.writeFile({ ...at(name), data: b64, recursive: true }); },
  exists: async (name) => Filesystem.stat(at(name)).then(() => true, () => false),
};
