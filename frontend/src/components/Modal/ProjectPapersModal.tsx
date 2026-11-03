import React, { useState } from 'react';
import { useLabStore } from '../../store/useLabStore';
import { X, Check, Plus, FileText, Search } from 'lucide-react';

interface ProjectPapersModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const ProjectPapersModal: React.FC<ProjectPapersModalProps> = ({
  projectId,
  isOpen,
  onClose,
}) => {
  const { projects, papers, toggleProjectPaper, addPaper, assignPaperToProject } =
    useLabStore();

  const [search, setSearch] = useState('');
  const [newPaperName, setNewPaperName] = useState('');

  if (!isOpen) return null;

  const project = projects.find((p) => p.id === projectId);
  if (!project) return null;

  const assignedSet = new Set<string>(project.paperIds || []);

  const activePapers = papers.filter((p) => !p.archived || assignedSet.has(p.id));
  const filteredPapers = activePapers.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreateAndAssign = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPaperName.trim()) return;
    const name = newPaperName.trim();
    // Create new paper
    addPaper(name);
    // Find the newly added paper from updated state
    setTimeout(() => {
      const state = useLabStore.getState();
      const created = state.papers.find((p) => p.name === name);
      if (created) {
        assignPaperToProject(project.id, created.id);
      }
    }, 10);
    setNewPaperName('');
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
    >
      <div
        className="w-full max-w-md bg-[var(--card)] border border-[var(--line)] rounded-xl shadow-2xl flex flex-col overflow-hidden text-[var(--ink)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--line)]">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-[var(--acc)]" />
            <h3 className="text-base font-semibold m-0 truncate">
              Assign Papers to Project
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--mut)] hover:text-[var(--ink)] p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors border-none bg-transparent"
          >
            <X size={16} />
          </button>
        </div>

        {/* Project Target Info */}
        <div className="px-5 pt-3 pb-2 bg-black/2 dark:bg-white/2 border-b border-[var(--line)]/50 text-xs text-[var(--mut)]">
          Project:{' '}
          <span className="font-semibold text-[var(--ink)]">{project.name}</span>
          <span className="ml-2 font-mono">
            ({assignedSet.size} {assignedSet.size === 1 ? 'paper' : 'papers'} assigned)
          </span>
        </div>

        {/* Search Filter */}
        {papers.length > 4 && (
          <div className="px-5 pt-3 pb-1">
            <div className="relative flex items-center">
              <Search
                size={13}
                className="absolute left-2.5 text-[var(--mut)] pointer-events-none"
              />
              <input
                type="text"
                placeholder="Search papers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--bg)] border border-[var(--line)] rounded-md outline-none focus:border-[var(--acc)] transition-colors"
              />
            </div>
          </div>
        )}

        {/* Papers Checklist */}
        <div className="p-5 overflow-y-auto max-h-[280px] space-y-1.5">
          {filteredPapers.map((paper) => {
            const isAssigned = assignedSet.has(paper.id);
            const expsCount = project.exps.filter((e) => e.paper === paper.id).length;

            return (
              <div
                key={paper.id}
                onClick={() => toggleProjectPaper(project.id, paper.id)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg border cursor-pointer select-none transition-all ${
                  isAssigned
                    ? 'border-[var(--acc)] bg-[var(--acc)]/10 font-medium'
                    : 'border-[var(--line)]/60 hover:bg-black/5 dark:hover:bg-white/5 opacity-80 hover:opacity-100'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-colors ${
                      isAssigned
                        ? 'bg-[var(--acc)] border-[var(--acc)] text-white'
                        : 'border-[var(--line)] bg-[var(--card)]'
                    }`}
                  >
                    {isAssigned && <Check size={12} strokeWidth={3} />}
                  </div>

                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: paper.color }}
                  />

                  <span className="text-xs truncate">{paper.name}</span>
                  {paper.archived && (
                    <span className="text-[10px] text-amber-500 font-normal shrink-0">
                      (Archived)
                    </span>
                  )}
                </div>

                {expsCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[var(--mut)] shrink-0 font-mono">
                    {expsCount} {expsCount === 1 ? 'exp' : 'exps'}
                  </span>
                )}
              </div>
            );
          })}

          {filteredPapers.length === 0 && (
            <div className="text-center py-6 text-xs text-[var(--mut)] italic">
              {search ? 'No matching papers found.' : 'No papers in lab notebook yet.'}
            </div>
          )}
        </div>

        {/* Quick Create & Assign */}
        <form
          onSubmit={handleCreateAndAssign}
          className="p-4 bg-black/2 dark:bg-white/2 border-t border-[var(--line)] flex items-center gap-2"
        >
          <input
            type="text"
            placeholder="Create & assign new paper..."
            value={newPaperName}
            onChange={(e) => setNewPaperName(e.target.value)}
            className="flex-1 px-3 py-1.5 text-xs bg-[var(--card)] border border-[var(--line)] rounded-md outline-none focus:border-[var(--acc)]"
          />
          <button
            type="submit"
            disabled={!newPaperName.trim()}
            className="primary text-xs px-3 py-1.5 flex items-center gap-1 shrink-0 disabled:opacity-50"
          >
            <Plus size={13} />
            <span>Add</span>
          </button>
        </form>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--line)] flex justify-end bg-[var(--card)]">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-4 py-1.5 rounded-md bg-[var(--sel)] hover:bg-[var(--line)] transition-colors font-medium"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
