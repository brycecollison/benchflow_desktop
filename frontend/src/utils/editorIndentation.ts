import type { Editor, NodeViewRenderer } from '@tiptap/core';

/** Keep literal leading whitespace editable while giving wrapped lines the same inset. */
export const indentedTextBlockView: NodeViewRenderer = ({ node, HTMLAttributes }) => {
  const dom = document.createElement(node.type.name === 'heading' ? `h${node.attrs.level}` : 'p');
  for (const [name, value] of Object.entries(HTMLAttributes)) dom.setAttribute(name, String(value));
  let frame = 0;
  const measure = () => {
    const leading = dom.textContent?.match(/^[ \t\u00a0\u2003]+/)?.[0].length || 0;
    let width = 0;
    if (leading) {
      const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
      let remaining = leading;
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (remaining > (text.textContent?.length || 0)) {
          remaining -= text.textContent?.length || 0;
          continue;
        }
        const range = document.createRange();
        range.setStart(dom, 0);
        range.setEnd(text, remaining);
        width = range.getBoundingClientRect().width;
        break;
      }
    }
    // Offset the first line back so its existing whitespace is not counted twice.
    dom.style.paddingInlineStart = width ? `${width}px` : '';
    dom.style.textIndent = width ? `${-width}px` : '';
  };
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
  const observer = new ResizeObserver(schedule);
  observer.observe(dom);
  schedule();
  return {
    dom,
    contentDOM: dom,
    update: (next) => {
      if (!next.sameMarkup(node)) return false;
      schedule();
      return true;
    },
    ignoreMutation: (mutation) => mutation.type === 'attributes' && mutation.target === dom,
    destroy: () => { cancelAnimationFrame(frame); observer.disconnect(); },
  };
};

/** Edit each selected line from the end so positions and the original selection stay intact. */
export const indentSelectedLines = (editor: Editor, outdent: boolean) => {
  const { doc, selection, tr } = editor.state;
  const edits: { position: number; remove: number; text: string }[] = [];
  doc.nodesBetween(selection.from, selection.to, (node, position) => {
    if (!node.isTextblock) return;
    const text = node.textBetween(0, node.content.size, '\n', (leaf) => leaf.type.name === 'hardBreak' ? '\n' : '\ufffc');
    let offset = 0;
    for (const line of text.split('\n')) {
      const start = position + 1 + offset;
      if (start < selection.to && start + line.length >= selection.from) {
        const remove = outdent ? line.match(/^(?:[\u2003\t]|[\u00a0 ]{1,4})/)?.[0].length || 0 : 0;
        if (!outdent || remove) edits.push({ position: start, remove, text: outdent ? '' : node.type.spec.code ? '\t' : '\u2003' });
      }
      offset += line.length + 1;
    }
    return false;
  });
  for (const edit of edits.reverse()) {
    if (edit.remove) tr.delete(edit.position, edit.position + edit.remove);
    else tr.insertText(edit.text, edit.position);
  }
  if (tr.docChanged) editor.view.dispatch(tr.setSelection(selection.map(tr.doc, tr.mapping)).scrollIntoView());
};

/** Reconnect lists split by display math so their first item can nest under the preceding item. */
export const sinkListItemAcrossMath = (editor: Editor): boolean => {
  const { selection } = editor.state;
  const range = selection.$from.blockRange(selection.$to, (node) => node.firstChild?.type.name === 'listItem');
  if (!range || range.startIndex !== 0) return false;

  const list = range.parent;
  const listPosition = range.$from.before(range.depth);
  const parent = range.$from.node(range.depth - 1);
  let previousIndex = range.$from.index(range.depth - 1) - 1;
  let previousPosition = listPosition;
  let between = list.content.cut(0, 0);
  while (previousIndex >= 0) {
    const node = parent.child(previousIndex);
    if (node.type.name !== 'blockMath' && !(node.type.name === 'paragraph' && node.content.size === 0)) break;
    between = between.addToStart(node);
    previousPosition -= node.nodeSize;
    previousIndex--;
  }
  if (previousIndex < 0) return false;
  const previous = parent.child(previousIndex);
  if (previous.type !== list.type || !previous.lastChild) return false;
  previousPosition -= previous.nodeSize;

  const lastItem = previous.lastChild;
  const items = previous.content.cut(0, previous.content.size - lastItem.nodeSize)
    .addToEnd(lastItem.copy(lastItem.content.append(between)))
    .append(list.content);
  return editor.chain().command(({ tr }) => {
    tr.replaceWith(previousPosition, listPosition + list.nodeSize, previous.copy(items));
    return true;
  })
    // Joining the lists removes their two intervening list-boundary tokens.
    .setTextSelection({ from: selection.from - 2, to: selection.to - 2 })
    .sinkListItem('listItem').run();
};
