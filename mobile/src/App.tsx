import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { App as CapApp } from '@capacitor/app';
import { GlobalDialogModal } from '../../frontend/src/components/Modal/GlobalDialogModal';
import { getExperimentPhaseData, getExperimentPhases, type ELNBlock } from '../../frontend/src/types/lab';
import { STATUS_LIST } from '../../frontend/src/utils/colors';
import { withDeviation, withExperimentUpdates, withPhaseUpdate } from '../../frontend/src/utils/experimentUpdates';
import { alertDialog, confirmDialog } from '../../frontend/src/store/useDialogStore';
import { isoDay, toIsoDay } from '../../frontend/src/utils/schedule';
import { buildAgenda, type AgendaRow } from './agenda';
import { photo } from './photo';
import type { Conflict, Repo } from './repo';

// The same editor the desktop uses.
const SectionTextEditor = lazy(() => import('../../frontend/src/components/Modal/SectionTextEditor')
  .then((m) => ({ default: m.SectionTextEditor })));

type Screen = { kind: 'phase'; expId: string; phaseKey: string } | { kind: 'experiment'; expId: string };

// The desktop editor's TipTap instance (its types come from frontend/node_modules).
type EditorLike = { chain: () => any };

const SYNC_EVERY_MS = 60_000;
const SYNC_AFTER_EDIT_MS = 5_000;

/** Images shown before their file was downloaded stay broken; setting src again reloads them. */
const reloadBrokenImages = (got: number) => {
  if (got) document.querySelectorAll<HTMLImageElement>('img[src^="/uploads/"]').forEach((i) => { if (!i.naturalWidth) i.src = i.src; });
};

function useRepo(repo: Repo) {
  useSyncExternalStore(repo.subscribe, repo.getVersion);
  return repo;
}

/** org.benchflow.companion://pair?url=...&code=... (the QR code in desktop Settings > Phone sync) */
export function parsePairLink(link: string): { url: string; code: string } | null {
  try {
    const u = new URL(link);
    const url = u.searchParams.get('url');
    const code = u.searchParams.get('code');
    return u.protocol === 'org.benchflow.companion:' && url && code ? { url, code } : null;
  } catch { return null; }
}

