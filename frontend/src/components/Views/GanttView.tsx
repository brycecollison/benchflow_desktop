import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChartGantt, Search } from 'lucide-react';
import { useLabStore } from '../../store/useLabStore';
import { ALL_WORKFLOW_PHASES, getWorkflowPhaseMeta } from '../../types/lab';
import { matchesFilter } from '../../utils/dag';
import { calendarDayDate, getGanttPhases, toCalendarDay, type GanttPhase } from '../../utils/gantt';

const LABEL_WIDTH = 260;
const BAR_LABEL_WIDTH = 220;
type Timescale = 'days' | 'weeks';
const formatDay = (day: number) => calendarDayDate(day).toLocaleDateString(undefined, {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

interface GanttChartProps {
  title: string;
  phases: GanttPhase[];
  scale: Timescale;
  today: number;
  openModal: (experimentId: string) => void;
}

const GanttChart: React.FC<GanttChartProps> = ({ title, phases, scale, today, openModal }) => {
  const scroller = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setViewportWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const dayWidth = scale === 'days' ? 40 : 18;
  const tickDays = scale === 'days' ? 1 : 7;
  const firstDay = phases.reduce((min, phase) => Math.min(min, phase.startDay), today);
  // Align ticks to today, retaining earlier phases to the left of the initial viewport.
  const startDay = today - Math.ceil((today - firstDay) / tickDays) * tickDays;
  const visibleDays = Math.max(28, Math.ceil(Math.max(0, viewportWidth - LABEL_WIDTH) / dayWidth));
  const labelPadding = Math.ceil((BAR_LABEL_WIDTH + 12) / dayWidth);
  const lastDay = phases.reduce((max, phase) => Math.max(max, phase.endDay + labelPadding), today + visibleDays - 1);
  const dayCount = Math.ceil((lastDay - startDay + 1) / tickDays) * tickDays;
  const timelineWidth = dayCount * dayWidth;
  const todayOffset = (today - startDay) * dayWidth;

  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = todayOffset;
  }, [todayOffset, viewportWidth]);

  return (
    <section className="min-w-0 rounded-lg border border-[var(--line)] overflow-hidden" aria-label={title}>
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-[var(--card)] border-b border-[var(--line)]">
        <div className="min-w-0">
          <h3 className="m-0 font-semibold text-sm truncate">{title}</h3>
          <span className="text-[11px] text-[var(--mut)]">{phases.length} scheduled phase{phases.length === 1 ? '' : 's'}</span>
        </div>
        <button type="button" onClick={() => { if (scroller.current) scroller.current.scrollLeft = todayOffset; }} className="text-xs shrink-0">
          Today
        </button>
      </div>
      <div ref={scroller} className="max-h-[420px] overflow-auto relative" tabIndex={0} role="region" aria-label={`${title} timeline`}>
        <div style={{ width: LABEL_WIDTH + timelineWidth, minWidth: '100%' }}>
          <div className="sticky top-0 z-30 flex h-14 border-b border-[var(--line)] bg-[var(--card)]">
            <div style={{ width: LABEL_WIDTH }} className="sticky left-0 z-40 shrink-0 flex items-center px-3 bg-[var(--card)] border-r border-[var(--line)] text-xs font-semibold">
              Project / Experiment / Phase
            </div>
            <div className="flex" style={{ width: timelineWidth }}>
              {Array.from({ length: dayCount / tickDays }, (_, index) => {
                const day = startDay + index * tickDays;
                return (
                  <div key={day} aria-current={day === today ? 'date' : undefined} style={{ width: dayWidth * tickDays }} className={`shrink-0 flex flex-col items-center justify-center border-r border-[var(--line)] text-[10px] ${day === today ? 'text-[var(--acc)] font-semibold' : 'text-[var(--mut)]'}`} title={formatDay(day)}>
                    <span>{calendarDayDate(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
                    <span className="opacity-70">{day === today ? 'Today' : scale === 'weeks' ? calendarDayDate(day).getUTCFullYear() : calendarDayDate(day).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {phases.map((phase) => {
            const meta = phase.meta;
            const dates = `${formatDay(phase.startDay)} – ${formatDay(phase.endDay)}`;
            const barLeft = (phase.startDay - startDay) * dayWidth + 2;
            const barWidth = (phase.endDay - phase.startDay + 1) * dayWidth - 4;
            const labelInside = barWidth >= 180;
            return (
              <div key={phase.id} className="flex h-20 border-b border-[var(--line)]">
                <button
                  type="button"
                  onClick={() => openModal(phase.experimentId)}
                  style={{ width: LABEL_WIDTH }}
                  className="sticky left-0 z-20 shrink-0 min-w-0 !rounded-none !px-3 !py-2 !bg-[var(--card)] hover:!bg-[var(--sel)] !border-0 !border-r !border-solid !border-[var(--line)] text-left flex flex-col justify-center cursor-pointer"
                  title={`${phase.projectName} / ${phase.experimentName} / ${meta.label}`}
                >
                  <span className="block w-full truncate text-[10px] text-[var(--mut)]">{phase.projectName}</span>
                  <span className="block w-full truncate text-xs font-semibold text-[var(--ink)]">{phase.experimentName}</span>
                  <span className={`block w-full truncate text-[10px] ${meta.colorTheme.text}`}>{meta.label}</span>
                </button>
                <div className="relative shrink-0" style={{
                  width: timelineWidth,
                  backgroundImage: 'linear-gradient(to right, var(--line) 1px, transparent 1px)',
                  backgroundSize: `${dayWidth * tickDays}px 100%`,
                }}>
                  <div className="absolute inset-y-0 border-l-2 border-[var(--acc)] opacity-40 pointer-events-none" style={{ left: todayOffset }} title="Today" />
                  <div style={{ left: barLeft, width: barWidth }} className={`absolute top-5 h-10 rounded-md ${meta.colorTheme.badge} shadow-xs`}>
                    <button
                      type="button"
                      aria-label={`${phase.experimentName}: ${meta.label}, ${dates}`}
                      title={`${phase.projectName} / ${phase.experimentName}\n${meta.label}\n${dates}`}
                      onClick={() => openModal(phase.experimentId)}
                      className="w-full h-full !min-w-0 !px-1 !py-0 !rounded-md !border-0 !bg-transparent !text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] cursor-pointer"
                    >
                      {(labelInside || barWidth >= 36) && (
                        <span className="block min-w-0 truncate text-[10px] font-semibold">{labelInside ? phase.experimentName : meta.shortLabel}</span>
                      )}
                    </button>
                  </div>
                  {!labelInside && (
                    <span style={{ left: barLeft + barWidth + 8, width: BAR_LABEL_WIDTH }} className="absolute top-5 h-10 flex items-center text-xs text-[var(--ink)] pointer-events-none">
                      <span className="truncate">{phase.experimentName}</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {phases.length === 0 && (
          <p className="sticky left-0 m-0 p-5 text-xs text-[var(--mut)]">No scheduled incomplete phases for this chart.</p>
        )}
      </div>
    </section>
  );
};

export const GanttView: React.FC = () => {
  const { projects, filters, openModal } = useLabStore();
  const [search, setSearch] = useState('');
  const [scale, setScale] = useState<Timescale>('weeks');
  const [projectId, setProjectId] = useState('all');
  const [today] = useState(() => toCalendarDay(new Date().toDateString())!);
  const activeProjects = projects.filter((project) => !project.archived);
  const phases = useMemo(() => {
    const query = search.trim().toLowerCase();
    return getGanttPhases(projects.map((project) => ({
      ...project,
      exps: project.exps.filter((exp) => matchesFilter(exp, filters)),
    }))).filter((phase) =>
      (projectId === 'all' || phase.projectId === projectId) &&
      (!query || `${phase.experimentName} ${phase.projectName} ${phase.meta.label}`.toLowerCase().includes(query))
    );
  }, [projects, filters, search, projectId]);

  return (
    <section className="flex-1 min-w-0 flex flex-col overflow-hidden" aria-label="Gantt chart">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--line)] bg-[var(--card)]">
        <div>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <ChartGantt size={16} className="text-[var(--acc)]" />
            <span>{phases.length} scheduled phase{phases.length === 1 ? '' : 's'}</span>
          </div>
          <p className="m-0 mt-1 text-xs text-[var(--mut)]">Completed phases are hidden. Charts start at today; scroll left for earlier phases.</p>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--mut)] pointer-events-none" />
            <input
              aria-label="Search Gantt phases"
              placeholder="Search phases…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ paddingLeft: 28 }}
              className="w-44 text-xs py-1.5 rounded-md bg-[var(--bg)] border border-[var(--line)]"
            />
          </div>
          <select aria-label="Gantt project" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="text-xs max-w-48 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--line)]">
            <option value="all">All projects</option>
            {activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <select aria-label="Gantt timescale" value={scale} onChange={(event) => setScale(event.target.value as Timescale)} className="text-xs py-1.5 rounded-md bg-[var(--bg)] border border-[var(--line)]">
            <option value="weeks">Weeks</option>
            <option value="days">Days</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 px-4 py-2 text-[11px] text-[var(--mut)] border-b border-[var(--line)]">
        {ALL_WORKFLOW_PHASES.map((key) => {
          const meta = getWorkflowPhaseMeta(key);
          return (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${meta.colorTheme.badge}`} />
              {meta.label}
            </span>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
        {phases.length === 0 && <h3 className="m-0 mb-3 text-sm text-[var(--mut)]">No scheduled incomplete phases</h3>}
        <GanttChart title="All projects" phases={phases} scale={scale} today={today} openModal={openModal} />
        {activeProjects.filter((project) => projectId === 'all' || project.id === projectId).map((project) => (
          <GanttChart
            key={project.id}
            title={project.name}
            phases={phases.filter((phase) => phase.projectId === project.id)}
            scale={scale}
            today={today}
            openModal={openModal}
          />
        ))}
      </div>
    </section>
  );
};
