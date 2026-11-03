// node frontend/scripts/gantt-check.ts
import assert from 'node:assert/strict';
import { getGanttPhases, toCalendarDay } from '../src/utils/gantt.ts';
import type { Experiment, Project } from '../src/types/lab.ts';

const base: Experiment = {
  id: 'exp', name: 'Experiment', status: 'Planned', priority: '', paper: '', deps: [], blocks: [],
  experimentalProtocolStartDate: '2026-03-07',
};
const project = (exps: Experiment[], archived = false): Project => ({
  id: 'project', name: 'Project', exps, archived,
});
const phases = (exp: Partial<Experiment> = {}) => getGanttPhases([project([{ ...base, ...exp }])]);

assert.equal(phases().length, 1, 'Scheduled legacy phases are included');
assert.equal(phases({ experimentalProtocolCompleted: true }).length, 0, 'Completed phases are hidden');
assert.equal(phases({ experimentalProtocolStartDate: '' }).length, 0, 'Unscheduled phases are hidden');
assert.equal(phases({ experimentalProtocolStartDate: 'not a date' }).length, 0, 'Invalid start dates are hidden');
assert.equal(phases({ phases: ['dataAnalysis'] }).length, 0, 'Excluded phases stay hidden even with stale dates');
assert.equal(phases({ phases: ['Protocol'] }).length, 1, 'Legacy phase names are respected');
assert.equal(getGanttPhases([project([base], true)]).length, 0, 'Archived projects are hidden');

const mixed = phases({
  experimentalProtocolCompleted: true,
  dataAcquisitionStartDate: '2026-03-09',
  dataAnalysisStartDate: '2026-03-10', dataAnalysisCompleted: true,
});
assert.deepEqual(mixed.map((phase) => phase.phaseKey), ['dataAcquisition'], 'Only incomplete phases are returned');
assert.equal(mixed[0].experimentId, base.id, 'Rows link to the correct experiment');

let phase = phases({ experimentalProtocolDuration: '3 days' })[0];
assert.equal(phase.endDay - phase.startDay + 1, 3, 'Duration fallback is inclusive across DST');
phase = phases({ experimentalProtocolEndDate: base.experimentalProtocolStartDate, experimentalProtocolDuration: '2 weeks' })[0];
assert.equal(phase.endDay - phase.startDay + 1, 14, 'Same-day end dates use multi-day duration');
phase = phases({ experimentalProtocolEndDate: '2026-03-10', experimentalProtocolDuration: '2 weeks' })[0];
assert.equal(phase.endDay - phase.startDay + 1, 4, 'Explicit date ranges override duration');
phase = phases({ experimentalProtocolEndDate: '2026-03-01' })[0];
assert.equal(phase.endDay, phase.startDay, 'Reversed date ranges cannot produce negative bars');
phase = phases({ experimentalProtocolDuration: '1/2 day' })[0];
assert.equal(phase.endDay, phase.startDay, 'Half-day phases occupy a day');
assert.equal(toCalendarDay('2026-02-30'), null, 'Impossible ISO dates are rejected');
assert.equal(toCalendarDay('2024-02-29')! + 1, toCalendarDay('2024-03-01'), 'Leap days are preserved');
assert.equal(toCalendarDay('Tuesday, June 23, 2026'), toCalendarDay('2026-06-23'), 'Legacy notebook dates are supported');
console.log('PASS: Gantt phase filtering, date handling, and inclusive durations');
