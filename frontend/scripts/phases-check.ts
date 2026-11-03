import {
  checkAllPhasesCompleted,
  getExperimentPhases,
  getExperimentPhaseData,
  getWorkflowPhaseMeta,
} from '../src/types/lab.ts';

import { getCalendarPhaseFilterKey } from '../src/utils/calendarPhaseFilters.ts';

let failed = 0;
const t = (name: string, cond: boolean) => {
  if (!cond) { failed++; console.error('FAIL:', name); } else { console.log('ok:', name); }
};

const base: any = { id: 'e1', name: 'x', blocks: [] };

const filterKeys = ['experimentalProtocol', 'dataAcquisition', 'dataAnalysis', 'phase_staining', 'phase_washing'].map(getCalendarPhaseFilterKey);
t('custom phases share a single Calendar filter', new Set(filterKeys).size === 4);
t('built-in Calendar filters remain independent', filterKeys[0] === 'experimentalProtocol' && filterKeys[1] === 'dataAcquisition' && filterKeys[2] === 'dataAnalysis');
const hiddenFilters = new Set(['customPhases']);
t('custom filter hides every custom phase but not built-ins', filterKeys.map((key) => hiddenFilters.has(key)).join() === 'false,false,false,true,true');
hiddenFilters.clear();
t('clearing custom filter restores all phases', filterKeys.every((key) => !hiddenFilters.has(key)));

t('legacy exp gets all 3 phases',
  JSON.stringify(getExperimentPhases(base)) === '["experimentalProtocol","dataAcquisition","dataAnalysis"]');
t('explicit phases -> canonical order subset',
  JSON.stringify(getExperimentPhases({ ...base, phases: ['dataAnalysis', 'experimentalProtocol'] })) === '["experimentalProtocol","dataAnalysis"]');
t('explicit empty phases array stays empty',
  getExperimentPhases({ ...base, phases: [] }).length === 0);
t('null phases retain legacy defaults',
  getExperimentPhases({ ...base, phases: null }).length === 3);
t('no phases does not auto-complete the experiment',
  checkAllPhasesCompleted({ ...base, phases: [] }) === false);
t('single included phase done -> completed',
  checkAllPhasesCompleted({ ...base, phases: ['experimentalProtocol'], experimentalProtocolCompleted: true }) === true);
t('one included phase not done -> not completed',
  checkAllPhasesCompleted({ ...base, phases: ['experimentalProtocol', 'dataAnalysis'], experimentalProtocolCompleted: true }) === false);
t('legacy exp all 3 done -> completed',
  checkAllPhasesCompleted({ ...base, experimentalProtocolCompleted: true, dataAcquisitionCompleted: true, dataAnalysisCompleted: true }) === true);

// Custom phase tests
const customExp: any = {
  ...base,
  phases: ['phase_staining', 'dataAnalysis'],
  customPhases: [
    {
      id: 'phase_staining',
      name: 'Tissue Staining',
      content: 'Stain slices with DAPI',
      duration: '2 days',
      startDate: '2026-04-01',
      endDate: '2026-04-02',
      completed: false,
    },
  ],
};

t('custom phases preserved in experiment phases',
  JSON.stringify(getExperimentPhases(customExp)) === '["dataAnalysis","phase_staining"]');

t('custom phase data retrieved correctly',
  getExperimentPhaseData(customExp, 'phase_staining').label === 'Tissue Staining' &&
  getExperimentPhaseData(customExp, 'phase_staining').duration === '2 days' &&
  getExperimentPhaseData(customExp, 'phase_staining').startDate === '2026-04-01');

t('custom phase metadata generated with color theme',
  getWorkflowPhaseMeta('phase_staining', customExp).label === 'Tissue Staining' &&
  Boolean(getWorkflowPhaseMeta('phase_staining', customExp).colorTheme.badge));

const orphanId = 'phase_1792791415389_hm0n';
for (const customPhases of [undefined, null, [{ id: orphanId, name: orphanId }], [{ id: orphanId, name: '  ' }]]) {
  const orphan = { ...base, phases: [orphanId], customPhases };
  t('missing custom names never expose generated IDs',
    getWorkflowPhaseMeta(orphanId, orphan).label === 'Custom Phase' &&
    getExperimentPhaseData(orphan, orphanId).label === 'Custom Phase');
}
t('legacy human-readable phase keys remain readable',
  getWorkflowPhaseMeta('Tissue Staining', base).label === 'Tissue Staining');

t('experiment with custom phase not completed when custom phase incomplete',
  checkAllPhasesCompleted({ ...customExp, dataAnalysisCompleted: true }) === false);

t('experiment with custom phase completed when both completed',
  checkAllPhasesCompleted({
    ...customExp,
    dataAnalysisCompleted: true,
    customPhases: [{ ...customExp.customPhases[0], completed: true }],
  }) === true);

t('solo custom phase completed -> experiment completed',
  checkAllPhasesCompleted({
    ...base,
    phases: ['phase_staining'],
    customPhases: [{ ...customExp.customPhases[0], completed: true }],
  }) === true);

let removing = { ...customExp, phases: ['experimentalProtocol', 'dataAcquisition', 'dataAnalysis', 'phase_staining'] };
for (const key of [...removing.phases]) {
  removing = { ...removing, phases: getExperimentPhases(removing).filter((phase) => phase !== key) };
}
t('removing every phase does not restore built-ins or hidden customs',
  getExperimentPhases(removing).length === 0);
t('empty phase selection survives JSON reload',
  getExperimentPhases(JSON.parse(JSON.stringify(removing))).length === 0);

process.exit(failed ? 1 : 0);