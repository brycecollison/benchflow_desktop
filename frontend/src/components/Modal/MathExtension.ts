import { InputRule, Node, PasteRule, mergeAttributes } from '@tiptap/core';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
// Only load mathematical packages, not HTML, URLs, or runtime package loading.
const mathDocument = mathjax.document('', {
  InputJax: new TeX({ packages: ['base', 'ams'], maxBuffer: 10000, maxMacros: 1000 }),
  OutputJax: new SVG({ fontCache: 'none' }),
});

const mathNode = (display: boolean) => {
  const name = display ? 'blockMath' : 'inlineMath';
  const tag = display ? 'div' : 'span';
  const delimiter = display ? '$$' : '$';
  const pattern = display ? /^\$\$\s*([\s\S]+?)\s*\$\$(?:\n|$)/ : /^\$(?!\$)((?:\\[^\n]|[^$\\\n])+)\$/;
  return Node.create({
    name,
    group: display ? 'block' : 'inline',
    inline: !display,
    atom: true,
    addAttributes: () => ({ latex: { default: '', parseHTML: (element) => element.getAttribute('data-latex'), renderHTML: (attrs) => ({ 'data-latex': attrs.latex }) } }),
    parseHTML: () => [{ tag: `${tag}[data-type="${name}"]` }],
    renderHTML: ({ node, HTMLAttributes }) => [tag, mergeAttributes(HTMLAttributes, { 'data-type': name }), node.attrs.latex],
    markdownTokenName: name,
    markdownTokenizer: {
      name,
      level: display ? 'block' : 'inline',
      start: (src) => src.indexOf(delimiter),
      tokenize: (src) => {
        const match = pattern.exec(src);
        return match ? { type: name, raw: match[0], text: match[1] } : undefined;
      },
    },
    parseMarkdown: (token, helpers) => helpers.createNode(name, { latex: token.text }),
    renderMarkdown: (node) => display ? `$$\n${node.attrs?.latex}\n$$` : `$${node.attrs?.latex}$`,
    addInputRules() {
      return [new InputRule({
        find: display ? /^\$\$\s*(.+?)\s*\$\$$/ : /(?:^|[^$\\])\$((?:\\[^\n]|[^$\\\n])+)\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          const from = display ? range.from : range.to - latex.length - 2;
          if (display) state.tr.delete(range.from, range.to).setNodeMarkup(range.from - 1, this.type, { latex });
          else state.tr.replaceWith(from, range.to, this.type.create({ latex }));
        },
      })];
    },
    addPasteRules() {
      return [new PasteRule({
        find: display ? /\$\$\s*([\s\S]+?)\s*\$\$/g : /(?<![$\\])\$(?!\$)((?:\\[^\n]|[^$\\\n])+)\$(?!\$)/g,
        handler: ({ state, range, match, chain, pasteEvent }) => {
          if (!pasteEvent?.clipboardData?.getData('text/html')) return;
          const doc = state.tr.doc;
          if (doc.resolve(range.from).parent.type.spec.code || doc.rangeHasMark(range.from, range.to, state.schema.marks.code)) return;
          const marks = display ? [] : doc.resolve(range.from).marks().map((mark) => mark.toJSON());
          chain().deleteRange(range).insertContentAt(range.from, { type: name, attrs: { latex: match[1] }, marks });
        },
      })];
    },
    addNodeView: () => ({ node }) => {
      const dom = document.createElement(tag);
      dom.className = `section-math ${display ? 'section-math-block' : 'section-math-inline'}`;
      dom.setAttribute('role', 'img');
      dom.setAttribute('aria-label', `Equation: ${node.attrs.latex}`);
      dom.title = 'Select equation, then use its equation toolbar button to edit';
      dom.dataset.latex = node.attrs.latex;
      try {
        dom.innerHTML = adaptor.outerHTML(mathDocument.convert(node.attrs.latex, { display }));
      } catch {
        dom.textContent = node.attrs.latex;
        dom.title = 'Unable to render equation; select and edit its LaTeX';
      }
      return { dom };
    },
  });
};

export const InlineMath = mathNode(false);
export const BlockMath = mathNode(true);
