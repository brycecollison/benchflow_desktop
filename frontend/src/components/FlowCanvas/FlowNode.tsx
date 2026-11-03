import React, { useRef, useState, useEffect } from 'react';
import type { Experiment, Paper, NodePosition, ExperimentStatus, PriorityLevel } from '../../types/lab';
import { useLabStore } from '../../store/useLabStore';
import { STATUS_COLORS, PRIORITY_COLORS, STATUS_LIST, PRIORITY_LIST } from '../../utils/colors';
import { MIN_NODE_WIDTH } from '../../utils/dag';
import { Pencil, Plus, ChevronDown, Check } from 'lucide-react';

interface FlowNodeProps {
  experiment: Experiment;
  paper?: Paper;
  position: NodePosition;
  nodeWidth?: number;
  maxNodeWidth?: number;
  projectId?: string;
  onOpenModal: (expId: string) => void;
  onAddChild: (expId: string) => void;
  onUpdatePosition: (expId: string, px: number, py: number) => void;
  onUpdateStatus?: (newStatus: ExperimentStatus) => void;
  onUpdatePriority?: (newPriority: PriorityLevel) => void;
  onStartConnect: (expId: string, startPos: { x: number; y: number }, e: React.PointerEvent) => void;
}

export const FlowNode: React.FC<FlowNodeProps> = ({
  experiment,
  paper,
  position,
  nodeWidth,
  maxNodeWidth,
  projectId,
  onOpenModal,
  onAddChild,
  onUpdatePosition,
  onUpdateStatus,
  onUpdatePriority,
  onStartConnect,
}) => {
  const { snapToGrid, gridSize } = useLabStore();
  const width = nodeWidth || MIN_NODE_WIDTH;
  const nodeRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const priorityMenuRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isPriorityMenuOpen, setIsPriorityMenuOpen] = useState(false);
  const [altHeld, setAltHeld] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const statusColor = STATUS_COLORS[experiment.status] || '#9ca3af';
  const priorityColor = experiment.priority ? PRIORITY_COLORS[experiment.priority] : undefined;

  const effectiveSnap = altHeld ? !snapToGrid : snapToGrid;
  const rawX = Math.max(0, position.x + dragOffset.x);
  const rawY = Math.max(0, position.y + dragOffset.y);

  const currentX =
    effectiveSnap && isDragging
      ? Math.max(0, Math.round(rawX / gridSize) * gridSize)
      : rawX;
  const currentY =
    effectiveSnap && isDragging
      ? Math.max(0, Math.round(rawY / gridSize) * gridSize)
      : rawY;

  // Handle outside clicks to close the status dropdown
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent | PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  // Handle outside clicks to close the priority dropdown
  useEffect(() => {
    if (!isPriorityMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent | PointerEvent) => {
      if (priorityMenuRef.current && !priorityMenuRef.current.contains(e.target as Node)) {
        setIsPriorityMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsPriorityMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPriorityMenuOpen]);

  const handleStatusSelect = (newStatus: ExperimentStatus) => {
    setIsMenuOpen(false);
    if (newStatus === experiment.status) return;
    if (onUpdateStatus) {
      onUpdateStatus(newStatus);
    } else if (projectId) {
      useLabStore.getState().updateExperiment(projectId, experiment.id, { status: newStatus });
    }
  };

  const handlePrioritySelect = (newPriority: PriorityLevel) => {
    setIsPriorityMenuOpen(false);
    if (newPriority === experiment.priority) return;
    if (onUpdatePriority) {
      onUpdatePriority(newPriority);
    } else if (projectId) {
      useLabStore.getState().updateExperiment(projectId, experiment.id, { priority: newPriority });
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // Primary button only

    // If clicked on connection handle
    const target = e.target as HTMLElement;
    if (target.closest('.connect-handle')) {
      e.stopPropagation();
      onStartConnect(
        experiment.id,
        { x: position.x + width, y: position.y + 37 },
        e
      );
      return;
    }

    // If clicked on action buttons or status/priority dropdowns
    if (
      target.closest('.action-btn') ||
      target.closest('.status-dropdown-container') ||
      target.closest('.priority-dropdown-container')
    ) {
      return;
    }

    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    let hasMoved = false;

    const el = nodeRef.current;
    if (el) {
      el.setPointerCapture(e.pointerId);
    }

    const onPointerMove = (moveEv: PointerEvent) => {
      const dx = moveEv.clientX - startX;
      const dy = moveEv.clientY - startY;

      if (!hasMoved && Math.hypot(dx, dy) < 5) return;
      hasMoved = true;
      setIsDragging(true);
      setIsMenuOpen(false);
      setIsPriorityMenuOpen(false);
      setAltHeld(moveEv.altKey);
      setDragOffset({ x: dx, y: dy });
    };

    const onPointerUp = (upEv: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      if (el) {
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          // ignore if already released
        }
      }

      setIsDragging(false);
      setDragOffset({ x: 0, y: 0 });
      setAltHeld(false);

      if (!hasMoved) {
        // Simple click -> open experiment editor
        onOpenModal(experiment.id);
      } else {
        // Drag ended -> persist coordinate offset
        let finalX = Math.max(0, Math.round(position.x + (upEv.clientX - startX)));
        let finalY = Math.max(0, Math.round(position.y + (upEv.clientY - startY)));
        const shouldSnap = upEv.altKey ? !snapToGrid : snapToGrid;
        if (shouldSnap) {
          finalX = Math.max(0, Math.round(finalX / gridSize) * gridSize);
          finalY = Math.max(0, Math.round(finalY / gridSize) * gridSize);
        }
        onUpdatePosition(experiment.id, finalX, finalY);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return (
    <div
      ref={nodeRef}
      id={`exp-node-${experiment.id}`}
      data-node-id={experiment.id}
      onPointerDown={handlePointerDown}
      style={{
        transform: `translate3d(${currentX}px, ${currentY}px, 0)`,
        width: `${width}px`,
        minWidth: `${MIN_NODE_WIDTH}px`,
        maxWidth: maxNodeWidth ? `${maxNodeWidth}px` : undefined,
        height: '74px',
        borderLeftColor: statusColor,
      }}
      className={`absolute left-0 top-0 select-none bg-[var(--card)] border border-[var(--line)] border-l-4 rounded-lg p-2 cursor-grab touch-none transition-shadow ${
        isDragging
          ? '!cursor-grabbing z-20 shadow-xl opacity-90'
          : isMenuOpen || isPriorityMenuOpen
          ? 'z-40 shadow-lg ring-1 ring-[var(--line)]'
          : 'hover:shadow-md z-10'
      }`}
    >
      {/* Title */}
      <b
        title={experiment.name}
        className="block text-[13px] font-semibold truncate pr-6 leading-tight"
      >
        {experiment.name}
      </b>

      {/* Paper Subtitle */}
      <small className="flex items-center gap-1.5 text-[var(--mut)] text-xs mt-0.5 truncate">
        {paper ? (
          <>
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: paper.color }}
            />
            <span className="truncate">{paper.name}</span>
          </>
        ) : (
          <span>No paper</span>
        )}
      </small>

      {/* Badges */}
      <div className="flex items-center gap-1.5 mt-1.5 pr-6">
        {/* Interactive Status Indicator & Dropdown */}
        <div ref={menuRef} className="relative inline-block status-dropdown-container">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsMenuOpen((prev) => !prev);
              setIsPriorityMenuOpen(false);
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            title="Click to change status"
            aria-haspopup="listbox"
            aria-expanded={isMenuOpen}
            className="action-btn group flex items-center gap-1 text-[10px] !px-1.5 !py-0.5 rounded-full border font-medium leading-none cursor-pointer transition-all hover:brightness-95 active:scale-95 shadow-xs"
            style={{
              color: statusColor,
              borderColor: `${statusColor}55`,
              backgroundColor: `${statusColor}12`,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: statusColor }}
            />
            <span>{experiment.status}</span>
            <ChevronDown
              size={9}
              className={`shrink-0 transition-transform duration-150 opacity-70 group-hover:opacity-100 ${
                isMenuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Status Dropdown Menu */}
          {isMenuOpen && (
            <div
              role="listbox"
              aria-label="Change experiment status"
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute left-0 top-[calc(100%+4px)] z-50 min-w-[130px] bg-[var(--card)] border border-[var(--line)] rounded-lg shadow-xl py-1 text-xs select-none"
            >
              <div className="px-2.5 py-0.5 text-[9px] uppercase tracking-wider font-semibold text-[var(--mut)] border-b border-[var(--line)]/50 mb-0.5">
                Status
              </div>
              {STATUS_LIST.map((st) => {
                const isSelected = st === experiment.status;
                const col = STATUS_COLORS[st];
                return (
                  <button
                    key={st}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStatusSelect(st);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left border-none rounded-none transition-colors cursor-pointer !m-0 ${
                      isSelected
                        ? 'bg-[var(--sel)] font-medium text-[var(--ink)]'
                        : 'text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/5 bg-transparent'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: col }}
                      />
                      <span className="text-xs">{st}</span>
                    </span>
                    {isSelected && (
                      <Check size={12} className="text-[var(--acc)] shrink-0 ml-1" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Interactive Priority Indicator & Dropdown */}
        <div ref={priorityMenuRef} className="relative inline-block priority-dropdown-container">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsPriorityMenuOpen((prev) => !prev);
              setIsMenuOpen(false);
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            title="Click to change priority"
            aria-haspopup="listbox"
            aria-expanded={isPriorityMenuOpen}
            className={`action-btn group flex items-center gap-1 text-[10px] !px-1.5 !py-0.5 rounded-full border font-medium leading-none cursor-pointer transition-all hover:brightness-95 active:scale-95 shadow-xs ${
              !experiment.priority
                ? 'border-dashed border-[var(--line)] text-[var(--mut)] hover:border-[var(--mut)]'
                : ''
            }`}
            style={
              experiment.priority && priorityColor
                ? {
                    color: priorityColor,
                    borderColor: `${priorityColor}55`,
                    backgroundColor: `${priorityColor}12`,
                  }
                : undefined
            }
          >
            {experiment.priority && priorityColor ? (
              <>
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: priorityColor }}
                />
                <span>{experiment.priority}</span>
              </>
            ) : (
              <span className="text-[var(--mut)]">Pri</span>
            )}
            <ChevronDown
              size={9}
              className={`shrink-0 transition-transform duration-150 opacity-70 group-hover:opacity-100 ${
                isPriorityMenuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Priority Dropdown Menu */}
          {isPriorityMenuOpen && (
            <div
              role="listbox"
              aria-label="Change experiment priority"
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute left-0 top-[calc(100%+4px)] z-50 min-w-[120px] bg-[var(--card)] border border-[var(--line)] rounded-lg shadow-xl py-1 text-xs select-none"
            >
              <div className="px-2.5 py-0.5 text-[9px] uppercase tracking-wider font-semibold text-[var(--mut)] border-b border-[var(--line)]/50 mb-0.5">
                Priority
              </div>
              {PRIORITY_LIST.map((pr) => {
                const isSelected = pr === experiment.priority;
                const col = PRIORITY_COLORS[pr];
                return (
                  <button
                    key={pr}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePrioritySelect(pr);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left border-none rounded-none transition-colors cursor-pointer !m-0 ${
                      isSelected
                        ? 'bg-[var(--sel)] font-medium text-[var(--ink)]'
                        : 'text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/5 bg-transparent'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: col }}
                      />
                      <span className="text-xs">{pr}</span>
                    </span>
                    {isSelected && (
                      <Check size={12} className="text-[var(--acc)] shrink-0 ml-1" />
                    )}
                  </button>
                );
              })}
              {/* Option to clear priority */}
              <button
                type="button"
                role="option"
                aria-selected={!experiment.priority}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrioritySelect('');
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left border-none rounded-none transition-colors cursor-pointer border-t border-[var(--line)]/40 !m-0 ${
                  !experiment.priority
                    ? 'bg-[var(--sel)] font-medium text-[var(--ink)]'
                    : 'text-[var(--mut)] hover:bg-black/5 dark:hover:bg-white/5 bg-transparent'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0 border border-dashed border-[var(--mut)]" />
                  <span className="text-xs">None</span>
                </span>
                {!experiment.priority && (
                  <Check size={12} className="text-[var(--acc)] shrink-0 ml-1" />
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Edit button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenModal(experiment.id);
        }}
        title="Edit experimental details"
        className="action-btn absolute top-1.5 right-1.5 !p-1 border-none bg-transparent text-[var(--mut)] hover:text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/5 rounded"
      >
        <Pencil size={12} />
      </button>

      {/* Add downstream experiment button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAddChild(experiment.id);
        }}
        title="Add downstream experiment"
        className="action-btn absolute bottom-1.5 right-1.5 !p-1 border-none bg-transparent text-[var(--mut)] hover:text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/5 rounded"
      >
        <Plus size={13} />
      </button>

      {/* Connection output handle */}
      <span
        title="Drag onto another experiment to connect dependency"
        className="connect-handle absolute -right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[var(--acc)] border-2 border-[var(--card)] cursor-crosshair hover:scale-125 transition-transform"
      />
    </div>
  );
};
