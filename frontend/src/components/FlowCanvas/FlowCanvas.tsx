import React, { useEffect, useRef, useState } from 'react';
import type { Project, Paper } from '../../types/lab';
import { useLabStore } from '../../store/useLabStore';
import { calculateLayout, wouldCreateCycle, NODE_WIDTH } from '../../utils/dag';
import { FlowNode } from './FlowNode';
import { FlowEdge } from './FlowEdge';
import { Magnet, Grid3x3, RotateCcw } from 'lucide-react';
import { alertDialog } from '../../store/useDialogStore';
import { calculateRoutedEdges } from '../../utils/edgeRouting';
import { promptCreateExperiment } from '../../utils/experimentCreation';

interface FlowCanvasProps {
  project: Project;
  papers: Paper[];
}

export const FlowCanvas: React.FC<FlowCanvasProps> = ({ project, papers }) => {
  const {
    filters,
    resetFilters,
    openModal,
    addExperiment,
    updateExperiment,
    updateNodePosition,
    addDependency,
    removeDependency,
    showGrid,
    snapToGrid,
    toggleSnapToGrid,
    toggleShowGrid,
  } = useLabStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  const [containerWidth, setContainerWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth - 260 : 1200
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateWidth = () => {
      if (el.clientWidth > 0) {
        setContainerWidth(el.clientWidth);
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const flowCanvasWidth = Math.max(containerWidth > 48 ? containerWidth - 48 : 800, 800);
  const maxNodeWidth = Math.max(NODE_WIDTH, Math.floor(flowCanvasWidth * 0.25));

  // Active connection line state during dragging
  const [connectingState, setConnectingState] = useState<{
    sourceId: string;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  const { positions, nodeWidths, width, height, visibleExperiments } = calculateLayout(
    project,
    filters,
    flowCanvasWidth
  );

  const paperMap = new Map<string, Paper>(papers.map((p) => [p.id, p]));

  const handleAddChild = async (parentId: string) => {
    const parentExp = project.exps.find((e) => e.id === parentId);
    const result = await promptCreateExperiment({
      project,
      papers,
      parentExp,
      title: 'New Downstream Experiment',
      message: parentExp
        ? `Create an experiment connected from "${parentExp.name}":`
        : 'Enter experiment name:',
    });
    if (result) {
      addExperiment(
        project.id,
        result.name,
        [parentId],
        result.paperId,
        result.status,
        result.priority,
        result.phases,
        true
      );
    }
  };

  const handleStartConnect = (
    sourceId: string,
    startPos: { x: number; y: number },
    e: React.PointerEvent
  ) => {
    e.preventDefault();
    if (!innerRef.current) return;

    const innerRect = innerRef.current.getBoundingClientRect();
    const initialX = e.clientX - innerRect.left;
    const initialY = e.clientY - innerRect.top;

    setConnectingState({
      sourceId,
      startX: startPos.x,
      startY: startPos.y,
      currentX: initialX,
      currentY: initialY,
    });

    const onPointerMove = (moveEv: PointerEvent) => {
      if (!innerRef.current) return;
      const rect = innerRef.current.getBoundingClientRect();
      setConnectingState((prev) =>
        prev
          ? {
              ...prev,
              currentX: moveEv.clientX - rect.left,
              currentY: moveEv.clientY - rect.top,
            }
          : null
      );
    };

    const onPointerUp = (upEv: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      const el = document.elementFromPoint(upEv.clientX, upEv.clientY);
      const targetNodeEl = el?.closest('[data-node-id]') as HTMLElement | null;

      if (targetNodeEl) {
        const targetId = targetNodeEl.dataset.nodeId;
        if (targetId && targetId !== sourceId) {
          const targetExp = project.exps.find((x) => x.id === targetId);
          if (targetExp && !targetExp.deps.includes(sourceId)) {
            if (wouldCreateCycle(project, sourceId, targetId)) {
              alertDialog({
                title: 'Circular Dependency',
                message: 'Connecting these experiments would create a dependency cycle.',
                variant: 'warning',
              });
            } else {
              addDependency(project.id, sourceId, targetId);
            }
          }
        }
      }

      setConnectingState(null);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  if (!project.exps.length) {
    return (
      <div
        className={`flex-1 flex items-center justify-center p-12 text-[var(--mut)] text-sm italic ${
          showGrid ? 'flowchart-dot-grid' : ''
        }`}
      >
        No experiments yet. Click "+ Experiment" in the header to start the flowchart.
      </div>
    );
  }

  if (!visibleExperiments.length) {
    return (
      <div
        className={`flex-1 flex flex-col items-center justify-center p-12 text-[var(--mut)] text-sm ${
          showGrid ? 'flowchart-dot-grid' : ''
        }`}
      >
        <span className="italic">No experiments match the current filter criteria.</span>
        <button
          type="button"
          onClick={resetFilters}
          className="mt-3 text-xs px-3 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--sel)] text-[var(--ink)] font-medium flex items-center gap-1.5 transition-colors shadow-xs"
        >
          <RotateCcw size={13} />
          <span>Reset filters</span>
        </button>
      </div>
    );
  }

  // Generate edge list and route paths to avoid obstacles and crossings
  const edges: { source: string; target: string }[] = [];
  visibleExperiments.forEach((exp) => {
    exp.deps.forEach((depId) => {
      if (positions[depId] && positions[exp.id]) {
        edges.push({ source: depId, target: exp.id });
      }
    });
  });

  const routedEdges = calculateRoutedEdges(edges, positions, nodeWidths);

  const canvasWidth = Math.max(width, 800);
  const canvasHeight = Math.max(height, 500);

  return (
    <div
      ref={containerRef}
      className={`flex-1 overflow-auto relative select-none transition-colors ${
        showGrid ? 'flowchart-dot-grid' : ''
      }`}
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <div
        ref={innerRef}
        className="relative m-6"
        style={{
          width: `${canvasWidth}px`,
          height: `${canvasHeight}px`,
          minWidth: 'calc(100% - 48px)',
          minHeight: 'calc(100% - 48px)',
        }}
      >
        {/* SVG Connectors Layer */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={canvasWidth}
          height={canvasHeight}
        >
          {routedEdges.map((edge) => (
            <FlowEdge
              key={`${edge.source}->${edge.target}`}
              sourceId={edge.source}
              targetId={edge.target}
              sourcePos={positions[edge.source]}
              targetPos={positions[edge.target]}
              sourceWidth={nodeWidths[edge.source]}
              pathData={edge.pathData}
              arrowData={edge.arrowData}
              onRemove={(s, t) => removeDependency(project.id, s, t)}
            />
          ))}

          {/* Active drag connection preview line */}
          {connectingState && (
            <path
              d={`M${connectingState.startX},${connectingState.startY}L${connectingState.currentX},${connectingState.currentY}`}
              fill="none"
              stroke="var(--acc)"
              strokeWidth="2"
              strokeDasharray="5 4"
            />
          )}
        </svg>

        {/* DOM Nodes Layer */}
        {visibleExperiments.map((exp) => (
          <FlowNode
            key={exp.id}
            projectId={project.id}
            experiment={exp}
            paper={paperMap.get(exp.paper)}
            position={positions[exp.id] || { x: 0, y: 0 }}
            nodeWidth={nodeWidths[exp.id]}
            maxNodeWidth={maxNodeWidth}
            onOpenModal={(id) => openModal(id)}
            onAddChild={handleAddChild}
            onUpdatePosition={(id, px, py) =>
              updateNodePosition(project.id, id, px, py)
            }
            onUpdateStatus={(newStatus) =>
              updateExperiment(project.id, exp.id, { status: newStatus })
            }
            onUpdatePriority={(newPriority) =>
              updateExperiment(project.id, exp.id, { priority: newPriority })
            }
            onStartConnect={handleStartConnect}
          />
        ))}
      </div>

      {/* Floating Canvas Controls */}
      <div className="fixed bottom-4 right-4 z-30 flex items-center gap-1.5 bg-[var(--card)]/90 backdrop-blur-sm border border-[var(--line)] shadow-lg rounded-full px-3 py-1.5 text-xs select-none">
        <button
          type="button"
          onClick={toggleShowGrid}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-colors ${
            showGrid
              ? 'text-[var(--acc)] font-medium bg-[var(--acc)]/10'
              : 'text-[var(--mut)] hover:text-[var(--ink)]'
          }`}
          title={showGrid ? 'Hide dot grid background' : 'Show dot grid background'}
        >
          <Grid3x3 size={12} />
          <span>Grid</span>
        </button>

        <span className="w-px h-3.5 bg-[var(--line)]" />

        <button
          type="button"
          onClick={toggleSnapToGrid}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-colors ${
            snapToGrid
              ? 'text-[var(--acc)] font-medium bg-[var(--acc)]/10'
              : 'text-[var(--mut)] hover:text-[var(--ink)]'
          }`}
          title={
            snapToGrid
              ? 'Disable grid snapping (hold Alt while dragging to micro-adjust)'
              : 'Enable grid snapping (20px)'
          }
        >
          <Magnet size={12} />
          <span>Snap {snapToGrid ? 'On' : 'Off'}</span>
        </button>
      </div>
    </div>
  );
};
