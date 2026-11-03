export type ExperimentStatus = 'Planning' | 'Planned' | 'Running' | 'Done' | 'Blocked';
export type PriorityLevel = 'High' | 'Med' | 'Low' | '';

export type ExperimentSectionKey =
  | 'purpose' | 'expectedResults' | 'experimentalDesign'
  | WorkflowPhaseKey | 'results' | 'notes';

interface SectionAttachment {
  section?: ExperimentSectionKey; // Legacy attachments without a section belong to Results.
  phase?: WorkflowPhaseKey;
}

export interface TextBlock extends SectionAttachment {
  type: 'txt';
  name?: string;
  text: string;
}

export interface ImageBlock extends SectionAttachment {
  type: 'img';
  name: string;
  src: string;
  preview_url?: string;
  raw_url?: string;
  format?: string;
  metadata?: Record<string, any>;
}

export interface TableBlock extends SectionAttachment {
  type: 'tbl';
  name: string;
  rows: string[][];
  src?: string; // Original uploaded CSV/TSV, when available.
}

export interface FileBlock extends SectionAttachment {
  type: 'file';
  name: string;
  src: string;
  mimeType: string;
  size: number;
}

export type ELNBlock = TextBlock | ImageBlock | TableBlock | FileBlock;

export interface Experiment {
  id: string;
  name: string;
  status: ExperimentStatus;
  priority: PriorityLevel;
  paper: string; // paper id or ''
  deps: string[]; // predecessor experiment IDs
  purpose?: string;
  expectedResults?: string;
  experimentalDesign?: string;
  experimentalProtocol?: string;
  experimentalProtocolDuration?: string;
  experimentalProtocolCompleted?: boolean;
  experimentalProtocolStartDate?: string;
  experimentalProtocolEndDate?: string;
  dataAcquisition?: string;
  dataAcquisitionDuration?: string;
  dataAcquisitionCompleted?: boolean;
  dataAcquisitionStartDate?: string;
  dataAcquisitionEndDate?: string;
  dataAnalysis?: string;
  dataAnalysisDuration?: string;
  dataAnalysisCompleted?: boolean;
  dataAnalysisStartDate?: string;
  dataAnalysisEndDate?: string;
  results?: string;
  notes?: string;
  blocks: ELNBlock[];
  /** Phases included in this experiment. Undefined/null = default phases (legacy experiments); empty = no phases. */
  phases?: (WorkflowPhaseKey | string)[];
  customPhases?: CustomPhase[];
  px?: number; // custom manual X
  py?: number; // custom manual Y
}

export interface CustomPhase {
  id: string;
  name: string;
  content?: string;
  duration?: string;
  completed?: boolean;
  startDate?: string;
  endDate?: string;
  color?: string;
}

export type BuiltinWorkflowPhaseKey = 'experimentalProtocol' | 'dataAcquisition' | 'dataAnalysis';
export type WorkflowPhaseKey = BuiltinWorkflowPhaseKey | string;

export interface WorkflowPhaseMeta {
  key: string;
  label: string;
  shortLabel: string;
  colorTheme: {
    bg: string;
    border: string;
    text: string;
    badge: string;
  };
  startKey?: 'experimentalProtocolStartDate' | 'dataAcquisitionStartDate' | 'dataAnalysisStartDate';
  endKey?: 'experimentalProtocolEndDate' | 'dataAcquisitionEndDate' | 'dataAnalysisEndDate';
  durationKey?: 'experimentalProtocolDuration' | 'dataAcquisitionDuration' | 'dataAnalysisDuration';
  completedKey?: 'experimentalProtocolCompleted' | 'dataAcquisitionCompleted' | 'dataAnalysisCompleted';
}

export const WORKFLOW_PHASES: Record<BuiltinWorkflowPhaseKey, WorkflowPhaseMeta> = {
  experimentalProtocol: {
    key: 'experimentalProtocol',
    label: 'Experimental Protocol',
    shortLabel: 'Protocol',
    colorTheme: {
      bg: 'bg-[#ebf5fe] dark:bg-[#112338]',
      border: 'border-sky-300 dark:border-sky-700',
      text: 'text-sky-800 dark:text-sky-200',
      badge: 'bg-sky-600 text-white',
    },
    startKey: 'experimentalProtocolStartDate',
    endKey: 'experimentalProtocolEndDate',
    durationKey: 'experimentalProtocolDuration',
    completedKey: 'experimentalProtocolCompleted',
  },
  dataAcquisition: {
    key: 'dataAcquisition',
    label: 'Data Acquisition',
    shortLabel: 'Acquisition',
    colorTheme: {
      bg: 'bg-[#e6f8f5] dark:bg-[#0c2a2b]',
      border: 'border-teal-300 dark:border-teal-700',
      text: 'text-teal-800 dark:text-teal-200',
      badge: 'bg-teal-600 text-white',
    },
    startKey: 'dataAcquisitionStartDate',
    endKey: 'dataAcquisitionEndDate',
    durationKey: 'dataAcquisitionDuration',
    completedKey: 'dataAcquisitionCompleted',
  },
  dataAnalysis: {
    key: 'dataAnalysis',
    label: 'Data Analysis',
    shortLabel: 'Analysis',
    colorTheme: {
      bg: 'bg-[#f4ecfb] dark:bg-[#25183d]',
      border: 'border-violet-300 dark:border-violet-700',
      text: 'text-violet-800 dark:text-violet-200',
      badge: 'bg-violet-600 text-white',
    },
    startKey: 'dataAnalysisStartDate',
    endKey: 'dataAnalysisEndDate',
    durationKey: 'dataAnalysisDuration',
    completedKey: 'dataAnalysisCompleted',
  },
};

