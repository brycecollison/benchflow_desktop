import React, { useCallback, useEffect, useState } from 'react';
import { Cloud, Save, RefreshCw } from 'lucide-react';

interface LastBackup {
  at: string;
  dest: string;
  db_bytes: number;
  referenced: number;
  copied: number;
  present: number;
  missing: number;
  history: number;
  unreferenced_count: number;
  unreferenced_bytes: number;
}

interface BackupConfig {
  dir: string | null;
  configured: boolean;
  folder_exists: boolean;
  in_onedrive: boolean;
  last_backup: LastBackup | null;
}

const gb = (n: number) => (n / 1e9).toFixed(2);

export const SettingsView: React.FC = () => {
  const [bcfg, setBcfg] = useState<BackupConfig | null>(null);
  const [bdir, setBdir] = useState('');
  const [bbusy, setBbusy] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [bmsg, setBmsg] = useState<string | null>(null);
  const [bwarn, setBwarn] = useState<string | null>(null);
  const [berr, setBerr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const bres = await fetch('/api/backup/config');
      if (!bres.ok) throw new Error(`HTTP ${bres.status}`);
      const b: BackupConfig = await bres.json();
      setBcfg(b);
      setBdir(b.dir ?? '');
    } catch (e: any) {
      setBerr(`Could not load settings: ${e.message}`);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveBackup = async () => {
    setBbusy(true); setBmsg(null); setBwarn(null); setBerr(null);
    try {
      const res = await fetch('/api/backup/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: bdir }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setBwarn(data.warning ?? null);
      setBmsg(`Backed up ${data.backup.referenced} attachments, db ${gb(data.backup.db_bytes)} GB → ${data.backup.dest}`);
      await load();
    } catch (e: any) { setBerr(e.message); }
    setBbusy(false);
  };

  const backupNow = async () => {
    setBbusy(true); setBmsg(null); setBwarn(null); setBerr(null);
    try {
      const res = await fetch('/api/backup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setBmsg(`${data.copied} new attachments, db ${gb(data.db_bytes)} GB → ${data.dest}`);
      await load();
    } catch (e: any) { setBerr(e.message); }
    setBbusy(false);
  };

  const browseBackup = async () => {
    setBrowsing(true); setBerr(null);
    try {
      const res = await fetch('/api/backup/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: bdir }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      if (data.dir) setBdir(data.dir);
    } catch (e: any) { setBerr(e.message); }
    finally { setBrowsing(false); }
  };

  const blast = bcfg?.last_backup;

  return (
    <section className="flex-1 min-w-0 flex flex-col rounded-lg border border-[var(--line)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--card)] border-b border-[var(--line)]">
        <h3 className="m-0 font-semibold text-sm">Settings</h3>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
        <div className="rounded-lg border border-[var(--line)] overflow-hidden max-w-xl">
          <div className="flex items-center gap-2 px-3 py-2 bg-[var(--card)] border-b border-[var(--line)]">
            <Cloud size={15} className="text-[var(--acc)]" />
            <div className="min-w-0">
              <h4 className="m-0 font-semibold text-sm">Personal OneDrive Backup</h4>
              <span className="text-[11px] text-[var(--mut)]">
                Database snapshot plus the attachments your notebook references, copied on every shutdown. The code itself is never backed up here.
              </span>
            </div>
          </div>
          <div className="p-3 space-y-3">
            <div>
              <label htmlFor="backup-folder" className="block text-xs text-[var(--mut)]">
                Backup folder path
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="backup-folder"
                  type="text"
                  value={bdir}
                  onChange={(e) => setBdir(e.target.value)}
                  disabled={bbusy || browsing}
                  placeholder="C:\Users\you\OneDrive\BenchflowBackup"
                  className="min-w-0 flex-1 px-2 py-1.5 text-sm rounded-md border border-[var(--line)] bg-[var(--bg)] text-[var(--ink)] focus:outline-none focus:border-[var(--acc)]"
                />
                <button
                  type="button"
                  onClick={browseBackup}
                  disabled={bbusy || browsing}
                  className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-md border border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:bg-[var(--sel)] disabled:opacity-40 cursor-pointer"
                >
                  {browsing ? 'Browsing…' : 'Browse'}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={saveBackup}
                disabled={bbusy || browsing || !bdir.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-[var(--acc)] text-white disabled:opacity-40 cursor-pointer"
              >
                <Save size={13} /> Save
              </button>
              <button
                type="button"
                onClick={backupNow}
                disabled={bbusy || browsing || !bcfg?.configured}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:bg-[var(--sel)] disabled:opacity-40 cursor-pointer"
              >
                <RefreshCw size={13} /> Back up now
              </button>
            </div>

            {bmsg && <p className="m-0 text-xs text-[var(--acc)]">{bmsg}</p>}
            {bwarn && <p className="m-0 text-xs text-amber-600 dark:text-amber-400">{bwarn}</p>}
            {berr && <p className="m-0 text-xs text-red-600 dark:text-red-400">{berr}</p>}

            {bcfg?.configured && (
              <div className="text-[11px] text-[var(--mut)] space-y-0.5 pt-1 border-t border-[var(--line)]">
                <p className="m-0">
                  Folder: {bcfg.folder_exists ? 'found' : 'not found'}
                  {bcfg.dir ? ` · ${bcfg.dir}` : ''}
                  {bcfg.configured && !bcfg.in_onedrive ? ' · not inside a OneDrive folder' : ''}
                </p>
                {blast && (
                  <p className="m-0">
                    Last backup: db {gb(blast.db_bytes)} GB, {blast.referenced} attachments
                    ({blast.copied} new{blast.missing > 0 ? `, ${blast.missing} missing` : ''}), {blast.history} snapshots
                    {' · '}{new Date(blast.at).toLocaleString()}
                  </p>
                )}
                {blast && blast.unreferenced_count > 0 && (
                  <p className="m-0">
                    {blast.unreferenced_count} files in uploads/ ({gb(blast.unreferenced_bytes)} GB) are not referenced by
                    any notebook content, so they are listed in manifest.json and not copied.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
