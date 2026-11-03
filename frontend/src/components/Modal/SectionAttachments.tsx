import React, { useRef, useState } from 'react';
import { Upload, FileText, Download, LoaderCircle, Plus, Maximize2 } from 'lucide-react';
import { useLabStore } from '../../store/useLabStore';
import { confirmDialog } from '../../store/useDialogStore';
import type { ELNBlock, ExperimentSectionKey, ImageBlock } from '../../types/lab';
import { sectionBlocks, sectionOwnership } from '../../utils/sectionAttachments';
import { parseCsvTsv } from '../../utils/csvParser';
import { EnlargeImageButton } from './EnlargedImagePreview';

interface Props {
  projectId: string;
  experimentId: string;
  section: ExperimentSectionKey;
  label: string;
  blocks: ELNBlock[];
  onInspect: (block: ImageBlock) => void;
  fullScreen?: boolean;
  onEnlarge?: (block: ImageBlock) => void;
}

export const SectionAttachments: React.FC<Props> = ({ projectId, experimentId, section, label, blocks, onInspect, fullScreen = false, onEnlarge }) => {
  const { addBlock, removeBlock, updateBlockText, uploadMediaFile } = useLabStore();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const entries = sectionBlocks(blocks, section);
  const ownership = sectionOwnership(section);

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = '';
    setErrors([]);
    for (const file of files) {
      setUploading(file.name);
      try {
        const rows = /\.(csv|tsv)$/i.test(file.name) ? parseCsvTsv(await file.text()).slice(0, 300) : null;
        const uploaded = await uploadMediaFile(file);
        let block: ELNBlock;
        if (rows) {
          block = { type: 'tbl', name: file.name, rows, src: uploaded.raw_url || uploaded.url, ...ownership };
        } else if (uploaded.content_type.startsWith('image/') || /\.(tiff?|nd2)$/i.test(file.name)) {
          block = { type: 'img', name: file.name, src: uploaded.url, preview_url: uploaded.preview_url,
            raw_url: uploaded.raw_url, metadata: uploaded.metadata, format: uploaded.format, ...ownership };
        } else {
          block = { type: 'file', name: file.name, src: uploaded.raw_url || uploaded.url,
            mimeType: uploaded.content_type, size: uploaded.size, ...ownership };
        }
        // IDs are captured before awaiting, so a late upload never moves to another experiment.
        addBlock(projectId, experimentId, block);
      } catch (error) {
        setErrors((previous) => [...previous, `${file.name}: ${error instanceof Error ? error.message : 'Upload failed. Please try again.'}`]);
      }
    }
    setUploading('');
  };

  const controls = (
    <div className="flex gap-2 flex-wrap">
          <button type="button" className="!text-xs !py-1" onClick={() => addBlock(projectId, experimentId, { type: 'txt', text: '', ...ownership })}>
            <Plus size={12} /> Text note
          </button>
          <input ref={input} type="file" multiple className="hidden" aria-label={`Upload files to ${label}`} onChange={(event) => { void upload(event); }} />
          <button type="button" className="!text-xs !py-1" disabled={Boolean(uploading)} onClick={() => input.current?.click()}>
            {uploading ? <LoaderCircle size={13} className="animate-spin" /> : <Upload size={13} />} Upload files
          </button>
        </div>
  );

  return (
    <div className={fullScreen ? 'py-3' : 'pt-3 border-t border-[var(--line)]'} role="region" aria-label={`${label} attachments`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h4 className="m-0 text-xs font-semibold">{fullScreen ? label : 'Uploaded content'} <span className="text-[var(--mut)]">({entries.length})</span></h4>
        {controls}
      </div>
      {uploading && <p role="status" className="text-xs text-[var(--acc)]">Uploading and processing {uploading}…</p>}
      {errors.map((error, index) => <p key={index} role="alert" className="text-xs text-red-600">{error}</p>)}
      {!fullScreen && entries.length === 0 && <p className="m-0 text-xs text-[var(--mut)]">No uploads for this section. Images, microscopy files, tables, videos, audio, and documents can be attached here.</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] gap-3">
        {entries.map(({ block, index }) => {
          const source = block.type === 'img' ? block.raw_url || block.src : block.type === 'tbl' || block.type === 'file' ? block.src : undefined;
          const imagePreview = block.type === 'img'
            ? block.preview_url || (!/TIFF|ND2/i.test(block.format || '') ? block.src : null) : null;
          return (
            <article key={index} className="min-w-0 p-2 rounded-lg border border-[var(--line)] bg-[var(--bg)]" aria-label={block.name || 'Text note'}>
              {block.type === 'img' && (imagePreview ? (fullScreen && onEnlarge ? (
                <div className="image-preview-surface w-full h-28">
                  <img src={imagePreview} alt={block.name} className="w-full h-full object-contain rounded" loading="lazy" />
                  <EnlargeImageButton name={block.name} onClick={() => onEnlarge(block)} />
                </div>
              ) : <button type="button" onClick={() => onInspect(block)} title={`Inspect ${block.name}`} className="!p-0 !border-0 w-full h-28 !bg-transparent relative group">
                  <img src={imagePreview} alt={block.name} className="w-full h-full object-contain rounded" loading="lazy" />
                  <Maximize2 size={14} className="absolute right-1 bottom-1 text-[var(--acc)]" />
                </button>
              ) : <div className="h-28 flex flex-col items-center justify-center gap-2 text-xs text-[var(--mut)]"><FileText size={28} />Preview unavailable · {block.format}</div>)}
              {block.type === 'file' && (
                block.mimeType.startsWith('video/') ? <video src={block.src} controls preload="metadata" className="w-full h-28 bg-black rounded" aria-label={block.name} />
                : block.mimeType.startsWith('audio/') ? <div className="h-28 flex items-center"><audio src={block.src} controls preload="metadata" className="w-full" aria-label={block.name} /></div>
                : <div className="h-28 flex flex-col items-center justify-center gap-2 text-xs text-[var(--mut)]"><FileText size={28} /><span className="max-w-full truncate">{block.mimeType === 'application/pdf' ? 'PDF document' : block.name.split('.').pop()?.toUpperCase() || 'File'}</span><span>{Math.ceil(block.size / 1024)} KB</span></div>
              )}
              {block.type === 'tbl' && (
                <details>
                  <summary className="text-xs cursor-pointer">Table preview · {block.rows.length} rows</summary>
                  <div className="max-h-64 overflow-auto mt-1"><table className="text-[10px] border-collapse w-full"><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => <td key={column} className="border border-[var(--line)] px-1 py-0.5">{cell}</td>)}</tr>)}</tbody></table></div>
                </details>
              )}
              {block.type === 'tbl' && <div className="h-24 overflow-hidden text-[10px] my-1"><table className="w-full"><tbody>{block.rows.slice(0, 3).map((row, rowIndex) => <tr key={rowIndex}>{row.slice(0, 4).map((cell, column) => <td key={column} className="border border-[var(--line)] px-1 max-w-20 truncate">{cell}</td>)}</tr>)}</tbody></table></div>}
              {block.type === 'txt' && <textarea aria-label={`${label} text note`} value={block.text} onChange={(event) => updateBlockText(projectId, experimentId, index, event.target.value)} className="w-full min-h-28 !text-xs" />}
              <p className="my-2 text-xs font-medium truncate" title={block.name}>{block.name || 'Text note'}</p>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                {source && <a href={source} download={block.name} className="inline-flex items-center gap-1 text-[var(--acc)]"><Download size={12} /> Download</a>}
                <button type="button" className="!text-[11px] !py-0.5 !px-2 ml-auto" onClick={async () => {
                  if (await confirmDialog({ title: 'Remove attachment', message: `Remove ${block.name || 'this note'} from ${label}? The original uploaded file is not deleted.`, confirmLabel: 'Remove', variant: 'danger' })) removeBlock(projectId, experimentId, index);
                }}>Remove</button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};