/** All workflow phases in canonical order. */
export const ALL_WORKFLOW_PHASES: BuiltinWorkflowPhaseKey[] = [
  'experimentalProtocol',
  'dataAcquisition',
  'dataAnalysis',
];

export const CUSTOM_PHASE_COLOR_THEMES = [
  {
    bg: 'bg-[#fef3c7] dark:bg-[#2d2008]',
    border: 'border-amber-300 dark:border-amber-700',
    text: 'text-amber-800 dark:text-amber-200',
    badge: 'bg-amber-600 text-white',
  },
  {
    bg: 'bg-[#ecfdf5] dark:bg-[#062c1e]',
    border: 'border-emerald-300 dark:border-emerald-700',
    text: 'text-emerald-800 dark:text-emerald-200',
    badge: 'bg-emerald-600 text-white',
  },
  {
    bg: 'bg-[#ffe4e6] dark:bg-[#2c0b11]',
    border: 'border-rose-300 dark:border-rose-700',
    text: 'text-rose-800 dark:text-rose-200',
    badge: 'bg-rose-600 text-white',
  },
  {
    bg: 'bg-[#e0e7ff] dark:bg-[#1e1b4b]',
    border: 'border-indigo-300 dark:border-indigo-700',
    text: 'text-indigo-800 dark:text-indigo-200',
    badge: 'bg-indigo-600 text-white',
  },
  {
    bg: 'bg-[#fae8ff] dark:bg-[#3b0764]',
    border: 'border-fuchsia-300 dark:border-fuchsia-700',
    text: 'text-fuchsia-800 dark:text-fuchsia-200',
    badge: 'bg-fuchsia-600 text-white',
  },
];

export function getCustomPhaseColorTheme(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return CUSTOM_PHASE_COLOR_THEMES[Math.abs(hash) % CUSTOM_PHASE_COLOR_THEMES.length];
}

export function getWorkflowPhaseMeta(phaseKey: string, exp?: Experiment | null): WorkflowPhaseMeta {
  if (phaseKey in WORKFLOW_PHASES) {
    return WORKFLOW_PHASES[phaseKey as BuiltinWorkflowPhaseKey];
  }
  const custom = (exp?.customPhases || []).find((p) => p.id === phaseKey);
  const savedName = custom?.name?.trim();
  const name = savedName && savedName !== phaseKey
    ? savedName
    : /^phase_\d+_[a-z0-9]+$/.test(phaseKey) ? 'Custom Phase' : phaseKey;
  return {
    key: phaseKey,
    label: name,
    shortLabel: name.length > 14 ? `${name.slice(0, 12)}…` : name,
    colorTheme: getCustomPhaseColorTheme(phaseKey),
  };
}

export interface PhaseData {
  key: string;
  label: string;
  content: string;
  duration: string;
  completed: boolean;
  startDate: string;
  endDate: string;
}

export function getExperimentPhaseData(exp: Experiment, phaseKey: string): PhaseData {
  if (phaseKey === 'experimentalProtocol') {
    return {
      key: 'experimentalProtocol',
      label: WORKFLOW_PHASES.experimentalProtocol.label,
      content: exp.experimentalProtocol || '',
      duration: exp.experimentalProtocolDuration || '',
      completed: Boolean(exp.experimentalProtocolCompleted),
      startDate: exp.experimentalProtocolStartDate || '',
      endDate: exp.experimentalProtocolEndDate || '',
    };
  }
  if (phaseKey === 'dataAcquisition') {
    return {
      key: 'dataAcquisition',
      label: WORKFLOW_PHASES.dataAcquisition.label,
      content: exp.dataAcquisition || '',
      duration: exp.dataAcquisitionDuration || '',
      completed: Boolean(exp.dataAcquisitionCompleted),
      startDate: exp.dataAcquisitionStartDate || '',
      endDate: exp.dataAcquisitionEndDate || '',
    };
  }
  if (phaseKey === 'dataAnalysis') {
    return {
      key: 'dataAnalysis',
      label: WORKFLOW_PHASES.dataAnalysis.label,
      content: exp.dataAnalysis || '',
      duration: exp.dataAnalysisDuration || '',
      completed: Boolean(exp.dataAnalysisCompleted),
      startDate: exp.dataAnalysisStartDate || '',
      endDate: exp.dataAnalysisEndDate || '',
    };
  }
  const custom = (exp.customPhases || []).find((p) => p.id === phaseKey);
  return {
    key: phaseKey,
    label: getWorkflowPhaseMeta(phaseKey, exp).label,
    content: custom?.content || '',
    duration: custom?.duration || '',
    completed: Boolean(custom?.completed),
    startDate: custom?.startDate || '',
    endDate: custom?.endDate || '',
  };
}

