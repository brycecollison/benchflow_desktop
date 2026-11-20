import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffUnits, flatten, phoneMayEdit, stable, unflatten, withUnits } from './units.ts';

const exp: any = {
  id: 'e', name: 'E', status: 'Running', deps: [], experimentalProtocol: 'P',
  blocks: [{ id: 'b1', type: 'txt', text: 'x' }],
  customPhases: [{ id: 'c1', name: 'Imaging', content: 'c', completed: false }],
  deviations: { experimentalProtocol: [{ id: 'd1', at: 't', device_id: 'p', text: 'late' }] },
};

test('flatten and unflatten round-trip (same units as backend merge.py)', () => {
  const units = flatten(exp);
  assert.deepEqual(Object.keys(units).sort(), [
    'blocks/b1', 'blocks:order', 'customPhases/c1/completed', 'customPhases/c1/content', 'customPhases/c1/name',
    'customPhases:order', 'deps', 'deviations/experimentalProtocol', 'experimentalProtocol', 'id', 'name', 'status',
  ]);
  assert.equal(stable(unflatten(units)), stable(exp));
});

test('diff finds only the changed units, ignoring key order', () => {
  const after = { ...exp, notes: 'n', customPhases: [{ completed: true, content: 'c', name: 'Imaging', id: 'c1' }],
    blocks: [...exp.blocks, { id: 'b2', type: 'img', name: 'x', src: '/uploads/x' }] };
  assert.deepEqual(diffUnits(exp, after).map((c) => c.unit).sort(), ['blocks/b2', 'customPhases/c1/completed', 'notes']);
});

test('withUnits applies changes, appends new blocks, deletes with null', () => {
  const next: any = withUnits(exp, [{ unit: 'blocks/b2', value: { id: 'b2', type: 'txt', text: 'y' } }, { unit: 'blocks/b1', value: null }]);
  assert.deepEqual(next.blocks.map((b: any) => b.id), ['b2']);
});

test('the phone may edit text, phase fields, blocks and deviations, not structure', () => {
  for (const u of ['notes', 'status', 'experimentalProtocolCompleted', 'customPhases/c1/content', 'blocks/x', 'deviations/dataAnalysis']) assert.ok(phoneMayEdit(u), u);
  for (const u of ['deps', 'phases', 'px', 'paper', 'customPhases/c1/name', 'blocks:order']) assert.ok(!phoneMayEdit(u), u);
});
