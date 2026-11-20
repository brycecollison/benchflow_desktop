import type { Experiment, Project, WorkflowPhaseKey } from '../types/lab';

// Mobile sync, window side (docs/adr/0002-mobile-sync.md). For each experiment the window keeps the
// last version it shares with the server (its baseline). A save sends a base only for experiments
// the user changed (local !== baseline), so the server merges those field by field and never writes
// this window's stale copy of the others over a phone edit.

export interface RemoteChanges {
  rev: number;
  projects: { id: string; name: string; archived: boolean; paperIds: string[]; rev: number }[];
  experiments: (Experiment & { projectId: string; rev: number })[];
  deleted: { kind: string; id: string; rev: number }[];
}

export const sync = {
  /** Notebook rev this window has caught up to; null = an old server without sync. */
  rev: null as number | null,
  baselines: new Map<string, Experiment>(),
  knownRevs: new Map<string, number>(),
};

export function normalizeExperimentPhases(phases?: (WorkflowPhaseKey | string)[]): WorkflowPhaseKey[] | undefined {
  if (!phases) return undefined;
  return phases.map((p) => {
    const raw = String(p);
    if (raw === 'Protocol') return 'experimentalProtocol';
    if (raw === 'Acquisition') return 'dataAcquisition';
    if (raw === 'Analysis') return 'dataAnalysis';
    return raw as WorkflowPhaseKey;
  });
}

/** After a full load: everything loaded is clean, at the rev it was read at. */
export function startFrom(projects: Project[], rev: number | null | undefined): void {
  sync.baselines.clear();
  sync.knownRevs.clear();
  projects.forEach((p) => p.exps.forEach((e) => {
    sync.baselines.set(e.id, e);
    sync.knownRevs.set(e.id, rev ?? 0);
  }));
  sync.rev = rev ?? null;
}

/** What a save sends: every experiment the user changed or created, and the base of each change. */
export function pendingEdits(projects: Project[]) {
  const sent = new Map<string, Experiment>();
  const bases: Record<string, Experiment> = {};
  for (const p of projects) {
    for (const e of p.exps) {
      const base = sync.baselines.get(e.id);
      if (base !== e) sent.set(e.id, e);
      if (base && base !== e) bases[e.id] = base;
    }
  }
  return { sent, bases };
}

/** The server accepted a save: it now holds every sent edit, so what was sent is the new common
 * ancestor - also for an experiment edited again since, whose next save merges from here. */
export function markSent(sent: Map<string, Experiment>): void {
  sent.forEach((e, id) => sync.baselines.set(id, e));
}

/** Fold server changes into the window. A clean experiment takes the server copy; an edited one
 * keeps the user's edits and its baseline, and the next save merges them on the server. */
export function foldChanges(projects: Project[], changes: RemoteChanges): Project[] {
  const { baselines, knownRevs } = sync;
  let next = projects;
  for (const rp of changes.projects) {
    if (!next.some((p) => p.id === rp.id)) {
      next = [...next, { id: rp.id, name: rp.name, archived: rp.archived, paperIds: rp.paperIds, exps: [] }];
    }
  }
  for (const { projectId, rev, ...raw } of changes.experiments) {
    const remote = raw.phases ? { ...raw, phases: normalizeExperimentPhases(raw.phases) } : raw;
    if (rev <= (knownRevs.get(remote.id) ?? -1)) continue; // an older answer arriving late
    knownRevs.set(remote.id, rev);
    const local = next.flatMap((p) => p.exps).find((e) => e.id === remote.id);
    if (!local) {
      if (baselines.has(remote.id)) continue; // deleted here; the pending save deletes it on the server
      baselines.set(remote.id, remote);
      next = next.map((p) => (p.id === projectId ? { ...p, exps: [...p.exps, remote] } : p));
    } else if (local === baselines.get(remote.id)) {
      baselines.set(remote.id, remote);
      next = next.map((p) => ({ ...p, exps: p.exps.map((e) => (e.id === remote.id ? remote : e)) }));
    }
  }
  for (const gone of changes.deleted) {
    if (gone.kind !== 'experiment') continue;
    const local = next.flatMap((p) => p.exps).find((e) => e.id === gone.id);
    if (local && local !== baselines.get(gone.id)) continue; // edited here: the save re-creates it
    baselines.delete(gone.id);
    if (local) next = next.map((p) => ({ ...p, exps: p.exps.filter((e) => e.id !== gone.id) }));
  }
  sync.rev = Math.max(sync.rev ?? 0, changes.rev);
  return next;
}
