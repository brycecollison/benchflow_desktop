import React, { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { useLabStore } from '../../store/useLabStore';
import type { ImageBlock, Experiment, ExperimentSectionKey } from '../../types/lab';
import {
  ALL_WORKFLOW_PHASES,
  WORKFLOW_PHASES,
  getExperimentPhases,
  getWorkflowPhaseMeta,
  getExperimentPhaseData,
} from '../../types/lab';
import { STATUS_LIST, PRIORITY_LIST } from '../../utils/colors';
import { SectionAttachments } from './SectionAttachments';
import { ExperimentNavigation } from './ExperimentNavigation';
import { EnlargedImagePreview } from './EnlargedImagePreview';
import { sectionBlocks, sectionOwnership } from '../../utils/sectionAttachments';
import {
  X,
  Maximize2,
  Minimize2,
  Columns2,
  Trash2,
  Microscope,
  Download,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  Target,
  Sparkles,
  Layers,
  ClipboardList,
  Database,
  LineChart,
  StickyNote,
  BarChart3,
  Clock,
  Calendar,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Plus,
  Pencil,
} from 'lucide-react';
import { confirmDialog, promptDialog, useDialogStore } from '../../store/useDialogStore';

const SectionTextEditor = lazy(() => import('./SectionTextEditor').then((module) => ({ default: module.SectionTextEditor })));

type SectionKey = ExperimentSectionKey;

type ActiveSectionTab = 'all' | SectionKey;

interface SectionConfig {
  key: SectionKey;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
  badgeClass: string;
  badgeTextClass: string;
  placeholder: string;
  minHeight: string;
  hasWorkflowFields?: boolean;
}

const DURATION_OPTIONS = [
  { value: '', label: 'Duration...' },
  { value: '1/2 day', label: '1/2 day' },
  { value: '1 day', label: '1 day' },
  { value: '2 days', label: '2 days' },
  { value: '3 days', label: '3 days' },
  { value: '4 days', label: '4 days' },
  { value: '5 days', label: '5 days' },
];

const SECTIONS: SectionConfig[] = [
  {
    key: 'purpose',
    label: 'Purpose',
    subtitle: 'Research hypothesis, primary objective & scientific rationale',
    icon: <Target size={14} />,
    badgeClass: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
    badgeTextClass: 'text-indigo-600 dark:text-indigo-400',
    placeholder: 'State the primary hypothesis, research objective, and scientific rationale for this experiment…',
    minHeight: 'min-h-[100px]',
  },
  {
    key: 'expectedResults',
    label: 'Expected Results',
    subtitle: 'Anticipated readout, phenotype, quantitative targets & success criteria',
    icon: <Sparkles size={14} />,
    badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
    badgeTextClass: 'text-amber-600 dark:text-amber-400',
    placeholder: 'Describe anticipated phenotype, expected band sizes, threshold signal, or benchmark criteria for success…',
    minHeight: 'min-h-[100px]',
  },
  {
    key: 'experimentalDesign',
    label: 'Experimental Design',
    subtitle: 'Variables, positive & negative controls, biological replicates & sample groups',
    icon: <Layers size={14} />,
    badgeClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30',
    badgeTextClass: 'text-purple-600 dark:text-purple-400',
    placeholder: 'Outline experimental groups, positive and negative controls, independent/dependent variables, biological replicates, and sample sizes…',
    minHeight: 'min-h-[110px]',
  },
  {
    key: 'experimentalProtocol',
    label: 'Experimental Protocol',
    subtitle: 'Step-by-step procedures, reagents, concentrations & timing',
    icon: <ClipboardList size={14} />,
    badgeClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
    badgeTextClass: 'text-sky-600 dark:text-sky-400',
    placeholder: '1. Reagent preparation, cell seeding, and incubation parameters…\n2. Wash cycles, buffer formulation, and temperatures…\n3. Assay readout procedure and instrumentation settings…',
    minHeight: 'min-h-[150px]',
    hasWorkflowFields: true,
  },
  {
    key: 'dataAcquisition',
    label: 'Data Acquisition',
    subtitle: 'Instrument settings, raw data capture, channels & run logs',
    icon: <Database size={14} />,
    badgeClass: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30',
    badgeTextClass: 'text-cyan-600 dark:text-cyan-400',
    placeholder: 'Document instrument parameters (e.g., flow cytometer, microscope, plate reader), channels, laser lines, exposure times, and raw data files…',
    minHeight: 'min-h-[110px]',
    hasWorkflowFields: true,
  },
  {
    key: 'dataAnalysis',
    label: 'Data Analysis',
    subtitle: 'Processing pipelines, normalization, statistical tests & scripts',
    icon: <LineChart size={14} />,
    badgeClass: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30',
    badgeTextClass: 'text-violet-600 dark:text-violet-400',
    placeholder: 'Specify data processing workflows, background subtraction, normalization methods, statistical analysis (e.g., ANOVA, t-test), scripts/software…',
    minHeight: 'min-h-[110px]',
    hasWorkflowFields: true,
  },
  {
    key: 'results',
    label: 'Results',
    subtitle: 'Quantitative findings, measurements, analysis, conclusions & media attachments',
    icon: <BarChart3 size={14} />,
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    badgeTextClass: 'text-emerald-600 dark:text-emerald-400',
    placeholder: 'Document observed bands, fold changes, statistical analysis, conclusions, and data interpretation…',
    minHeight: 'min-h-[120px]',
  },
  {
    key: 'notes',
    label: 'Notes',
    subtitle: 'Real-time bench observations, lot/batch numbers, deviations & remarks',
    icon: <StickyNote size={14} />,
    badgeClass: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30',
    badgeTextClass: 'text-orange-600 dark:text-orange-400',
    placeholder: 'Record real-time bench observations, buffer batch numbers, deviations from standard protocol, troubleshooting remarks…',
    minHeight: 'min-h-[100px]',
  },
];

function getWorkflowInfo(exp: Experiment, key: string) {
  if (key === 'experimentalProtocol') {
    return {
      phaseKey: 'experimentalProtocol',
      durationVal: exp.experimentalProtocolDuration || '',
      isCompleted: Boolean(exp.experimentalProtocolCompleted),
      startDate: exp.experimentalProtocolStartDate || '',
      endDate: exp.experimentalProtocolEndDate || '',
    };
  }
  if (key === 'dataAcquisition') {
    return {
      phaseKey: 'dataAcquisition',
      durationVal: exp.dataAcquisitionDuration || '',
      isCompleted: Boolean(exp.dataAcquisitionCompleted),
      startDate: exp.dataAcquisitionStartDate || '',
      endDate: exp.dataAcquisitionEndDate || '',
    };
  }
  if (key === 'dataAnalysis') {
    return {
      phaseKey: 'dataAnalysis',
      durationVal: exp.dataAnalysisDuration || '',
      isCompleted: Boolean(exp.dataAnalysisCompleted),
      startDate: exp.dataAnalysisStartDate || '',
      endDate: exp.dataAnalysisEndDate || '',
    };
  }
  const custom = (exp.customPhases || []).find((p) => p.id === key);
  if (custom) {
    return {
      phaseKey: custom.id,
      durationVal: custom.duration || '',
      isCompleted: Boolean(custom.completed),
      startDate: custom.startDate || '',
      endDate: custom.endDate || '',
    };
  }
  return null;
}

export const ExperimentModal: React.FC = () => {
  const { activeModalExpId, isModalFullScreen, closeModal, toggleModalFullScreen, projects } = useLabStore();
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || useDialogStore.getState().activeDialog || !activeModalExpId) return;
      if (isModalFullScreen) toggleModalFullScreen();
      else closeModal();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeModalExpId, isModalFullScreen, toggleModalFullScreen, closeModal]);

  if (!activeModalExpId || !projects.some((project) => project.exps.some((experiment) => experiment.id === activeModalExpId))) return null;

  return (
    <div
      onClick={(event) => { if (event.target === event.currentTarget) closeModal(); }}
      className={`fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 ${isModalFullScreen ? 'p-0' : 'p-4'}`}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isModalFullScreen ? 'Full-screen experiment editor' : 'Experiment editor'}
        className={`bg-[var(--bg)] shadow-2xl flex transition-all duration-200 ${isModalFullScreen
          ? 'w-full h-full max-h-none rounded-none overflow-hidden'
          : 'w-full max-w-[880px] max-h-[92vh] rounded-xl p-5 border border-[var(--line)]'}`}
      >
        {isModalFullScreen ? (
          <FullscreenWorkspace experimentId={activeModalExpId} />
        ) : (
          <ExperimentEditor experimentId={activeModalExpId} fullScreen={false} onDeleted={closeModal} headerActions={
            <>
              <button onClick={toggleModalFullScreen} title="Full screen" className="text-xs px-2.5 py-1.5"><Maximize2 size={14} /><span>Full Screen</span></button>
              <button onClick={closeModal} title="Close" className="text-xs px-2.5 py-1.5"><X size={15} /></button>
            </>
          } />
        )}
      </div>
    </div>
  );
};

