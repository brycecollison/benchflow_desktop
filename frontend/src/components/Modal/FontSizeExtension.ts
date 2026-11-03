import { Mark, getHTMLFromFragment, getSchema, type Extensions, type NodeConfig } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { indentedTextBlockView } from '../../utils/editorIndentation';

export const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72];

export const FontSize = Mark.create({
  name: 'fontSize',
  priority: 101,
  addAttributes: () => ({
    size: { default: 14, renderHTML: (attrs) => ({ style: `font-size: ${attrs.size}px` }) },
  }),
  parseHTML: () => [{
    style: 'font-size',
    consuming: false,
    getAttrs: (value) => {
      const size = Number(/^(\d+)px$/.exec(value as string)?.[1]);
      return FONT_SIZES.includes(size) ? { size } : false;
    },
  }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
});

export const createFontSizeStarterKit = (extensions: Extensions) => {
  const schema = getSchema([StarterKit, ...extensions]);
  return StarterKit.extend({
    addExtensions() {
      return (this.parent?.() || []).map((extension) => {
        if (extension.name !== 'paragraph' && extension.name !== 'heading') return extension;
        const config: Partial<NodeConfig> = {
          addNodeView: () => indentedTextBlockView,
          parseHTML() {
            return (this.parent?.() || []).map((rule) => ({ ...rule, preserveWhitespace: 'full' as const }));
          },
          renderMarkdown(node, helpers, context) {
            const text = node.content?.map((child) => child.type === 'hardBreak' ? '\n' : child.text || '').join('') || '';
            if (/^[ \t]|\n[ \t]|\t| {2}/.test(text) || node.content?.some((child) => child.marks?.some((mark) => mark.type === 'fontSize' || mark.type === 'highlight'))) {
              // HTML preserves whitespace without Markdown interpreting indentation as a code block, and keeps rich marks intact.
              return getHTMLFromFragment(schema.nodeFromJSON({ type: 'doc', content: [node] }).content, schema);
            }
            return this.parent?.(node, helpers, context) || '';
          },
        };
        return extension.extend(config);
      });
    },
  });
};
