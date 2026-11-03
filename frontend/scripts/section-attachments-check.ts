// node frontend/scripts/section-attachments-check.ts
import assert from 'node:assert/strict';
import { sectionBlocks, sectionOwnership } from '../src/utils/sectionAttachments.ts';
import type { ELNBlock } from '../src/types/lab.ts';

const blocks: ELNBlock[] = [
  { type: 'txt', text: 'Legacy Results' },
  { type: 'img', name: 'purpose.png', src: '/uploads/purpose.png', section: 'purpose' },
  { type: 'tbl', name: 'legacy.csv', rows: [] },
  { type: 'file', name: 'protocol.pdf', src: '/uploads/protocol.pdf', mimeType: 'application/pdf', size: 1, ...sectionOwnership('experimentalProtocol') },
];
assert.deepEqual(sectionBlocks(blocks, 'results').map((entry) => entry.index), [0, 2], 'Legacy blocks stay in Results with original removal indices');
assert.deepEqual(sectionBlocks(blocks, 'purpose').map((entry) => entry.index), [1]);
assert.deepEqual(sectionOwnership('dataAnalysis'), { section: 'dataAnalysis', phase: 'dataAnalysis' });
assert.deepEqual(sectionOwnership('purpose'), { section: 'purpose' });
assert.equal(sectionBlocks(blocks, 'experimentalProtocol')[0].block.phase, 'experimentalProtocol');
assert.equal(sectionBlocks(blocks, 'notes').length, 0);
console.log('PASS: section ownership, workflow assignment, legacy grouping, and removal indices');
