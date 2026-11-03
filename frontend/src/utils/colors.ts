import type { ExperimentStatus, PriorityLevel } from '../types/lab';

export const PAPER_COLORS = [
  '#2f6f5e',
  '#b5651d',
  '#4a6fa5',
  '#a14a7f',
  '#7a8b2e',
  '#c0392b',
];

export const STATUS_LIST: ExperimentStatus[] = [
  'Planning',
  'Planned',
  'Running',
  'Done',
  'Blocked',
];

export const STATUS_COLORS: Record<ExperimentStatus, string> = {
  Planning: '#9ca3af',
  Planned: '#8b5cf6',
  Running: '#3b82c4',
  Done: '#3fa66a',
  Blocked: '#c0392b',
};

export const PRIORITY_LIST: PriorityLevel[] = ['High', 'Med', 'Low'];

export const PRIORITY_COLORS: Record<string, string> = {
  High: '#c0392b',
  Med: '#d98e04',
  Low: '#6b7280',
};
