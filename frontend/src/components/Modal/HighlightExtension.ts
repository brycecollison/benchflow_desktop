import { Mark } from '@tiptap/core';

export const Highlight = Mark.create({
  name: 'highlight',
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: () => ['mark', {}, 0],
});
