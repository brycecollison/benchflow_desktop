import { Mark } from '@tiptap/core';

export const HIGHLIGHT_COLORS = { yellow: '#fde047', green: '#86efac', blue: '#93c5fd', pink: '#f9a8d4', orange: '#fdba74', purple: '#d8b4fe' } as const;
export type HighlightColor = keyof typeof HIGHLIGHT_COLORS;

/** Colors are stored as a name so saved Markdown stays `<mark data-color="green">`; a bare `<mark>` (older notes) is yellow. */
export const Highlight = Mark.create({
  name: 'highlight',
  addAttributes: () => ({
    color: {
      default: 'yellow',
      parseHTML: (element) => (element.getAttribute('data-color') as string) in HIGHLIGHT_COLORS ? element.getAttribute('data-color') : 'yellow',
      renderHTML: (attrs) => ({ 'data-color': attrs.color }),
    },
  }),
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: ({ HTMLAttributes }) => ['mark', HTMLAttributes, 0],
});