/**
 * Returns the phases included in the experiment, in canonical order.
 * Experiments without an explicit `phases` list get all 3 phases (legacy behavior).
 */
export function getExperimentPhases(exp: Experiment): WorkflowPhaseKey[] {
  if (!exp.phases) {
    const customKeys = (exp.customPhases || []).map((cp) => cp.id);
    return [...ALL_WORKFLOW_PHASES, ...customKeys];
  }
  const normalized = exp.phases.map((p) => {
    const raw = String(p);
    if (raw === 'Protocol') return 'experimentalProtocol';
    if (raw === 'Acquisition') return 'dataAcquisition';
    if (raw === 'Analysis') return 'dataAnalysis';
    return raw;
  });
  const builtins = ALL_WORKFLOW_PHASES.filter((pk) => normalized.includes(pk));
  const customs = normalized.filter((pk) => !ALL_WORKFLOW_PHASES.includes(pk as BuiltinWorkflowPhaseKey));
  return [...builtins, ...customs];
}

export function checkAllPhasesScheduled(exp: Experiment): boolean {
  const phases = getExperimentPhases(exp);
  return phases.length > 0 && phases.every((key) => Boolean(getExperimentPhaseData(exp, key).startDate.trim()));
}

/**
 * Determines whether all workflow phases of an experiment are marked completed.
 * Returns true if:
 * 1. All phases included in the experiment are marked completed.
 * 2. Or, if the experiment has multiple scheduled phases and all of them are marked completed.
 * 3. Or, if the experiment has multiple configured phases (content or duration) and all of them are marked completed.
 */
export function checkAllPhasesCompleted(exp: Experiment): boolean {
  const phaseKeys = getExperimentPhases(exp);
  if (phaseKeys.length === 0) return false;

  // 1. If all included phases are marked completed, always true
  const includedCompleted = phaseKeys.every(
    (pk) => getExperimentPhaseData(exp, pk).completed
  );
  if (includedCompleted) return true;

  // 2. Check scheduled phases on the calendar
  const scheduledPhases = phaseKeys
    .map((pk) => getExperimentPhaseData(exp, pk))
    .filter((p) => Boolean(p.startDate.trim()));

  if (
    scheduledPhases.length >= 2 &&
    scheduledPhases.every((p) => p.completed)
  ) {
    return true;
  }

  // 3. Check phases with explicit content or duration
  const configuredPhases = phaseKeys
    .map((pk) => getExperimentPhaseData(exp, pk))
    .filter((p) => Boolean(p.content.trim() || p.duration.trim()));

  if (
    configuredPhases.length >= 2 &&
    configuredPhases.every((p) => p.completed)
  ) {
    return true;
  }

  return false;
}

export interface CalendarEventItem {
  id: string; // `${expId}_${phaseKey}`
  projectId: string;
  projectName: string;
  experimentId: string;
  experimentName: string;
  phaseKey: WorkflowPhaseKey;
  startDate: string; // 'YYYY-MM-DD'
  endDate?: string;
  duration?: string;
  completed: boolean;
  paperColor?: string;
  paperName?: string;
  status: ExperimentStatus;
}

export interface Paper {
  id: string;
  name: string;
  color: string;
  archived?: boolean;
}

export interface Project {
  id: string;
  name: string;
  paperIds?: string[];
  exps: Experiment[];
  archived?: boolean;
}

export interface LabState {
  projects: Project[];
  papers: Paper[];
}

export type ViewType = 'p' | 'all' | 'pp' | 'calendar' | 'gantt' | 'settings';

export interface ViewState {
  type: ViewType;
  id?: string | null; // active projectId when type === 'p'
}

export interface FilterState {
  status: string[];
  paper: string[];
  priority: string[];
  statusNot: boolean;
  paperNot: boolean;
  priorityNot: boolean;
}

export interface NodePosition {
  x: number;
  y: number;
}
