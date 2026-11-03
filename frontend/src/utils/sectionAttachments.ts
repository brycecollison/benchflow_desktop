import type { ELNBlock, ExperimentSectionKey, WorkflowPhaseKey } from '../types/lab.ts';

const NON_WORKFLOW_SECTIONS = new Set([
  'purpose',
  'expectedResults',
  'experimentalDesign',
  'results',
  'notes',
]);

export function sectionBlocks(blocks: ELNBlock[], section: ExperimentSectionKey) {
  return blocks.map((block, index) => ({ block, index }))
    .filter(({ block }) => (block.section || block.phase || 'results') === section);
}

export function sectionOwnership(section: ExperimentSectionKey) {
  return {
    section,
    ...(!NON_WORKFLOW_SECTIONS.has(section) ? { phase: section as WorkflowPhaseKey } : {}),
  };
}
