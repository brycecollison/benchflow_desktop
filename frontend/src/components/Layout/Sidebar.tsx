import React, { useState, useEffect } from 'react';
import { useLabStore } from '../../store/useLabStore';
import {
  Plus,
  Folder,
  FileText,
  Layers,
  Sun,
  Moon,
  ChevronDown,
  ChevronRight,
  FolderArchive,
  FlaskConical,
  Calendar,
  ChartGantt,
  PanelLeftClose,
  Settings,
} from 'lucide-react';
import { STATUS_COLORS } from '../../utils/colors';
import { promptDialog } from '../../store/useDialogStore';

export const Sidebar: React.FC = () => {
  const {
    projects,
    papers,
    view,
    filters,
    setView,
    setFilter,
    toggleFilterValue,
    addProject,
    renameProject,
    addPaper,
    renamePaper,
    isDarkMode,
    toggleDarkMode,
    openModal,
    activeModalExpId,
    isSidebarOpen,
    sidebarWidth,
    toggleSidebar,
    setSidebarOpen,
    setSidebarWidth,
  } = useLabStore();

  const [isResizing, setIsResizing] = useState(false);
  const [isArchivedSectionOpen, setIsArchivedSectionOpen] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [expandedPapers, setExpandedPapers] = useState<Record<string, boolean>>({});
  const [expandedOverviewPapers, setExpandedOverviewPapers] = useState<Record<string, boolean>>({});

  // Keyboard shortcut Ctrl+B or Cmd+B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

  const handleSidebarResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = startWidth + delta;
      if (newWidth < 140) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
        const clamped = Math.min(Math.max(newWidth, 180), 480);
        setSidebarWidth(clamped);
      }
    };

    const onMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const activeProjects = projects.filter((p) => !p.archived);
  const archivedProjects = projects.filter((p) => p.archived);
  const activePapers = papers.filter((p) => !p.archived);
  const archivedPapers = papers.filter((p) => p.archived);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const scheduledCount = activeProjects.reduce(
    (acc, p) =>
      acc +
      p.exps.reduce((eAcc, e) => {
        const dates = [e.experimentalProtocolStartDate, e.dataAcquisitionStartDate, e.dataAnalysisStartDate];
        // Imported long-form dates are not calendar-compatible scheduled dates.
        const count = dates.filter((date) => {
          const start = date?.trim() || '';
          return /^\d{4}-\d{2}-\d{2}$/.test(start) && start >= today;
        }).length;
        return eAcc + count;
      }, 0),
    0
  );

  const handleAddProject = async () => {
    const name = await promptDialog({
      title: 'New Project',
      message: 'Enter a name for the research project:',
      placeholder: 'e.g., HDAC8 Inhibitor Study',
      confirmLabel: 'Create Project',
    });
    if (name && name.trim()) {
      addProject(name.trim());
    }
  };

  const handleAddPaper = async () => {
    const name = await promptDialog({
      title: 'New Paper',
      message: 'Enter a title or publication reference for the paper:',
      placeholder: 'e.g., CAS9 Target Cleavage Mechanisms',
      confirmLabel: 'Create Paper',
    });
    if (name && name.trim()) {
      addPaper(name.trim());
    }
  };

  const handleRenameProject = async (projectId: string, currentName: string) => {
    const name = await promptDialog({
      title: 'Rename Project',
      defaultValue: currentName,
      confirmLabel: 'Save',
    });
    if (name && name.trim()) {
      renameProject(projectId, name.trim());
    }
  };

  const handleRenamePaper = async (paperId: string, currentName: string) => {
    const nextName = await promptDialog({
      title: 'Rename Paper',
      defaultValue: currentName,
      confirmLabel: 'Save',
    });
    if (nextName && nextName.trim()) {
      renamePaper(paperId, nextName.trim());
    }
  };

  return (
    <aside
      style={{
        backgroundColor: 'var(--bg)',
        width: isSidebarOpen ? sidebarWidth : 0,
      }}
      className={`relative shrink-0 border-r border-[var(--line)] flex flex-col justify-between overflow-hidden select-none transition-[width] duration-200 ease-out ${
        !isSidebarOpen
          ? '!border-r-0 !p-0 pointer-events-none'
          : 'p-3 overflow-y-auto'
      } ${isResizing ? '!transition-none' : ''}`}
    >
      {/* Invisible Fullscreen Overlay during resizing */}
      {isResizing && (
        <div className="fixed inset-0 z-50 cursor-col-resize select-none pointer-events-auto" />
      )}

      {/* Resize Handle Splitter on Right Edge */}
      {isSidebarOpen && (
        <div
          onMouseDown={handleSidebarResizeMouseDown}
          title="Drag to resize sidebar (Double click to reset)"
          onDoubleClick={() => setSidebarWidth(250)}
          className={`absolute -right-1.5 top-0 bottom-0 w-3 cursor-col-resize z-40 group flex items-center justify-center transition-colors hover:bg-[var(--acc)]/25 ${
            isResizing ? '!bg-[var(--acc)]/40' : ''
          }`}
        >
          <div
            className={`w-0.5 h-8 rounded-full bg-[var(--line)] group-hover:bg-[var(--acc)] transition-colors ${
              isResizing ? '!bg-[var(--acc)] !h-full' : ''
            }`}
          />
        </div>
      )}

      <div className="space-y-4 min-w-[170px]">
        {/* Sidebar Header with Brand & Collapse Button */}
        <div className="flex items-center justify-between pb-2 mb-1 border-b border-[var(--line)] min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <FlaskConical size={16} className="text-[var(--acc)] shrink-0" />
            <span className="font-semibold text-xs tracking-tight text-[var(--ink)] truncate">
              Lab Notebook
            </span>
          </div>
          <button
            type="button"
            onClick={toggleSidebar}
            title="Collapse sidebar"
            className="p-1 rounded-md text-[var(--mut)] hover:text-[var(--ink)] hover:bg-[var(--sel)] cursor-pointer transition-colors shrink-0"
          >
            <PanelLeftClose size={15} />
          </button>
        </div>

        {/* All Projects link */}
        <div
          onClick={() => setView({ type: 'all' })}
          className={`px-2 py-1.5 rounded-md cursor-pointer flex items-center gap-2 transition-colors ${
            view.type === 'all'
              ? 'bg-[var(--sel)] font-semibold'
              : 'hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          <Layers size={15} className="text-[var(--mut)]" />
          <span>All projects</span>
        </div>

        {/* Calendar View link */}
        <div
          onClick={() => setView({ type: 'calendar' })}
          className={`px-2 py-1.5 rounded-md cursor-pointer flex items-center justify-between transition-colors ${
            view.type === 'calendar'
              ? 'bg-[var(--sel)] font-semibold'
              : 'hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          <div className="flex items-center gap-2">
            <Calendar size={15} className="text-[var(--mut)]" />
            <span>Calendar</span>
          </div>
          {scheduledCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--acc)]/15 text-[var(--acc)] font-mono font-medium">
              {scheduledCount}
            </span>
          )}
        </div>

        {/* Gantt View link */}
        <button
          type="button"
          onClick={() => setView({ type: 'gantt' })}
          aria-current={view.type === 'gantt' ? 'page' : undefined}
          className={`w-full !px-2 !py-1.5 !border-0 rounded-md cursor-pointer flex items-center !justify-start gap-2 text-left transition-colors ${
            view.type === 'gantt'
              ? '!bg-[var(--sel)] font-semibold'
              : '!bg-transparent hover:!bg-black/5 dark:hover:!bg-white/5'
          }`}
        >
          <ChartGantt size={15} className="text-[var(--mut)]" />
          <span>Gantt</span>
        </button>

        {/* Settings link */}
        <button
          type="button"
          onClick={() => setView({ type: 'settings' })}
          aria-current={view.type === 'settings' ? 'page' : undefined}
          className={`w-full !px-2 !py-1.5 !border-0 rounded-md cursor-pointer flex items-center !justify-start gap-2 text-left transition-colors ${
            view.type === 'settings'
              ? '!bg-[var(--sel)] font-semibold'
              : '!bg-transparent hover:!bg-black/5 dark:hover:!bg-white/5'
          }`}
        >
          <Settings size={15} className="text-[var(--mut)]" />
          <span>Settings</span>
        </button>

        {/* Projects header */}
        <div>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-[var(--mut)] mb-1.5 font-medium px-1">
            <span>Projects ({activeProjects.length})</span>
            <button
              onClick={handleAddProject}
              title="Create new project"
              className="w-5 h-5 !p-0 flex items-center justify-center rounded border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--sel)]"
            >
              <Plus size={13} />
            </button>
          </div>

          {/* Active Projects list */}
          <div className="space-y-0.5">
            {activeProjects.map((p) => {
              const isProjectSelected = view.type === 'p' && view.id === p.id;
              const isProjectExpanded = Boolean(expandedProjects[p.id]);

              // Get active papers assigned to this project or referenced by its experiments
              const assignedIds = new Set<string>([
                ...(p.paperIds || []),
                ...p.exps.map((e) => e.paper).filter(Boolean),
              ]);
              const projectPapers = activePapers.filter((q) => assignedIds.has(q.id));

              // Unassigned experiments: experiments in this project with no paper or whose paper isn't in projectPapers
              const unassignedExps = p.exps.filter(
                (e) => !e.paper || !projectPapers.some((paper) => paper.id === e.paper)
              );

              const hasChildren = projectPapers.length > 0 || p.exps.length > 0;

              return (
                <div key={p.id} className="space-y-0.5">
                  {/* Project Row */}
                  <div
                    onClick={() => {
                      setView({ type: 'p', id: p.id });
                    }}
                    className={`px-2 py-1.5 rounded-md cursor-pointer flex items-center justify-between group truncate transition-colors ${
                      isProjectSelected && filters.paper.length === 0
                        ? 'bg-[var(--sel)] font-semibold'
                        : 'hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate min-w-0">
                      {hasChildren ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedProjects((prev) => ({
                              ...prev,
                              [p.id]: !prev[p.id],
                            }));
                          }}
                          className="!p-0 border-none bg-transparent text-[var(--mut)] hover:text-[var(--ink)] cursor-pointer flex items-center justify-center shrink-0 w-3.5 h-3.5"
                          title={isProjectExpanded ? 'Collapse project' : 'Expand project'}
                        >
                          {isProjectExpanded ? (
                            <ChevronDown size={12} />
                          ) : (
                            <ChevronRight size={12} />
                          )}
                        </button>
                      ) : (
                        <span className="w-3.5 shrink-0" />
                      )}
                      <Folder size={14} className="text-[var(--mut)] shrink-0" />
                      <span
                        className="truncate"
                        onDoubleClick={() => handleRenameProject(p.id, p.name)}
                        title={`${p.name} — Double-click to rename`}
                      >
                        {p.name}
                      </span>
                      {p.exps.length > 0 && (
                        <span className="text-[10px] text-[var(--mut)] font-mono shrink-0 ml-0.5">
                          ({p.exps.length})
                        </span>
                      )}
                    </div>

                  </div>

                  {/* Children under project: Papers and Unassigned Experiments */}
                  {isProjectExpanded && (
                    <div className="space-y-0.5 ml-2.5 pl-2 border-l border-[var(--line)]/50">
                      {/* Papers assigned to this project */}
                      {projectPapers.map((paper) => {
                        const isPaperFiltered =
                          isProjectSelected && filters.paper.includes(paper.id);
                        const paperCollapseKey = `${p.id}_${paper.id}`;
                        const isPaperExpanded = Boolean(expandedPapers[paperCollapseKey]);
                        const paperExps = p.exps.filter((e) => e.paper === paper.id);

                        return (
                          <div key={paper.id} className="space-y-0.5">
                            {/* Paper Row */}
                            <div
                              onClick={() => {
                                if (!isProjectSelected) {
                                  setView({ type: 'p', id: p.id });
                                  setFilter('paper', [paper.id]);
                                } else {
                                  toggleFilterValue('paper', paper.id);
                                }
                              }}
                              onDoubleClick={() => handleRenamePaper(paper.id, paper.name)}
                              title={
                                isPaperFiltered
                                  ? filters.paperNot
                                    ? `Paper is excluded (NOT mode). Click to remove exclusion.`
                                    : `Paper is filtered. Click to toggle.`
                                  : `Click to filter by "${paper.name}", double-click to rename`
                              }
                              className={`px-1.5 py-1 text-[13px] rounded-md cursor-pointer flex items-center justify-between group transition-colors ${
                                isPaperFiltered
                                  ? filters.paperNot
                                    ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 font-semibold'
                                    : 'bg-[var(--sel)] font-semibold text-[var(--acc)]'
                                  : 'hover:bg-black/5 dark:hover:bg-white/5'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 truncate min-w-0">
                                {paperExps.length > 0 ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedPapers((prev) => ({
                                        ...prev,
                                        [paperCollapseKey]: !prev[paperCollapseKey],
                                      }));
                                    }}
                                    className="!p-0 border-none bg-transparent text-[var(--mut)] hover:text-[var(--ink)] cursor-pointer flex items-center justify-center shrink-0 w-3 h-3"
                                    title={isPaperExpanded ? 'Collapse experiments' : 'Expand experiments'}
                                  >
                                    {isPaperExpanded ? (
                                      <ChevronDown size={11} />
                                    ) : (
                                      <ChevronRight size={11} />
                                    )}
                                  </button>
                                ) : (
                                  <span className="w-3 shrink-0" />
                                )}
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: paper.color }}
                                />
                                <span
                                  className={`truncate ${
                                    isPaperFiltered && filters.paperNot
                                      ? 'line-through opacity-80'
                                      : ''
                                  }`}
                                >
                                  {paper.name}
                                </span>
                                {paperExps.length > 0 && (
                                  <span className="text-[10px] text-[var(--mut)] font-mono shrink-0 ml-0.5">
                                    ({paperExps.length})
                                  </span>
                                )}
                              </div>

                            </div>

                            {/* Nested experiments under paper */}
                            {isPaperExpanded && paperExps.length > 0 && (
                              <div className="space-y-0.5 ml-3 pl-2 border-l border-[var(--line)]/40">
                                {paperExps.map((exp) => {
                                  const isExpActive = activeModalExpId === exp.id;
                                  return (
                                    <div
                                      key={exp.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (view.type !== 'p' || view.id !== p.id) {
                                          setView({ type: 'p', id: p.id });
                                        }
                                        openModal(exp.id);
                                      }}
                                      className={`px-2 py-0.5 rounded text-[12px] cursor-pointer flex items-center justify-between group transition-colors ${
                                        isExpActive
                                          ? 'bg-[var(--sel)] font-semibold text-[var(--acc)]'
                                          : 'hover:bg-black/5 dark:hover:bg-white/5 text-[var(--ink)]/85'
                                      }`}
                                      title={`${exp.name} (${exp.status}${exp.priority ? ` • ${exp.priority}` : ''})`}
                                    >
                                      <div className="flex items-center gap-1.5 truncate min-w-0">
                                        <span
                                          className="w-1.5 h-1.5 rounded-full shrink-0"
                                          style={{
                                            backgroundColor:
                                              STATUS_COLORS[exp.status] || '#9ca3af',
                                          }}
                                        />
                                        <span className="truncate">{exp.name}</span>
                                      </div>
                                      <span className="text-[10px] text-[var(--mut)] font-mono opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                        {exp.status}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}


                      {/* Unassigned Experiments directly under the project */}
                      {unassignedExps.length > 0 && (
                        <div className="space-y-0.5 pt-0.5">
                          {projectPapers.length > 0 && (
                            <div className="px-1.5 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-[var(--mut)] font-semibold flex items-center gap-1 select-none">
                              <FlaskConical size={10} className="text-[var(--mut)]" />
                              <span>Unassigned ({unassignedExps.length})</span>
                            </div>
                          )}
                          {unassignedExps.map((exp) => {
                            const isExpActive = activeModalExpId === exp.id;
                            return (
                              <div
                                key={exp.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (view.type !== 'p' || view.id !== p.id) {
                                    setView({ type: 'p', id: p.id });
                                  }
                                  openModal(exp.id);
                                }}
                                className={`px-2 py-0.5 rounded text-[12px] cursor-pointer flex items-center justify-between group transition-colors ${
                                  isExpActive
                                    ? 'bg-[var(--sel)] font-semibold text-[var(--acc)]'
                                    : 'hover:bg-black/5 dark:hover:bg-white/5 text-[var(--ink)]/85'
                                }`}
                                title={`${exp.name} (${exp.status}${exp.priority ? ` • ${exp.priority}` : ''})`}
                              >
                                <div className="flex items-center gap-1.5 truncate min-w-0">
                                  <span
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{
                                      backgroundColor:
                                        STATUS_COLORS[exp.status] || '#9ca3af',
                                    }}
                                  />
                                  <span className="truncate">{exp.name}</span>
                                </div>
                                <span className="text-[10px] text-[var(--mut)] font-mono opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                  {exp.status}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {activeProjects.length === 0 && (
              <div className="text-xs text-[var(--mut)] px-2 py-1 italic">
                No active projects.
              </div>
            )}
          </div>
        </div>

        {/* Papers header */}
        <div>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-[var(--mut)] mb-1.5 font-medium px-1">
            <span>Papers ({activePapers.length})</span>
            <button
              onClick={handleAddPaper}
              title="Create new paper"
              className="w-5 h-5 !p-0 flex items-center justify-center rounded border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--sel)]"
            >
              <Plus size={13} />
            </button>
          </div>

          {/* All papers overview */}
          <div
            onClick={() => setView({ type: 'pp' })}
            className={`px-2 py-1.5 rounded-md cursor-pointer flex items-center gap-2 transition-colors ${
              view.type === 'pp' && !view.id
                ? 'bg-[var(--sel)] font-semibold'
                : 'hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            <FileText size={15} className="text-[var(--mut)] shrink-0" />
            <span>All papers overview</span>
          </div>

          {/* Individual paper tabs */}
          <div className="mt-1 space-y-0.5">
            {activePapers.map((paper) => {
              const isSelected = view.type === 'pp' && view.id === paper.id;
              const isOverviewPaperExpanded = Boolean(expandedOverviewPapers[paper.id]);
              const paperAllExps = activeProjects.flatMap((pr) =>
                pr.exps
                  .filter((e) => e.paper === paper.id)
                  .map((e) => ({ ...e, projectId: pr.id, projectName: pr.name }))
              );

              return (
                <div key={paper.id} className="space-y-0.5">
                  <div
                    onClick={() => setView({ type: 'pp', id: paper.id })}
                    onDoubleClick={() => handleRenamePaper(paper.id, paper.name)}
                    className={`px-2 py-1.5 rounded-md cursor-pointer flex items-center justify-between group truncate transition-colors ${
                      isSelected
                        ? 'bg-[var(--sel)] font-semibold'
                        : 'hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                    title="Click to view paper, double-click to rename"
                  >
                    <div className="flex items-center gap-1.5 truncate min-w-0">
                      {paperAllExps.length > 0 ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedOverviewPapers((prev) => ({
                              ...prev,
                              [paper.id]: !prev[paper.id],
                            }));
                          }}
                          className="!p-0 border-none bg-transparent text-[var(--mut)] hover:text-[var(--ink)] cursor-pointer flex items-center justify-center shrink-0 w-3 h-3"
                          title={isOverviewPaperExpanded ? 'Collapse experiments' : 'Expand experiments'}
                        >
                          {isOverviewPaperExpanded ? (
                            <ChevronDown size={11} />
                          ) : (
                            <ChevronRight size={11} />
                          )}
                        </button>
                      ) : (
                        <span className="w-3 shrink-0" />
                      )}
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: paper.color }}
                      />
                      <span className="truncate text-[13px]">{paper.name}</span>
                      {paperAllExps.length > 0 && (
                        <span className="text-[10px] text-[var(--mut)] font-mono shrink-0 ml-0.5">
                          ({paperAllExps.length})
                        </span>
                      )}
                    </div>

                  </div>

                  {/* Experiments nested under paper in Papers overview */}
                  {isOverviewPaperExpanded && paperAllExps.length > 0 && (
                    <div className="space-y-0.5 ml-3 pl-2 border-l border-[var(--line)]/40">
                      {paperAllExps.map((exp) => {
                        const isExpActive = activeModalExpId === exp.id;
                        return (
                          <div
                            key={exp.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setView({ type: 'p', id: exp.projectId });
                              openModal(exp.id);
                            }}
                            className={`px-2 py-0.5 rounded text-[12px] cursor-pointer flex items-center justify-between group transition-colors ${
                              isExpActive
                                ? 'bg-[var(--sel)] font-semibold text-[var(--acc)]'
                                : 'hover:bg-black/5 dark:hover:bg-white/5 text-[var(--ink)]/85'
                            }`}
                            title={`${exp.name} in ${exp.projectName} (${exp.status})`}
                          >
                            <div className="flex items-center gap-1.5 truncate min-w-0">
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{
                                  backgroundColor:
                                    STATUS_COLORS[exp.status] || '#9ca3af',
                                }}
                              />
                              <span className="truncate">{exp.name}</span>
                            </div>
                            <span className="text-[10px] text-[var(--mut)] truncate max-w-[65px] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity font-mono">
                              {exp.projectName}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {activePapers.length === 0 && (
              <div className="text-xs text-[var(--mut)] px-2 py-1 italic">
                No active papers.
              </div>
            )}
          </div>
        </div>

        {/* Archived Section (Collapsible) */}
        {(archivedProjects.length > 0 || archivedPapers.length > 0) && (
          <div className="pt-2 border-t border-[var(--line)]/60">
            <button
              type="button"
              onClick={() => setIsArchivedSectionOpen(!isArchivedSectionOpen)}
              className="w-full flex items-center justify-between px-1 py-1 text-[11px] uppercase tracking-wider text-[var(--mut)] hover:text-[var(--ink)] font-medium border-none bg-transparent"
            >
              <div className="flex items-center gap-1.5">
                <FolderArchive size={13} />
                <span>
                  Archived ({archivedProjects.length + archivedPapers.length})
                </span>
              </div>
              {isArchivedSectionOpen ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )}
            </button>

            {isArchivedSectionOpen && (
              <div className="mt-1 space-y-2 pl-1 animate-in fade-in duration-100">
                {/* Archived Projects */}
                {archivedProjects.length > 0 && (
                  <div>
                    <span className="text-[10px] text-[var(--mut)] font-semibold uppercase block px-1 mb-0.5">
                      Projects
                    </span>
                    <div className="space-y-0.5">
                      {archivedProjects.map((p) => (
                        <div
                          key={p.id}
                          className="px-2 py-1 rounded text-xs flex items-center justify-between group hover:bg-black/5 dark:hover:bg-white/5 text-[var(--mut)] hover:text-[var(--ink)]"
                        >
                          <span
                            className="truncate cursor-pointer hover:underline"
                            onClick={() => setView({ type: 'p', id: p.id })}
                            title="Click to view archived project"
                          >
                            {p.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Archived Papers */}
                {archivedPapers.length > 0 && (
                  <div>
                    <span className="text-[10px] text-[var(--mut)] font-semibold uppercase block px-1 mb-0.5">
                      Papers
                    </span>
                    <div className="space-y-0.5">
                      {archivedPapers.map((paper) => (
                        <div
                          key={paper.id}
                          className="px-2 py-1 rounded text-xs flex items-center justify-between group hover:bg-black/5 dark:hover:bg-white/5 text-[var(--mut)] hover:text-[var(--ink)]"
                        >
                          <div
                            onClick={() => setView({ type: 'pp', id: paper.id })}
                            className="flex items-center gap-1.5 truncate cursor-pointer hover:underline"
                            title="Click to view archived paper"
                          >
                            <span
                              className="w-2 h-2 rounded-full shrink-0 opacity-50"
                              style={{ backgroundColor: paper.color }}
                            />
                            <span className="truncate">{paper.name}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Theme toggle & footer */}
      <div className="pt-3 border-t border-[var(--line)] mt-4">
        <button
          onClick={toggleDarkMode}
          className="w-full flex items-center justify-center gap-2 py-1.5 text-xs text-[var(--mut)] hover:text-[var(--ink)]"
        >
          {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
          <span>{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
        </button>
      </div>

    </aside>
  );
};
