import { create } from 'zustand';
import type {
  LabState,
  Project,
  Paper,
  Experiment,
  ExperimentStatus,
  PriorityLevel,
  ViewState,
  FilterState,
  ELNBlock,
  WorkflowPhaseKey,
  BuiltinWorkflowPhaseKey,
  CustomPhase,
  CalendarEventItem,
} from '../types/lab';
import {
  WORKFLOW_PHASES,
  checkAllPhasesCompleted,
  checkAllPhasesScheduled,
  getExperimentPhases,
  getExperimentPhaseData,
} from '../types/lab';
import { PAPER_COLORS } from '../utils/colors';
import { alertDialog } from './useDialogStore';

export const DEFAULT_FILTERS: FilterState = {
  status: [],
  paper: [],
  priority: [],
  statusNot: false,
  paperNot: false,
  priorityNot: false,
};

const uid = () => Math.random().toString(36).slice(2, 9);

interface LabStore extends LabState {
  view: ViewState;
  filters: FilterState;
  activeModalExpId: string | null;
  isModalFullScreen: boolean;
  isDarkMode: boolean;
  isLoading: boolean;
  isSaving: boolean;
  lastSavedAt: Date | null;
  loadError: string | null;

  // Actions
  fetchInitialState: () => Promise<void>;
  saveState: () => Promise<void>;
  setView: (view: ViewState) => void;
  setFilter: (key: keyof FilterState, value: any) => void;
  toggleFilterValue: (key: 'status' | 'paper' | 'priority', value: string) => void;
  setFilterValues: (key: 'status' | 'paper' | 'priority', values: string[]) => void;
  toggleFilterNot: (key: 'status' | 'paper' | 'priority') => void;
  setFilterNot: (key: 'status' | 'paper' | 'priority', isNot: boolean) => void;
  clearFilter: (key: 'status' | 'paper' | 'priority') => void;
  resetFilters: () => void;
  openModal: (expId: string, fullScreen?: boolean) => void;
  closeModal: () => void;
  toggleModalFullScreen: () => void;
  toggleDarkMode: () => void;
  snapToGrid: boolean;
  showGrid: boolean;
  gridSize: number;
  toggleSnapToGrid: () => void;
  toggleShowGrid: () => void;
  isSidebarOpen: boolean;
  sidebarWidth: number;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;

  // Project Actions
  addProject: (name: string, initialPaperIds?: string[]) => void;
  renameProject: (projectId: string, name: string) => void;
  deleteProject: (projectId: string) => void;
  archiveProject: (projectId: string) => void;
  unarchiveProject: (projectId: string) => void;
  resetProjectLayout: (projectId: string) => void;
  resetAllProjectLayouts: () => void;
  assignPaperToProject: (projectId: string, paperId: string) => void;
  unassignPaperFromProject: (projectId: string, paperId: string) => void;
  toggleProjectPaper: (projectId: string, paperId: string) => void;
  setProjectPapers: (projectId: string, paperIds: string[]) => void;

  // Paper Actions
  addPaper: (name: string, color?: string) => void;
  renamePaper: (paperId: string, name: string) => void;
  deletePaper: (paperId: string) => void;
  archivePaper: (paperId: string) => void;
  unarchivePaper: (paperId: string) => void;
  showArchived: boolean;
  toggleShowArchived: () => void;

  addExperiment: (
    projectId: string,
    name: string,
    deps?: string[],
    paperId?: string,
    status?: ExperimentStatus,
    priority?: PriorityLevel,
    phases?: (WorkflowPhaseKey | string)[],
    insertDownstream?: boolean,
    customPhases?: CustomPhase[]
  ) => string;
  addCustomPhase: (
    projectId: string,
    expId: string,
    name: string
  ) => string;
  updatePhase: (
    projectId: string,
    expId: string,
    phaseKey: WorkflowPhaseKey,
    data: {
      startDate?: string;
      endDate?: string;
      duration?: string;
      completed?: boolean;
      content?: string;
      name?: string;
    }
  ) => void;
  updateExperiment: (
    projectId: string,
    expId: string,
    updates: Partial<Experiment>
  ) => void;
  updatePhaseSchedule: (
    projectId: string,
    expId: string,
    phaseKey: WorkflowPhaseKey,
    startDate?: string,
    endDate?: string
  ) => void;
  getCalendarEvents: () => CalendarEventItem[];
  deleteExperiment: (projectId: string, expId: string) => void;
  updateNodePosition: (
    projectId: string,
    expId: string,
    px: number,
    py: number
  ) => void;
  addDependency: (
    projectId: string,
    sourceId: string,
    targetId: string
  ) => boolean;
  removeDependency: (
    projectId: string,
    sourceId: string,
    targetId: string
  ) => void;

