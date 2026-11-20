import { useLabStore } from '../../store/useLabStore';

/** Banner on a section whose text lost a merge: shows the version that was set aside. */
export function SectionConflicts({ experimentId, sectionKey }: { experimentId: string; sectionKey: string }) {
  const { conflicts, resolveConflict } = useLabStore();
  const mine = conflicts.filter((c) => c.experiment_id === experimentId
    && (c.unit === sectionKey || c.unit === `customPhases/${sectionKey}/content`));
  if (!mine.length) return null;
  return (
    <>
      {mine.map((c) => (
        <div key={c.id} role="alert" className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/40 p-2 space-y-1 text-xs">
          <p className="m-0 font-semibold">
            {c.source === 'phone' ? 'A phone edit' : 'An edit'} to this section overlapped with another one and was set aside
            ({new Date(c.created_at).toLocaleString()}). The text below is that version; nothing was lost.
          </p>
          <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap bg-[var(--bg)] p-1 rounded">{String(c.parked ?? '')}</pre>
          <div className="flex gap-2">
            <button type="button" className="!text-xs !py-1" onClick={() => void resolveConflict(c.id, 'other')}>Use this version</button>
            <button type="button" className="!text-xs !py-1" onClick={() => void resolveConflict(c.id, 'keep')}>Keep the current text</button>
          </div>
        </div>
      ))}
    </>
  );
}
