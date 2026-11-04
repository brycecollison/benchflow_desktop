import { create } from 'zustand';
import { useDialogStore } from './useDialogStore';

/** What GET /api/update says. Mirrors backend/app/update.py:check().
 *
 * `installed` is false for a source checkout and for the web app: only an installed build has an
 * installer to update, so the UI shows nothing at all in that case. `installable` means the
 * release carries the Setup.exe this app knows how to fetch. */

export interface UpdateRelease {
  version: string | null;
  tag: string;
  name: string | null;
  url: string;
  size: number | null;
  notes: string | null;
  published_at: string | null;
  page: string | null;
}

export interface UpdateDownload {
  state: 'idle' | 'downloading' | 'ready' | 'error' | 'launched';
  name?: string;
  path?: string;
  got?: number;
  total?: number | null;
  detail?: string | null;
}

export interface UpdateInfo {
  current: string;
  installed: boolean;
  available: boolean;
  installable: boolean;
  reason?: string | null;
  error?: string | null;
  checked_at?: string | null;
  latest?: UpdateRelease | null;
  download: UpdateDownload;
}

interface UpdateState {
  info: UpdateInfo | null;
  /** "Later" was pressed - ask again next time the window opens, not again today. */
  dismissed: boolean;
  refresh: (force?: boolean) => Promise<UpdateInfo | null>;
  startDownload: () => Promise<void>;
  install: () => Promise<void>;
  /** The one step that closes this window, so it asks first (shared confirm dialog). */
  runSetup: () => Promise<void>;
  dismiss: () => void;
}

const EMPTY: UpdateInfo = {
  current: '',
  installed: false,
  available: false,
  installable: false,
  download: { state: 'idle' },
};

export const useUpdateStore = create<UpdateState>((set, get) => ({
  info: null,
  dismissed: false,

  refresh: async (force = false) => {
    try {
      const res = await fetch(`/api/update${force ? '?force=true' : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const info: UpdateInfo = await res.json();
      set({ info });
      return info;
    } catch (e) {
      // A failed check is shown in the Settings card; it never interrupts anything else.
      set({ info: { ...(get().info ?? EMPTY), error: `Could not check for updates: ${e}` } });
      return null;
    }
  },

  startDownload: async () => {
    if (get().info?.download.state === 'downloading') return;
    set({ info: { ...(get().info ?? EMPTY), error: null, download: { state: 'downloading' } } });
    // The POST blocks until the file is on disk; meanwhile the GET below reports its progress.
    const poll = setInterval(() => void get().refresh(), 1500);
    try {
      const res = await fetch('/api/update/download', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
      await get().refresh();
    } catch (e) {
      await get().refresh();
      set({ info: { ...(get().info ?? EMPTY), error: `${e}` } });
    } finally {
      clearInterval(poll);
    }
  },

  install: async () => {
    try {
      const res = await fetch('/api/update/install', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
      set({ info: { ...(get().info ?? EMPTY), error: null, download: body } });
    } catch (e) {
      set({ info: { ...(get().info ?? EMPTY), error: `Could not start Setup: ${e}` } });
    }
  },

  runSetup: async () => {
    const info = get().info;
    if (!info) return;
    const ok = await useDialogStore.getState().openConfirm({
      title: `Install Benchflow ${info.latest?.version ?? ''}?`,
      message:
        'Setup will ask to close this window - let it, that is what saves your notebook to the sync '
        + 'folder. The notebook, uploads and settings are left where they are.\n\n'
        + 'If the other computer is running an older build, update it the same day: the two should not '
        + 'work on the same notebook on different versions for long.',
      confirmLabel: 'Run Setup',
      cancelLabel: 'Not now',
      variant: 'warning',
    });
    if (ok) await get().install();
  },

  dismiss: () => set({ dismissed: true }),
}));
