import type {
  Project,
  Paper,
  Experiment,
  ExperimentStatus,
  PriorityLevel,
  WorkflowPhaseKey,
} from '../types/lab';
import { promptSelectDialog } from '../store/useDialogStore';
import type { PromptSelectField } from '../store/useDialogStore';
import {
  STATUS_LIST,
  PRIORITY_LIST,
  STATUS_COLORS,
  PRIORITY_COLORS,
} from './colors';
import { ALL_WORKFLOW_PHASES, WORKFLOW_PHASES } from '../types/lab';

export interface PromptCreateExperimentParams {
  project: Project;
  papers: Paper[];
  parentExp?: Experiment;
  title?: string;
  message?: string;
}

export interface CreatedExperimentData {
  name: string;
  paperId: string;
  status: ExperimentStatus;
  priority: PriorityLevel;
  phases: (WorkflowPhaseKey | string)[];
}

/** Only built-in phases are selectable when creating an experiment. */
function parsePhasesValue(raw?: string): WorkflowPhaseKey[] {
  if (raw === undefined) return [...ALL_WORKFLOW_PHASES];
  const selected = raw.split(',').map((key) => key.trim());
  return ALL_WORKFLOW_PHASES.filter((key) => selected.includes(key));
}

/**
 * Prompts the user to create a new experiment with status, priority, and paper selection:
 * 1. Status dropdown defaults to 'Planning'.
 * 2. Priority dropdown defaults to 'Med'.
 * 3. If the project has exactly one assigned paper, the experiment automatically inherits it.
 * 4. If the project has more than one assigned paper, those papers are displayed in a dropdown
 *    select menu with the paper having the most assigned experiments pre-selected by default.
 */
export async function promptCreateExperiment({
  project,
  papers,
  parentExp,
  title = 'New Experiment',
  message,
}: PromptCreateExperimentParams): Promise<CreatedExperimentData | null> {
  // Collect assigned papers for this project
  const assignedPaperIds = new Set<string>([
    ...(project.paperIds || []),
    ...project.exps.map((e) => e.paper).filter(Boolean),
  ]);

  const assignedPapers = papers.filter(
    (p) => !p.archived && assignedPaperIds.has(p.id)
  );

  // Common Status field (default: 'Planning')
  const statusField: PromptSelectField = {
    id: 'status',
    label: 'Status',
    options: STATUS_LIST.map((st) => ({
      value: st,
      label: st,
      color: STATUS_COLORS[st],
    })),
    defaultValue: 'Planning',
  };

  // Common Priority field (default: 'Med')
  const priorityField: PromptSelectField = {
    id: 'priority',
    label: 'Priority',
    options: [
      ...PRIORITY_LIST.map((pr) => ({
        value: pr,
        label: pr,
        color: PRIORITY_COLORS[pr],
      })),
      { value: '', label: 'None' },
    ],
    defaultValue: 'Med',
  };

  // Common Phases field: one or multiple workflow phases to include (default: all built-ins)
  const phasesField: PromptSelectField = {
    id: 'phases',
    label: 'Phases',
    multi: true,
    options: ALL_WORKFLOW_PHASES.map((pk) => ({
      value: pk,
      label: WORKFLOW_PHASES[pk].label,
    })),
    defaultValue: ALL_WORKFLOW_PHASES.join(','),
  };

  // Case 1: Exactly 1 paper assigned -> automatically inherit it
  if (assignedPapers.length === 1) {
    const inheritedPaper = assignedPapers[0];
    const defaultMsg =
      message ||
      `Add an experiment to "${project.name}" (Paper: ${inheritedPaper.name}):`;

    const res = await promptSelectDialog({
      title,
      message: defaultMsg,
      placeholder: 'e.g., Western Blot Validation',
      confirmLabel: 'Add Experiment',
      inputLabel: 'Experiment Name',
      selectFields: [statusField, priorityField, phasesField],
    });

    if (!res || !res.value.trim()) return null;
    const parsed = parsePhasesValue(res.fieldValues?.phases);
    return {
      name: res.value.trim(),
      paperId: inheritedPaper.id,
      status: (res.fieldValues?.status as ExperimentStatus) || 'Planning',
      priority: (res.fieldValues?.priority as PriorityLevel) ?? 'Med',
      phases: parsed,
    };
  }

  // Case 2: More than 1 paper assigned -> show paper dropdown alongside status & priority
  if (assignedPapers.length > 1) {
    // Count existing experiments in this project for each assigned paper
    const paperExpCounts: Record<string, number> = {};
    for (const p of assignedPapers) {
      paperExpCounts[p.id] = 0;
    }
    for (const exp of project.exps) {
      if (exp.paper && paperExpCounts[exp.paper] !== undefined) {
        paperExpCounts[exp.paper]++;
      }
    }

    // Determine the paper with the most assigned experiments
    let defaultPaperId = assignedPapers[0].id;
    let maxCount = -1;
    for (const p of assignedPapers) {
      const count = paperExpCounts[p.id] || 0;
      // Prefer strictly higher count, or if tied, prefer parent experiment's paper
      if (
        count > maxCount ||
        (count === maxCount && parentExp?.paper === p.id)
      ) {
        maxCount = count;
        defaultPaperId = p.id;
      }
    }

    const paperField: PromptSelectField = {
      id: 'paper',
      label: 'Paper',
      options: assignedPapers.map((p) => {
        const count = paperExpCounts[p.id] || 0;
        return {
          value: p.id,
          label: `${p.name} (${count} exp${count === 1 ? '' : 's'})`,
          color: p.color,
        };
      }),
      defaultValue: defaultPaperId,
    };

    const res = await promptSelectDialog({
      title,
      message: message || `Add an experiment to "${project.name}":`,
      placeholder: 'e.g., Western Blot Validation',
      confirmLabel: 'Add Experiment',
      inputLabel: 'Experiment Name',
      selectFields: [statusField, priorityField, paperField, phasesField],
    });

    if (!res || !res.value.trim()) return null;
    const parsed = parsePhasesValue(res.fieldValues?.phases);
    return {
      name: res.value.trim(),
      paperId: res.fieldValues?.paper || defaultPaperId,
      status: (res.fieldValues?.status as ExperimentStatus) || 'Planning',
      priority: (res.fieldValues?.priority as PriorityLevel) ?? 'Med',
      phases: parsed,
    };
  }

  // Case 3: No papers assigned to the project
  const res = await promptSelectDialog({
    title,
    message: message || `Add an experiment to "${project.name}":`,
    placeholder: 'e.g., Western Blot Validation',
    confirmLabel: 'Add Experiment',
    inputLabel: 'Experiment Name',
    selectFields: [statusField, priorityField, phasesField],
  });

  if (!res || !res.value.trim()) return null;
  const parsed = parsePhasesValue(res.fieldValues?.phases);
  return {
    name: res.value.trim(),
    paperId: '',
    status: (res.fieldValues?.status as ExperimentStatus) || 'Planning',
    priority: (res.fieldValues?.priority as PriorityLevel) ?? 'Med',
    phases: parsed,
  };
}