export function App({ repo }: { repo: Repo }) {
  useRepo(repo);
  const [tab, setTab] = useState<'agenda' | 'sync'>('agenda');
  const [stack, setStack] = useState<Screen[]>([]);
  const open = (s: Screen) => setStack((st) => [...st, s]);
  const top = stack[stack.length - 1];

  const pairFrom = useCallback(async (link: string) => {
    const p = parsePairLink(link);
    if (!p) return;
    if (!(await confirmDialog({ title: 'Pair with this computer?', message: p.url, confirmLabel: 'Pair' }))) return;
    try {
      await repo.pair(p.url, p.code, 'Phone');
      setTab('sync');
      void repo.sync();
    } catch (e) { await alertDialog({ title: 'Pairing failed', message: (e as Error).message, variant: 'danger' }); }
  }, [repo]);

  useEffect(() => {
    const subs = [
      CapApp.addListener('backButton', () => (stack.length ? setStack((st) => st.slice(0, -1)) : CapApp.exitApp())),
      CapApp.addListener('pause', () => void repo.flush()),
      CapApp.addListener('resume', () => void repo.sync()),
      CapApp.addListener('appUrlOpen', ({ url }) => void pairFrom(url)),
    ];
    return () => { subs.forEach((h) => void h.then((x) => x.remove())); };
  }, [stack.length, repo, pairFrom]);

  useEffect(() => {
    void CapApp.getLaunchUrl().then((l) => { if (l?.url) void pairFrom(l.url); });
    const soon = () => repo.sync().then((r) => {
      if (!r.ok) return;
      // attachments for what is on the bench this week, so they show without a network
      const agenda = buildAgenda(repo.view());
      const week = isoDay(new Date(Date.now() + 7 * 86_400_000));
      void repo.fetchAttachments([...agenda.today, ...agenda.upcoming.filter((a) => a.start <= week)].map((a) => a.exp)).then(reloadBrokenImages);
    });
    void soon();
    const every = setInterval(soon, SYNC_EVERY_MS);
    let afterEdit: ReturnType<typeof setTimeout> | null = null;
    let pending = repo.pendingCount;
    const unsub = repo.subscribe(() => {
      if (repo.pendingCount > pending && !afterEdit) afterEdit = setTimeout(() => { afterEdit = null; void repo.sync(); }, SYNC_AFTER_EDIT_MS);
      pending = repo.pendingCount;
    });
    return () => { clearInterval(every); unsub(); if (afterEdit) clearTimeout(afterEdit); };
  }, [repo, pairFrom]);

  return (
    <div className="h-full flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {top?.kind === 'phase' ? <PhaseScreen key={top.expId + top.phaseKey} repo={repo} expId={top.expId} phaseKey={top.phaseKey}
        onBack={() => setStack((s) => s.slice(0, -1))} onOpenExperiment={() => open({ kind: 'experiment', expId: top.expId })} />
        : top?.kind === 'experiment' ? <ExperimentScreen key={top.expId} repo={repo} expId={top.expId}
          onBack={() => setStack((s) => s.slice(0, -1))} onOpenPhase={(phaseKey) => open({ kind: 'phase', expId: top.expId, phaseKey })} />
          : (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {tab === 'agenda'
                  ? <AgendaScreen repo={repo} onOpen={(r) => open({ kind: 'phase', expId: r.exp.id, phaseKey: r.phaseKey })}
                    onOpenExperiment={(expId) => open({ kind: 'experiment', expId })} />
                  : <SyncScreen repo={repo} onPairLink={pairFrom} />}
              </div>
              <nav className="flex border-t border-[var(--line)] bg-[var(--card)]">
                {(['agenda', 'sync'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} className={`flex-1 !rounded-none !border-0 ${tab === t ? '!text-[var(--acc)] font-semibold' : ''}`}>
                    {t === 'agenda' ? 'Agenda' : `Sync${repo.pendingCount ? ` (${repo.pendingCount})` : ''}${repo.conflicts.length ? ' !' : ''}`}
                  </button>
                ))}
              </nav>
            </>
          )}
      <GlobalDialogModal />
    </div>
  );
}

