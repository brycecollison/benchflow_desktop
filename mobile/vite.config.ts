import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The editor is imported from ../frontend/src; its bare imports would otherwise resolve to
// frontend/node_modules and load a second React/TipTap. dedupe pins them to mobile/node_modules.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: {
    dedupe: [
      'react', 'react-dom', 'zustand', 'lucide-react', 'mathjax-full',
      '@tiptap/core', '@tiptap/pm', '@tiptap/react', '@tiptap/starter-kit',
      '@tiptap/markdown', '@tiptap/extension-table', '@tiptap/extension-image',
    ],
  },
  server: { fs: { allow: ['..'] } },
});
