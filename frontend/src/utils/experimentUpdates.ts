import type { BuiltinWorkflowPhaseKey, Experiment } from '../types/lab.ts';
import { WORKFLOW_PHASES, checkAllPhasesCompleted, checkAllPhasesScheduled } from '../types/lab.ts';

// Pure experiment edits shared by the desktop store and the phone app, so both apply the same
// field mapping and the same status rules (all phases done -> Done, and so on).

export interface PhaseUpdate {
  startDate?: string;
  endDate?: string;
  duration?: string;
  completed?: boolean;
  content?: string;
  name?: string;
}

export function withExperimentUpdates(e: Experiment, updates: Partial<Experiment>): Experiment {
  const updated = { ...e, ...updates };
  // When status is not explicitly provided in updates:
  if (!('status' in updates)) {
    if (checkAllPhasesCompleted(updated)) {
      updated.status = 'Done';
    } else if (
      ('experimentalProtocolCompleted' in updates ||
        'dataAcquisitionCompleted' in updates ||
        'dataAnalysisCompleted' in updates) &&
      e.status === 'Done'
    ) {
      // If a phase was marked incomplete on a previously Done experiment, revert to Running
      updated.status = 'Running';
    } else if (updated.status === 'Planning' && checkAllPhasesScheduled(updated)) {
      updated.status = 'Planned';
    }
  }
  return updated;
}

export function withPhaseUpdate(e: Experiment, phaseKey: string, data: PhaseUpdate): Experiment {
  const updated = { ...e };
  const meta = WORKFLOW_PHASES[phaseKey as BuiltinWorkflowPhaseKey];
  if (meta) {
    if (data.startDate !== undefined) updated[meta.startKey!] = data.startDate.trim();
    if (data.endDate !== undefined) updated[meta.endKey!] = data.endDate.trim();
    if (data.duration !== undefined) updated[meta.durationKey!] = data.duration;
    if (data.completed !== undefined) updated[meta.completedKey!] = data.completed;
    if (data.content !== undefined) (updated as any)[phaseKey] = data.content;
  } else {
    const currentCustom = e.customPhases || [];
    const exists = currentCustom.some((cp) => cp.id === phaseKey);
    updated.customPhases = exists
      ? currentCustom.map((cp) =>
          cp.id === phaseKey
            ? {
                ...cp,
                ...(data.startDate !== undefined ? { startDate: data.startDate.trim() } : {}),
                ...(data.endDate !== undefined ? { endDate: data.endDate.trim() } : {}),
                ...(data.duration !== undefined ? { duration: data.duration } : {}),
                ...(data.completed !== undefined ? { completed: data.completed } : {}),
                ...(data.content !== undefined ? { content: data.content } : {}),
                ...(data.name !== undefined ? { name: data.name.trim() } : {}),
              }
            : cp
        )
      : [
          ...currentCustom,
          {
            id: phaseKey,
            name: data.name?.trim() || phaseKey,
            startDate: data.startDate?.trim() || '',
            endDate: data.endDate?.trim() || '',
            duration: data.duration || '',
            completed: Boolean(data.completed),
            content: data.content || '',
          },
        ];
  }

  if (checkAllPhasesCompleted(updated)) {
    updated.status = 'Done';
  } else if (data.completed === false && e.status === 'Done') {
    updated.status = 'Running';
  } else if (updated.status === 'Planning' && checkAllPhasesScheduled(updated)) {
    updated.status = 'Planned';
  }
  return updated;
}

export function withDeviation(e: Experiment, phaseKey: string, text: string, deviceId: string): Experiment {
  const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), device_id: deviceId, text: text.trim() };
  return withExperimentUpdates(e, {
    deviations: { ...(e.deviations || {}), [phaseKey]: [...(e.deviations?.[phaseKey] || []), entry] },
  });
}