function AgendaScreen({ repo, onOpen, onOpenExperiment }: { repo: Repo; onOpen: (r: AgendaRow) => void; onOpenExperiment: (id: string) => void }) {
  const projects = repo.view();
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const q = query.trim().toLowerCase();
  const agenda = useMemo(() => buildAgenda(projects
    .filter((p) => !projectId || p.id === projectId)
    .map((p) => ({ ...p, exps: p.exps.filter((e) => !q || e.name.toLowerCase().includes(q)) }))), [projects, projectId, q]);
  const keep = (rows: AgendaRow[]) => (hideDone ? rows.filter((r) => !r.completed) : rows);
  const matches = q ? projects.filter((p) => !p.archived).flatMap((p) => p.exps.filter((e) => e.name.toLowerCase().includes(q))) : [];

  if (!projects.length) {
    return <p className="p-6 text-[var(--mut)]">No notebook yet. Pair with your computer in the Sync tab; the notebook arrives with the first sync.</p>;
  }
  const section = (title: string, rows: AgendaRow[]) => (
    <section>
      <h2 className="px-4 pt-4 pb-1 text-xs uppercase tracking-wide text-[var(--mut)]">{title} ({rows.length})</h2>
      {rows.map((r) => (
        <button key={r.exp.id + r.phaseKey} onClick={() => onOpen(r)}
          className={`w-full !justify-start text-left !rounded-none !border-0 !border-b !border-[var(--line)] !px-4 !py-3 ${r.completed ? 'opacity-50' : ''}`}>
          <span className="flex flex-col min-w-0">
            <span className="font-medium truncate">{r.exp.name}</span>
            <span className="text-sm text-[var(--mut)] truncate">{r.label} · {r.projectName}</span>
            <span className="text-sm text-[var(--mut)]">{r.start}{r.end !== r.start ? ` → ${r.end}` : ''}{r.completed ? ' · done' : ''}</span>
          </span>
        </button>
      ))}
    </section>
  );
  return (
    <div>
      <div className="p-3 space-y-2 border-b border-[var(--line)]">
        <input className="w-full" type="search" placeholder="Search experiments" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex gap-2 items-center">
          <select className="flex-1 min-w-0" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
            <option value="">All projects</option>
            {projects.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label className="flex items-center gap-1 text-sm shrink-0"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide done</label>
        </div>
      </div>
      {matches.length > 0 && (
        <section>
          <h2 className="px-4 pt-4 pb-1 text-xs uppercase tracking-wide text-[var(--mut)]">Experiments ({matches.length})</h2>
          {matches.map((e) => (
            <button key={e.id} onClick={() => onOpenExperiment(e.id)} className="w-full !justify-start text-left !rounded-none !border-0 !border-b !border-[var(--line)] !px-4 !py-3">
              <span className="font-medium truncate">{e.name}</span>
            </button>
          ))}
        </section>
      )}
      {section('Today', keep(agenda.today))}
      {section('Upcoming', keep(agenda.upcoming))}
      <button className="m-4" onClick={() => setShowPast(!showPast)}>{showPast ? 'Hide' : 'Show'} past ({keep(agenda.past).length})</button>
      {showPast && section('Past', keep(agenda.past))}
    </div>
  );
}

function Header({ title, subtitle, onBack, onTitle }: { title: string; subtitle?: string; onBack: () => void; onTitle?: () => void }) {
  return (
    <header className="phone-header flex items-center gap-2 px-2 py-1 border-b border-[var(--line)] bg-[var(--card)]">
      <button className="!border-0" onClick={onBack} aria-label="Back">←</button>
      <button className="min-w-0 !border-0 !p-0 !justify-start text-left flex-1" onClick={onTitle} disabled={!onTitle}>
        <span className="flex flex-col min-w-0">
          <span className="font-medium truncate">{title}</span>
          {subtitle && <span className="text-sm text-[var(--mut)] truncate">{subtitle}</span>}
        </span>
      </button>
    </header>
  );
}

/** "customPhases/<id>/content" -> the phase's name; other units -> their section name, else as stored. */
function unitLabel(repo: Repo, c: Conflict): string {
  const exp = repo.experiment(c.experiment_id);
  const key = c.unit.startsWith('customPhases/') ? c.unit.split('/')[1] : c.unit;
  if (exp && getExperimentPhases(exp).includes(key)) return getExperimentPhaseData(exp, key).label;
  return [...SECTIONS, ...AFTER].find(([k]) => k === key)?.[1] ?? c.unit;
}

function ConflictCards({ repo, conflicts }: { repo: Repo; conflicts: Conflict[] }) {
  const resolve = (id: string, choice: 'keep' | 'other') => repo.resolveConflict(id, choice)
    .catch((e) => alertDialog({ title: 'Could not resolve', message: (e as Error).message, variant: 'danger' }));
  return (
    <>
      {conflicts.map((c) => (
        <div key={c.id} role="alert" className="rounded-lg border border-amber-400 p-2 space-y-2 text-sm">
          <p className="m-0">{c.experiment_name} · {unitLabel(repo, c)}: {c.source === 'phone' ? 'your phone edit overlapped a desktop edit and was set aside' : `set aside (${c.source})`}.</p>
          {typeof c.parked === 'string' && <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap text-xs bg-[var(--bg)] p-1 rounded">{c.parked}</pre>}
          <div className="flex gap-2 flex-wrap">
            {c.source !== 'restored' && <button onClick={() => void resolve(c.id, 'other')}>Use set-aside version</button>}
            <button onClick={() => void resolve(c.id, 'keep')}>Keep current</button>
          </div>
        </div>
      ))}
    </>
  );
}

function useWakeLock() {
  const [on, setOn] = useState(false);
  const lock = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    if (!on) return;
    const take = () => navigator.wakeLock?.request('screen').then((l) => { lock.current = l; }).catch(() => setOn(false));
    void take();
    const again = () => { if (document.visibilityState === 'visible') void take(); };
    document.addEventListener('visibilitychange', again);
    return () => { document.removeEventListener('visibilitychange', again); void lock.current?.release(); lock.current = null; };
  }, [on]);
  return { supported: 'wakeLock' in navigator, on, setOn };
}

