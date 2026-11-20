import React, { useCallback, useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Smartphone } from 'lucide-react';
import { useLabStore } from '../../store/useLabStore';

interface Setup { installed: boolean; url: string | null; served: boolean; sync_port: number }
interface Device { id: string; name: string; paired_at: string; revoked: boolean }
interface Pairing { code: string; expires_in: number }

const button = 'px-3 py-1.5 text-xs font-semibold rounded-md border border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:bg-[var(--sel)] disabled:opacity-40 cursor-pointer';

/** Settings card: publish the sync endpoint on the tailnet, pair phones (QR), revoke them, and
 * settle sync conflicts. docs/adr/0002-mobile-sync.md */
export const PhoneSyncCard: React.FC = () => {
  const { conflicts, resolveConflict } = useLabStore();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, init);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    return data;
  };
  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([call('/api/mobile/setup'), call('/api/mobile/devices')]);
      setSetup(s);
      setDevices(d);
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e: any) { setError(e.message); }
    setBusy(false);
  };
  const publish = run(async () => setSetup(await call('/api/mobile/serve', { method: 'POST' })));
  const startPairing = run(async () => setPairing(await call('/api/mobile/pairing', { method: 'POST' })));
  const revoke = (id: string) => run(async () => {
    await call(`/api/mobile/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  })();

  const link = setup?.url && pairing
    ? `org.benchflow.companion://pair?url=${encodeURIComponent(setup.url)}&code=${encodeURIComponent(pairing.code)}`
    : null;
  const qrSvg = link ? (() => { const qr = qrcode(0, 'M'); qr.addData(link); qr.make(); return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); })() : null;

  return (
    <div className="rounded-lg border border-[var(--line)] overflow-hidden max-w-xl">
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--card)] border-b border-[var(--line)]">
        <Smartphone size={15} className="text-[var(--acc)]" />
        <div className="min-w-0">
          <h4 className="m-0 font-semibold text-sm">Phone sync</h4>
          <span className="text-[11px] text-[var(--mut)]">
            The Benchflow phone app syncs with this computer over your Tailscale network while this window
            is open. Edits made on the phone while this computer is closed wait on the phone.
          </span>
        </div>
      </div>
      <div className="p-3 space-y-3 text-xs">
        {setup && !setup.installed && (
          <p className="m-0">Tailscale is not installed or not signed in on this computer. Install it from tailscale.com,
            sign in, and turn on HTTPS certificates for your tailnet.</p>
        )}
        {setup?.installed && (
          <div className="space-y-2">
            <p className="m-0 text-[var(--mut)]">
              Address: {setup.url ?? 'unknown'} · {setup.served ? 'published on your tailnet' : 'not published yet'}
            </p>
            <div className="flex gap-2">
              {!setup.served && <button type="button" className={button} disabled={busy} onClick={publish}>Publish on tailnet</button>}
              <button type="button" className={button} disabled={busy || !setup.served} onClick={startPairing}>Pair a phone</button>
            </div>
          </div>
        )}
        {qrSvg && pairing && (
          <div className="flex gap-3 items-start">
            <div aria-label="Pairing QR code" className="w-40 shrink-0 bg-white p-1 rounded" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <div className="space-y-1">
              <p className="m-0">Scan with the phone app (Sync &gt; Scan), or enter by hand:</p>
              <p className="m-0 font-mono break-all">{setup?.url}</p>
              <p className="m-0">Code: <span className="font-mono text-sm font-semibold">{pairing.code}</span></p>
              <p className="m-0 text-[var(--mut)]">Works once, for {Math.round(pairing.expires_in / 60)} minutes.</p>
            </div>
          </div>
        )}
        {devices.length > 0 && (
          <ul className="m-0 p-0 list-none space-y-1">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate">{d.name} · paired {new Date(d.paired_at).toLocaleDateString()}</span>
                {d.revoked ? <span className="text-[var(--mut)]">revoked</span>
                  : <button type="button" className={button} disabled={busy} onClick={() => revoke(d.id)}>Revoke</button>}
              </li>
            ))}
          </ul>
        )}
        {conflicts.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-[var(--line)]">
            <p className="m-0 font-semibold">Sync conflicts ({conflicts.length})</p>
            {conflicts.map((c) => (
              <div key={c.id} className="rounded border border-[var(--line)] p-2 space-y-1">
                <p className="m-0">{c.experiment_name || c.experiment_id} · {c.unit} · {c.source === 'phone' ? 'phone edit set aside' : c.source}</p>
                {typeof c.parked === 'string' && <pre className="m-0 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] bg-[var(--bg)] p-1 rounded">{c.parked}</pre>}
                <div className="flex gap-2">
                  {c.source !== 'restored' && <button type="button" className={button} onClick={() => void resolveConflict(c.id, 'other')}>Use the set-aside version</button>}
                  <button type="button" className={button} onClick={() => void resolveConflict(c.id, 'keep')}>Keep current</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {error && <p className="m-0 text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
};
