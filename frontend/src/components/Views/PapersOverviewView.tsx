import React, { useState } from 'react';
import { useLabStore } from '../../store/useLabStore';
import { matchesFilter } from '../../utils/dag';
import { STATUS_COLORS } from '../../utils/colors';
import {
  Folder,
  Plus,
  X,
  Check,
  Archive,
  ArchiveRestore,
  Trash2,
  ArrowLeft,
} from 'lucide-react';
import { confirmDialog } from '../../store/useDialogStore';

export const PapersOverviewView: React.FC = () => {
  const {
    projects,
    papers,
    view,
    setView,
    filters,
    openModal,
    toggleProjectPaper,
    unassignPaperFromProject,
    archivePaper,
    unarchivePaper,
    deletePaper,
  } = useLabStore();

  const [openDropdownPaperId, setOpenDropdownPaperId] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'archived'>('active');

  const activePapers = papers.filter((p) => !p.archived);
  const archivedPapers = papers.filter((p) => p.archived);

  // All experiments flattened with project reference
  const allExperiments = projects.flatMap((p) =>
    p.exps.map((e) => ({ experiment: e, project: p }))
  );

  const selectedPaper =
    view.type === 'pp' && view.id
      ? papers.find((p) => p.id === view.id)
      : null;

  const displayedPapers = selectedPaper
    ? [selectedPaper]
    : tab === 'active'
    ? [...activePapers, { id: '', name: 'Unassigned', color: '#9ca3af' }]
    : archivedPapers;

  const handleDeletePaper = async (paperId: string, name: string) => {
    const confirmed = await confirmDialog({
      title: 'Delete Paper',
      message: `Permanently delete paper "${name}"? It will be unassigned from all experiments and projects.`,
      confirmLabel: 'Delete Permanently',
      variant: 'danger',
    });
    if (confirmed) {
      deletePaper(paperId);
    }
  };

  const handleArchivePaper = async (paperId: string, name: string) => {
    const confirmed = await confirmDialog({
      title: 'Archive Paper',
      message: `Archive paper "${name}"? It will be hidden from active dropdowns, but can be restored anytime.`,
      confirmLabel: 'Archive Paper',
      variant: 'warning',
    });
    if (confirmed) {
      archivePaper(paperId);
    }
  };

  return (
    <div className="flex-1 p-6 overflow-auto" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Top Header & Tab Controls */}
        {selectedPaper ? (
          <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={() => setView({ type: 'pp' })}
                className="text-[var(--mut)] hover:text-[var(--ink)] flex items-center gap-1.5 transition-colors border-none bg-transparent !p-0 cursor-pointer font-medium"
              >
                <ArrowLeft size={13} />
                <span>All papers overview</span>
              </button>
              <span className="text-[var(--mut)]">/</span>
              <span className="font-semibold text-[var(--ink)]">{selectedPaper.name}</span>
            </div>

            <button
              onClick={() => setView({ type: 'pp' })}
              className="text-xs px-2.5 py-1 rounded border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--sel)] text-[var(--mut)] hover:text-[var(--ink)] transition-colors"
            >
              View all papers
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTab('active')}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  tab === 'active'
                    ? 'bg-[var(--sel)] text-[var(--acc)] border border-[var(--acc)]/30'
                    : 'text-[var(--mut)] hover:text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
                }`}
              >
                Active Papers ({activePapers.length})
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
                <span>Archived Papers ({archivedPapers.length})</span>
              </button>
            </div>

            <span className="text-xs text-[var(--mut)] font-mono">
              Total {papers.length} {papers.length === 1 ? 'paper' : 'papers'}
            </span>
          </div>
        )}

        {/* Paper Cards List */}
        {displayedPapers.map((paper) => {
          const matchingExps = allExperiments.filter(
            (item) =>
              item.experiment.paper === paper.id &&
              matchesFilter(item.experiment, filters)
          );

          // Projects this paper is assigned to
          const assignedProjects = paper.id
            ? projects.filter(
                (p) =>
                  (p.paperIds || []).includes(paper.id) ||
                  p.exps.some((e) => e.paper === paper.id)
              )
            : [];

          return (
            <div
              key={paper.id || 'unassigned'}
              className={`border rounded-xl bg-[var(--card)] p-4 shadow-xs transition-colors ${
                paper.archived ? 'border-amber-500/30 opacity-90' : 'border-[var(--line)]'
              }`}
            >
              {/* Paper Card Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]/60 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: paper.color }}
                  />
                  <h3 className="font-semibold text-base m-0">{paper.name}</h3>
                  {paper.archived && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-medium">
                      Archived
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--mut)] mr-2 font-mono">
                    {matchingExps.length}{' '}
                    {matchingExps.length === 1 ? 'experiment' : 'experiments'}
                  </span>

                  {paper.id && (
                    <>
                      {paper.archived ? (
                        <button
                          type="button"
                          onClick={() => unarchivePaper(paper.id)}
                          className="text-xs px-2.5 py-1 rounded bg-[var(--acc)] text-white hover:opacity-90 flex items-center gap-1.5 transition-colors"
                          title="Restore paper"
                        >
                          <ArchiveRestore size={12} />
                          <span>Restore</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleArchivePaper(paper.id, paper.name)}
                          className="text-xs px-2.5 py-1 rounded border border-[var(--line)] hover:bg-black/5 dark:hover:bg-white/5 text-[var(--mut)] hover:text-[var(--ink)] flex items-center gap-1.5 transition-colors"
                          title="Archive paper"
                        >
                          <Archive size={12} />
                          <span>Archive</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleDeletePaper(paper.id, paper.name)}
                        className="text-xs p-1.5 rounded hover:bg-red-500/10 text-[var(--mut)] hover:text-red-500 transition-colors border border-transparent hover:border-red-500/30"
                        title="Delete paper permanently"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Projects Assignment Row */}
              {paper.id && (
                <div className="py-2.5 border-b border-[var(--line)]/40 flex items-center gap-1.5 flex-wrap text-xs relative">
                  <span className="text-[11px] text-[var(--mut)] font-medium mr-1 flex items-center gap-1">
                    <Folder size={12} className="text-[var(--mut)]" />
                    <span>Assigned to Projects:</span>
                  </span>

                  {assignedProjects.map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-[var(--sel)] border border-[var(--line)] text-[var(--ink)] group"
                    >
                      <span>{p.name}</span>
                      <button
                        type="button"
                        onClick={() => unassignPaperFromProject(p.id, paper.id)}
                        title={`Unassign paper from "${p.name}"`}
                        className="opacity-0 group-hover:opacity-100 text-[var(--mut)] hover:text-red-500 border-none bg-transparent p-0 -mr-0.5"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}

                  {assignedProjects.length === 0 && (
                    <span className="text-[11px] text-[var(--mut)] italic">
                      None (unassigned to any project)
                    </span>
                  )}

                  {/* Assign Project Dropdown Trigger */}
                  <div className="relative inline-block ml-1">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenDropdownPaperId(
                          openDropdownPaperId === paper.id ? null : paper.id
                        )
                      }
                      className="text-[11px] px-2 py-0.5 rounded-full border border-dashed border-[var(--line)] hover:border-[var(--acc)] text-[var(--mut)] hover:text-[var(--ink)] flex items-center gap-1 transition-colors"
                      title="Assign or unassign projects for this paper"
                    >
                      <Plus size={10} />
                      <span>Assign to Project</span>
                    </button>

                    {/* Popover Dropdown */}
                    {openDropdownPaperId === paper.id && (
                      <div className="absolute left-0 top-full mt-1.5 z-40 w-56 bg-[var(--card)] border border-[var(--line)] rounded-lg shadow-xl p-1.5 space-y-1">
                        <div className="text-[10px] uppercase font-semibold text-[var(--mut)] px-2 py-1 tracking-wider border-b border-[var(--line)]/50">
                          Toggle Projects
                        </div>
                        {projects.map((proj) => {
                          const isAssigned = (proj.paperIds || []).includes(paper.id);
                          return (
                            <div
                              key={proj.id}
                              onClick={() => toggleProjectPaper(proj.id, paper.id)}
                              className={`flex items-center justify-between px-2.5 py-1.5 rounded cursor-pointer text-xs transition-colors ${
                                isAssigned
                                  ? 'bg-[var(--sel)] text-[var(--acc)] font-medium'
                                  : 'hover:bg-black/5 dark:hover:bg-white/5 text-[var(--ink)]'
                              }`}
                            >
                              <span className="truncate">{proj.name}</span>
                              {isAssigned && <Check size={12} strokeWidth={2.5} />}
                            </div>
                          );
                        })}
                        {projects.length === 0 && (
                          <div className="px-2 py-1 text-xs text-[var(--mut)] italic">
                            No projects exist yet.
                          </div>
                        )}
                        <div className="border-t border-[var(--line)]/50 pt-1 text-right">
                          <button
                            type="button"
                            onClick={() => setOpenDropdownPaperId(null)}
                            className="text-[10px] px-2 py-0.5 rounded text-[var(--mut)] hover:text-[var(--ink)] hover:bg-black/5"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Experiments List */}
              <div className="mt-2 space-y-1">
                {matchingExps.map(({ experiment, project }) => {
                  const sc = STATUS_COLORS[experiment.status] || '#9ca3af';

                  return (
                    <div
                      key={experiment.id}
                      onClick={() => openModal(experiment.id)}
                      className="px-3 py-2 rounded-lg cursor-pointer flex items-center justify-between hover:bg-[var(--sel)] transition-colors group"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-medium text-[13px] truncate">
                          {experiment.name}
                        </span>
                        <span className="text-xs text-[var(--mut)]">
                          · {project.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--line)] font-medium"
                          style={{
                            color: sc,
                            borderColor: `${sc}44`,
                          }}
                        >
                          {experiment.status}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {matchingExps.length === 0 && (
                  <div className="text-xs text-[var(--mut)] italic py-2 px-1">
                    No experiments assigned to this paper matching current filters.
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {displayedPapers.length === 0 && (
          <div className="text-center py-12 text-[var(--mut)] text-sm italic">
            {tab === 'active' ? 'No active papers.' : 'No archived papers.'}
          </div>
        )}
      </div>
    </div>
  );
};
