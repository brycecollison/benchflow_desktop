import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgenda, type Project } from './agenda.ts';

const exp = (id: string, start: string, end = '') => ({
  id, name: id, status: 'Planned', priority: '', paper: '', deps: [], blocks: [], phases: ['experimentalProtocol'],
  experimentalProtocolStartDate: start, experimentalProtocolEndDate: end,
}) as any;

test('today pinned, upcoming ascending, past latest-first, unscheduled and archived skipped', () => {
  const projects: Project[] = [
    { id: 'p', name: 'P', exps: [exp('late', '2026-03-10'), exp('now', '2026-02-28', '2026-03-02'),
      exp('soon', 'Thursday, March 5, 2026'), exp('old', '2026-01-01'), exp('older', '2025-01-01'), exp('none', '')] },
    { id: 'a', name: 'A', archived: true, exps: [exp('hidden', '2026-03-01')] },
  ];
  const a = buildAgenda(projects, '2026-03-01');
  assert.deepEqual(a.today.map((r) => r.exp.id), ['now']);
  assert.deepEqual(a.upcoming.map((r) => r.exp.id), ['soon', 'late']);
  assert.deepEqual(a.past.map((r) => r.exp.id), ['old', 'older']);
});
