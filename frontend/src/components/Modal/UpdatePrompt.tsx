import React, { useEffect } from 'react';
import { Download, RefreshCw, AlertTriangle, X } from 'lucide-react';
import { useUpdateStore } from '../../store/useUpdateStore';

const mb = (n?: number | null) => (n ? `${Math.round(n / 1e6)} MB` : '');

/** The update offer, for an installed build only (backend/app/update.py says who counts).
 *
 * Not a modal: it sits in the corner so it can appear while the notebook is being used, and
 * "Later" closes it for the rest of this window instead of nagging. The one blocking question is
 * asked by the shared confirm dialog, because running Setup closes the window.
 */
export const UpdatePrompt: React.FC = () => {
  const { info, dismissed, refresh, startDownload, runSetup, dismiss } = useUpdateStore();

  useEffect(() => {
    void refresh(); // once per window open; the backend asks GitHub once per window too
  }, [refresh]);

  if (!info?.installed || !info.available || dismissed) return null;

  const version = info.latest?.version ?? 'a new version';
  const state = info.download.state;

  return (
    <div
      role="dialog"
      aria-label={`Benchflow ${version} is available`}
      className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-[var(--line)] bg-[var(--card)] text-[var(--ink)] shadow-2xl"
    >
      <div className="flex items-start gap-2 px-3 py-2 border-b border-[var(--line)]">
        <div className="min-w-0 flex-1">
          <h4 className="m-0 font-semibold text-sm">Benchflow {version} is available</h4>
          <span className="text-[11px] text-[var(--mut)]">
            You have {info.current}
            {info.latest?.size ? ` · ${mb(info.latest.size)}` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={dismiss}
          title="Ask again next time this window opens"
          className="!p-1 text-[var(--mut)] hover:text-[var(--ink)] rounded-md border-none bg-transparent cursor-pointer"
        >
          <X size={15} />
        </button>
      </div>

      <div className="p-3 space-y-2">
        {info.latest?.notes && (
          <p className="m-0 text-xs text-[var(--mut)] leading-relaxed whitespace-pre-line max-h-32 overflow-y-auto">
            {info.latest.notes.replace(/^#+\s*/gm, '').slice(0, 600)}
          </p>
        )}

        {state === 'downloading' && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-[var(--line)] overflow-hidden">
              <div
                className="h-full bg-[var(--acc)]"
                style={{
                  width: `${
                    info.download.total ? Math.min(100, (info.download.got ?? 0) / info.download.total * 100) : 20
                  }%`,
                }}
              />
            </div>
            <p className="m-0 text-[11px] text-[var(--mut)]">
              Downloading… {mb(info.download.got)}
              {info.download.total ? ` of ${mb(info.download.total)}` : ''}
            </p>
          </div>
        )}

        {info.error && (
          <p className="m-0 text-xs text-red-600 dark:text-red-400">{info.error}</p>
        )}
        {info.download.detail && (
          <p className="m-0 text-xs text-red-600 dark:text-red-400">{info.download.detail}</p>
        )}

        {state === 'ready' && (
          <p className="m-0 text-[11px] text-[var(--mut)]">
            Installer is on this computer. Running Setup replaces the program only.
          </p>
        )}
        {state === 'launched' && (
          <p className="m-0 text-[11px] text-[var(--mut)]">
            Setup is running. Close this window when it asks, then finish the install.
          </p>
        )}
        {!info.installable && (
          <p className="m-0 text-xs flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            This release has no installer to fetch, so it cannot be installed from here.
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          {state === 'ready' ? (
            <button
              type="button"
              onClick={runSetup}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-[var(--acc)] text-white cursor-pointer"
            >
              <Download size={13} /> Run Setup
            </button>
          ) : state === 'launched' ? null : (
            <button
              type="button"
              onClick={startDownload}
              disabled={!info.installable || state === 'downloading'}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-[var(--acc)] text-white disabled:opacity-40 cursor-pointer"
            >
              {state === 'downloading' ? <RefreshCw size={13} /> : <Download size={13} />}
              {state === 'downloading'
                ? 'Downloading…'
                : state === 'error'
                ? 'Try the download again'
                : 'Download installer'}
            </button>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="px-3 py-1.5 text-xs font-semibold rounded-md border border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:bg-[var(--sel)] cursor-pointer"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpdatePrompt;