const FullscreenWorkspace: React.FC<{ experimentId: string }> = ({ experimentId }) => {
  const { openModal, closeModal, toggleModalFullScreen, projects } = useLabStore();
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [splitView, setSplitView] = useState<{ experimentId: string | null } | null>(null);
  const secondaryId = splitView?.experimentId;
  const hasSecondary = secondaryId && projects.some((project) => project.exps.some((experiment) => experiment.id === secondaryId));
  const resizeSidebar = (width: number) => setSidebarWidth(Math.max(160, Math.min(480, window.innerWidth - 320, width)));

  return (
    <>
      <aside aria-label="Experiment sidebar" style={{ width: `min(${sidebarWidth}px, 40vw)` }} className="shrink-0 min-h-0 flex border-r border-[var(--line)]">
        <ExperimentNavigation activeExperimentId={experimentId} onOpen={(id) => openModal(id, true)} onSplit={(id) => setSplitView({ experimentId: id })} />
      </aside>
      <div
        role="separator"
        aria-label="Resize experiment sidebar"
        aria-orientation="vertical"
        aria-valuemin={160}
        aria-valuemax={480}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        className="w-1 shrink-0 cursor-col-resize hover:bg-[var(--acc)] focus-visible:bg-[var(--acc)] touch-none"
        onPointerDown={(event) => { if (event.button === 0) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); } }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeSidebar(event.clientX - event.currentTarget.parentElement!.getBoundingClientRect().left); }}
        onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resizeSidebar(sidebarWidth + (event.key === 'ArrowLeft' ? -24 : 24)); }
        }}
      />
      <div className="min-w-0 flex-1 flex overflow-x-auto">
        <ExperimentEditor
          experimentId={experimentId} fullScreen split={Boolean(splitView)} paneLabel="Primary experiment editor" onDeleted={closeModal}
          headerActions={
            <>
              <button onClick={() => setSplitView(splitView ? null : { experimentId: null })} title="Splitscreen" aria-pressed={Boolean(splitView)} className="text-xs px-2.5 py-1.5"><Columns2 size={14} /><span>Splitscreen</span></button>
              <button onClick={toggleModalFullScreen} title="Exit full screen" className="text-xs px-2.5 py-1.5"><Minimize2 size={14} /><span>Exit Full Screen</span></button>
              <button onClick={closeModal} title="Close" className="text-xs px-2.5 py-1.5"><X size={15} /></button>
            </>
          }
        />
        {splitView && (
          hasSecondary ? (
            <ExperimentEditor
              experimentId={secondaryId} fullScreen split paneLabel="Secondary experiment editor" onDeleted={() => setSplitView(null)}
              headerActions={<button onClick={() => setSplitView(null)} title="Close split screen" className="text-xs px-2.5 py-1.5"><X size={15} /><span>Close split screen</span></button>}
            />
          ) : (
            <section aria-label="Choose second experiment" className="min-w-80 flex-1 min-h-0 flex flex-col border-l border-[var(--line)]">
              <div className="flex items-center justify-between gap-3 p-4 border-b border-[var(--line)]">
                <h2 className="m-0 text-sm font-semibold">Choose second experiment</h2>
                <button onClick={() => setSplitView(null)} title="Close split screen"><X size={15} /></button>
              </div>
              <ExperimentNavigation activeExperimentId={experimentId} label="Split screen experiment selection" onOpen={(id) => setSplitView({ experimentId: id })} />
            </section>
          )
        )}
      </div>
    </>
  );
};

