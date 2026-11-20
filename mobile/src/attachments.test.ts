import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentRefs } from './repo.ts';

test('attachment names keep spaces, parentheses and plus signs', () => {
  const exp = {
    id: 'e', name: 'e', results: '![image.png](</uploads/64f2d8a7f3a7_image.png> "image.png")',
    dataAcquisition: '![a](</uploads/08b483bc1ab4_rep 1 + 2 overlay_preview.png> "t") and ![b](/uploads/plain%20name.png) ![c](/uploads/x.png)',
    customPhases: [{ id: 'p', name: 'p', content: '![Rep 3](</uploads/ee3ecd0b8865_Rep 3 (Ponceau S)_preview.png>)' }],
    blocks: [
      { id: '1', type: 'img', name: 'n', src: '/uploads/b595_Rep 1 and 2 (Ponceau S)_preview.png', preview_url: '/uploads/b595_Rep 1 and 2 (Ponceau S)_preview.png', raw_url: '/uploads/b595_big.tif' },
      { id: '2', type: 'file', name: 'doc', src: '/uploads/doc.pdf' },
    ],
  } as any;
  assert.deepEqual(attachmentRefs(exp).sort(), [
    '08b483bc1ab4_rep 1 + 2 overlay_preview.png', '64f2d8a7f3a7_image.png', 'b595_Rep 1 and 2 (Ponceau S)_preview.png',
    'doc.pdf', 'ee3ecd0b8865_Rep 3 (Ponceau S)_preview.png', 'plain name.png', 'x.png',
  ]);
});