  // Block Actions
  addBlock: (projectId: string, expId: string, block: ELNBlock) => void;
  removeBlock: (projectId: string, expId: string, blockIndex: number) => void;
  updateBlockText: (
    projectId: string,
    expId: string,
    blockIndex: number,
    text: string
  ) => void;
  uploadMediaFile: (file: File) => Promise<{
    url: string;
    filename: string;
    content_type: string;
    size: number;
    preview_url?: string;
    raw_url?: string;
    format?: string;
    metadata?: Record<string, any>;
  }>;
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function normalizeExperimentPhases(phases?: (WorkflowPhaseKey | string)[]): WorkflowPhaseKey[] | undefined {
  if (!phases) return undefined;
  return phases.map((p) => {
    const raw = String(p);
    if (raw === 'Protocol') return 'experimentalProtocol';
    if (raw === 'Acquisition') return 'dataAcquisition';
    if (raw === 'Analysis') return 'dataAnalysis';
    return raw as WorkflowPhaseKey;
  });
}

function normalizeProjects(projects: Project[]): Project[] {
  return (projects || []).map((p) => {
    const expPapers = (p.exps || []).map((e) => e.paper).filter(Boolean);
    const merged = Array.from(new Set([...(p.paperIds || []), ...expPapers]));
    const normalizedExps = (p.exps || []).map((e) => {
      if (!e.phases) return e;
      return {
        ...e,
        phases: normalizeExperimentPhases(e.phases),
      };
    });
    return {
      ...p,
      paperIds: merged,
      exps: normalizedExps,
    };
  });
}

export const useLabStore = create<LabStore>((set, get) => ({
  projects: [],
  papers: [],
  view: { type: 'calendar' },
  filters: { ...DEFAULT_FILTERS },
  activeModalExpId: null,
  isModalFullScreen: false,
  isDarkMode:
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  isLoading: true,
  isSaving: false,
  lastSavedAt: null,
  loadError: null,
  snapToGrid:
    typeof window !== 'undefined'
      ? localStorage.getItem('lab_snap_grid') !== 'false'
      : true,
  showGrid:
    typeof window !== 'undefined'
      ? localStorage.getItem('lab_show_grid') !== 'false'
      : true,
  gridSize: 20,
  showArchived: false,
  toggleShowArchived: () => set((state) => ({ showArchived: !state.showArchived })),
  isSidebarOpen:
    typeof window !== 'undefined'
      ? localStorage.getItem('lab_sidebar_open') !== 'false'
      : true,
  sidebarWidth:
    typeof window !== 'undefined'
      ? (() => {
          const saved = localStorage.getItem('lab_sidebar_width');
          const val = saved ? parseInt(saved, 10) : 250;
          return isNaN(val) ? 250 : Math.min(Math.max(val, 180), 480);
        })()
      : 250,
  toggleSidebar: () => {
    set((state) => {
      const next = !state.isSidebarOpen;
      try {
        localStorage.setItem('lab_sidebar_open', String(next));
      } catch (_) {}
      return { isSidebarOpen: next };
    });
  },
  setSidebarOpen: (open: boolean) => {
    try {
      localStorage.setItem('lab_sidebar_open', String(open));
    } catch (_) {}
    set({ isSidebarOpen: open });
  },
  setSidebarWidth: (width: number) => {
    try {
      localStorage.setItem('lab_sidebar_width', String(width));
    } catch (_) {}
    set({ sidebarWidth: width });
  },

  fetchInitialState: async () => {
    try {
      const res = await fetch('/api/lab/state');
      if (res.ok) {
        const data: LabState = await res.json();
        const normalizedProjects = normalizeProjects(data.projects);
        set({
          projects: normalizedProjects,
          papers: data.papers,
          view: { type: 'calendar' },
          isLoading: false,
          loadError: null,
        });
        return;
      }
      set({ isLoading: false, loadError: `Backend returned HTTP ${res.status} for /api/lab/state.` });
    } catch (e) {
      // shortcut: no offline data source. localStorage used to be one, but POST /api/lab/state
      // replaces the whole database, so an empty or stale local copy would delete real
      // projects/experiments. Show the failure instead of pretending the lab is empty.
      console.warn('Backend not available', e);
      set({
        isLoading: false,
        loadError: 'Backend is not reachable at /api/lab/state - start it with start-dev, then reload this page.',
      });
    }
  },

  saveState: async () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      const state = {
        projects: get().projects,
        papers: get().papers,
      };

      try {
        localStorage.setItem('lab', JSON.stringify(state));
      } catch (e) {
        console.error('LocalStorage save error', e);
      }

      set({ isSaving: true });
      try {
        await fetch('/api/lab/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state),
        });
      } catch (e) {
        console.warn('Could not sync to backend API', e);
      } finally {
        set({ isSaving: false, lastSavedAt: new Date() });
      }
    }, 300);
  },

  setView: (view) => set({ view, filters: { ...DEFAULT_FILTERS } }),

  setFilter: (key, value) =>
    set((state) => {
      if (key === 'status' || key === 'paper' || key === 'priority') {
        const newValues = Array.isArray(value)
          ? value
          : value === ''
          ? []
          : [value];
        return {
          filters: { ...state.filters, [key]: newValues },
        };
      }
      return {
        filters: { ...state.filters, [key]: value },
      };
    }),

  toggleFilterValue: (key, value) =>
    set((state) => {
      const current = state.filters[key] || [];
      const updated = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return {
        filters: { ...state.filters, [key]: updated },
      };
    }),

  setFilterValues: (key, values) =>
    set((state) => ({
      filters: { ...state.filters, [key]: values },
    })),

  toggleFilterNot: (key) =>
    set((state) => {
      const notKey = `${key}Not` as 'statusNot' | 'paperNot' | 'priorityNot';
      return {
        filters: { ...state.filters, [notKey]: !state.filters[notKey] },
      };
    }),

  setFilterNot: (key, isNot) =>
    set((state) => {
      const notKey = `${key}Not` as 'statusNot' | 'paperNot' | 'priorityNot';
      return {
        filters: { ...state.filters, [notKey]: isNot },
      };
    }),

  clearFilter: (key) =>
    set((state) => {
      const notKey = `${key}Not` as 'statusNot' | 'paperNot' | 'priorityNot';
      return {
        filters: {
          ...state.filters,
          [key]: [],
          [notKey]: false,
        },
      };
    }),

  resetFilters: () =>
    set({ filters: { ...DEFAULT_FILTERS } }),

  openModal: (expId, fullScreen = false) =>
    set({ activeModalExpId: expId, isModalFullScreen: fullScreen }),

  closeModal: () => set({ activeModalExpId: null, isModalFullScreen: false }),

  toggleModalFullScreen: () =>
    set((state) => ({ isModalFullScreen: !state.isModalFullScreen })),

  toggleDarkMode: () => {
    set((state) => {
      const nextDark = !state.isDarkMode;
      if (nextDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
        document.documentElement.classList.remove('dark');
      }
      return { isDarkMode: nextDark };
    });
  },

  toggleSnapToGrid: () => {
    set((state) => {
      const next = !state.snapToGrid;
      try {
        localStorage.setItem('lab_snap_grid', String(next));
      } catch (_) {}
      return { snapToGrid: next };
    });
  },

  toggleShowGrid: () => {
    set((state) => {
      const next = !state.showGrid;
      try {
        localStorage.setItem('lab_show_grid', String(next));
      } catch (_) {}
      return { showGrid: next };
    });
  },

  addProject: (name: string, initialPaperIds?: string[]) => {
    const newProject: Project = {
      id: uid(),
      name,
      paperIds: initialPaperIds || [],
      exps: [],
    };
    set((state) => ({
      projects: [...state.projects, newProject],
      view: { type: 'p', id: newProject.id },
    }));
    get().saveState();
  },

  renameProject: (projectId: string, name: string) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, name } : p
      ),
    }));
    get().saveState();
  },

  deleteProject: (projectId: string) => {
    set((state) => {
      const nextProjects = state.projects.filter((p) => p.id !== projectId);
      let nextView = state.view;
      if (state.view.type === 'p' && state.view.id === projectId) {
        const firstActive = nextProjects.find((p) => !p.archived);
        nextView = firstActive ? { type: 'p', id: firstActive.id } : { type: 'all' };
      }
      return {
        projects: nextProjects,
        view: nextView,
      };
    });
    get().saveState();
  },

  archiveProject: (projectId: string) => {
    set((state) => {
      const nextProjects = state.projects.map((p) =>
        p.id === projectId ? { ...p, archived: true } : p
      );
      let nextView = state.view;
      if (state.view.type === 'p' && state.view.id === projectId) {
        const firstActive = nextProjects.find((p) => !p.archived);
        nextView = firstActive ? { type: 'p', id: firstActive.id } : { type: 'all' };
      }
      return {
        projects: nextProjects,
        view: nextView,
      };
    });
    get().saveState();
  },

  unarchiveProject: (projectId: string) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, archived: false } : p
      ),
    }));
    get().saveState();
  },

  resetProjectLayout: (projectId: string) => {
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          exps: p.exps.map((e) => {
            const copy = { ...e };
            delete copy.px;
            delete copy.py;
            return copy;
          }),
        };
      }),
    }));
    get().saveState();
  },

  resetAllProjectLayouts: () => {
    let changed = false;
    set((state) => {
      const updatedProjects = state.projects.map((p) => {
        const hasPositions = p.exps.some((e) => e.px !== undefined || e.py !== undefined);
        if (!hasPositions) return p;
        changed = true;
        return {
          ...p,
          exps: p.exps.map((e) => {
            if (e.px === undefined && e.py === undefined) return e;
            const copy = { ...e };
            delete copy.px;
            delete copy.py;
            return copy;
          }),
        };
      });
      if (!changed) return state;
      return { projects: updatedProjects };
    });
    if (changed) {
      get().saveState();
    }
  },

  assignPaperToProject: (projectId: string, paperId: string) => {
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        const current = p.paperIds || [];
        if (current.includes(paperId)) return p;
        return { ...p, paperIds: [...current, paperId] };
      }),
    }));
    get().saveState();
  },

  unassignPaperFromProject: (projectId: string, paperId: string) => {
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        const current = p.paperIds || [];
        return {
          ...p,
          paperIds: current.filter((id) => id !== paperId),
        };
      }),
    }));
    get().saveState();
  },

  toggleProjectPaper: (projectId: string, paperId: string) => {
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        const current = p.paperIds || [];
        const hasIt = current.includes(paperId);
        return {
          ...p,
          paperIds: hasIt
            ? current.filter((id) => id !== paperId)
            : [...current, paperId],
        };
      }),
    }));
    get().saveState();
  },

  setProjectPapers: (projectId: string, paperIds: string[]) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, paperIds } : p
      ),
    }));
    get().saveState();
  },

  addPaper: (name: string, color?: string) => {
    const papers = get().papers;
    const assignedColor =
      color || PAPER_COLORS[papers.length % PAPER_COLORS.length];
    const newPaper: Paper = {
      id: uid(),
      name,
      color: assignedColor,
    };
    set((state) => ({ papers: [...state.papers, newPaper] }));
    get().saveState();
  },

  renamePaper: (paperId: string, name: string) => {
    set((state) => ({
      papers: state.papers.map((p) =>
        p.id === paperId ? { ...p, name } : p
      ),
    }));
    get().saveState();
  },

  deletePaper: (paperId: string) => {
    set((state) => {
      let nextView = state.view;
      if (state.view.type === 'pp' && state.view.id === paperId) {
        nextView = { type: 'pp' };
      }
      return {
        papers: state.papers.filter((p) => p.id !== paperId),
        view: nextView,
        filters: {
          ...state.filters,
          paper: state.filters.paper.filter((id) => id !== paperId),
        },
        projects: state.projects.map((proj) => ({
          ...proj,
          paperIds: (proj.paperIds || []).filter((id) => id !== paperId),
          exps: proj.exps.map((e) =>
            e.paper === paperId ? { ...e, paper: '' } : e
          ),
        })),
      };
    });
    get().saveState();
  },

  archivePaper: (paperId: string) => {
    set((state) => {
      let nextView = state.view;
      if (state.view.type === 'pp' && state.view.id === paperId) {
        nextView = { type: 'pp' };
      }
      return {
        papers: state.papers.map((p) =>
          p.id === paperId ? { ...p, archived: true } : p
        ),
        view: nextView,
        filters: {
          ...state.filters,
          paper: state.filters.paper.filter((id) => id !== paperId),
        },
      };
    });
    get().saveState();
  },

  unarchivePaper: (paperId: string) => {
    set((state) => ({
      papers: state.papers.map((p) =>
        p.id === paperId ? { ...p, archived: false } : p
      ),
    }));
    get().saveState();
  },

  addExperiment: (
    projectId: string,
    name: string,
    deps: string[] = [],
    paperId: string = '',
    status: ExperimentStatus = 'Planning',
    priority: PriorityLevel = 'Med',
    phases?: (WorkflowPhaseKey | string)[],
    insertDownstream = false,
    customPhases?: CustomPhase[]
  ) => {
    const state = get();
    const proj = state.projects.find((p) => p.id === projectId);
    let assignedPaper = paperId;
    if (!assignedPaper && proj) {
      const assignedPaperIds = new Set<string>([
        ...(proj.paperIds || []),
        ...proj.exps.map((e) => e.paper).filter(Boolean),
      ]);
      const validPapers = state.papers.filter(
        (p) => !p.archived && assignedPaperIds.has(p.id)
      );
      if (validPapers.length === 1) {
        assignedPaper = validPapers[0].id;
      }
    }

    const newExpId = uid();
    const newExp: Experiment = {
      id: newExpId,
      name,
      status: status || 'Planning',
      priority: priority ?? 'Med',
      paper: assignedPaper,
      deps,
      purpose: '',
      expectedResults: '',
      experimentalDesign: '',
      experimentalProtocol: '',
      experimentalProtocolDuration: '',
      experimentalProtocolCompleted: false,
      dataAcquisition: '',
      dataAcquisitionDuration: '',
      dataAcquisitionCompleted: false,
      dataAnalysis: '',
      dataAnalysisDuration: '',
      dataAnalysisCompleted: false,
      results: '',
      notes: '',
      blocks: [],
      ...(phases !== undefined ? { phases } : {}),
      ...(customPhases && customPhases.length > 0 ? { customPhases } : {}),
    };
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              exps: [
                ...p.exps.map((e) =>
                  insertDownstream && e.deps.some((dep) => deps.includes(dep))
                    ? { ...e, deps: [...new Set(e.deps.map((dep) => deps.includes(dep) ? newExpId : dep))] }
                    : e
                ),
                newExp,
              ],
            }
          : p
      ),
      activeModalExpId: newExpId,
    }));
    get().saveState();
    return newExpId;
  },

  updateExperiment: (projectId, expId, updates) => {
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          exps: p.exps.map((e) => {
            if (e.id !== expId) return e;
            const updated = { ...e, ...updates };

            // When status is not explicitly provided in updates:
            if (!('status' in updates)) {
              if (checkAllPhasesCompleted(updated)) {
                updated.status = 'Done';
              } else if (
                ('experimentalProtocolCompleted' in updates ||
                  'dataAcquisitionCompleted' in updates ||
                  'dataAnalysisCompleted' in updates) &&
                e.status === 'Done'
              ) {
                // If a phase was marked incomplete on a previously Done experiment, revert to Running
                updated.status = 'Running';
              } else if (updated.status === 'Planning' && checkAllPhasesScheduled(updated)) {
                updated.status = 'Planned';
              }
            }

            return updated;
          }),
        };
      }),
    }));
    get().saveState();
  },

  addCustomPhase: (projectId, expId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return '';
    const id = `phase_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newPhase: CustomPhase = {
      id,
      name: trimmed,
      content: '',
      duration: '',
      completed: false,
      startDate: '',
      endDate: '',
    };
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          exps: p.exps.map((e) => {
            if (e.id !== expId) return e;
            const currentPhases = getExperimentPhases(e);
            const currentCustom = e.customPhases || [];
            const nextPhases = currentPhases.includes(id) ? currentPhases : [...currentPhases, id];
            const nextCustom = currentCustom.some((cp) => cp.id === id)
              ? currentCustom
              : [...currentCustom, newPhase];
            return {
              ...e,
              phases: nextPhases,
              customPhases: nextCustom,
            };
          }),
        };
      }),
    }));
    get().saveState();
    return id;
  },

  updatePhase: (projectId, expId, phaseKey, data) => {
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          exps: p.exps.map((e) => {
            if (e.id !== expId) return e;
            const updated = { ...e };
            const meta = WORKFLOW_PHASES[phaseKey as BuiltinWorkflowPhaseKey];
            if (meta) {
              if (data.startDate !== undefined) updated[meta.startKey!] = data.startDate.trim();
              if (data.endDate !== undefined) updated[meta.endKey!] = data.endDate.trim();
              if (data.duration !== undefined) updated[meta.durationKey!] = data.duration;
              if (data.completed !== undefined) updated[meta.completedKey!] = data.completed;
              if (data.content !== undefined) (updated as any)[phaseKey] = data.content;
            } else {
              const currentCustom = e.customPhases || [];
              const exists = currentCustom.some((cp) => cp.id === phaseKey);
              const nextCustom = exists
                ? currentCustom.map((cp) =>
                    cp.id === phaseKey
                      ? {
                          ...cp,
                          ...(data.startDate !== undefined ? { startDate: data.startDate.trim() } : {}),
                          ...(data.endDate !== undefined ? { endDate: data.endDate.trim() } : {}),
                          ...(data.duration !== undefined ? { duration: data.duration } : {}),
                          ...(data.completed !== undefined ? { completed: data.completed } : {}),
                          ...(data.content !== undefined ? { content: data.content } : {}),
                          ...(data.name !== undefined ? { name: data.name.trim() } : {}),
                        }
                      : cp
                  )
                : [
                    ...currentCustom,
                    {
                      id: phaseKey,
                      name: data.name?.trim() || phaseKey,
                      startDate: data.startDate?.trim() || '',
                      endDate: data.endDate?.trim() || '',
                      duration: data.duration || '',
                      completed: Boolean(data.completed),
                      content: data.content || '',
                    },
                  ];
              updated.customPhases = nextCustom;
            }

            if (checkAllPhasesCompleted(updated)) {
              updated.status = 'Done';
            } else if (data.completed === false && e.status === 'Done') {
              updated.status = 'Running';
            } else if (updated.status === 'Planning' && checkAllPhasesScheduled(updated)) {
              updated.status = 'Planned';
            }
            return updated;
          }),
        };
      }),
    }));
    get().saveState();
  },

  updatePhaseSchedule: (projectId, expId, phaseKey, startDate, endDate) => {
    const startVal = startDate ? startDate.trim() : '';
    const endVal = endDate !== undefined ? (endDate ? endDate.trim() : '') : startVal;
    get().updatePhase(projectId, expId, phaseKey, { startDate: startVal, endDate: endVal });
  },

  getCalendarEvents: () => {
    const { projects, papers } = get();
    const paperColorMap = new Map(papers.map((p) => [p.id, p.color]));
    const events: CalendarEventItem[] = [];

    for (const proj of projects) {
      if (proj.archived) continue;
      for (const exp of proj.exps) {
        for (const phaseKey of getExperimentPhases(exp)) {
          const pData = getExperimentPhaseData(exp, phaseKey);
          const start = pData.startDate;
          if (start && start.trim()) {
            events.push({
              id: `${exp.id}_${phaseKey}`,
              projectId: proj.id,
              projectName: proj.name,
              experimentId: exp.id,
              experimentName: exp.name,
              phaseKey,
              startDate: start.trim(),
              endDate: pData.endDate?.trim() || start.trim(),
              duration: pData.duration,
              completed: pData.completed,
              paperColor: exp.paper ? paperColorMap.get(exp.paper) : undefined,
              status: exp.status,
            });
          }
        }
      }
    }
    return events;
  },

  deleteExperiment: (projectId, expId) => {
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        const survivingIds = new Set(p.exps.filter((e) => e.id !== expId).map((e) => e.id));
        const inheritedDeps = (p.exps.find((e) => e.id === expId)?.deps ?? [])
          .filter((dep) => survivingIds.has(dep));
        return {
          ...p,
          exps: p.exps
            .filter((e) => e.id !== expId)
            .map((e) => e.deps.includes(expId)
              ? {
                  ...e,
                  deps: [...new Set(e.deps.flatMap((dep) => dep === expId ? inheritedDeps : [dep]))],
                }
              : e),
        };
      }),
      activeModalExpId:
        state.activeModalExpId === expId ? null : state.activeModalExpId,
    }));
    get().saveState();
  },

  updateNodePosition: (projectId, expId, px, py) => {
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          exps: p.exps.map((e) => (e.id === expId ? { ...e, px, py } : e)),
        };
      }),
    }));
    get().saveState();
  },

  addDependency: (projectId, sourceId, targetId) => {
    if (sourceId === targetId) return false;
    let success = false;
    set((state) => {
      const proj = state.projects.find((p) => p.id === projectId);
      if (!proj) return state;
      const targetExp = proj.exps.find((e) => e.id === targetId);
      if (!targetExp || targetExp.deps.includes(sourceId)) return state;

      // Cycle detection: check if target is an ancestor of source
      const getDesc = (id: string, s = new Set<string>()): Set<string> => {
        proj.exps
          .filter((x) => x.deps.includes(id))
          .forEach((x) => {
            if (!s.has(x.id)) {
              s.add(x.id);
              getDesc(x.id, s);
            }
          });
        return s;
      };

      if (getDesc(targetId).has(sourceId)) {
        alertDialog({
          title: 'Circular Dependency',
          message: 'Connecting these experiments would create a dependency cycle.',
          variant: 'warning',
        });
        return state;
      }

      success = true;
      return {
        projects: state.projects.map((p) => {
          if (p.id !== projectId) return p;
          return {
            ...p,
            exps: p.exps.map((e) =>
              e.id === targetId ? { ...e, deps: [...e.deps, sourceId] } : e
            ),
          };
        }),
      };
    });

    if (success) get().saveState();
    return success;
  },

  removeDependency: (projectId, sourceId, targetId) => {
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          exps: p.exps.map((e) =>
            e.id === targetId
              ? { ...e, deps: e.deps.filter((d) => d !== sourceId) }
              : e
          ),
        };
      }),
    }));
    get().saveState();
  },

  addBlock: (projectId, expId, block) => {
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          exps: p.exps.map((e) =>
            e.id === expId ? { ...e, blocks: [...e.blocks, block] } : e
          ),
        };
      }),
    }));
    get().saveState();
  },

  removeBlock: (projectId, expId, blockIndex) => {
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          exps: p.exps.map((e) => {
            if (e.id !== expId) return e;
            const updated = [...e.blocks];
            updated.splice(blockIndex, 1);
            return { ...e, blocks: updated };
          }),
        };
      }),
    }));
    get().saveState();
  },

  updateBlockText: (projectId, expId, blockIndex, text) => {
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          exps: p.exps.map((e) => {
            if (e.id !== expId) return e;
            const updated = [...e.blocks];
            const target = updated[blockIndex];
            if (target && target.type === 'txt') {
              updated[blockIndex] = { ...target, text };
            }
            return { ...e, blocks: updated };
          }),
        };
      }),
    }));
    get().saveState();
  },

  uploadMediaFile: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/lab/upload', {
      method: 'POST',
      body: formData,
    });
    if ([502, 503, 504].includes(res.status)) {
      throw new Error(`Upload service unavailable (${res.status}). Make sure the backend is running on port 8000; start both services with bash start-dev.sh.`);
    }
    if (!res.ok) throw new Error(`Upload failed (${res.status}). Please try again.`);
    const data = await res.json();
    if (!data.url) throw new Error('The server did not return an uploaded file URL.');
    const ext = file.name.toLowerCase();
    const defaultFormat = ext.endsWith('.nd2')
      ? 'Nikon ND2'
      : ext.match(/\.tiff?$/i) ? 'TIFF' : undefined;
    return {
      url: data.url,
      filename: data.filename || file.name,
      content_type: data.content_type || file.type || 'application/octet-stream',
      size: data.size ?? file.size,
      preview_url: data.preview_url,
      raw_url: data.raw_url || data.url,
      format: data.metadata?.format || defaultFormat,
      metadata: data.metadata,
    };
  },
}));
