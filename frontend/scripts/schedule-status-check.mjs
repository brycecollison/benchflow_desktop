// node frontend/scripts/schedule-status-check.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true } });
try {
  globalThis.window = {};
  globalThis.localStorage = { getItem: () => null };
  const { useLabStore } = await server.ssrLoadModule('/src/store/useLabStore.ts');
  const base = { id: 'e', name: 'Scheduling', status: 'Planning', priority: '', paper: '', deps: [], blocks: [] };
  let saves = 0;
  const reset = (fields = {}) => useLabStore.setState({
    projects: [{ id: 'p', name: 'Project', exps: [{ ...base, ...fields }] }],
    saveState: async () => { saves++; },
  });
  const experiment = () => useLabStore.getState().projects[0].exps[0];
  const schedule = (phase, date = '2026-04-01') => useLabStore.getState().updatePhaseSchedule('p', 'e', phase, date);
  const update = (fields) => useLabStore.getState().updateExperiment('p', 'e', fields);

  reset();
  schedule('experimentalProtocol');
  schedule('dataAcquisition');
  assert.equal(experiment().status, 'Planning', 'Partial scheduling keeps Planning');
  const before = saves;
  schedule('dataAnalysis');
  assert.equal(experiment().status, 'Planned', 'Scheduling the last legacy phase promotes to Planned');
  assert.equal(saves, before + 1, 'Schedule and status save together');
  schedule('dataAnalysis', '');
  assert.equal(experiment().status, 'Planned', 'Unscheduling does not automatically demote status');

  reset({ phases: ['dataAnalysis', 'custom'], customPhases: [{ id: 'custom', name: 'Custom' }] });
  schedule('dataAnalysis');
  assert.equal(experiment().status, 'Planning', 'Custom phases must also be scheduled');
  useLabStore.getState().updatePhase('p', 'e', 'custom', { startDate: ' 2026-04-02 ' });
  assert.equal(experiment().status, 'Planned', 'Custom start dates count without requiring an end date');

  reset({ phases: ['dataAnalysis'] });
  useLabStore.getState().updatePhase('p', 'e', 'dataAnalysis', { endDate: '2026-04-02', duration: '1 day' });
  assert.equal(experiment().status, 'Planning', 'An end date or duration alone is not scheduled');
  update({ dataAnalysisStartDate: '   ' });
  assert.equal(experiment().status, 'Planning', 'Whitespace is not a scheduled date');
  update({ dataAnalysisStartDate: '2026-04-01' });
  assert.equal(experiment().status, 'Planned', 'Direct experiment updates also promote status');

  reset({ phases: ['experimentalProtocol', 'dataAnalysis'], experimentalProtocolStartDate: '2026-04-01' });
  update({ phases: ['experimentalProtocol'] });
  assert.equal(experiment().status, 'Planned', 'Removing the last unscheduled phase rechecks included phases');
  reset({ phases: [] });
  update({ name: 'No phases' });
  assert.equal(experiment().status, 'Planning', 'An experiment with no phases is not automatically planned');

  for (const status of ['Planned', 'Running', 'Blocked', 'Done']) {
    reset({ phases: ['dataAnalysis'], status });
    schedule('dataAnalysis');
    assert.equal(experiment().status, status, `Scheduling preserves ${status}`);
  }
  reset({ phases: ['dataAnalysis'] });
  update({ dataAnalysisStartDate: '2026-04-01', status: 'Planning' });
  assert.equal(experiment().status, 'Planning', 'Explicit status changes remain authoritative');
  reset({ phases: ['dataAnalysis'] });
  useLabStore.getState().updatePhase('p', 'e', 'dataAnalysis', { startDate: '2026-04-01', completed: true });
  assert.equal(experiment().status, 'Done', 'Existing automatic completion takes priority');
  console.log('PASS: scheduling promotes Planning to Planned across shared update paths, custom/legacy/selected phases, atomic saves, empty phases, and status preservation');
} finally {
  delete globalThis.window;
  delete globalThis.localStorage;
  await server.close();
}
