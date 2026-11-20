import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { GlobalDialogModal } from '../../frontend/src/components/Modal/GlobalDialogModal';
import { getExperimentPhaseData } from '../../frontend/src/types/lab';
import seed from '../../seed/lab_state.json';
import { buildAgenda, type AgendaRow, type Project } from './agenda';
import { lanProbe, runChecks, signIn, signOut } from './graph';

// The same editor the desktop uses, unmodified.
const SectionTextEditor = lazy(() => import('../../frontend/src/components/Modal/SectionTextEditor')
  .then((m) => ({ default: m.SectionTextEditor })));

// Canned notebook: the bundled seed. Edits stay in memory; the spike only tests the editor.
const projects = (seed as unknown as { projects: Project[] }).projects;

export function App() {
  const [tab, setTab] = useState<'agenda' | 'probe'>('agenda');
  const [open, setOpen] = useState<AgendaRow | null>(null);

  useEffect(() => {
    const h = CapApp.addListener('backButton', () => (open ? setOpen(null) : CapApp.exitApp()));
    return () => { void h.then((x) => x.remove()); };
  }, [open]);

  return (
    <div className="h-full flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {open ? <PhaseScreen row={open} onBack={() => setOpen(null)} /> : (
        <>
          <div className="flex-1 overflow-y-auto">{tab === 'agenda' ? <AgendaScreen onOpen={setOpen} /> : <ProbeScreen />}</div>
          <nav className="flex border-t border-[var(--line)] bg-[var(--card)]">
            {(['agenda', 'probe'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`flex-1 !rounded-none !border-0 ${tab === t ? '!text-[var(--acc)] font-semibold' : ''}`}>
                {t === 'agenda' ? 'Agenda' : 'Sync probe'}
              </button>
            ))}
          </nav>
        </>
      )}
      <GlobalDialogModal />
    </div>
  );
}

function AgendaScreen({ onOpen }: { onOpen: (r: AgendaRow) => void }) {
  const agenda = useMemo(() => buildAgenda(projects), []);
  const [showPast, setShowPast] = useState(false);
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
      {section('Today', agenda.today)}
      {section('Upcoming', agenda.upcoming)}
      <button className="m-4" onClick={() => setShowPast(!showPast)}>{showPast ? 'Hide' : 'Show'} past ({agenda.past.length})</button>
      {showPast && section('Past', agenda.past)}
    </div>
  );
}

function PhaseScreen({ row, onBack }: { row: AgendaRow; onBack: () => void }) {
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [text, setText] = useState(() => getExperimentPhaseData(row.exp, row.phaseKey).content);
  return (
    <div className="h-full flex flex-col min-h-0">
      <header className="flex items-center gap-2 px-2 py-1 border-b border-[var(--line)] bg-[var(--card)]">
        <button className="!border-0" onClick={onBack} aria-label="Back">←</button>
        <div className="min-w-0">
          <div className="font-medium truncate">{row.exp.name}</div>
          <div className="text-sm text-[var(--mut)] truncate">{row.label} · {row.start}{row.end !== row.start ? ` → ${row.end}` : ''}</div>
        </div>
      </header>
      <div ref={setToolbar} />
      <div data-experiment-scroll className="flex-1 overflow-y-auto p-3">
        <Suspense fallback={<p className="text-sm text-[var(--mut)]">Loading editor…</p>}>
          <SectionTextEditor label={row.label} value={text} onChange={setText}
            toolbarTarget={toolbar} toolbarActive onActivate={() => {}} onEnlargeImage={() => {}}
            onUploadImage={() => Promise.reject(new Error('Images are not part of the spike'))} />
        </Suspense>
      </div>
    </div>
  );
}

const LOG_KEY = 'spike_log';

function ProbeScreen() {
  const [lines, setLines] = useState<string[]>([]);
  const [folder, setFolder] = useState('BenchflowBackup/mobile-sync');
  const [lanUrl, setLanUrl] = useState('http://192.168.1.10:8765/');
  const [busy, setBusy] = useState(false);

  useEffect(() => { void Preferences.get({ key: LOG_KEY }).then((r) => setLines(r.value ? JSON.parse(r.value) : [])); }, []);
  // Persisted so a "background for an hour, then run again" session keeps its history.
  const log = (line: string) => setLines((prev) => {
    const next = [...prev, line].slice(-500);
    void Preferences.set({ key: LOG_KEY, value: JSON.stringify(next) });
    return next;
  });
  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    try { await fn(); } catch (e) { log(`ERROR ${(e as Error).message}`); } finally { setBusy(false); }
  };

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-lg font-semibold">OneDrive (personal) via Microsoft Graph</h1>
      <div className="flex gap-2 flex-wrap">
        <button className="primary" disabled={busy} onClick={run(async () => { await signIn(); log('signed in'); })}>Sign in</button>
        <button disabled={busy} onClick={run(() => runChecks(folder, log))}>Run checks</button>
        <button disabled={busy} onClick={run(async () => { await signOut(); log('signed out'); })}>Sign out</button>
      </div>
      <label className="block text-sm">Folder in OneDrive
        <input className="w-full" value={folder} onChange={(e) => setFolder(e.target.value)} />
      </label>

      <h2 className="font-semibold pt-2">LAN (optional)</h2>
      <label className="block text-sm">Desktop URL
        <input className="w-full" value={lanUrl} onChange={(e) => setLanUrl(e.target.value)} />
      </label>
      <button disabled={busy} onClick={run(() => lanProbe(lanUrl, log))}>Probe LAN</button>

      <div className="flex gap-2 pt-2">
        <button onClick={() => void navigator.clipboard.writeText(lines.join('\n'))}>Copy log</button>
        <button onClick={() => { setLines([]); void Preferences.remove({ key: LOG_KEY }); }}>Clear log</button>
      </div>
      <pre className="text-xs whitespace-pre-wrap break-all bg-[var(--card)] border border-[var(--line)] rounded p-2">{lines.join('\n') || 'No runs yet.'}</pre>
    </div>
  );
}
