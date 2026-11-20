import { useState } from 'react';
import type { Deviation } from '../../types/lab';
import { useLabStore } from '../../store/useLabStore';

interface PhaseDeviationsProps {
  projectId: string;
  experimentId: string;
  phaseKey: string;
  label: string;
  entries: Deviation[];
}

/** Append-only log of where the run departed from this phase's plan (phone entries land here too). */
export function PhaseDeviations({ projectId, experimentId, phaseKey, label, entries }: PhaseDeviationsProps) {
  const logDeviation = useLabStore((s) => s.logDeviation);
  const [text, setText] = useState('');

  return (
    <div className="pt-3 border-t border-[var(--line)] space-y-2" role="region" aria-label={`${label} deviations`}>
      <h4 className="m-0 text-xs font-semibold">Deviations <span className="text-[var(--mut)]">({entries.length})</span></h4>
      {entries.length > 0 && (
        <ul className="m-0 p-0 list-none space-y-1">
          {entries.map((d) => (
            <li key={d.id} className="text-xs flex gap-2">
              <time dateTime={d.at} className="text-[var(--mut)] shrink-0">
                {new Date(d.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
              </time>
              <span className="whitespace-pre-wrap">{d.text}</span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          logDeviation(projectId, experimentId, phaseKey, text);
          setText('');
        }}
      >
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="What differed from the plan?"
          aria-label={`New ${label} deviation`}
          className="flex-1 min-w-0 text-xs bg-[var(--bg)] px-2 py-1 border border-[var(--line)] rounded-lg"
        />
        <button type="submit" className="!text-xs !py-1" disabled={!text.trim()}>
          Log deviation
        </button>
      </form>
    </div>
  );
}