interface ExperimentEditorProps {
  experimentId: string;
  fullScreen: boolean;
  headerActions: React.ReactNode;
  onDeleted: () => void;
  paneLabel?: string;
  split?: boolean;
}

const ExperimentEditor: React.FC<ExperimentEditorProps> = ({ experimentId: activeModalExpId, fullScreen: isModalFullScreen, headerActions, onDeleted, paneLabel, split }) => {
  const {
    projects,
    papers,
    updateExperiment,
    deleteExperiment,
    addCustomPhase,
    updatePhase,
  } = useLabStore();

  const paneId = useId();
  const modalSurface = useRef<HTMLDivElement>(null);
  const pinnedHeader = useRef<HTMLDivElement>(null);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [activeEditorSection, setActiveEditorSection] = useState<SectionKey>('purpose');
  const [activeLightboxBlock, setActiveLightboxBlock] = useState<ImageBlock | null>(null);
  const [enlargedImage, setEnlargedImage] = useState<ImageBlock | null>(null);
  const [isLightboxZoomed, setIsLightboxZoomed] = useState(false);
  const [activeSectionTab, setActiveSectionTab] = useState<ActiveSectionTab>('all');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  // Find project and experiment
  let currentProject = null;
  let currentExp = null;

  for (const proj of projects) {
    const found = proj.exps.find((e) => e.id === activeModalExpId);
    if (found) {
      currentProject = proj;
      currentExp = found;
      break;
    }
  }

  useEffect(() => {
    if (!isModalFullScreen || !pinnedHeader.current) return;
    const header = pinnedHeader.current;
    const updateHeight = () => modalSurface.current?.style.setProperty('--experiment-header-height', `${header.getBoundingClientRect().height}px`);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(header);
    return () => observer.disconnect();
  }, [isModalFullScreen, activeModalExpId]);

  useEffect(() => {
    modalSurface.current?.scrollTo({ top: 0 });
  }, [activeModalExpId]);

  useEffect(() => {
    if (!activeLightboxBlock) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !useDialogStore.getState().activeDialog) {
        event.preventDefault();
        setActiveLightboxBlock(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activeLightboxBlock]);

  if (!activeModalExpId || !currentExp || !currentProject) {
    return null;
  }

  // Phases: which workflow sections belong to this experiment (legacy exps get all 3)
  const includedPhases = getExperimentPhases(currentExp);
  const includedPhaseSet = new Set<string>(includedPhases);

  const introSections = SECTIONS.filter((s) =>
    ['purpose', 'expectedResults', 'experimentalDesign'].includes(s.key)
  );
  const outroSections = SECTIONS.filter((s) =>
    ['results', 'notes'].includes(s.key)
  );

  const workflowSections: SectionConfig[] = includedPhases.map((pk) => {
    const builtin = SECTIONS.find((s) => s.key === pk);
    if (builtin) return builtin;
    const meta = getWorkflowPhaseMeta(pk, currentExp);
    return {
      key: pk,
      label: meta.label,
      subtitle: 'Custom experiment phase workflow & notes',
      icon: <Sparkles size={14} />,
      badgeClass: `${meta.colorTheme.bg} ${meta.colorTheme.text} ${meta.colorTheme.border}`,
      badgeTextClass: meta.colorTheme.text,
      placeholder: `Document procedures, parameters, and notes for ${meta.label}…`,
      minHeight: 'min-h-[110px]',
      hasWorkflowFields: true,
    };
  });

  const visibleSections = [
    ...introSections,
    ...workflowSections,
    ...outroSections,
  ];

  const toolbarSection = visibleSections.some((section) => section.key === activeEditorSection) ? activeEditorSection : 'purpose';

  const remainingBuiltinPhases = ALL_WORKFLOW_PHASES.filter(
    (pk) => !includedPhaseSet.has(pk)
  );
  const remainingCustomPhases = (currentExp.customPhases || []).filter(
    (cp) => !includedPhaseSet.has(cp.id)
  );
  const sectionList =
    isModalFullScreen || activeSectionTab === 'all'
      ? visibleSections
      : visibleSections.filter((s) => s.key === activeSectionTab);

  const handleAddPhase = (key: string) => {
    if (!currentProject || !currentExp) return;
    const next = [...getExperimentPhases(currentExp), key];
    updateExperiment(currentProject.id, currentExp.id, { phases: next });
  };

  const handleCreateCustomPhase = async () => {
    if (!currentProject || !currentExp) return;
    const res = await promptDialog({
      title: 'New Custom Phase',
      message: 'Add a custom workflow phase to this experiment.',
      inputLabel: 'Phase Name',
      placeholder: 'e.g., Tissue Staining, In Vivo Imaging, Flow Cytometry',
      confirmLabel: 'Add Phase',
      required: true,
    });
    if (!res || !res.trim()) return;
    addCustomPhase(currentProject.id, currentExp.id, res.trim());
  };

  const handleRenamePhase = async (key: string) => {
    if (!currentProject || !currentExp) return;
    const name = await promptDialog({
      title: 'Rename Custom Phase',
      inputLabel: 'Phase Name',
      defaultValue: getWorkflowPhaseMeta(key, currentExp).label,
      confirmLabel: 'Save Name',
      required: true,
    });
    if (!name?.trim()) return;
    updatePhase(currentProject.id, currentExp.id, key, { name: name.trim() });
  };

  const handleRemovePhase = async (key: string) => {
    if (!currentProject || !currentExp) return;
    const meta = getWorkflowPhaseMeta(key, currentExp);
    const pData = getExperimentPhaseData(currentExp, key);
    const hasContent = Boolean(
      pData.content.trim() ||
        pData.duration.trim() ||
        pData.startDate.trim() ||
        pData.endDate.trim() ||
        pData.completed ||
        sectionBlocks(currentExp.blocks, key).length > 0
    );
    const ok = await confirmDialog({
      title: `Remove ${meta.label}`,
      message: hasContent
        ? `Remove the "${meta.label}" phase from this experiment? Its notes, schedule and completion status will be kept but hidden.`
        : `Remove the "${meta.label}" phase from this experiment?`,
      confirmLabel: 'Remove Phase',
      variant: 'danger',
    });
    if (!ok) return;
    updateExperiment(currentProject.id, currentExp.id, {
      phases: getExperimentPhases(currentExp).filter((p) => p !== key),
    });
    if (activeSectionTab === key) setActiveSectionTab('all');
  };

  const handleSectionTextChange = (key: string, value: string) => {
    if (!currentProject || !currentExp) return;
    if (['experimentalProtocol', 'dataAcquisition', 'dataAnalysis'].includes(key)) {
      updateExperiment(currentProject.id, currentExp.id, { [key]: value });
    } else if (['purpose', 'expectedResults', 'experimentalDesign', 'results', 'notes'].includes(key)) {
      updateExperiment(currentProject.id, currentExp.id, { [key]: value });
    } else {
      updatePhase(currentProject.id, currentExp.id, key, { content: value });
    }
  };

  const handleDelete = async () => {
    if (!currentProject || !currentExp) return;
    const confirmed = await confirmDialog({
      title: 'Delete Experiment',
      message: `Delete experiment "${currentExp.name}" and all attached protocol notes, images, and data tables? This cannot be undone.`,
      confirmLabel: 'Delete Experiment',
      variant: 'danger',
    });
    if (confirmed) {
      deleteExperiment(currentProject.id, currentExp.id);
      onDeleted();
    }
  };

  return (
    <>
        <div ref={modalSurface} role={paneLabel ? 'region' : undefined} aria-label={paneLabel} data-experiment-scroll className={`min-h-0 flex-1 overflow-y-auto flex flex-col ${split ? 'min-w-80' : 'min-w-0'} ${paneLabel ? 'border-r border-[var(--line)]' : ''}`}>
        <div ref={pinnedHeader} className={isModalFullScreen ? 'sticky top-0 z-30 bg-[var(--bg)] shrink-0' : ''}>
        {/* Header row */}
        <div aria-label="Experiment title" className={`flex flex-wrap items-center gap-3 pb-3 border-b border-[var(--line)] ${isModalFullScreen ? 'px-4 md:px-6 pt-3' : ''}`}>
          <input
            type="text"
            aria-label="Experiment name"
            value={currentExp.name}
            onChange={(e) =>
              updateExperiment(currentProject.id, currentExp.id, {
                name: e.target.value,
              })
            }
            className="flex-1 min-w-0 text-base font-semibold bg-[var(--card)] px-3 py-1.5 border border-[var(--line)] rounded-md"
            placeholder="Experiment name"
          />

          {headerActions}
        </div>

        {isModalFullScreen && <div ref={setToolbarTarget} />}
        </div>

        {/* Metadata options row */}
        <div className={`flex items-center gap-3 flex-wrap py-3 border-b border-[var(--line)] text-xs ${isModalFullScreen ? 'mx-4 md:mx-6' : ''}`}>
          <label className="flex items-center gap-1.5 font-medium">
            <span>Status</span>
            <select
              value={currentExp.status}
              onChange={(e) =>
                updateExperiment(currentProject.id, currentExp.id, {
                  status: e.target.value as any,
                })
              }
              className="py-1 px-2 rounded-md bg-[var(--card)] border border-[var(--line)]"
            >
              {STATUS_LIST.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 font-medium">
            <span>Priority</span>
            <select
              value={currentExp.priority || ''}
              onChange={(e) =>
                updateExperiment(currentProject.id, currentExp.id, {
                  priority: e.target.value as any,
                })
              }
              className="py-1 px-2 rounded-md bg-[var(--card)] border border-[var(--line)]"
            >
              <option value="">—</option>
              {PRIORITY_LIST.map((pr) => (
                <option key={pr} value={pr}>
                  {pr}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 font-medium">
            <span>Paper</span>
            <select
              value={currentExp.paper || ''}
              onChange={(e) =>
                updateExperiment(currentProject.id, currentExp.id, {
                  paper: e.target.value,
                })
              }
              className="py-1 px-2 rounded-md bg-[var(--card)] border border-[var(--line)]"
            >
              <option value="">— none —</option>
              {papers
                .filter((p) => !p.archived || currentExp.paper === p.id)
                .map((p) => {
                  const isProjectPaper = (currentProject?.paperIds || []).includes(p.id);
                  const label = p.archived ? `[Archived] ${p.name}` : p.name;
                  return (
                    <option key={p.id} value={p.id}>
                      {isProjectPaper ? `★ ${label} (Project Paper)` : label}
                    </option>
                  );
                })}
            </select>
          </label>

          <div className="ml-auto">
            <button
              onClick={handleDelete}
              className="danger text-xs py-1 px-2.5"
              title="Delete experiment"
            >
              <Trash2 size={13} />
              <span>Delete</span>
            </button>
          </div>
        </div>

        {/* Section Navigation Tab Bar */}
        <div className={`flex items-center gap-1.5 py-2.5 overflow-x-auto border-b border-[var(--line)] text-xs shrink-0 select-none ${isModalFullScreen ? 'mx-4 md:mx-6' : ''}`}>
          <button
            type="button"
            onClick={() => { setActiveSectionTab('all'); if (isModalFullScreen) modalSurface.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeSectionTab === 'all'
                ? 'bg-[var(--ink)] text-[var(--bg)] shadow-xs'
                : 'hover:bg-[var(--sel)] text-[var(--mut)] hover:text-[var(--ink)]'
            }`}
          >
            <span>All Sections</span>
          </button>

          {visibleSections.map((sec) => {
            const val = sec.hasWorkflowFields
              ? getExperimentPhaseData(currentExp, sec.key).content
              : ((currentExp as any)[sec.key] || '');
            const hasText = Boolean(val && val.trim().length > 0);
            const attachmentCount = sectionBlocks(currentExp.blocks, sec.key).length;
            const hasMedia = attachmentCount > 0;
            const wf = getWorkflowInfo(currentExp, sec.key);
            const isCompleted = wf ? wf.isCompleted : false;
            const hasContent = hasText || hasMedia;
            const isActive = !isModalFullScreen && activeSectionTab === sec.key;

            return (
              <button
                key={sec.key}
                type="button"
                onClick={() => { if (isModalFullScreen) document.getElementById(`${paneId}-experiment-section-${sec.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); else setActiveSectionTab(sec.key); }}
                className={`px-2.5 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 whitespace-nowrap border cursor-pointer ${
                  isActive
                    ? 'bg-[var(--card)] border-[var(--acc)] text-[var(--ink)] shadow-xs'
                    : 'border-transparent hover:bg-[var(--sel)] text-[var(--mut)] hover:text-[var(--ink)]'
                }`}
              >
                <span className={sec.badgeTextClass}>{sec.icon}</span>
                <span>{sec.label}</span>
                {attachmentCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--sel)] text-[var(--ink)] border border-[var(--line)] font-mono">
                    {attachmentCount}
                  </span>
                )}
                {sec.hasWorkflowFields && isCompleted && (
                  <span className="text-[10px] px-1 py-0.2 rounded-sm bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/30">
                    Done
                  </span>
                )}
                {sec.hasWorkflowFields && wf?.startDate && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-sm bg-[var(--acc)]/15 text-[var(--acc)] font-mono flex items-center gap-1 border border-[var(--acc)]/30">
                    <Calendar size={9} />
                    <span>{wf.startDate.slice(5)}</span>
                  </span>
                )}
                {hasContent && !isCompleted && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isActive ? 'bg-[var(--acc)]' : 'bg-emerald-500'
                    }`}
                    title="Section contains content"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Sections Container */}
        <div className={`py-3 shrink-0 ${isModalFullScreen ? 'space-y-8 w-full max-w-6xl mx-auto px-4 md:px-6' : 'space-y-4'}`}>
          {sectionList.map((sec) => {
            const isCollapsed = Boolean(
              !isModalFullScreen && activeSectionTab === 'all' && collapsedSections[sec.key]
            );
            const val = sec.hasWorkflowFields
              ? getExperimentPhaseData(currentExp, sec.key).content
              : ((currentExp as any)[sec.key] || '');
            const wf = getWorkflowInfo(currentExp, sec.key);
            const isCompleted = wf ? wf.isCompleted : false;
            const durationVal = wf ? wf.durationVal : '';

            // Detect out-of-order scheduling sequence
            const sequenceWarning = (() => {
              if (
                sec.key === 'experimentalProtocol' &&
                currentExp.experimentalProtocolStartDate &&
                currentExp.dataAcquisitionStartDate
              ) {
                if (
                  currentExp.experimentalProtocolStartDate >
                  currentExp.dataAcquisitionStartDate
                ) {
                  return 'Scheduled after Data Acquisition';
                }
              }
              if (
                sec.key === 'dataAcquisition' &&
                currentExp.dataAcquisitionStartDate &&
                currentExp.dataAnalysisStartDate
              ) {
                if (
                  currentExp.dataAcquisitionStartDate >
                  currentExp.dataAnalysisStartDate
                ) {
                  return 'Scheduled after Data Analysis';
                }
              }
              return null;
            })();

            return (
              <div
                key={`${currentExp.id}_${sec.key}`}
                id={`${paneId}-experiment-section-${sec.key}`}
                role="region"
                aria-label={`${sec.label} section`}
                style={{ scrollMarginTop: 'calc(var(--experiment-header-height, 80px) + 8px)' }}
                className={isModalFullScreen ? 'min-w-0' : 'border border-[var(--line)] rounded-xl bg-[var(--card)]/60 backdrop-blur-xs overflow-hidden transition-all shadow-xs'}
              >
                {/* Section Header */}
                <div
                  className={`flex items-center justify-between py-2.5 flex-wrap gap-2 ${isModalFullScreen ? '' : 'px-3.5 bg-[var(--card)] border-b border-[var(--line)]/70 cursor-pointer select-none'}`}
                  onClick={() => {
                    if (!isModalFullScreen && activeSectionTab === 'all') {
                      setCollapsedSections((prev) => ({
                        ...prev,
                        [sec.key]: !prev[sec.key],
                      }));
                    }
                  }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`p-1.5 rounded-lg border flex items-center justify-center shrink-0 ${sec.badgeClass}`}
                    >
                      {sec.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className={`m-0 font-semibold text-[var(--ink)] tracking-tight ${isModalFullScreen ? 'text-lg' : 'text-xs'}`}>
                          {sec.label}
                        </h2>
                        {isCompleted && (
                          <span className="text-[10px] font-medium px-1.5 py-0.2 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            Done
                          </span>
                        )}
                        {sequenceWarning && (
                          <span
                            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-medium"
                            title={sequenceWarning}
                          >
                            <AlertTriangle size={10} className="shrink-0 text-amber-600 dark:text-amber-400" />
                            <span className="hidden sm:inline">{sequenceWarning}</span>
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--mut)] truncate leading-tight mt-0.5">
                        {sec.subtitle}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 max-w-full">
                    {sec.hasWorkflowFields && !ALL_WORKFLOW_PHASES.some((key) => key === sec.key) && (
                      <button
                        type="button"
                        aria-label={`Rename ${sec.label} phase`}
                        title="Rename custom phase"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRenamePhase(sec.key);
                        }}
                        className="p-1 text-[var(--mut)] hover:text-[var(--acc)] transition-colors cursor-pointer"
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                    {/* Remove Phase Button */}
                    {sec.hasWorkflowFields && (
                      <button
                        type="button"
                        title={`Remove ${sec.label} phase`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRemovePhase(sec.key);
                        }}
                        className="p-1 text-[var(--mut)] hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}

                    {/* Workflow Fields in Section Header: Duration, Schedule Date, Completed */}
                    {sec.hasWorkflowFields && wf && (
                      <div
                        className="flex items-center gap-2 flex-wrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Duration Dropdown */}
                        <div
                          className="flex items-center gap-1 bg-[var(--bg)] border border-[var(--line)] rounded-md px-2 py-1 shadow-2xs hover:border-[var(--acc)] transition-colors"
                          title="Estimated duration for this stage"
                        >
                          <Clock size={11} className="text-[var(--mut)] shrink-0" />
                          <select
                            value={durationVal}
                            onChange={(e) => {
                              e.stopPropagation();
                              updatePhase(currentProject.id, currentExp.id, sec.key, {
                                duration: e.target.value,
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-transparent text-[11px] font-medium text-[var(--ink)] cursor-pointer outline-hidden py-0 pr-0.5 border-none focus:ring-0"
                          >
                            {DURATION_OPTIONS.map((opt) => (
                              <option
                                key={opt.value}
                                value={opt.value}
                                className="bg-[var(--card)] text-[var(--ink)]"
                              >
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Scheduled Date Field */}
                        <div
                          className={`flex items-center gap-1.5 border rounded-md px-2 py-1 shadow-2xs transition-colors ${
                            wf.startDate
                              ? 'bg-[var(--card)] border-[var(--acc)]/60 text-[var(--ink)]'
                              : 'bg-[var(--bg)] border-[var(--line)] text-[var(--mut)] hover:border-[var(--acc)]'
                          }`}
                          title={
                            wf.startDate
                              ? `Scheduled for ${wf.startDate}`
                              : 'Schedule this stage on the calendar'
                          }
                        >
                          <Calendar
                            size={11}
                            className={
                              wf.startDate
                                ? 'text-[var(--acc)] shrink-0'
                                : 'text-[var(--mut)] shrink-0'
                            }
                          />
                          <input
                            type="date"
                            value={wf.startDate}
                            onChange={(e) => {
                              e.stopPropagation();
                              const val = e.target.value;
                              updatePhase(currentProject.id, currentExp.id, sec.key, {
                                startDate: val,
                                endDate: val,
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-transparent text-[11px] font-medium text-[var(--ink)] cursor-pointer outline-hidden py-0 pr-0.5 border-none focus:ring-0"
                          />
                          {wf.startDate && (
                            <button
                              type="button"
                              title="Clear scheduled date"
                              onClick={(e) => {
                                e.stopPropagation();
                                updatePhase(currentProject.id, currentExp.id, sec.key, {
                                  startDate: '',
                                  endDate: '',
                                });
                              }}
                              className="p-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded text-[var(--mut)] hover:text-red-500 cursor-pointer"
                            >
                              <X size={10} />
                            </button>
                          )}
                        </div>

                        {/* Completed Checkbox */}
                        <label
                          onClick={(e) => e.stopPropagation()}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-colors border select-none ${
                            isCompleted
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 font-semibold shadow-2xs'
                              : 'bg-[var(--bg)] text-[var(--mut)] hover:text-[var(--ink)] border-[var(--line)] hover:border-[var(--acc)]'
                          }`}
                          title={
                            isCompleted
                              ? 'Mark section as incomplete'
                              : 'Mark section as completed'
                          }
                        >
                          <input
                            type="checkbox"
                            checked={isCompleted}
                            onChange={(e) => {
                              e.stopPropagation();
                              updatePhase(currentProject.id, currentExp.id, sec.key, {
                                completed: e.target.checked,
                              });
                            }}
                            className="rounded text-[var(--acc)] focus:ring-[var(--acc)] cursor-pointer w-3.5 h-3.5"
                          />
                          <span>Completed</span>
                        </label>
                      </div>
                    )}

                    {!isModalFullScreen && activeSectionTab === 'all' && (
                      <button
                        type="button"
                        className="p-1 text-[var(--mut)] hover:text-[var(--ink)] transition-colors"
                        title={isCollapsed ? 'Expand section' : 'Collapse section'}
                      >
                        {isCollapsed ? (
                          <ChevronRight size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Section Content */}
                {!isCollapsed && (
                  <div className={`${isModalFullScreen ? 'py-3' : 'p-3'} space-y-3`}>
                    {isModalFullScreen ? (
                      <Suspense fallback={<p className="text-xs text-[var(--mut)]">Loading text editor…</p>}>
                        <SectionTextEditor label={sec.label} value={val} onChange={(value) => handleSectionTextChange(sec.key, value)}
                          toolbarTarget={toolbarTarget}
                          toolbarActive={sec.key === toolbarSection}
                          onActivate={() => setActiveEditorSection(sec.key)}
                          onEnlargeImage={(src, name) => {
                            const original = currentExp.blocks.find((block): block is ImageBlock =>
                              block.type === 'img' && [block.src, block.preview_url, block.raw_url].includes(src));
                            setEnlargedImage(original || { type: 'img', name, src });
                          }}
                          onUploadImage={async (file) => {
                            const { uploadMediaFile, addBlock } = useLabStore.getState();
                            const uploaded = await uploadMediaFile(file);
                            addBlock(currentProject.id, currentExp.id, {
                              type: 'img', name: file.name, src: uploaded.url, preview_url: uploaded.preview_url,
                              raw_url: uploaded.raw_url, metadata: uploaded.metadata, format: uploaded.format,
                              ...sectionOwnership(sec.key),
                            });
                            if (/TIFF|ND2/i.test(uploaded.format || '') && !uploaded.preview_url) {
                              throw new Error('Original attached, but no browser-compatible inline preview is available.');
                            }
                            return uploaded.preview_url || uploaded.url;
                          }}
                        />
                      </Suspense>
                    ) : (
                    <textarea aria-label={`${sec.label} text`}
                      value={val}
                      onChange={(e) => handleSectionTextChange(sec.key, e.target.value)}
                      placeholder={sec.placeholder}
                      className={`w-full bg-[var(--bg)] p-3 border border-[var(--line)] rounded-lg text-sm transition-all focus:border-[var(--acc)] focus:ring-1 focus:ring-[var(--acc)]/30 font-sans leading-relaxed ${
                        activeSectionTab !== 'all'
                          ? 'min-h-[220px]'
                          : sec.minHeight
                      }`}
                    />
                    )}

                    {!isModalFullScreen && <SectionAttachments
                      projectId={currentProject.id}
                      experimentId={currentExp.id}
                      section={sec.key}
                      label={sec.label}
                      blocks={currentExp.blocks}
                      onInspect={(block) => { setIsLightboxZoomed(false); setActiveLightboxBlock(block); }}
                    />}
                  </div>
                )}
                {isModalFullScreen && (
                  <hr id={`${paneId}-experiment-section-${sec.key}-end`} aria-label={`${sec.label} end`} className="mt-2 mb-0 border-0 border-t-2 border-[var(--line)]" />
                )}
              </div>
            );
          })}

          {/* Remaining Phases: add them back or create custom */}
          {(isModalFullScreen || activeSectionTab === 'all') && (
            <div className="border border-dashed border-[var(--line)] rounded-xl p-3 bg-[var(--card)]/30">
              <span className="text-[11px] font-medium text-[var(--mut)]">
                Add a phase to this experiment:
              </span>
              <div className="flex items-center gap-2 flex-wrap mt-2">
                {remainingBuiltinPhases.map((pk) => (
                  <button
                    key={pk}
                    type="button"
                    onClick={() => handleAddPhase(pk)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-[var(--line)] text-[11px] font-medium text-[var(--mut)] hover:text-[var(--ink)] hover:border-[var(--acc)] hover:bg-[var(--sel)]/50 transition-colors cursor-pointer"
                  >
                    <Plus size={12} className="text-[var(--acc)]" />
                    <span>{WORKFLOW_PHASES[pk].label}</span>
                  </button>
                ))}
                {remainingCustomPhases.map((cp) => (
                  <button
                    key={cp.id}
                    type="button"
                    onClick={() => handleAddPhase(cp.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-[var(--line)] text-[11px] font-medium text-[var(--mut)] hover:text-[var(--ink)] hover:border-[var(--acc)] hover:bg-[var(--sel)]/50 transition-colors cursor-pointer"
                  >
                    <Plus size={12} className="text-[var(--acc)]" />
                    <span>{cp.name}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleCreateCustomPhase}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-[var(--acc)]/60 text-[11px] font-semibold text-[var(--acc)] hover:bg-[var(--acc)]/10 transition-colors cursor-pointer"
                >
                  <Plus size={12} className="text-[var(--acc)]" />
                  <span>Custom Phase</span>
                </button>
              </div>
            </div>
          )}

          {isModalFullScreen && (
            <section aria-label="Uploaded content" className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 md:p-4">
              <h2 className="m-0 text-sm font-semibold">Uploaded content</h2>
              <div className="divide-y divide-[var(--line)]">
                {visibleSections.map((sec) => (
                  <SectionAttachments key={`${currentExp.id}_${sec.key}`}
                    projectId={currentProject.id} experimentId={currentExp.id}
                    section={sec.key} label={sec.label} blocks={currentExp.blocks} fullScreen
                    onEnlarge={setEnlargedImage}
                    onInspect={(block) => { setIsLightboxZoomed(false); setActiveLightboxBlock(block); }}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
        </div>

      {enlargedImage && <EnlargedImagePreview block={enlargedImage} onClose={() => setEnlargedImage(null)}
        onInspect={(block) => { setIsLightboxZoomed(false); setActiveLightboxBlock(block); }} />}

      {/* Lightbox / Scientific Image Inspector Modal */}
      {activeLightboxBlock && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveLightboxBlock(null);
          }}
          className="fixed inset-0 z-60 bg-black/85 backdrop-blur-md flex flex-col p-4 md:p-6 overflow-hidden"
        >
          {/* Lightbox Header */}
          <div className="flex items-center justify-between pb-3 border-b border-white/10 text-white shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <Microscope size={18} className="text-[var(--acc)] shrink-0" />
              <h3 className="text-sm font-semibold truncate m-0">
                {activeLightboxBlock.name}
              </h3>
              {activeLightboxBlock.format && (
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--acc)]/20 text-[var(--acc)] border border-[var(--acc)]/30">
                  {activeLightboxBlock.format}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsLightboxZoomed(!isLightboxZoomed)}
                className="text-xs px-2.5 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white flex items-center gap-1.5 transition-colors"
                title={isLightboxZoomed ? 'Fit to screen' : 'Zoom to actual size (100%)'}
              >
                {isLightboxZoomed ? <ZoomOut size={13} /> : <ZoomIn size={13} />}
                <span>{isLightboxZoomed ? 'Fit Screen' : '100% Zoom'}</span>
              </button>

              {(activeLightboxBlock.preview_url || activeLightboxBlock.src) && (
                <a
                  href={activeLightboxBlock.preview_url || activeLightboxBlock.src}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs px-2.5 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white flex items-center gap-1.5 transition-colors no-underline"
                  title="Open full resolution composite preview in a new browser tab"
                >
                  <ExternalLink size={13} />
                  <span>Open in Tab</span>
                </a>
              )}

              {(activeLightboxBlock.raw_url || activeLightboxBlock.src) && (
                <a
                  href={activeLightboxBlock.raw_url || activeLightboxBlock.src}
                  download={activeLightboxBlock.name}
                  className="text-xs px-2.5 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white flex items-center gap-1.5 transition-colors no-underline"
                  title="Download original raw scientific file"
                >
                  <Download size={13} />
                  <span>Download RAW Data</span>
                </a>
              )}
              <button
                onClick={() => setActiveLightboxBlock(null)}
                className="text-white/70 hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
                title="Close (Esc)"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Lightbox Content: Image + Metadata Drawer */}
          <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-4 mt-4 overflow-hidden">
            {/* Left Image Viewport */}
            <div className="flex-1 flex items-center justify-center min-h-0 bg-black/40 rounded-lg p-2 border border-white/5 overflow-auto relative">
              <img
                src={activeLightboxBlock.preview_url || activeLightboxBlock.src}
                alt={activeLightboxBlock.name}
                onClick={() => setIsLightboxZoomed(!isLightboxZoomed)}
                className={`${
                  isLightboxZoomed
                    ? 'max-w-none max-h-none cursor-zoom-out'
                    : 'max-h-full max-w-full object-contain cursor-zoom-in'
                } rounded shadow-2xl transition-all duration-200`}
                title={isLightboxZoomed ? 'Click to fit view' : 'Click to zoom to 100% resolution'}
              />
            </div>

            {/* Right Metadata Sidepanel */}
            {activeLightboxBlock.metadata && (
              <div className="w-full md:w-80 shrink-0 bg-white/5 border border-white/10 rounded-lg p-4 overflow-y-auto text-white text-xs space-y-4">
                <div>
                  <h4 className="text-[11px] uppercase tracking-wider text-white/50 font-semibold mb-2">
                    Scientific Acquisition Details
                  </h4>
                  <div className="space-y-1.5 font-mono text-[11px]">
                    {activeLightboxBlock.metadata.width && (
                      <div className="flex justify-between py-1 border-b border-white/5">
                        <span className="text-white/60">Dimensions:</span>
                        <span>
                          {activeLightboxBlock.metadata.width} ×{' '}
                          {activeLightboxBlock.metadata.height} px
                        </span>
                      </div>
                    )}
                    {activeLightboxBlock.metadata.channels && (
                      <div className="flex justify-between py-1 border-b border-white/5">
                        <span className="text-white/60">Channels:</span>
                        <span>{activeLightboxBlock.metadata.channels}</span>
                      </div>
                    )}
                    {activeLightboxBlock.metadata.channel_names && (
                      <div className="py-1 border-b border-white/5">
                        <span className="text-white/60 block mb-1">Channel Names:</span>
                        <div className="flex flex-wrap gap-1 font-sans">
                          {activeLightboxBlock.metadata.channel_names.map(
                            (c: string, ci: number) => (
                              <span
                                key={ci}
                                className="px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-white"
                              >
                                {c}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    )}
                    {activeLightboxBlock.metadata.z_slices && (
                      <div className="flex justify-between py-1 border-b border-white/5">
                        <span className="text-white/60">Z-Planes:</span>
                        <span>{activeLightboxBlock.metadata.z_slices} slices</span>
                      </div>
                    )}
                    {activeLightboxBlock.metadata.projection && (
                      <div className="flex justify-between py-1 border-b border-white/5">
                        <span className="text-white/60">Projection:</span>
                        <span>{activeLightboxBlock.metadata.projection}</span>
                      </div>
                    )}
                    {activeLightboxBlock.metadata.dtype && (
                      <div className="flex justify-between py-1 border-b border-white/5">
                        <span className="text-white/60">Bit Depth:</span>
                        <span>{activeLightboxBlock.metadata.dtype}</span>
                      </div>
                    )}
                    {activeLightboxBlock.metadata.pixel_size_um && (
                      <div className="flex justify-between py-1 border-b border-white/5">
                        <span className="text-white/60">Voxel Calibration:</span>
                        <span>
                          {activeLightboxBlock.metadata.pixel_size_um.x} µm / px
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {activeLightboxBlock.metadata.text_info && (
                  <div>
                    <h4 className="text-[11px] uppercase tracking-wider text-white/50 font-semibold mb-2">
                      Optical & Device Parameters
                    </h4>
                    <div className="space-y-1.5 text-[11px] text-white/80 max-h-48 overflow-y-auto">
                      {Object.entries(activeLightboxBlock.metadata.text_info).map(
                        ([k, v]) => (
                          <div key={k} className="py-0.5">
                            <span className="text-white/50 block text-[10px]">{k}:</span>
                            <span className="break-all">{String(v)}</span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
