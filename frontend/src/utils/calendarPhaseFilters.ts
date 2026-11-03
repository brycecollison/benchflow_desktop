import { ALL_WORKFLOW_PHASES } from '../types/lab.ts';

export function getCalendarPhaseFilterKey(phaseKey: string): string {
  return ALL_WORKFLOW_PHASES.some((key) => key === phaseKey) ? phaseKey : 'customPhases';
}
