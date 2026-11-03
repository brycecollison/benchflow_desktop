import React, { useEffect, useRef, useState } from 'react';
import { ImagePreview } from './ImagePreviewExtension';
import type { JSONContent } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { Bold, Italic, Underline, Strikethrough, List, ListOrdered, Quote, Code, Link, Undo2, Redo2, Table, Highlighter, RemoveFormatting, ImagePlus, Sigma, SquareFunction } from 'lucide-react';
import { promptDialog, alertDialog } from '../../store/useDialogStore';
import { InlineMath, BlockMath } from './MathExtension';
import { FontSize, createFontSizeStarterKit, FONT_SIZES } from './FontSizeExtension';
import { Highlight } from './HighlightExtension';
import { indentSelectedLines, sinkListItemAcrossMath } from '../../utils/editorIndentation';
import './SectionTextEditor.css';

const contentExtensions = [TableKit, FontSize, Highlight, InlineMath, BlockMath, ImagePreview.configure({ inline: true })];
const SectionStarterKit = createFontSizeStarterKit(contentExtensions);

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onUploadImage: (file: File) => Promise<string>;
  toolbarTarget: HTMLElement | null;
  toolbarActive: boolean;
  onActivate: () => void;
  onEnlargeImage: (src: string, name: string) => void;
}

const containsMath = (node: JSONContent): boolean =>
  node.type === 'inlineMath' || node.type === 'blockMath' || (node.content?.some(containsMath) ?? false);

