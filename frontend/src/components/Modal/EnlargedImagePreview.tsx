import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X } from 'lucide-react';
import type { ImageBlock } from '../../types/lab';
import './EnlargedImagePreview.css';

export const EnlargeImageButton = ({ name, onClick }: { name: string; onClick: () => void }) => (
  <button type="button" className="image-enlarge-control" aria-label={`Enlarge ${name}`} title="Enlarge image" onClick={onClick}>
    <Maximize2 size={20} />
  </button>
);

export const EnlargedImagePreview = ({ block, onClose, onInspect }: {
  block: ImageBlock;
  onClose: () => void;
  onInspect: (block: ImageBlock) => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog ref={dialog} className="enlarged-image-dialog" aria-label={`Enlarged preview: ${block.name}`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="enlarged-image-window">
        <img src={block.preview_url || block.src} alt={block.name} />
        <button type="button" className="image-open-viewer" onClick={() => { onClose(); onInspect(block); }}>Open in viewer</button>
        <button type="button" className="image-enlarge-control" aria-label="Close enlarged preview" title="Close enlarged preview (Esc)" onClick={onClose}><X size={22} /></button>
      </div>
    </dialog>, document.body,
  );
};
