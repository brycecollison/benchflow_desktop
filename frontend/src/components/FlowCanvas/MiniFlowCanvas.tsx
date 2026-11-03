import React from 'react';
import type { Project, Paper, FilterState } from '../../types/lab';
import { calculateLayout, NODE_WIDTH, NODE_HEIGHT } from '../../utils/dag';
import { calculateRoutedEdges } from '../../utils/edgeRouting';
import { STATUS_COLORS, PRIORITY_COLORS } from '../../utils/colors';
import { useLabStore } from '../../store/useLabStore';

interface MiniFlowCanvasProps {
  project: Project;
  papers: Paper[];
  onOpenExperiment: (expId: string) => void;
  filter?: FilterState;
}

export const MiniFlowCanvas: React.FC<MiniFlowCanvasProps> = ({
  project,
  papers,
  onOpenExperiment,
  filter: propFilter,
}) => {
  const storeFilters = useLabStore((state) => state.filters);
  const filter = propFilter ?? storeFilters;
  const hasActiveFilters =
    Boolean(filter) &&
    ((filter.status && filter.status.length > 0) ||
      (filter.paper && filter.paper.length > 0) ||
      (filter.priority && filter.priority.length > 0));

  const { positions, nodeWidths, width, height, visibleExperiments } = calculateLayout(
    project,
    filter,
    {
      isMini: true,
      ignoreCustomPositions: hasActiveFilters,
    }
  );

  const paperMap = new Map(papers.map((p) => [p.id, p]));

  if (!project.exps.length) {
    return (
      <div className="text-xs text-[var(--mut)] italic py-4">
        No experiments in this project.
      </div>
    );
  }

  if (!visibleExperiments.length) {
    return (
      <div className="text-xs text-[var(--mut)] italic py-3 bg-black/[0.02] dark:bg-white/[0.02] rounded-lg text-center border border-dashed border-[var(--line)]">
        No experiments in this project match the active filter criteria.
      </div>
    );
  }

  const edges: { source: string; target: string }[] = [];
  visibleExperiments.forEach((exp) => {
    exp.deps.forEach((depId) => {
      if (positions[depId] && positions[exp.id]) {
        edges.push({ source: depId, target: exp.id });
      }
    });
  });

  const routedEdges = calculateRoutedEdges(edges, positions, nodeWidths);

  return (
    <div role="group" aria-label={`${project.name} flowchart`} className="w-full min-w-0 overflow-x-auto overflow-y-hidden py-2">
      <div
        className="relative"
        style={{
          width: `${Math.max(width, 400)}px`,
          height: `${Math.max(height, 120)}px`,
        }}
      >
        {/* SVG Edges */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={Math.max(width, 400)}
          height={Math.max(height, 120)}
        >
          {routedEdges.map((re) => (
            <g key={`${re.source}->${re.target}`}>
              <path d={re.pathData} fill="none" stroke="var(--mut)" strokeWidth="1.5" />
              <path d={re.arrowData} fill="none" stroke="var(--mut)" strokeWidth="1.5" />
            </g>
          ))}
        </svg>

        {/* Nodes */}
        {visibleExperiments.map((e) => {
          const pos = positions[e.id] || { x: 0, y: 0 };
          const p = paperMap.get(e.paper);
          const sc = STATUS_COLORS[e.status] || '#9ca3af';

          return (
            <div
              key={e.id}
              onClick={(ev) => {
                ev.stopPropagation();
                onOpenExperiment(e.id);
              }}
              style={{
                left: `${pos.x}px`,
                top: `${pos.y}px`,
                width: `${nodeWidths[e.id] || NODE_WIDTH}px`,
                height: `${NODE_HEIGHT}px`,
                borderLeftColor: sc,
              }}
              className="absolute bg-[var(--card)] border border-[var(--line)] border-l-4 rounded-lg p-2 cursor-pointer shadow-xs hover:shadow-md transition-shadow select-none"
            >
              <b
                title={e.name}
                className="block text-[13px] font-semibold truncate leading-tight"
              >
                {e.name}
              </b>
              <small className="flex items-center gap-1.5 text-[var(--mut)] text-xs mt-0.5 truncate">
                {p ? (
                  <>
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: p.color }}
                    />
                    <span className="truncate">{p.name}</span>
                  </>
                ) : (
                  <span>No paper</span>
                )}
              </small>
              <div className="flex items-center gap-1 mt-1.5">
                <span
                  className="text-[10px] px-1.5 py-0.2 rounded-full border border-[var(--line)] font-medium"
                  style={{ color: sc }}
                >
                  {e.status}
                </span>
                {e.priority && (
                  <span
                    className="text-[10px] px-1.5 py-0.2 rounded-full border font-medium"
                    style={{
                      color: PRIORITY_COLORS[e.priority],
                      borderColor: PRIORITY_COLORS[e.priority],
                    }}
                  >
                    {e.priority}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