function PhaseScreen({ repo, expId, phaseKey, onBack, onOpenExperiment }: { repo: Repo; expId: string; phaseKey: string; onBack: () => void; onOpenExperiment: () => void }) {
  useRepo(repo);
  const exp = repo.experiment(expId);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [deviation, setDeviation] = useState('');
  const editor = useRef<EditorLike | null>(null);
  const onEditor = useCallback((e: unknown) => { editor.current = e as EditorLike; }, []);
  const awake = useWakeLock();
  useEffect(() => { if (exp) void repo.fetchAttachments([exp]).then(reloadBrokenImages); }, [repo, expId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!exp) return <div className="p-4"><button onClick={onBack}>← Back</button><p>This experiment is no longer in the notebook.</p></div>;
  const phase = getExperimentPhaseData(exp, phaseKey);
  const set = (data: Parameters<typeof withPhaseUpdate>[2]) => repo.update(expId, (e) => withPhaseUpdate(e, phaseKey, data));
  const attachments = exp.blocks.filter((b: ELNBlock) => b.section === phaseKey || b.phase === phaseKey);
  const addPhoto = async (file: File) => {
    const { filename, base64 } = await photo(file);
    const name = await repo.addFile(filename, base64);
    const src = `/uploads/${name}`;
    repo.update(expId, (e) => ({ ...e, blocks: [...e.blocks, { id: crypto.randomUUID(), type: 'img', name: filename, src, section: phaseKey, phase: phaseKey } as ELNBlock] }));
    return src;
  };
  const stamp = () => {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    editor.current?.chain().focus().insertContent([{ type: 'text', text: hhmm, marks: [{ type: 'bold' }] }, { type: 'text', text: ' ' }]).run();
  };
  const conflicts = repo.conflicts.filter((c) => c.experiment_id === expId && (c.unit === phaseKey || c.unit.startsWith(`customPhases/${phaseKey}/`)));

  return (
    <div className="h-full flex flex-col min-h-0">
      <Header title={exp.name} subtitle={`${phase.label}${phase.completed ? ' · done' : ''}`} onBack={onBack} onTitle={onOpenExperiment} />
      <div className="flex items-center gap-1 border-b border-[var(--line)] bg-[var(--bg)]">
        <div ref={setToolbar} className="flex-1 min-w-0" />
        <button className="shrink-0 !border-0" onMouseDown={(e) => e.preventDefault()} onClick={stamp} aria-label="Insert time">🕒</button>
      </div>
      <div data-experiment-scroll className="flex-1 overflow-y-auto p-3 space-y-4">
        <ConflictCards repo={repo} conflicts={conflicts} />
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label>Start<input className="w-full" type="date" value={toIsoDay(phase.startDate)} onChange={(e) => set({ startDate: e.target.value })} /></label>
          <label>End<input className="w-full" type="date" value={toIsoDay(phase.endDate)} onChange={(e) => set({ endDate: e.target.value })} /></label>
          <label>Duration<input className="w-full" value={phase.duration} onChange={(e) => set({ duration: e.target.value })} /></label>
          <label className="flex items-center gap-2 pt-5"><input type="checkbox" checked={phase.completed} onChange={(e) => set({ completed: e.target.checked })} /> Completed</label>
        </div>
        {awake.supported && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={awake.on} onChange={(e) => awake.setOn(e.target.checked)} /> Keep screen on</label>}
        <Suspense fallback={<p className="text-sm text-[var(--mut)]">Loading editor…</p>}>
          <SectionTextEditor label={phase.label} value={phase.content} onChange={(content) => set({ content })}
            toolbarTarget={toolbar} toolbarActive onActivate={() => {}} onEnlargeImage={() => {}} onEditor={onEditor}
            onUploadImage={addPhoto} />
        </Suspense>
        <section className="space-y-2">
          <h3 className="m-0 text-sm font-semibold">Deviations</h3>
          {(exp.deviations?.[phaseKey] || []).map((d) => (
            <p key={d.id} className="m-0 text-sm"><span className="text-[var(--mut)]">{new Date(d.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span> {d.text}</p>
          ))}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (deviation.trim()) repo.update(expId, (x) => withDeviation(x, phaseKey, deviation, repo.deviceId)); setDeviation(''); }}>
            <input className="flex-1 min-w-0" value={deviation} onChange={(e) => setDeviation(e.target.value)} placeholder="What differed from the plan?" />
            <button type="submit" disabled={!deviation.trim()}>Log</button>
          </form>
        </section>
        <section className="space-y-2">
          <h3 className="m-0 text-sm font-semibold">Attachments ({attachments.length})</h3>
          <div className="grid grid-cols-3 gap-2">
            {attachments.map((b) => b.type === 'img'
              ? <img key={b.id} src={b.preview_url || b.src} alt={b.name} className="w-full aspect-square object-cover rounded" />
              : <span key={b.id} className="text-xs break-all">{b.name || b.type}</span>)}
          </div>
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--line)] text-sm">
            Add photo
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void addPhoto(file).catch((err) => alertDialog({ title: 'Photo not added', message: (err as Error).message, variant: 'danger' }));
            }} />
          </label>
        </section>
      </div>
    </div>
  );
}

