import { Node } from '@tiptap/core';

export const isPdfUrl = (href = '') => /\.pdf$/i.test(href.split(/[?#]/)[0]);

/** Block PDF viewer. Saved as `![name.pdf](</uploads/x.pdf>)` so it stays a plain Markdown image line. */
export const PdfEmbed = Node.create({
  name: 'pdfEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({ src: { default: '' }, name: { default: 'document.pdf' } }),
  parseHTML: () => [{ tag: 'div[data-pdf-embed]', getAttrs: (el) => ({ src: el.getAttribute('data-src'), name: el.getAttribute('data-name') }) }],
  renderHTML: ({ node }) => ['div', { 'data-pdf-embed': '', 'data-src': node.attrs.src, 'data-name': node.attrs.name }],
  renderMarkdown: (node) => `![${node.attrs?.name ?? ''}](<${node.attrs?.src ?? ''}>)`,
  addNodeView: () => ({ node }) => {
    const dom = document.createElement('div');
    dom.className = 'section-pdf-embed';
    dom.contentEditable = 'false';
    const header = document.createElement('div');
    header.className = 'section-pdf-header';
    const name = document.createElement('span');
    name.textContent = node.attrs.name;
    const open = document.createElement('a');
    open.href = node.attrs.src;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = 'Open';
    header.append(name, open);
    const frame = document.createElement('iframe');
    frame.title = node.attrs.name;
    frame.src = node.attrs.src;
    dom.append(header, frame);
    // Clicks inside the iframe never reach ProseMirror; the link must not be treated as an editor event.
    return { dom, stopEvent: (event) => event.target instanceof Element && Boolean(event.target.closest('a')) };
  },
});
