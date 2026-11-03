import React, { useState } from 'react';
import { useLabStore } from '../../store/useLabStore';
import {
  STATUS_LIST,
  PRIORITY_LIST,
  STATUS_COLORS,
  PRIORITY_COLORS,
} from '../../utils/colors';
import {
  RotateCcw,
  Plus,
  Edit3,
  Trash2,
  Magnet,
  Grid3x3,
  X,
  Archive,
  ArchiveRestore,
  FolderArchive,
  Ban,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { ProjectPapersModal } from '../Modal/ProjectPapersModal';
import { confirmDialog, promptDialog } from '../../store/useDialogStore';
import { promptCreateExperiment } from '../../utils/experimentCreation';
import {
  UnifiedFilterDropdown,
  type FilterCategoryConfig,
} from '../Filters/UnifiedFilterDropdown';

export const Header: React.FC = () => {
  const {
    projects,
    papers,
    view,
    filters,
    toggleFilterValue,
    setFilterValues,
    setFilterNot,
    toggleFilterNot,
    clearFilter,
    resetFilters,
    resetProjectLayout,
    addExperiment,
    renameProject,
    deleteProject,
    archiveProject,
    unarchiveProject,
    unassignPaperFromProject,
    snapToGrid,
    showGrid,
    toggleSnapToGrid,
    toggleShowGrid,
    isSidebarOpen,
    toggleSidebar,
  } = useLabStore();

  const [isPapersModalOpen, setIsPapersModalOpen] = useState(false);

  const isActiveFilter = filters.statusNot && filters.status.length === 1 && filters.status[0] === 'Done';

  const currentProject =
    view.type === 'p' ? projects.find((p) => p.id === view.id) : null;

  const assignedPaperIds = new Set<string>([
    ...(currentProject?.paperIds || []),
    ...((currentProject?.exps || []).map((e) => e.paper).filter(Boolean) as string[]),
  ]);
  const assignedPapers = papers.filter((p) => assignedPaperIds.has(p.id));

  const handleResetLayout = () => {
    if (currentProject) {
      resetProjectLayout(currentProject.id);
    }
  };

  const handleAddExperiment = async () => {
    if (currentProject) {
      const result = await promptCreateExperiment({
        project: currentProject,
        papers,
        title: 'New Experiment',
        message: `Add an experiment to "${currentProject.name}":`,
      });
      if (result) {
        addExperiment(
          currentProject.id,
          result.name,
          [],
          result.paperId,
          result.status,
          result.priority,
          result.phases
        );
      }
    }
  };

  const handleRenameProject = async () => {
    if (currentProject) {
      const name = await promptDialog({
        title: 'Rename Project',
        defaultValue: currentProject.name,
        confirmLabel: 'Save',
      });
      if (name && name.trim()) {
        renameProject(currentProject.id, name.trim());
      }
    }
  };

  const handleDeleteProject = async () => {
    if (currentProject) {
      const confirmed = await confirmDialog({
        title: 'Delete Project',
        message: `Delete project "${currentProject.name}" and all its experiments? This action cannot be undone.`,
        confirmLabel: 'Delete Permanently',
        variant: 'danger',
      });
      if (confirmed) {
        deleteProject(currentProject.id);
      }
    }
  };

  const handleArchiveProject = async () => {
    if (currentProject) {
      const confirmed = await confirmDialog({
        title: 'Archive Project',
        message: `Archive project "${currentProject.name}"? It can be restored anytime from the archive.`,
        confirmLabel: 'Archive Project',
        variant: 'warning',
      });
      if (confirmed) {
        archiveProject(currentProject.id);
      }
    }
  };

  const handleUnassignPaper = async (paperId: string, paperName: string) => {
    if (currentProject) {
      const confirmed = await confirmDialog({
        title: 'Unassign Paper',
        message: `Unassign paper "${paperName}" from project "${currentProject.name}"?`,
        confirmLabel: 'Unassign',
        variant: 'default',
      });
      if (confirmed) {
        unassignPaperFromProject(currentProject.id, paperId);
      }
    }
  };

  const currentPaper =
    view.type === 'pp' && view.id
      ? papers.find((p) => p.id === view.id)
      : null;

  const getTitle = () => {
    if (view.type === 'all') return 'All projects';
    if (view.type === 'calendar') return 'Calendar & Schedule';
    if (view.type === 'gantt') return 'Gantt Chart';
    if (view.type === 'pp') {
      return currentPaper ? currentPaper.name : 'Papers overview';
    }
    return currentProject ? currentProject.name : 'Lab Planner';
  };

  // Experiments relevant to current view for counts
  const relevantExps = currentProject
    ? currentProject.exps
    : projects.flatMap((p) => p.exps);

  // Status Filter options
  const statusOptions = STATUS_LIST.map((st) => ({
    id: st,
    label: st,
    color: STATUS_COLORS[st],
    count: relevantExps.filter((e) => e.status === st).length,
  }));

  // Priority Filter options
  const priorityOptions = [
    ...PRIORITY_LIST.map((pr) => ({
      id: pr as string,
      label: pr as string,
      color: PRIORITY_COLORS[pr],
      count: relevantExps.filter((e) => e.priority === pr).length,
    })),
    {
      id: '-',
      label: 'No priority',
      count: relevantExps.filter((e) => !e.priority).length,
    },
  ];

  // Paper Filter options
  const paperOptions = [
    ...papers
      .filter((q) => !q.archived || filters.paper.includes(q.id))
      .map((q) => ({
        id: q.id,
        label: q.name,
        color: q.color,
        archived: q.archived,
        count: relevantExps.filter((e) => e.paper === q.id).length,
      })),
    {
      id: '-',
      label: 'No paper',
      count: relevantExps.filter((e) => !e.paper).length,
    },
  ];

  const filterCategories: FilterCategoryConfig[] = [
    {
      id: 'status',
      title: 'Status',
      options: statusOptions,
      selectedValues: filters.status,
      isNot: filters.statusNot,
      onToggleValue: (id) => toggleFilterValue('status', id),
      onSetValues: (values) => setFilterValues('status', values),
      onToggleNot: () => toggleFilterNot('status'),
      onClear: () => clearFilter('status'),
    },
    {
      id: 'priority',
      title: 'Priority',
      options: priorityOptions,
      selectedValues: filters.priority,
      isNot: filters.priorityNot,
      onToggleValue: (id) => toggleFilterValue('priority', id),
      onSetValues: (values) => setFilterValues('priority', values),
      onToggleNot: () => toggleFilterNot('priority'),
      onClear: () => clearFilter('priority'),
    },
    ...(view.type !== 'pp'
      ? [
          {
            id: 'paper',
            title: 'Paper',
            options: paperOptions,
            selectedValues: filters.paper,
            isNot: filters.paperNot,
            onToggleValue: (id: string) => toggleFilterValue('paper', id),
            onSetValues: (values: string[]) => setFilterValues('paper', values),
            onToggleNot: () => toggleFilterNot('paper'),
            onClear: () => clearFilter('paper'),
          },
        ]
      : []),
  ];

  return (
    <header className="relative z-40 px-4 py-2 border-b border-[var(--line)] flex items-center justify-between gap-3 flex-nowrap bg-[var(--card)]/50 backdrop-blur-xs select-none min-w-0">
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        {/* Left Sidebar Toggle Button */}
        <button
          type="button"
          onClick={toggleSidebar}
          title={isSidebarOpen ? 'Collapse sidebar (Ctrl+B)' : 'Expand sidebar (Ctrl+B)'}
          className={`p-1.5 rounded-lg border transition-all cursor-pointer shrink-0 flex items-center justify-center shadow-3xs ${
            !isSidebarOpen
              ? 'bg-[var(--sel)] text-[var(--acc)] border-[var(--acc)]/60 shadow-xs'
              : 'border-[var(--line)] bg-[var(--card)] hover:bg-[var(--sel)] text-[var(--mut)] hover:text-[var(--ink)]'
          }`}
        >
          {isSidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>

        <div className="flex items-center gap-2 shrink-0">
          {currentPaper && (
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: currentPaper.color }}
            />
          )}
          <h2 className="text-[16px] font-semibold tracking-tight m-0 truncate max-w-[150px] sm:max-w-[220px]">
            {currentProject ? (
              <button
                type="button"
                onClick={handleRenameProject}
                title="Rename project"
                aria-label={`Rename project ${currentProject.name}`}
                className="block max-w-full truncate text-left hover:text-[var(--acc)] cursor-pointer"
              >
                {currentProject.name}
              </button>
            ) : getTitle()}
          </h2>
          {currentProject?.archived && (
            <span className="px-2 py-0.5 rounded text-[11px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-medium flex items-center gap-1 shrink-0">
              <FolderArchive size={12} />
              <span>Archived</span>
            </span>
          )}
          {currentPaper?.archived && (
            <span className="px-2 py-0.5 rounded text-[11px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-medium flex items-center gap-1 shrink-0">
              <Archive size={12} />
              <span>Archived</span>
            </span>
          )}
        </div>

        {/* Assigned Papers Chips for Current Project */}
        {view.type === 'p' && currentProject && (
          <div className="flex items-center gap-1.5 flex-nowrap shrink-0">
            {assignedPapers.map((paper) => {
              const isFiltered = filters.paper.includes(paper.id);
              return (
                <div
                  key={paper.id}
                  className={`group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border transition-all cursor-pointer select-none shrink-0 ${
                    isFiltered
                      ? filters.paperNot
                        ? 'bg-rose-500/10 border-rose-500/50 text-rose-800 dark:text-rose-200 font-medium'
                        : 'bg-[var(--sel)] border-[var(--acc)] text-[var(--acc)] font-medium shadow-xs'
                      : 'bg-black/3 dark:bg-white/5 border-[var(--line)] text-[var(--ink)] hover:border-[var(--acc)]/60'
                  }`}
                  onClick={() => toggleFilterValue('paper', paper.id)}
                  title={
                    isFiltered
                      ? filters.paperNot
                        ? `Click to remove "${paper.name}" from excluded papers`
                        : `Click to remove "${paper.name}" from filtered papers`
                      : `Click to filter flowchart by "${paper.name}"`
                  }
                >
                  {isFiltered && filters.paperNot ? (
                    <Ban size={10} className="text-rose-600 shrink-0" />
                  ) : (
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: paper.color }}
                    />
                  )}
                  <span
                    className={`truncate max-w-[120px] ${
                      isFiltered && filters.paperNot ? 'line-through opacity-85' : ''
                    }`}
                  >
                    {paper.name}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUnassignPaper(paper.id, paper.name);
                    }}
                    title="Unassign paper from project"
                    className="opacity-0 group-hover:opacity-100 -mr-1 p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/20 text-[var(--mut)] hover:text-red-500 transition-opacity border-none bg-transparent cursor-pointer"
                  >
                    <X size={10} />
                  </button>
                </div>
              );
            })}

            {/* Quick NOT toggle for paper chips if any paper is filtered */}
            {filters.paper.length > 0 && (
              <button
                type="button"
                onClick={() => toggleFilterNot('paper')}
                title={
                  filters.paperNot
                    ? 'Switch paper filter to Include (IS) mode'
                    : 'Switch paper filter to Exclude (NOT) mode'
                }
                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors flex items-center gap-1 font-semibold shrink-0 cursor-pointer ${
                  filters.paperNot
                    ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                    : 'bg-black/5 dark:bg-white/10 border-[var(--line)] text-[var(--mut)] hover:text-[var(--ink)]'
                }`}
              >
                {filters.paperNot ? 'NOT' : 'IS'}
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsPapersModalOpen(true)}
              className="text-xs px-2 py-0.5 rounded-full border border-dashed border-[var(--line)] hover:border-[var(--acc)] text-[var(--mut)] hover:text-[var(--ink)] hover:bg-[var(--sel)] flex items-center gap-1 transition-colors shrink-0 cursor-pointer"
              title="Assign or create papers for this project"
            >
              <Plus size={11} />
              <span>Paper</span>
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0 flex-nowrap">
        {view.type !== 'calendar' && (
          <UnifiedFilterDropdown
            categories={filterCategories}
            onResetAll={resetFilters}
            align="right"
          />
        )}

        {view.type === 'all' && (
          <button
            type="button"
            title="Active"
            aria-pressed={isActiveFilter}
            onClick={() => {
              if (isActiveFilter) {
                resetFilters();
              } else {
                setFilterValues('status', ['Done']);
                setFilterNot('status', true);
              }
            }}
            className={`text-xs py-1 px-2 rounded-md border transition-colors cursor-pointer ${isActiveFilter
              ? '!border-emerald-500 !text-emerald-700 dark:!text-emerald-400 hover:bg-emerald-500/10'
              : 'border-[var(--line)] hover:bg-[var(--sel)] text-[var(--ink)]'}`}
          >
            Active
          </button>
        )}

        {/* Project Specific Actions */}
        {view.type === 'p' && currentProject && (
          <div className="flex items-center gap-1.5 ml-1 border-l border-[var(--line)] pl-2 flex-nowrap">
            <button
              type="button"
              onClick={handleResetLayout}
              title="Reset to automatic DAG flowchart layout"
              className="text-xs py-1 px-2 rounded-md hover:bg-[var(--sel)] border border-transparent hover:border-[var(--line)] text-[var(--mut)] hover:text-[var(--ink)] flex items-center gap-1 transition-colors cursor-pointer"
            >
              <RotateCcw size={13} />
              <span className="hidden sm:inline">Reset layout</span>
            </button>

            <button
              type="button"
              onClick={toggleShowGrid}
              title={showGrid ? 'Hide grid dots' : 'Show grid dots'}
              className={`text-xs py-1 px-2 rounded-md transition-colors flex items-center gap-1.5 border cursor-pointer ${
                showGrid
                  ? 'bg-[var(--sel)] text-[var(--acc)] font-medium border-[var(--acc)]/40 shadow-3xs'
                  : 'text-[var(--mut)] hover:text-[var(--ink)] border-transparent hover:border-[var(--line)] hover:bg-[var(--sel)]/50'
              }`}
            >
              <Grid3x3 size={13} />
              <span>Grid</span>
            </button>

            <button
              type="button"
              onClick={toggleSnapToGrid}
              title={
                snapToGrid
                  ? 'Disable grid snapping (hold Alt while dragging to micro-adjust)'
                  : 'Enable grid snapping (20px)'
              }
              className={`text-xs py-1 px-2 rounded-md transition-colors flex items-center gap-1.5 border cursor-pointer ${
                snapToGrid
                  ? 'bg-[var(--sel)] text-[var(--acc)] font-medium border-[var(--acc)]/40 shadow-3xs'
                  : 'text-[var(--mut)] hover:text-[var(--ink)] border-transparent hover:border-[var(--line)] hover:bg-[var(--sel)]/50'
              }`}
            >
              <Magnet size={13} />
              <span>Snap {snapToGrid ? 'On' : 'Off'}</span>
            </button>

            <button
              type="button"
              onClick={handleAddExperiment}
              className="primary text-xs py-1 px-2.5 rounded-md font-medium flex items-center gap-1 shadow-xs cursor-pointer"
            >
              <Plus size={13} />
              <span>Experiment</span>
            </button>

            {currentProject.archived ? (
              <button
                type="button"
                onClick={() => unarchiveProject(currentProject.id)}
                className="text-xs py-1 px-2.5 bg-[var(--acc)] text-white hover:opacity-90 rounded-md flex items-center gap-1.5 shadow-xs cursor-pointer"
                title="Restore project from archive"
              >
                <ArchiveRestore size={13} />
                <span>Restore Project</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleArchiveProject}
                className="text-xs py-1 px-2 rounded-md flex items-center gap-1 text-[var(--mut)] hover:text-[var(--ink)] hover:bg-[var(--sel)] border border-transparent hover:border-[var(--line)] transition-colors cursor-pointer"
                title="Archive project"
              >
                <Archive size={13} />
                <span className="hidden md:inline">Archive</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleRenameProject}
              className="text-xs py-1 px-2 rounded-md text-[var(--mut)] hover:text-[var(--ink)] hover:bg-[var(--sel)] border border-transparent hover:border-[var(--line)] flex items-center gap-1 transition-colors cursor-pointer"
              title="Rename project"
            >
              <Edit3 size={13} />
              <span className="hidden md:inline">Rename</span>
            </button>

            <button
              type="button"
              onClick={handleDeleteProject}
              className="danger text-xs py-1 px-2 rounded-md flex items-center gap-1 cursor-pointer"
              title="Delete project"
            >
              <Trash2 size={13} />
              <span className="hidden md:inline">Delete</span>
            </button>
          </div>
        )}
      </div>

      {currentProject && (
        <ProjectPapersModal
          projectId={currentProject.id}
          isOpen={isPapersModalOpen}
          onClose={() => setIsPapersModalOpen(false)}
        />
      )}
    </header>
  );
};