const SECTIONS: [string, string][] = [['purpose', 'Purpose'], ['expectedResults', 'Expected results'], ['experimentalDesign', 'Experimental design']];
const AFTER: [string, string][] = [['results', 'Results'], ['notes', 'Notes']];

function ExperimentScreen({ repo, expId, onBack, onOpenPhase }: { repo: Repo; expId: string; onBack: () => void; onOpenPhase: (k: string) => void }) {
  useRepo(repo);
  const exp = repo.experiment(expId);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [active, setActive] = useState('purpose');
  if (!exp) return <div className="p-4"><button onClick={onBack}>← Back</button><p>This experiment is no longer in the notebook.</p></div>;
  const text = ([key, label]: [string, string]) => (
    <section key={key} className="space-y-1">
      <h3 className="m-0 text-sm font-semibold">{label}</h3>
      <ConflictCards repo={repo} conflicts={repo.conflicts.filter((c) => c.experiment_id === expId && c.unit === key)} />
      <Suspense fallback={<p className="text-sm text-[var(--mut)]">Loading editor…</p>}>
        <SectionTextEditor label={label} value={(exp as any)[key] || ''} onChange={(v) => repo.update(expId, (e) => withExperimentUpdates(e, { [key]: v }))}
          toolbarTarget={toolbar} toolbarActive={active === key} onActivate={() => setActive(key)} onEnlargeImage={() => {}}
          onUploadImage={() => Promise.reject(new Error('Add photos from a phase'))} />
      </Suspense>
    </section>
  );
  return (
    <div className="h-full flex flex-col min-h-0">
      <Header title={exp.name} subtitle="Experiment" onBack={onBack} />
      <div ref={setToolbar} className="border-b border-[var(--line)]" />
      <div data-experiment-scroll className="flex-1 overflow-y-auto p-3 space-y-4">
        <label className="block text-sm">Name<input className="w-full" value={exp.name} onChange={(e) => repo.update(expId, (x) => ({ ...x, name: e.target.value }))} /></label>
        <label className="block text-sm">Status
          <select className="w-full" value={exp.status} onChange={(e) => repo.update(expId, (x) => withExperimentUpdates(x, { status: e.target.value as typeof x.status }))}>
            {STATUS_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {SECTIONS.map(text)}
        <section className="space-y-1">
          <h3 className="m-0 text-sm font-semibold">Phases</h3>
          {getExperimentPhases(exp).map((k) => {
            const p = getExperimentPhaseData(exp, k);
            return (
              <button key={k} onClick={() => onOpenPhase(k)} className="w-full !justify-start text-left">
                {p.label}{p.startDate ? ` · ${p.startDate}` : ''}{p.completed ? ' · done' : ''}
              </button>
            );
          })}
        </section>
        {AFTER.map(text)}
      </div>
    </div>
  );
}

function SyncScreen({ repo, onPairLink }: { repo: Repo; onPairLink: (link: string) => Promise<void> }) {
  useRepo(repo);
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e) { await alertDialog({ title: 'Sync', message: (e as Error).message, variant: 'danger' }); }
    setBusy(false);
  };
  const last = repo.lastSync;
  return (
    <div className="p-4 space-y-4">
      <section className="space-y-2">
        <h2 className="m-0 text-base font-semibold">Sync</h2>
        <p className="m-0 text-sm">
          {last ? `${last.ok ? 'Last sync' : 'Last attempt'}: ${new Date(last.at).toLocaleString()} · ${last.detail}` : 'Not synced yet.'}
        </p>
        <p className="m-0 text-sm">Waiting to send: {repo.pendingCount}</p>
        <button className="primary" disabled={busy || !repo.desktops.length} onClick={() => void run(() => repo.sync())}>Sync now</button>
      </section>
      {repo.conflicts.length > 0 && (
        <section className="space-y-2">
          <h2 className="m-0 text-base font-semibold">Conflicts ({repo.conflicts.length})</h2>
          <ConflictCards repo={repo} conflicts={repo.conflicts} />
        </section>
      )}
      <section className="space-y-2">
        <h2 className="m-0 text-base font-semibold">Computers</h2>
        {repo.desktops.map((d) => (
          <div key={d.url} className="flex items-center gap-2 text-sm">
            <span className="flex-1 min-w-0 break-all">{d.url}</span>
            <button onClick={() => void run(() => repo.unpair(d.url))}>Remove</button>
          </div>
        ))}
        <p className="m-0 text-sm text-[var(--mut)]">On the computer: Settings &gt; Phone sync &gt; Pair a phone. Then scan its QR code here, or type the address and code.</p>
        {'BarcodeDetector' in window && <button disabled={busy} onClick={() => setScanning(true)}>Scan QR code</button>}
        {scanning && <QrScanner onCode={(text) => { setScanning(false); void onPairLink(text); }} onClose={() => setScanning(false)} />}
        <input className="w-full" placeholder="https://your-pc.your-tailnet.ts.net" value={url} autoCapitalize="off" onChange={(e) => setUrl(e.target.value)} />
        <input className="w-full" placeholder="Pairing code" value={code} autoCapitalize="off" onChange={(e) => setCode(e.target.value)} />
        <button disabled={busy || !url || !code} onClick={() => void run(async () => { await repo.pair(url, code, 'Phone'); setCode(''); await repo.sync(); })}>Pair</button>
      </section>
      <p className="m-0 text-xs text-[var(--mut)]">This phone: {repo.deviceId}</p>
    </div>
  );
}

function QrScanner({ onCode, onClose }: { onCode: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((s) => {
      stream = s;
      if (!video.current) return;
      video.current.srcObject = s;
      void video.current.play();
      timer = setInterval(async () => {
        const found = video.current && (await detector.detect(video.current).catch(() => []))[0];
        if (found?.rawValue) onCode(found.rawValue);
      }, 300);
    }, (e) => setError(`Camera not available: ${e.message}`));
    return () => { if (timer) clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode]);
  return (
    <div className="space-y-2">
      <video ref={video} className="w-full rounded" muted playsInline />
      {error && <p className="m-0 text-sm text-red-500">{error}</p>}
      <button onClick={onClose}>Cancel</button>
    </div>
  );
}
