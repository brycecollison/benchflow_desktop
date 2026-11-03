import React from 'react';
import { ChevronRight, Columns2 } from 'lucide-react';
import { useLabStore } from '../../store/useLabStore';

interface Props {
  activeExperimentId: string;
  onOpen: (id: string) => void;
  onSplit?: (id: string) => void;
  label?: string;
}

export const ExperimentNavigation: React.FC<Props> = ({ activeExperimentId, onOpen, onSplit, label = 'Experiment navigation' }) => {
  const projects = useLabStore((state) => state.projects);
  const currentProject = projects.find((project) => project.exps.some((experiment) => experiment.id === activeExperimentId));

  return (
    <nav key={activeExperimentId} aria-label={label} className="min-w-0 min-h-0 flex-1 overflow-y-auto bg-[var(--card)] p-3 text-sm">
      <h2 className="m-0 mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--mut)]">Experiments</h2>
      {projects.map((project) => (
        <details key={project.id} open={project.id === currentProject?.id} className="group mb-1">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-2 hover:bg-[var(--bg)] [&::-webkit-details-marker]:hidden">
            <ChevronRight size={14} aria-hidden="true" className="shrink-0 group-open:rotate-90" />
            <span className="min-w-0 break-words font-medium">{project.name}</span>
            <span className="ml-auto text-xs text-[var(--mut)]">{project.exps.length}</span>
          </summary>
          <ul className="m-0 list-none space-y-1 py-1 pl-4">
            {project.exps.map((experiment) => (
              <li key={experiment.id} className="group/experiment flex items-center gap-1">
                <button
                  type="button"
                  data-experiment-open
                  aria-current={experiment.id === activeExperimentId ? 'page' : undefined}
                  onClick={() => onOpen(experiment.id)}
                  className={`min-w-0 flex-1 rounded-md px-2 py-2 !justify-start text-left break-words ${experiment.id === activeExperimentId ? 'bg-[var(--acc)]/10 text-[var(--acc)] font-medium' : 'hover:bg-[var(--bg)]'}`}
                >
                  {experiment.name}
                </button>
                {onSplit && (
                  <button
                    type="button"
                    onClick={() => onSplit(experiment.id)}
                    aria-label={`Open ${experiment.name} in split screen`}
                    title="Open in split screen"
                    className="shrink-0 !p-1 opacity-0 group-hover/experiment:opacity-100 group-focus-within/experiment:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <Columns2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </nav>
  );
};
