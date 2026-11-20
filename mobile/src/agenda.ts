import { getExperimentPhaseData, getExperimentPhases, type Experiment } from '../../frontend/src/types/lab.ts';

export interface Project { id: string; name: string; archived?: boolean; exps: Experiment[] }
export interface AgendaRow {
  projectId: string; projectName: string; exp: Experiment;
  phaseKey: string; label: string; start: string; end: string; completed: boolean;
}
export interface Agenda { today: AgendaRow[]; upcoming: AgendaRow[]; past: AgendaRow[] }

/** Local calendar date as YYYY-MM-DD, the format the notebook stores. */
export const isoDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Scheduled phases of non-archived projects: active today first, then upcoming, then past (latest first). */
export function buildAgenda(projects: Project[], today = isoDay()): Agenda {
  const rows: AgendaRow[] = [];
  for (const p of projects) {
    if (p.archived) continue;
    for (const exp of p.exps) {
      for (const key of getExperimentPhases(exp)) {
        const ph = getExperimentPhaseData(exp, key);
        if (!ph.startDate.trim()) continue;
        rows.push({ projectId: p.id, projectName: p.name, exp, phaseKey: key, label: ph.label,
          start: ph.startDate, end: ph.endDate || ph.startDate, completed: ph.completed });
      }
    }
  }
  const byStart = (a: AgendaRow, b: AgendaRow) => a.start.localeCompare(b.start) || a.exp.name.localeCompare(b.exp.name);
  return {
    today: rows.filter((r) => r.start <= today && today <= r.end).sort(byStart),
    upcoming: rows.filter((r) => r.start > today).sort(byStart),
    past: rows.filter((r) => r.end < today).sort((a, b) => byStart(b, a)),
  };
}