/** Markdown keeps rich content readable/editable in the existing popup and exports. */
export const SectionTextEditor: React.FC<Props> = ({ label, value, onChange, onUploadImage, toolbarTarget, toolbarActive, onActivate, onEnlargeImage }) => {
  const lastValue = useRef(value);
  const imageInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [imageErrors, setImageErrors] = useState<string[]>([]);
  const editor: Editor | null = useEditor({
    enablePasteRules: ['link', 'inlineMath', 'blockMath'],
    extensions: [
      SectionStarterKit.configure({ link: { openOnClick: false, defaultProtocol: 'https' } }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
      ...contentExtensions,
    ],
    content: value,
    contentType: 'markdown',
    editorProps: {
      transformPastedHTML: (html) => {
        const document = new DOMParser().parseFromString(html, 'text/html');
        if (document.querySelector('[data-pm-slice]')) return html;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          if (!/[\r\n]/.test(text.textContent || '')) continue;
          let preformatted = false;
          for (let parent = text.parentElement; parent; parent = parent.parentElement) {
            if (parent.matches('pre, code') || /^(pre|pre-wrap|pre-line|break-spaces)$/.test(parent.style.whiteSpace)) { preformatted = true; break; }
          }
          if (preformatted) continue;
          let value = (text.textContent || '').replace(/\r\n?/g, '\n');
          const block = /^(P|H[1-6]|DIV|LI|TD|TH)$/.test(text.parentElement?.tagName || '');
          if (block && !text.previousSibling) value = value.replace(/^[ \t]*\n[ \t]*/, '');
          if (block && !text.nextSibling) value = value.replace(/[ \t]*\n[ \t]*$/, '');
          // Source-code wrapping in normal HTML is whitespace, not a visible line break.
          text.textContent = value.replace(/[ \t]*\n[ \t]*/g, ' ');
        }
        return document.body.innerHTML;
      },
      clipboardTextParser: (text, context, _plainText, view) => {
        const { schema } = view.state;
        const paragraphs = text.replace(/\r\n?/g, '\n').split('\n').map((line) =>
          schema.nodes.paragraph.create(null, line ? schema.text(line, context.marks()) : undefined));
        return Slice.maxOpen(Fragment.from(paragraphs));
      },
      handleScrollToSelection: (view) => {
        const dialog = view.dom.closest<HTMLElement>('[data-experiment-scroll]');
        if (!dialog) return false;
        const headerHeight = parseFloat(getComputedStyle(dialog).getPropertyValue('--experiment-header-height')) || 0;
        const top = dialog.getBoundingClientRect().top + headerHeight + 8;
        const caretTop = view.coordsAtPos(view.state.selection.head).top;
        if (caretTop >= top) return false;
        // ProseMirror's default scrolling does not account for the pinned header.
        dialog.scrollTop -= top - caretTop;
        return true;
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && editor && !editor.isActive('listItem')) {
          const { $from, $to } = view.state.selection;
          const indent = $from.parent.type.name === 'paragraph' ? $from.parent.textContent.match(/^[ \t\u00a0\u2003]+/)?.[0] : undefined;
          if (indent && $from.sameParent($to) && $from.parentOffset >= indent.length) {
            const handled = editor.chain().splitBlock().command(({ tr }) => { tr.insertText(indent); return true; }).scrollIntoView().run();
            if (handled) event.preventDefault();
            return handled;
          }
        }
        if (event.key !== 'Tab') return false;
        event.preventDefault();
        if (editor?.isActive('listItem')) {
          if (event.shiftKey) editor.commands.liftListItem('listItem');
          else if (!editor.commands.sinkListItem('listItem')) sinkListItemAcrossMath(editor);
        } else if (!view.state.selection.empty && editor) {
          indentSelectedLines(editor, event.shiftKey);
        } else if (event.shiftKey) {
          const { $from, from } = view.state.selection;
          const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc');
          const lineStart = before.lastIndexOf('\n') + 1;
          const line = $from.parent.textBetween(lineStart, $from.parent.content.size, '\n', '\ufffc');
          const leading = line.match(/^(?:[\u2003\t]|[\u00a0 ]{1,4})/)?.[0].length || 0;
          const spaces = leading || before.match(/(?:[\u2003\t]|[\u00a0 ]{1,4})$/)?.[0].length || 0;
          const start = leading ? $from.start() + lineStart : from - spaces;
          if (spaces) view.dispatch(view.state.tr.delete(start, start + spaces));
        } else {
          // One em-space deletes atomically and survives Markdown without becoming a code block.
          view.dispatch(view.state.tr.insertText(editor?.isActive('codeBlock') ? '\t' : '\u2003').scrollIntoView());
        }
        return true;
      },
      handlePaste: (_view, event) => {
        const clipboard = event.clipboardData;
        const images = Array.from(clipboard?.items || [])
          .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null);
        const files = images.length ? images : Array.from(clipboard?.files || []).filter((file) => file.type.startsWith('image/'));
        if (files.length) {
          event.preventDefault();
          void uploadImages(files);
          return true;
        }
        // Let the normal rich-text paste preserve HTML; math paste rules replace only equations.
        if (clipboard?.getData('text/html')) return false;
        const text = clipboard?.getData('text/plain');
        if (!text?.includes('$') || !editor?.markdown || editor.isActive('codeBlock') || editor.isActive('code')) return false;
        // Pasting does not run typing rules; reuse the saved-Markdown parser for equations.
        const content = editor.markdown.parse(text);
        if (!containsMath(content)) return false;
        event.preventDefault();
        return editor.commands.insertContent(content);
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (position) editor?.commands.setTextSelection(position.pos);
        void uploadImages(files);
        return true;
      },
      attributes: {
      class: 'section-document',
      role: 'textbox',
      'aria-label': `${label} editor`,
      'aria-multiline': 'true',
    } },
    onFocus: () => onActivate(),
    onUpdate: ({ editor: current }) => {
      const markdown = current.getMarkdown();
      lastValue.current = markdown;
      onChange(markdown);
    },
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? {
      bold: current.isActive('bold'), italic: current.isActive('italic'), underline: current.isActive('underline'),
      highlight: current.isActive('highlight'), strike: current.isActive('strike'), bullet: current.isActive('bulletList'), ordered: current.isActive('orderedList'),
      quote: current.isActive('blockquote'), code: current.isActive('codeBlock'), link: current.isActive('link'),
      heading: [1, 2, 3].find((level) => current.isActive('heading', { level })) || 0,
      fontSize: current.getAttributes('fontSize').size || '',
      inlineMath: current.isActive('inlineMath'), blockMath: current.isActive('blockMath'),
      table: current.isActive('table'), undo: current.can().undo(), redo: current.can().redo(),
    } : null,
  });

  useEffect(() => {
    if (editor && value !== lastValue.current) {
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
      lastValue.current = value;
    }
  }, [editor, value]);

  const uploadImages = async (files: File[]) => {
    if (!editor || editor.isDestroyed) return;
    setUploading(true);
    setImageErrors([]);
    // Keep the originating editor/callback when an upload outlives a phase switch.
    for (const file of files) {
      try {
        const src = await onUploadImage(file);
        if (!editor.isDestroyed) editor.chain().focus().setImage({ src, alt: file.name, title: file.name }).run();
      } catch (error) {
        setImageErrors((previous) => [...previous, `${file.name}: ${error instanceof Error ? error.message : 'Image upload failed'}`]);
      }
    }
    setUploading(false);
  };

  if (!editor || !state) return null;
  const setLink = async () => {
    const url = await promptDialog({ title: 'Insert link', message: 'Use an https://, http://, or mailto: URL. Leave blank to remove the link.', defaultValue: editor.getAttributes('link').href || '' });
    if (url === null) return;
    if (!url.trim()) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    if (!/^(https?:\/\/|mailto:)/i.test(url.trim())) {
      await alertDialog({ title: 'Invalid link', message: 'Please enter an https://, http://, or mailto: URL.', variant: 'danger' });
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };
  const setEquation = async (display: boolean) => {
    const type = display ? 'blockMath' : 'inlineMath';
    const selected = editor.isActive(type);
    const selection = editor.state.selection;
    const latex = await promptDialog({
      title: selected ? 'Edit equation' : 'Insert equation',
      message: 'Enter LaTeX without $ delimiters (for example: \\frac{a}{b}). Select an equation and use this button to edit it.',
      defaultValue: selected ? editor.getAttributes(type).latex : '',
    });
    if (latex === null || !latex.trim() || editor.isDestroyed) return;
    if (selected) editor.chain().focus().setNodeSelection(selection.from).updateAttributes(type, { latex: latex.trim() }).run();
    else editor.chain().focus().setTextSelection({ from: selection.from, to: selection.to }).insertContent({ type, attrs: { latex: latex.trim() } }).run();
  };
  const tools = [
    { label: 'Bold', icon: Bold, active: state.bold, run: () => editor.chain().focus().toggleBold().run() },
    { label: 'Italic', icon: Italic, active: state.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'Underline', icon: Underline, active: state.underline, run: () => editor.chain().focus().toggleUnderline().run() },
    { label: 'Strikethrough', icon: Strikethrough, active: state.strike, run: () => editor.chain().focus().toggleStrike().run() },
    { label: 'Highlight', icon: Highlighter, active: state.highlight, run: () => editor.chain().focus().toggleMark('highlight').run() },
    { label: 'Bullet list', icon: List, active: state.bullet, run: () => editor.chain().focus().toggleBulletList().run() },
    { label: 'Numbered list', icon: ListOrdered, active: state.ordered, run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: 'Quote', icon: Quote, active: state.quote, run: () => editor.chain().focus().toggleBlockquote().run() },
    { label: 'Code block', icon: Code, active: state.code, run: () => editor.chain().focus().toggleCodeBlock().run() },
    { label: 'Link', icon: Link, active: state.link, run: () => { void setLink(); } },
    { label: 'Inline equation', icon: Sigma, active: state.inlineMath, run: () => { void setEquation(false); } },
    { label: 'Display equation', icon: SquareFunction, active: state.blockMath, run: () => { void setEquation(true); } },
    { label: 'Insert table', icon: Table, run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { label: 'Clear formatting', icon: RemoveFormatting, run: () => editor.chain().focus().unsetAllMarks().clearNodes().run() },
    { label: 'Undo', icon: Undo2, disabled: !state.undo, run: () => editor.chain().focus().undo().run() },
    { label: 'Redo', icon: Redo2, disabled: !state.redo, run: () => editor.chain().focus().redo().run() },
  ];
  const renderFontSize = () => (
    <select aria-label="Font size" title="Font size" value={state.fontSize}
      onChange={(event) => {
        const size = Number(event.target.value);
        if (size) editor.chain().focus().setMark('fontSize', { size }).run();
        else editor.chain().focus().unsetMark('fontSize').run();
      }} className="!text-xs !py-1">
      <option value="">Default</option>
      {FONT_SIZES.map((size) => <option key={size} value={size}>{size} px</option>)}
    </select>
  );
  const renderTool = (tool: (typeof tools)[number]) => (
    <button key={tool.label} type="button" aria-label={tool.label} title={tool.label} aria-pressed={tool.active} disabled={tool.disabled}
      onMouseDown={(event) => event.preventDefault()} onClick={tool.run}
      className={`!p-1.5 !rounded !border-0 disabled:opacity-30 ${tool.active ? '!bg-[var(--sel)] !text-[var(--acc)]' : '!bg-transparent hover:!bg-[var(--sel)]'}`}>
      <tool.icon size={15} />
    </button>
  );
  return (
    <div className="min-w-0">
      {toolbarActive && toolbarTarget && createPortal(
      <div role="toolbar" aria-label="Experiment formatting" data-section={label}
        onClick={() => editor.commands.scrollIntoView()} onChange={() => editor.commands.scrollIntoView()}
        className="flex flex-wrap items-center gap-1 px-4 md:px-6 py-2 border-b border-[var(--line)] bg-[var(--bg)]">
        <span className="text-xs text-[var(--mut)] mr-2">Editing: {label}</span>
        <select aria-label="Text style" value={state.heading} onChange={(event) => {
          const level = Number(event.target.value) as 0 | 1 | 2 | 3;
          if (level) editor.chain().focus().setHeading({ level }).run();
          else editor.chain().focus().setParagraph().run();
        }} className="!text-xs !py-1">
          <option value={0}>Paragraph</option><option value={1}>Heading 1</option><option value={2}>Heading 2</option><option value={3}>Heading 3</option>
        </select>
        {renderFontSize()}
        {tools.map((tool) => renderTool(tool))}
        <input ref={imageInput} type="file" accept="image/*" multiple className="hidden" aria-label={`Insert images into ${label}`} onChange={(event) => {
          const files = Array.from(event.currentTarget.files || []);
          event.currentTarget.value = '';
          void uploadImages(files);
        }} />
        <button type="button" aria-label="Insert image" title="Insert image" disabled={uploading} className="!p-1.5 !border-0 !bg-transparent" onMouseDown={(event) => event.preventDefault()} onClick={() => imageInput.current?.click()}><ImagePlus size={15} /></button>
        {state.table && (
          <>
            <button type="button" className="!text-xs !py-1" onClick={() => editor.chain().focus().addRowAfter().run()}>Add row</button>
            <button type="button" className="!text-xs !py-1" onClick={() => editor.chain().focus().addColumnAfter().run()}>Add column</button>
            <button type="button" className="!text-xs !py-1" onClick={() => editor.chain().focus().deleteRow().run()}>Delete row</button>
            <button type="button" className="!text-xs !py-1" onClick={() => editor.chain().focus().deleteColumn().run()}>Delete column</button>
            <button type="button" className="!text-xs !py-1" onClick={() => editor.chain().focus().deleteTable().run()}>Delete table</button>
          </>
        )}
      </div>, toolbarTarget)}
      {uploading && <p role="status" className="text-xs text-[var(--acc)]">Uploading inline image…</p>}
      {imageErrors.map((error, index) => <p key={index} role="alert" className="text-xs text-red-600">{error}</p>)}
      {toolbarActive && <BubbleMenu editor={editor} options={{ strategy: 'fixed', scrollTarget: editor.view.dom.closest<HTMLElement>('[data-experiment-scroll]') ?? window }}
        role="toolbar" aria-label="Text selection formatting"
        className="z-50 flex flex-wrap items-center gap-1 max-w-[calc(100vw-16px)] p-1 rounded-md border border-[var(--line)] bg-[var(--bg)] shadow-lg">
        {renderFontSize()}
        {tools.filter((tool) => ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Highlight', 'Link', 'Clear formatting'].includes(tool.label)).map(renderTool)}
      </BubbleMenu>}
      <EditorContent editor={editor} onClick={(event) => {
        const button = (event.target as Element).closest('[data-enlarge-image]');
        const image = button?.parentElement?.querySelector('img');
        if (image) {
          event.preventDefault();
          onEnlargeImage(image.getAttribute('src') || '', image.title || image.alt || 'Image');
        }
      }} />
      <div className="px-3 py-1 text-[10px] text-[var(--mut)]">Rich text · Math: $inline$ or $$display$$ · Select equations to edit via toolbar · Paste screenshots with Ctrl+V (⌘V on Mac) · Changes save automatically</div>
    </div>
  );
};
