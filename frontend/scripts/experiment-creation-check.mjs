// node frontend/scripts/experiment-creation-check.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true } });
try {
  const { promptCreateExperiment } = await server.ssrLoadModule('/src/utils/experimentCreation.ts');
  const { useDialogStore } = await server.ssrLoadModule('/src/store/useDialogStore.ts');
  globalThis.window = {};
  globalThis.localStorage = { getItem: () => null };
  const { useLabStore } = await server.ssrLoadModule('/src/store/useLabStore.ts');
  const builtins = ['experimentalProtocol', 'dataAcquisition', 'dataAnalysis'];
  for (const paperCount of [0, 1, 2]) {
    const papers = Array.from({ length: paperCount }, (_, i) => ({ id: `paper${i}`, name: `Paper ${i}`, color: '#123456' }));
    const project = { id: 'p', name: 'Project', paperIds: papers.map((p) => p.id), exps: [{ id: 'old', paper: '', customPhases: [{ id: 'phase_old', name: 'Existing Custom Phase' }] }] };
    const pending = promptCreateExperiment({ project, papers });
    const dialog = useDialogStore.getState().activeDialog;
    const field = dialog.options.selectFields.find((field) => field.id === 'phases');
    assert.deepEqual(field.options.map((option) => option.value), builtins);
    dialog.resolve({ value: 'New experiment', fieldValues: { phases: '' } });
    const result = await pending;
    assert.deepEqual(result.phases, [], 'Deselecting all phases stays empty');
    assert.equal(result.customPhases, undefined);
  }
  // Keep persistence in memory so this check never touches notebook data.
  useLabStore.setState({ projects: [{ id: 'p', name: 'Project', exps: [] }], papers: [], saveState: () => {} });
  const id = useLabStore.getState().addExperiment('p', 'No phases', [], '', 'Planning', '', []);
  assert.deepEqual(useLabStore.getState().projects[0].exps.find((exp) => exp.id === id).phases, []);
  const phaseId = useLabStore.getState().addCustomPhase('p', id, ' Tissue Staining ');
  useLabStore.getState().updatePhaseSchedule('p', id, phaseId, '2026-04-01');
  const restoredProjects = JSON.parse(JSON.stringify(useLabStore.getState().projects));
  useLabStore.setState({ projects: restoredProjects });
  assert.equal(restoredProjects[0].exps[0].customPhases[0].name, 'Tissue Staining');
  const { getGanttPhases } = await server.ssrLoadModule('/src/utils/gantt.ts');
  const row = getGanttPhases(restoredProjects)[0];
  assert.equal(row.meta.label, 'Tissue Staining', 'Gantt keeps the saved phase name instead of displaying its ID');
  assert.ok(row.meta.shortLabel.startsWith('Tissue'), 'Compact labels use the saved name too');
  const orphanId = 'phase_1792791415389_hm0n';
  useLabStore.setState({ projects: [{ id: 'p', name: 'Project', exps: [{
    id: 'orphan', name: 'Legacy experiment', status: 'Planning', priority: '', paper: '', deps: [],
    phases: [orphanId], blocks: [],
  }] }], activeModalExpId: 'orphan' });
  const { getWorkflowPhaseMeta } = await server.ssrLoadModule('/src/types/lab.ts');
  assert.equal(getWorkflowPhaseMeta(orphanId, useLabStore.getState().projects[0].exps[0]).label, 'Custom Phase');
  useLabStore.getState().updatePhase('p', 'orphan', orphanId, { name: ' Recovered title ' });
  useLabStore.setState({ projects: JSON.parse(JSON.stringify(useLabStore.getState().projects)) });
  assert.equal(getWorkflowPhaseMeta(orphanId, useLabStore.getState().projects[0].exps[0]).label, 'Recovered title', 'Recovered names survive reload');
  assert.equal(useLabStore.getState().projects[0].exps[0].customPhases[0].id, orphanId, 'Renaming preserves phase ownership');
  useLabStore.setState({ activeModalExpId: null });
  useLabStore.setState({ projects: [{ id: 'p', name: 'Project', exps: [
    { id: 'parent', deps: [] }, { id: 'child', deps: ['parent'] },
  ] }] });
  const inserted = useLabStore.getState().addExperiment('p', 'Inserted', ['parent'], '', 'Planning', '', [], true);
  assert.deepEqual(useLabStore.getState().projects[0].exps.find((exp) => exp.id === 'child').deps, [inserted], 'The downstream insertion argument remains compatible');
  console.log('PASS: built-in creation options, empty selections, and downstream insertion compatibility');
} finally {
  delete globalThis.window;
  delete globalThis.localStorage;
  await server.close();
}
