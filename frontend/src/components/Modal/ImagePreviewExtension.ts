import Image from '@tiptap/extension-image';

export const ImagePreview = Image.extend({
  addNodeView: () => ({ node, HTMLAttributes }) => {
    const dom = document.createElement('span');
    dom.className = 'section-image-preview';
    dom.contentEditable = 'false';
    const image = document.createElement('img');
    for (const [name, value] of Object.entries(HTMLAttributes)) {
      if (value != null) image.setAttribute(name, String(value));
    }
    const filename = document.createElement('span');
    filename.className = 'section-image-filename';
    filename.textContent = node.attrs.title || node.attrs.alt || 'Image';
    filename.title = filename.textContent;
    const surface = document.createElement('span');
    surface.className = 'image-preview-surface';
    const enlarge = document.createElement('button');
    enlarge.type = 'button';
    enlarge.className = 'image-enlarge-control';
    enlarge.dataset.enlargeImage = 'true';
    enlarge.setAttribute('aria-label', `Enlarge ${filename.textContent}`);
    enlarge.title = 'Enlarge image';
    enlarge.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/></svg>';
    surface.append(image, enlarge);
    dom.append(surface, filename);
    return {
      dom,
      stopEvent: (event) => event.target instanceof Element && Boolean(event.target.closest('[data-enlarge-image]')),
    };
  },
});
