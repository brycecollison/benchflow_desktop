import React, { useState, useEffect } from 'react';
import { useLabStore } from '../../store/useLabStore';
import { MiniFlowCanvas } from '../FlowCanvas/MiniFlowCanvas';
import { matchesFilter } from '../../utils/dag';
import {
  Folder,
  Plus,
  FileText,
  Archive,
  ArchiveRestore,
  Trash2,
  FolderArchive,
  Search,
  X,
  SlidersHorizontal,
  Eye,
  EyeOff,
  Ban,
} from 'lucide-react';
import { ProjectPapersModal } from '../Modal/ProjectPapersModal';
import { confirmDialog } from '../../store/useDialogStore';

export const AllProjectsView: React.FC = () => {
  const {
    projects,
    papers,
    filters,
    setView,
    openModal,
    archiveProject,
    unarchiveProject,
    deleteProject,
    toggleFilterValue,
    clearFilter,
    resetFilters,
    resetAllProjectLayouts,
  } = useLabStore();

  const [assignModalProjectId, setAssignModalProjectId] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [hideNonMatching, setHideNonMatching] = useState(true);

  const activeProjects = projects.filter((p) => !p.archived);
  const archivedProjects = projects.filter((p) => p.archived);
  const baseProjects = tab === 'active' ? activeProjects : archivedProjects;

  const hasActiveFilters =
    filters.status.length > 0 ||
    filters.paper.length > 0 ||
    filters.priority.length > 0;

  // When filters are applied in the all projects view, all flow charts should automatically reset their layouts
  useEffect(() => {
    if (hasActiveFilters) {
      resetAllProjectLayouts();
    }
  }, [hasActiveFilters, filters, resetAllProjectLayouts]);

  const q = searchQuery.toLowerCase().trim();

  // Process projects with filter matching and search matching
  const processedProjects = baseProjects.map((project) => {
    const matchingExps = project.exps.filter((e) => matchesFilter(e, filters));
    const assignedIds = new Set<string>([
      ...(project.paperIds || []),
      ...project.exps.map((e) => e.paper).filter(Boolean),
    ]);
    const projectPapers = papers.filter((p) => assignedIds.has(p.id));

    // Search query check:
    let matchesSearch = true;
    if (q) {
      const matchesProjectName = project.name.toLowerCase().includes(q);
      const matchesExps = project.exps.some(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.purpose && e.purpose.toLowerCase().includes(q)) ||
          (e.expectedResults && e.expectedResults.toLowerCase().includes(q)) ||
          (e.experimentalDesign && e.experimentalDesign.toLowerCase().includes(q)) ||
          (e.experimentalProtocol && e.experimentalProtocol.toLowerCase().includes(q)) ||
          (e.dataAcquisition && e.dataAcquisition.toLowerCase().includes(q)) ||
          (e.dataAnalysis && e.dataAnalysis.toLowerCase().includes(q)) ||
          (e.results && e.results.toLowerCase().includes(q)) ||
          (e.notes && e.notes.toLowerCase().includes(q))
      );
      const matchesPapers = projectPapers.some((p) =>
        p.name.toLowerCase().includes(q)
      );
      matchesSearch = matchesProjectName || matchesExps || matchesPapers;
    }

    const matchesGlobalFilters = !hasActiveFilters || matchingExps.length > 0;

    return {
      project,
      projectPapers,
      matchingExps,
      matchesSearch,
      matchesGlobalFilters,
    };
  });

  // Filter projects by search
  const searchFilteredProjects = processedProjects.filter((item) => item.matchesSearch);

  // Count projects with matching experiments
  const matchingProjectsCount = searchFilteredProjects.filter(
    (item) => item.matchesGlobalFilters
  ).length;

  const nonMatchingProjectsCount =
    searchFilteredProjects.length - matchingProjectsCount;

  // Final projects to display (controlled by hideNonMatching toggle when filters are active)
  const displayedProjects = searchFilteredProjects.filter((item) => {
    if (!hasActiveFilters) return true;
    if (hideNonMatching) return item.matchesGlobalFilters;
    return true;
  });

  const handleDelete = async (projectId: string, name: string) => {
    const confirmed = await confirmDialog({
      title: 'Delete Project',
      message: `Permanently delete project "${name}" and all its experiments? This cannot be undone.`,
      confirmLabel: 'Delete Permanently',
      variant: 'danger',
    });
    if (confirmed) {
      deleteProject(projectId);
    }
  };

  const handleArchive = async (projectId: string, name: string) => {
    const confirmed = await confirmDialog({
      title: 'Archive Project',
      message: `Archive project "${name}"? It will be moved to the archive section, but all experiment records will be preserved.`,
      confirmLabel: 'Archive Project',
      variant: 'warning',
    });
    if (confirmed) {
      archiveProject(projectId);
    }
  };

  return (
    <div className="flex-1 p-6 overflow-auto" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="w-[90%] mx-auto space-y-4">
        {/* Top Header & Search Controls */}
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-3 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTab('active')}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                tab === 'active'
                  ? 'bg-[var(--sel)] text-[var(--acc)] border border-[var(--acc)]/30'
                  : 'text-[var(--mut)] hover:text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
              }`}
            >
              Active Projects ({activeProjects.length})
            </button>

            <button
              onClick={() => setTab('archived')}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                tab === 'archived'
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                  : 'text-[var(--mut)] hover:text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
              }`}
            >
              <Archive size={12} />
              <span>Archived ({archivedProjects.length})</span>
            </button>
          </div>

          {/* Search bar & Project counts */}
          <div className="flex items-center gap-3 flex-1 max-w-md ml-auto justify-end">
            <div className="relative flex-1 max-w-xs">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--mut)]"
              />
              <input
                type="text"
                placeholder="Search projects & experiments..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs !pl-8 !pr-8 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--card)] focus:outline-hidden focus:border-[var(--acc)] text-[var(--ink)] placeholder:text-[var(--mut)] shadow-xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--mut)] hover:text-[var(--ink)] border-none bg-transparent !p-0 cursor-pointer"
                  title="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <span className="text-xs text-[var(--mut)] font-mono shrink-0">
              {displayedProjects.length} of {baseProjects.length}{' '}
              {baseProjects.length === 1 ? 'project' : 'projects'}
            </span>
          </div>
        </div>

        {/* Active Filters Summary Banner */}
        {(hasActiveFilters || searchQuery) && (
          <div className="p-2.5 rounded-xl border border-[var(--line)] bg-[var(--card)]/80 backdrop-blur-xs flex items-center justify-between flex-wrap gap-2 text-xs shadow-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-[var(--mut)] flex items-center gap-1">
                <SlidersHorizontal size={12} className="text-[var(--acc)]" />
                <span>Active Filters:</span>
              </span>

              {/* Status filter pill */}
              {filters.status.length > 0 && (
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium text-[11px] ${
                    filters.statusNot
                      ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                      : 'bg-[var(--sel)] text-[var(--acc)] border border-[var(--acc)]/30'
                  }`}
                >
                  {filters.statusNot && (
                    <span className="px-1 py-0.2 rounded text-[9px] bg-rose-600 text-white font-bold uppercase">
                      NOT
                    </span>
                  )}
                  <span>Status: {filters.status.join(', ')}</span>
                  <button
                    type="button"
                    onClick={() => clearFilter('status')}
                    className="hover:text-red-500 border-none bg-transparent !p-0 ml-0.5 cursor-pointer"
                    title="Remove status filter"
                  >
                    <X size={10} />
                  </button>
                </span>
              )}

              {/* Priority filter pill */}
              {filters.priority.length > 0 && (
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium text-[11px] ${
                    filters.priorityNot
                      ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                      : 'bg-[var(--sel)] text-[var(--acc)] border border-[var(--acc)]/30'
                  }`}
                >
                  {filters.priorityNot && (
                    <span className="px-1 py-0.2 rounded text-[9px] bg-rose-600 text-white font-bold uppercase">
                      NOT
                    </span>
                  )}
                  <span>
                    Priority:{' '}
                    {filters.priority
                      .map((p) => (p === '-' ? 'None' : p))
                      .join(', ')}
                  </span>
                  <button
                    type="button"
                    onClick={() => clearFilter('priority')}
                    className="hover:text-red-500 border-none bg-transparent !p-0 ml-0.5 cursor-pointer"
                    title="Remove priority filter"
                  >
                    <X size={10} />
                  </button>
                </span>
              )}

              {/* Paper filter pill */}
              {filters.paper.length > 0 && (
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium text-[11px] ${
                    filters.paperNot
                      ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                      : 'bg-[var(--sel)] text-[var(--acc)] border border-[var(--acc)]/30'
                  }`}
                >
                  {filters.paperNot && (
                    <span className="px-1 py-0.2 rounded text-[9px] bg-rose-600 text-white font-bold uppercase">
                      NOT
                    </span>
                  )}
                  <span>
                    Paper:{' '}
                    {filters.paper
                      .map((id) =>
                        id === '-'
                          ? 'No paper'
                          : papers.find((p) => p.id === id)?.name || id
                      )
                      .join(', ')}
                  </span>
                  <button
                    type="button"
                    onClick={() => clearFilter('paper')}
                    className="hover:text-red-500 border-none bg-transparent !p-0 ml-0.5 cursor-pointer"
                    title="Remove paper filter"
                  >
                    <X size={10} />
                  </button>
                </span>
              )}

              {/* Search query pill */}
              {searchQuery && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/10 text-[var(--ink)] border border-[var(--line)] text-[11px]">
                  <span>Search: "{searchQuery}"</span>
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="hover:text-red-500 border-none bg-transparent !p-0 ml-0.5 cursor-pointer"
                    title="Clear search query"
                  >
                    <X size={10} />
                  </button>
                </span>
              )}
            </div>

            {/* Quick Actions: Hide non-matching & Reset */}
            <div className="flex items-center gap-2">
              {hasActiveFilters && nonMatchingProjectsCount > 0 && (
                <button
                  type="button"
                  onClick={() => setHideNonMatching(!hideNonMatching)}
                  className="text-xs px-2.5 py-1 rounded-md border border-[var(--line)] hover:bg-[var(--sel)] text-[var(--ink)] flex items-center gap-1.5 transition-colors"
                  title={
                    hideNonMatching
                      ? 'Show all projects including those with 0 matching experiments'
                      : 'Hide projects with 0 matching experiments'
                  }
                >
                  {hideNonMatching ? (
                    <>
                      <Eye size={12} />
                      <span>
                        Show {nonMatchingProjectsCount} non-matching{' '}
                        {nonMatchingProjectsCount === 1 ? 'project' : 'projects'}
                      </span>
                    </>
                  ) : (
                    <>
                      <EyeOff size={12} />
                      <span>Hide non-matching</span>
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  resetFilters();
                  setSearchQuery('');
                }}
                className="text-xs text-red-600 dark:text-red-400 hover:underline flex items-center gap-1 border-none bg-transparent !p-0 cursor-pointer font-medium ml-1"
              >
                <X size={11} />
                <span>Reset all</span>
              </button>
            </div>
          </div>
        )}

        {/* Project Cards Grid */}
        <div className="grid grid-cols-1 gap-4">
          {displayedProjects.map(
            ({ project, projectPapers, matchingExps, matchesGlobalFilters }) => {
              return (
                <div
                  key={project.id}
                  className={`min-w-0 border rounded-xl bg-[var(--card)] p-4 shadow-xs transition-colors ${
                    project.archived
                      ? 'border-amber-500/30 opacity-90'
                      : matchesGlobalFilters
                      ? 'border-[var(--line)] hover:border-[var(--acc)]/50'
                      : 'border-[var(--line)] opacity-60'
                  }`}
                >
                  {/* Project Card Header */}
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div
                      onClick={() => setView({ type: 'p', id: project.id })}
                      className="flex items-center gap-2 cursor-pointer group"
                    >
                      {project.archived ? (
                        <FolderArchive size={18} className="text-amber-500 shrink-0" />
                      ) : (
                        <Folder size={18} className="text-[var(--acc)] shrink-0" />
                      )}
                      <h3 className="font-semibold text-base group-hover:text-[var(--acc)] transition-colors m-0">
                        {project.name}
                      </h3>
                      {project.archived && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                          Archived
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Filter match count indicator */}
                      {hasActiveFilters ? (
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-mono font-medium ${
                            matchingExps.length > 0
                              ? 'bg-[var(--sel)] text-[var(--acc)] border border-[var(--acc)]/30'
                              : 'bg-black/5 dark:bg-white/5 text-[var(--mut)]'
                          }`}
                        >
                          {matchingExps.length} of {project.exps.length}{' '}
                          {project.exps.length === 1 ? 'experiment' : 'experiments'}{' '}
                          match
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--mut)] font-mono mr-1">
                          {project.exps.length}{' '}
                          {project.exps.length === 1 ? 'experiment' : 'experiments'}
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => setAssignModalProjectId(project.id)}
                        className="text-xs px-2.5 py-1 rounded-md border border-[var(--line)] hover:bg-[var(--sel)] hover:border-[var(--acc)]/60 text-[var(--ink)] flex items-center gap-1.5 transition-colors"
                        title="Manage papers assigned to this project"
                      >
                        <FileText size={12} className="text-[var(--acc)]" />
                        <span>Papers ({projectPapers.length})</span>
                      </button>

                      {project.archived ? (
                        <button
                          type="button"
                          onClick={() => unarchiveProject(project.id)}
                          className="text-xs px-2.5 py-1 rounded-md bg-[var(--acc)] text-white hover:opacity-90 flex items-center gap-1.5 transition-colors"
                          title="Restore project from archive"
                        >
                          <ArchiveRestore size={12} />
                          <span>Restore</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleArchive(project.id, project.name)}
                          className="text-xs px-2.5 py-1 rounded-md border border-[var(--line)] hover:bg-black/5 dark:hover:bg-white/5 text-[var(--mut)] hover:text-[var(--ink)] flex items-center gap-1.5 transition-colors"
                          title="Archive project"
                        >
                          <Archive size={12} />
                          <span>Archive</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleDelete(project.id, project.name)}
                        className="text-xs p-1.5 rounded-md hover:bg-red-500/10 text-[var(--mut)] hover:text-red-500 transition-colors border border-transparent hover:border-red-500/30"
                        title="Delete project permanently"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Assigned Papers Tags Row */}
                  <div className="flex items-center gap-1.5 flex-wrap mb-3">
                    <span className="text-[11px] text-[var(--mut)] font-medium mr-1">
                      Assigned Papers:
                    </span>
                    {projectPapers.map((paper) => {
                      const isPaperFiltered = filters.paper.includes(paper.id);

                      return (
                        <button
                          key={paper.id}
                          type="button"
                          onClick={() => toggleFilterValue('paper', paper.id)}
                          title={
                            isPaperFiltered
                              ? filters.paperNot
                                ? `Paper "${paper.name}" is excluded (NOT). Click to unselect.`
                                : `Paper "${paper.name}" is filtered. Click to unselect.`
                              : `Click to filter by "${paper.name}"`
                          }
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border transition-colors cursor-pointer select-none ${
                            isPaperFiltered
                              ? filters.paperNot
                                ? 'bg-rose-500/10 border-rose-500/40 text-rose-700 dark:text-rose-300 font-medium'
                                : 'bg-[var(--sel)] border-[var(--acc)] text-[var(--acc)] font-medium shadow-xs'
                              : 'bg-black/3 dark:bg-white/5 border-[var(--line)] text-[var(--ink)] hover:border-[var(--acc)]/60'
                          }`}
                        >
                          {isPaperFiltered && filters.paperNot ? (
                            <Ban size={9} className="text-rose-600 shrink-0" />
                          ) : (
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: paper.color }}
                            />
                          )}
                          <span
                            className={`truncate max-w-[150px] ${
                              isPaperFiltered && filters.paperNot
                                ? 'line-through opacity-80'
                                : ''
                            }`}
                          >
                            {paper.name}
                          </span>
                        </button>
                      );
                    })}

                    {projectPapers.length === 0 && (
                      <span className="text-[11px] text-[var(--mut)] italic">
                        None assigned yet
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => setAssignModalProjectId(project.id)}
                      className="text-[11px] px-1.5 py-0.5 rounded-full border border-dashed border-[var(--line)] hover:border-[var(--acc)] text-[var(--mut)] hover:text-[var(--ink)] flex items-center gap-1 transition-colors"
                      title="Assign paper to this project"
                    >
                      <Plus size={10} />
                      <span>Assign</span>
                    </button>
                  </div>

                  {/* Mini Flowchart Preview - dynamically filtered */}
                  <MiniFlowCanvas
                    project={project}
                    papers={papers}
                    filter={filters}
                    onOpenExperiment={(expId) => openModal(expId)}
                  />
                </div>
              );
            }
          )}

          {displayedProjects.length === 0 && (
            <div className="text-center py-12 text-[var(--mut)] text-sm space-y-3 border border-dashed border-[var(--line)] rounded-xl bg-[var(--card)]/50">
              <div className="italic">
                {hasActiveFilters || searchQuery
                  ? 'No projects match the current filter or search criteria.'
                  : tab === 'active'
                  ? 'No active projects. Click “+” in the sidebar to create one.'
                  : 'No archived projects.'}
              </div>

              {(hasActiveFilters || searchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    resetFilters();
                    setSearchQuery('');
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--sel)] text-[var(--ink)] font-medium inline-flex items-center gap-1.5 transition-colors shadow-xs"
                >
                  <X size={12} />
                  <span>Reset filters & search</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {assignModalProjectId && (
        <ProjectPapersModal
          projectId={assignModalProjectId}
          isOpen={Boolean(assignModalProjectId)}
          onClose={() => setAssignModalProjectId(null)}
        />
      )}
    </div>
  );
};
