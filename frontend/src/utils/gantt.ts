import {
  getExperimentPhases,
  getExperimentPhaseData,
  getWorkflowPhaseMeta,
  type WorkflowPhaseMeta,
  type Project,
  type WorkflowPhaseKey,
} from '../types/lab.ts';
import { parseDurationDays } from './schedule.ts';

const DAY_MS = 86_400_000;

export interface GanttPhase {
  id: string;
  projectId: string;
  projectName: string;
  experimentId: string;
  experimentName: string;
  phaseKey: WorkflowPhaseKey;
  meta: WorkflowPhaseMeta;
  startDay: number;
  endDay: number;
}

/** Use calendar-day numbers so DST never changes a bar's length. */
export function toCalendarDay(value?: string): number | null {
  const text = value?.trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso.map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return date.getTime() / DAY_MS;
  }
  // Older notebook imports contain dates such as "Tuesday, June 23, 2026".
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

export function calendarDayDate(day: number): Date {
  return new Date(day * DAY_MS);
}

export function getGanttPhases(projects: Project[]): GanttPhase[] {
  const phases: GanttPhase[] = [];
  for (const project of projects) {
    if (project.archived) continue;
    for (const exp of project.exps) {
      for (const phaseKey of getExperimentPhases(exp)) {
        const pData = getExperimentPhaseData(exp, phaseKey);
        if (pData.completed) continue;
        const startDay = toCalendarDay(pData.startDate);
        if (startDay === null) continue;
        const end = toCalendarDay(pData.endDate);
        const duration = parseDurationDays(pData.duration);
        // Match Calendar's duration fallback for missing or same-day end dates.
        const endDay = end === null || end === startDay
          ? startDay + duration - 1
          : Math.max(startDay, end);
        phases.push({
          id: `${project.id}_${exp.id}_${phaseKey}`,
          projectId: project.id,
          projectName: project.name,
          experimentId: exp.id,
          experimentName: exp.name,
          phaseKey,
          meta: getWorkflowPhaseMeta(phaseKey, exp),
          startDay,
          endDay,
        });
      }
    }
  }
  return phases.sort((a, b) =>
    a.projectName.localeCompare(b.projectName) ||
    a.experimentName.localeCompare(b.experimentName) ||
    a.startDay - b.startDay
  );
}
