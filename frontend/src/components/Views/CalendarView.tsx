import React, { useState, useMemo } from 'react';
import { useLabStore } from '../../store/useLabStore';
import { getCalendarPhaseFilterKey } from '../../utils/calendarPhaseFilters';
import { parseDurationDays } from '../../utils/schedule';
import {
  ALL_WORKFLOW_PHASES,
  getWorkflowPhaseMeta,
  getExperimentPhaseData,
  getExperimentPhases,
  type WorkflowPhaseKey,
  type CalendarEventItem,
} from '../../types/lab';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Check,
  AlertTriangle,
  Search,
  X,
  Folder,
  PanelRightClose,
  PanelRightOpen,
  GripVertical,
  FlaskConical,
  ClipboardList,
  Database,
  LineChart,
  RotateCcw,
  FileText,
  Sparkles,
} from 'lucide-react';

type CalendarViewMode = 'month' | 'week';

interface DragPayload {
  type: 'move' | 'resize-left' | 'resize-right';
  projectId: string;
  experimentId: string;
  phaseKey: WorkflowPhaseKey;
  eventId?: string;
  duration?: string;
  currentStartDate?: string;
  currentEndDate?: string;
}

interface WeekTrackEvent {
  event: CalendarEventItem;
  startCol: number; // 0 to 6
  endCol: number; // 0 to 6
  spanCols: number; // 1 to 7
  trackIndex: number;
  isStart: boolean;
  isEnd: boolean;
}

export const CalendarView: React.FC = () => {
  const {
    projects,
    papers,
    openModal,
    updatePhaseSchedule,
    updatePhase,
  } = useLabStore();

  const [viewMode, setViewMode] = useState<CalendarViewMode>('week');
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());

  // 1. Independent Calendar Filters: hidden phase keys (empty set = all phases shown)
  const [hiddenCalPhases, setHiddenCalPhases] = useState<Set<WorkflowPhaseKey>>(new Set());
  const [calProjectId, setCalProjectId] = useState<string>('all');
  const [calSearchQuery, setCalSearchQuery] = useState('');

  // 2. Independent Unscheduled Workflows Filters: hidden phase keys (empty set = all phases shown)
  const [hiddenTrayPhases, setHiddenTrayPhases] = useState<Set<WorkflowPhaseKey>>(new Set());
  const [trayProjectId, setTrayProjectId] = useState<string>('all');
  const [traySearchQuery, setTraySearchQuery] = useState('');

  const [isTrayOpen, setIsTrayOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('lab_calendar_tray_open');
      return saved !== 'false';
    } catch {
      return true;
    }
  });

  const toggleTrayOpen = () => {
    setIsTrayOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('lab_calendar_tray_open', String(next));
      } catch {}
      return next;
    });
  };

  const [trayWidth, setTrayWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('lab_calendar_tray_width');
      const val = saved ? parseInt(saved, 10) : 320;
      return isNaN(val) ? 320 : Math.min(Math.max(val, 250), 650);
    } catch {
      return 320;
    }
  });

  const [isResizingTray, setIsResizingTray] = useState(false);

  const handleTrayResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingTray(true);
    const startX = e.clientX;
    const startWidth = trayWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = startWidth + delta;
      if (newWidth < 160) {
        setIsTrayOpen(false);
        try {
          localStorage.setItem('lab_calendar_tray_open', 'false');
        } catch {}
      } else {
        setIsTrayOpen(true);
        const clamped = Math.min(Math.max(newWidth, 250), 650);
        setTrayWidth(clamped);
      }
    };

    const onMouseUp = () => {
      setIsResizingTray(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setTrayWidth((current) => {
        try {
          localStorage.setItem('lab_calendar_tray_width', String(current));
        } catch {}
        return current;
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };
  const [activeDragItem, setActiveDragItem] = useState<DragPayload | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [isDragOverTray, setIsDragOverTray] = useState(false);
  const [dragOverCard, setDragOverCard] = useState<{
    eventId: string;
    position: 'above' | 'below';
  } | null>(null);

  const [eventOrder, setEventOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('lab_calendar_event_order');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const paperMap = useMemo(
    () => new Map(papers.map((p) => [p.id, p])),
    [papers]
  );

  const activeProjects = useMemo(
    () => projects.filter((p) => !p.archived),
    [projects]
  );

  const phaseMetadata = useMemo(() => {
    const metadata = new Map<WorkflowPhaseKey, ReturnType<typeof getWorkflowPhaseMeta>>(
      ALL_WORKFLOW_PHASES.map((key) => [key, getWorkflowPhaseMeta(key)])
    );
    for (const proj of activeProjects) {
      for (const exp of proj.exps) {
        for (const key of getExperimentPhases(exp)) {
          metadata.set(key, getWorkflowPhaseMeta(key, exp));
        }
      }
    }
    return metadata;
  }, [activeProjects]);
  const phaseFilters = Array.from(new Set(
    Array.from(phaseMetadata.keys(), getCalendarPhaseFilterKey)
  )).map((key) => key === 'customPhases'
    ? { ...getWorkflowPhaseMeta(key), label: 'Custom Phases', shortLabel: 'Custom Phases' }
    : phaseMetadata.get(key)!);
  const availablePhaseKeys = phaseFilters.map((meta) => meta.key);

  // Compile scheduled events based on Calendar filters
  // Automatically spans phases whose duration > 1 day across corresponding days
  const allEvents = useMemo<CalendarEventItem[]>(() => {
    const list: CalendarEventItem[] = [];

    for (const proj of activeProjects) {
      if (calProjectId !== 'all' && proj.id !== calProjectId) continue;

      for (const exp of proj.exps) {
        for (const phaseKey of getExperimentPhases(exp)) {
          if (hiddenCalPhases.has(getCalendarPhaseFilterKey(phaseKey))) continue;

          const pData = getExperimentPhaseData(exp, phaseKey);
          const start = pData.startDate.trim();
          if (start) {
            let end = pData.endDate.trim();
            const durationDays = parseDurationDays(pData.duration);

            // If end date is missing or same as start, but duration is > 1 day, calculate end date
            if (!end || (end === start && durationDays > 1)) {
              end = calculateEndDate(start, durationDays);
            }

            const paperObj = exp.paper ? paperMap.get(exp.paper) : undefined;

            list.push({
              id: `${exp.id}_${phaseKey}`,
              projectId: proj.id,
              projectName: proj.name,
              experimentId: exp.id,
              experimentName: exp.name,
              phaseKey,
              startDate: start,
              endDate: end,
              duration:
                pData.duration ||
                formatDurationDays(getDaysBetween(start, end)),
              completed: pData.completed,
              paperColor: paperObj?.color,
              paperName: paperObj?.name,
              status: exp.status,
            });
          }
        }
      }
    }
    return list;
  }, [activeProjects, calProjectId, hiddenCalPhases, paperMap]);

  // Filter calendar events by search query
  const filteredEvents = useMemo(() => {
    if (!calSearchQuery.trim()) return allEvents;
    const q = calSearchQuery.toLowerCase();
    return allEvents.filter(
      (ev) =>
        ev.experimentName.toLowerCase().includes(q) ||
        ev.projectName.toLowerCase().includes(q)
    );
  }, [allEvents, calSearchQuery]);

  // Group unscheduled phases by experiment
  // Criteria: remove completed phases and add all uncompleted phases, regardless of text or duration presence
  const unscheduledGroups = useMemo(() => {
    const groupMap = new Map<
      string,
      {
        projectId: string;
        projectName: string;
        experimentId: string;
        experimentName: string;
        paperColor?: string;
        status: string;
        phases: Array<{
          phaseKey: WorkflowPhaseKey;
          duration?: string;
        }>;
      }
    >();

    const q = traySearchQuery.toLowerCase().trim();

    for (const proj of activeProjects) {
      if (trayProjectId !== 'all' && proj.id !== trayProjectId) continue;

      for (const exp of proj.exps) {
        if (
          q &&
          !exp.name.toLowerCase().includes(q) &&
          !proj.name.toLowerCase().includes(q)
        ) {
          continue;
        }

        const expPhases: Array<{
          phaseKey: WorkflowPhaseKey;
          duration?: string;
        }> = [];

        for (const phaseKey of getExperimentPhases(exp)) {
          if (hiddenTrayPhases.has(getCalendarPhaseFilterKey(phaseKey))) continue;
          const pData = getExperimentPhaseData(exp, phaseKey);
          const hasDate = Boolean(pData.startDate.trim());
          const isCompleted = pData.completed;

          // Unscheduled and uncompleted
          if (!hasDate && !isCompleted) {
            expPhases.push({
              phaseKey,
              duration: pData.duration || '1 day',
            });
          }
        }

        if (expPhases.length > 0) {
          const paperObj = exp.paper ? paperMap.get(exp.paper) : undefined;
          groupMap.set(exp.id, {
            projectId: proj.id,
            projectName: proj.name,
            experimentId: exp.id,
            experimentName: exp.name,
            paperColor: paperObj?.color,
            status: exp.status,
            phases: expPhases,
          });
        }
      }
    }

    return Array.from(groupMap.values());
  }, [activeProjects, trayProjectId, hiddenTrayPhases, traySearchQuery, paperMap]);

  // Total count of unscheduled phases in the tray
  const totalUnscheduledPhasesCount = useMemo(() => {
    return unscheduledGroups.reduce((acc, g) => acc + g.phases.length, 0);
  }, [unscheduledGroups]);

  // Date Navigation Helpers
  const handlePrev = () => {
    const next = new Date(currentDate);
    if (viewMode === 'month') {
      next.setMonth(next.getMonth() - 1);
    } else {
      next.setDate(next.getDate() - 7);
    }
    setCurrentDate(next);
  };

  const handleNext = () => {
    const next = new Date(currentDate);
    if (viewMode === 'month') {
      next.setMonth(next.getMonth() + 1);
    } else {
      next.setDate(next.getDate() + 7);
    }
    setCurrentDate(next);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, payload: DragPayload) => {
    setActiveDragItem(payload);
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setActiveDragItem(null);
    setDragOverDate(null);
    setDragOverCard(null);
    setIsDragOverTray(false);
  };

  const reorderEvents = (
    draggedId: string,
    targetId: string,
    position: 'above' | 'below'
  ) => {
    setEventOrder((prevOrder) => {
      // Start with all existing orders without discarding other filtered projects/phases
      const currentList = [...prevOrder];

      // Ensure targetId is in the list
      if (!currentList.includes(targetId)) {
        currentList.push(targetId);
      }

      // Remove draggedId from its old position if present
      const filtered = currentList.filter((id) => id !== draggedId);

      // Find index of targetId
      const targetIdx = filtered.indexOf(targetId);
      if (targetIdx === -1) {
        filtered.push(draggedId);
      } else {
        const insertIdx = position === 'above' ? targetIdx : targetIdx + 1;
        filtered.splice(insertIdx, 0, draggedId);
      }

      // Persist to localStorage
      try {
        localStorage.setItem(
          'lab_calendar_event_order',
          JSON.stringify(filtered)
        );
      } catch (err) {
        console.warn('Failed to save calendar event order to localStorage', err);
      }

      return filtered;
    });
  };

  const handleCardDrop = (
    targetEvent: CalendarEventItem,
    position: 'above' | 'below'
  ) => {
    if (!activeDragItem) return;
    const draggedEventId =
      activeDragItem.eventId ||
      `${activeDragItem.experimentId}_${activeDragItem.phaseKey}`;
    if (draggedEventId === targetEvent.id) return;

    const draggedDays =
      activeDragItem.currentStartDate && activeDragItem.currentEndDate
        ? getDaysBetween(
            activeDragItem.currentStartDate,
            activeDragItem.currentEndDate
          )
        : parseDurationDays(activeDragItem.duration);
    const targetDays = getDaysBetween(
      targetEvent.startDate,
      targetEvent.endDate || targetEvent.startDate
    );

    // Only single day or less phases can be reordered vertically
    if (draggedDays > 1 || targetDays > 1) {
      if (activeDragItem.currentStartDate !== targetEvent.startDate) {
        const newEndDate = calculateEndDate(targetEvent.startDate, draggedDays);
        updatePhaseSchedule(
          activeDragItem.projectId,
          activeDragItem.experimentId,
          activeDragItem.phaseKey,
          targetEvent.startDate,
          newEndDate
        );
      }
      setActiveDragItem(null);
      setDragOverCard(null);
      setDragOverDate(null);
      return;
    }

    // 1. If dragged from a different day, update schedule to match target's day
    if (activeDragItem.currentStartDate !== targetEvent.startDate) {
      const spanDays =
        activeDragItem.currentStartDate && activeDragItem.currentEndDate
          ? getDaysBetween(
              activeDragItem.currentStartDate,
              activeDragItem.currentEndDate
            )
          : parseDurationDays(activeDragItem.duration);
      const newEndDate = calculateEndDate(targetEvent.startDate, spanDays);
      updatePhaseSchedule(
        activeDragItem.projectId,
        activeDragItem.experimentId,
        activeDragItem.phaseKey,
        targetEvent.startDate,
        newEndDate
      );
    }

    // 2. Reorder vertically (only single-day phases)
    reorderEvents(draggedEventId, targetEvent.id, position);

    setActiveDragItem(null);
    setDragOverCard(null);
    setDragOverDate(null);
  };

  const handleDayDrop = (cellDateStr: string) => {
    if (!activeDragItem) return;

    if (activeDragItem.type === 'move') {
      // Preserve duration when moving
      const spanDays =
        activeDragItem.currentStartDate && activeDragItem.currentEndDate
          ? getDaysBetween(
              activeDragItem.currentStartDate,
              activeDragItem.currentEndDate
            )
          : parseDurationDays(activeDragItem.duration);

      const newEndDate = calculateEndDate(cellDateStr, spanDays);
      updatePhaseSchedule(
        activeDragItem.projectId,
        activeDragItem.experimentId,
        activeDragItem.phaseKey,
        cellDateStr,
        newEndDate
      );
    } else if (activeDragItem.type === 'resize-left') {
      // Adjust start date, keeping end date anchored
      const currentEnd = activeDragItem.currentEndDate || cellDateStr;
      if (cellDateStr <= currentEnd) {
        const newDays = getDaysBetween(cellDateStr, currentEnd);
        updatePhaseSchedule(
          activeDragItem.projectId,
          activeDragItem.experimentId,
          activeDragItem.phaseKey,
          cellDateStr,
          currentEnd
        );
        updatePhase(
          activeDragItem.projectId,
          activeDragItem.experimentId,
          activeDragItem.phaseKey,
          {
            duration: formatDurationDays(newDays),
          }
        );
      }
    } else if (activeDragItem.type === 'resize-right') {
      // Adjust end date, keeping start date anchored
      const currentStart = activeDragItem.currentStartDate || cellDateStr;
      if (cellDateStr >= currentStart) {
        const newDays = getDaysBetween(currentStart, cellDateStr);
        updatePhaseSchedule(
          activeDragItem.projectId,
          activeDragItem.experimentId,
          activeDragItem.phaseKey,
          currentStart,
          cellDateStr
        );
        updatePhase(
          activeDragItem.projectId,
          activeDragItem.experimentId,
          activeDragItem.phaseKey,
          {
            duration: formatDurationDays(newDays),
          }
        );
      }
    }

    setActiveDragItem(null);
    setDragOverDate(null);
  };

  const handleTrayDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!activeDragItem) return;
    // Clear date to unschedule
    updatePhaseSchedule(
      activeDragItem.projectId,
      activeDragItem.experimentId,
      activeDragItem.phaseKey,
      '',
      ''
    );
    setActiveDragItem(null);
    setIsDragOverTray(false);
  };

  // Sequence verification helper
  const getSequenceWarning = (ev: CalendarEventItem) => {
    const proj = activeProjects.find((p) => p.id === ev.projectId);
    const exp = proj?.exps.find((e) => e.id === ev.experimentId);
    if (!exp) return null;

    if (
      ev.phaseKey === 'experimentalProtocol' &&
      exp.experimentalProtocolStartDate &&
      exp.dataAcquisitionStartDate &&
      exp.experimentalProtocolStartDate > exp.dataAcquisitionStartDate
    ) {
      return 'Scheduled after Data Acquisition';
    }
    if (
      ev.phaseKey === 'dataAcquisition' &&
      exp.dataAcquisitionStartDate &&
      exp.dataAnalysisStartDate &&
      exp.dataAcquisitionStartDate > exp.dataAnalysisStartDate
    ) {
      return 'Scheduled after Data Analysis';
    }
    return null;
  };

  // Calendar Math: Month Grid Days with Sunday as start of week
  const monthDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    // Sunday as start of week (0: Sun, 1: Mon, ..., 6: Sat)
    const startDayOfWeek = firstDayOfMonth.getDay();

    const days: Array<{
      date: Date;
      dateStr: string;
      isCurrentMonth: boolean;
      isToday: boolean;
    }> = [];

    // Days from previous month
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      const dateStr = formatDateIso(d);
      days.push({
        date: d,
        dateStr,
        isCurrentMonth: false,
        isToday: isSameDay(d, new Date()),
      });
    }

    // Days of current month
    for (let day = 1; day <= lastDayOfMonth.getDate(); day++) {
      const d = new Date(year, month, day);
      const dateStr = formatDateIso(d);
      days.push({
        date: d,
        dateStr,
        isCurrentMonth: true,
        isToday: isSameDay(d, new Date()),
      });
    }

    // Days from next month to complete the 7-column grid
    const remaining = (7 - (days.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      const dateStr = formatDateIso(d);
      days.push({
        date: d,
        dateStr,
        isCurrentMonth: false,
        isToday: isSameDay(d, new Date()),
      });
    }

    return days;
  }, [currentDate]);

  // Group month days into 7-day week chunks
  const monthWeeks = useMemo(() => {
    const weeks: Array<typeof monthDays> = [];
    for (let i = 0; i < monthDays.length; i += 7) {
      weeks.push(monthDays.slice(i, i + 7));
    }
    return weeks;
  }, [monthDays]);

  // Calendar Math: Week View Days with Sunday as start of week
  const weekDays = useMemo(() => {
    const curr = new Date(currentDate);
    const sunday = new Date(curr);
    sunday.setDate(curr.getDate() - curr.getDay());

    const days: Array<{
      date: Date;
      dateStr: string;
      isToday: boolean;
    }> = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      days.push({
        date: d,
        dateStr: formatDateIso(d),
        isToday: isSameDay(d, new Date()),
      });
    }
    return days;
  }, [currentDate]);

  // Week View Track Events (continuous spanning multi-day & single-day events)
  const weekTracks = useMemo(() => {
    return computeWeekTracks(weekDays, filteredEvents, eventOrder);
  }, [weekDays, filteredEvents, eventOrder]);

  // Header label
  const headerDateLabel = useMemo(() => {
    const options: Intl.DateTimeFormatOptions = {
      month: 'long',
      year: 'numeric',
    };
    if (viewMode === 'month') {
      return currentDate.toLocaleDateString(undefined, options);
    } else {
      const start = weekDays[0].date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
      const end = weekDays[6].date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      return `${start} – ${end}`;
    }
  }, [viewMode, currentDate, weekDays]);

  const toggleCalPhase = (phase: WorkflowPhaseKey) => {
    setHiddenCalPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        if (next.size < availablePhaseKeys.length - 1) {
          next.add(phase);
        }
      }
      return next;
    });
  };

  const toggleTrayPhase = (phase: WorkflowPhaseKey) => {
    setHiddenTrayPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        if (next.size < availablePhaseKeys.length - 1) {
          next.add(phase);
        }
      }
      return next;
    });
  };

  const getPhaseIcon = (phaseKey: WorkflowPhaseKey) => {
    switch (phaseKey) {
      case 'experimentalProtocol':
        return <ClipboardList size={11} className="shrink-0" />;
      case 'dataAcquisition':
        return <Database size={11} className="shrink-0" />;
      case 'dataAnalysis':
        return <LineChart size={11} className="shrink-0" />;
      default:
        return <Sparkles size={11} className="shrink-0" />;
    }
  };

  const isTrayFiltered =
    trayProjectId !== 'all' ||
    traySearchQuery.trim() !== '' ||
    hiddenTrayPhases.size > 0;

  const resetTrayFilters = () => {
    setTrayProjectId('all');
    setTraySearchQuery('');
    setHiddenTrayPhases(new Set());
  };

  // Helper to render a continuous event card spanning one or more columns
  const renderContinuousEventCard = (item: WeekTrackEvent) => {
    const ev = item.event;
    const meta = phaseMetadata.get(ev.phaseKey)!;
    const warning = getSequenceWarning(ev);
    const totalDays = getDaysBetween(ev.startDate, ev.endDate || ev.startDate);
    const isMultiDay = isEventMultiDay(ev, item.spanCols);

    const isReorderTarget = !isMultiDay && dragOverCard?.eventId === ev.id;
    const reorderPos = isReorderTarget ? dragOverCard.position : null;

    // Condensed Card for Month View: Only Phase Icon & Experiment Name
    if (viewMode === 'month') {
      return (
        <div
          key={`${ev.id}_${item.startCol}_${item.spanCols}`}
          draggable
          onDragStart={(e) =>
            handleDragStart(e, {
              type: 'move',
              projectId: ev.projectId,
              experimentId: ev.experimentId,
              phaseKey: ev.phaseKey,
              eventId: ev.id,
              currentStartDate: ev.startDate,
              currentEndDate: ev.endDate,
              duration: ev.duration,
            })
          }
          onDragEnd={handleDragEnd}
          onClick={() => openModal(ev.experimentId)}
          onDragOver={(e) => {
            if (activeDragItem && activeDragItem.type === 'move') {
              e.preventDefault();
              e.stopPropagation();

              const draggedEventId =
                activeDragItem.eventId ||
                `${activeDragItem.experimentId}_${activeDragItem.phaseKey}`;

              const draggedDays =
                activeDragItem.currentStartDate && activeDragItem.currentEndDate
                  ? getDaysBetween(
                      activeDragItem.currentStartDate,
                      activeDragItem.currentEndDate
                    )
                  : parseDurationDays(activeDragItem.duration);

              // Only single-day cards can be vertically reordered
              if (draggedEventId !== ev.id && !isMultiDay && draggedDays <= 1) {
                const rect = e.currentTarget.getBoundingClientRect();
                const isTop = e.clientY - rect.top < rect.height / 2;
                const position = isTop ? 'above' : 'below';

                if (
                  !dragOverCard ||
                  dragOverCard.eventId !== ev.id ||
                  dragOverCard.position !== position
                ) {
                  setDragOverCard({ eventId: ev.id, position });
                }
              }
              if (dragOverDate !== ev.startDate) {
                setDragOverDate(ev.startDate);
              }
            }
          }}
          onDragLeave={(e) => {
            if (
              e.relatedTarget &&
              e.currentTarget.contains(e.relatedTarget as Node)
            ) {
              return;
            }
            if (dragOverCard?.eventId === ev.id) {
              setDragOverCard(null);
            }
          }}
          onDrop={(e) => {
            if (activeDragItem && activeDragItem.type === 'move') {
              e.preventDefault();
              e.stopPropagation();

              const draggedEventId =
                activeDragItem.eventId ||
                `${activeDragItem.experimentId}_${activeDragItem.phaseKey}`;

              const draggedDays =
                activeDragItem.currentStartDate && activeDragItem.currentEndDate
                  ? getDaysBetween(
                      activeDragItem.currentStartDate,
                      activeDragItem.currentEndDate
                    )
                  : parseDurationDays(activeDragItem.duration);

              // Only reorder if both target and dragged are single-day
              if (draggedEventId !== ev.id && !isMultiDay && draggedDays <= 1) {
                const rect = e.currentTarget.getBoundingClientRect();
                const isTop = e.clientY - rect.top < rect.height / 2;
                const position = isTop ? 'above' : 'below';
                handleCardDrop(ev, position);
              } else {
                handleDayDrop(ev.startDate);
              }
            }
          }}
          style={{
            gridColumn: `${item.startCol + 1} / span ${item.spanCols}`,
            gridRow: item.trackIndex + 1,
          }}
          title={`${ev.experimentName} - ${meta.label}\n${ev.startDate} to ${
            ev.endDate || ev.startDate
          } (${totalDays} day${totalDays > 1 ? 's' : ''})${
            !isMultiDay ? '\nDrag up or down to reorder cards' : '\nLocked to top slot'
          }\nClick to view experiment`}
          className={`group relative h-[22px] min-h-[22px] py-0.5 px-1.5 rounded-md border text-left cursor-grab active:cursor-grabbing transition-all select-none flex items-center gap-1.5 shadow-3xs hover:shadow-xs hover:border-[var(--acc)] pointer-events-auto ${
            meta.colorTheme.bg
          } ${meta.colorTheme.border} ${
            !item.isStart ? 'rounded-l-none border-l-0 border-dashed !ml-0' : 'ml-1'
          } ${
            !item.isEnd ? 'rounded-r-none border-r-0 border-dashed !mr-0' : 'mr-1'
          } ${
            reorderPos ? 'ring-2 ring-[var(--acc)] shadow-md z-30' : ''
          }`}
        >
          {/* Drop Indicator Bar: Above */}
          {reorderPos === 'above' && (
            <div className="absolute -top-1 left-0 right-0 h-1 bg-[var(--acc)] rounded-full z-40 shadow-xs pointer-events-none flex items-center">
              <div className="w-2 h-2 -ml-0.5 rounded-full bg-[var(--acc)] ring-1.5 ring-white dark:ring-gray-900 shadow-xs" />
            </div>
          )}

          {/* Drop Indicator Bar: Below */}
          {reorderPos === 'below' && (
            <div className="absolute -bottom-1 left-0 right-0 h-1 bg-[var(--acc)] rounded-full z-40 shadow-xs pointer-events-none flex items-center">
              <div className="w-2 h-2 -ml-0.5 rounded-full bg-[var(--acc)] ring-1.5 ring-white dark:ring-gray-900 shadow-xs" />
            </div>
          )}
          {/* Left Resize Handle (Only shown on actual start day) */}
          {item.isStart && (
            <div
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                handleDragStart(e, {
                  type: 'resize-left',
                  projectId: ev.projectId,
                  experimentId: ev.experimentId,
                  phaseKey: ev.phaseKey,
                  currentStartDate: ev.startDate,
                  currentEndDate: ev.endDate || ev.startDate,
                });
              }}
              onDragEnd={handleDragEnd}
              title="Drag left to start earlier"
              className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-black/15 dark:bg-white/20 hover:!bg-[var(--acc)] rounded-l transition-opacity z-10 flex items-center justify-center"
            >
              <div className="w-0.5 h-3 bg-white/80 rounded-full" />
            </div>
          )}

          {/* Right Resize Handle (Only shown on actual end day) */}
          {item.isEnd && (
            <div
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                handleDragStart(e, {
                  type: 'resize-right',
                  projectId: ev.projectId,
                  experimentId: ev.experimentId,
                  phaseKey: ev.phaseKey,
                  currentStartDate: ev.startDate,
                  currentEndDate: ev.endDate || ev.startDate,
                });
              }}
              onDragEnd={handleDragEnd}
              title="Drag right to extend duration"
              className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-black/15 dark:bg-white/20 hover:!bg-[var(--acc)] rounded-r transition-opacity z-10 flex items-center justify-center"
            >
              <div className="w-0.5 h-3 bg-white/80 rounded-full" />
            </div>
          )}

          {!item.isStart && (
            <span className="text-[9px] font-bold text-[var(--mut)] shrink-0">
              ‹
            </span>
          )}

          {/* Phase Icon */}
          <span className="shrink-0 flex items-center text-[var(--ink)] opacity-85">
            {getPhaseIcon(ev.phaseKey)}
          </span>

          {/* Experiment Name */}
          <span
            className={`font-semibold text-[11px] leading-tight truncate text-[var(--ink)] flex-1 min-w-0 ${
              ev.completed ? 'line-through opacity-65' : ''
            }`}
          >
            {ev.experimentName}
          </span>

          {!item.isEnd && (
            <span className="text-[9px] font-bold text-[var(--mut)] shrink-0 ml-auto">
              ›
            </span>
          )}
        </div>
      );
    }

    // Rich Dynamic-Height Card for Week View with Drag-to-Reorder Support
    return (
      <div
        key={`${ev.id}_${item.startCol}_${item.spanCols}`}
        draggable
        onDragStart={(e) =>
          handleDragStart(e, {
            type: 'move',
            projectId: ev.projectId,
            experimentId: ev.experimentId,
            phaseKey: ev.phaseKey,
            eventId: ev.id,
            currentStartDate: ev.startDate,
            currentEndDate: ev.endDate,
            duration: ev.duration,
          })
        }
        onDragEnd={handleDragEnd}
        onClick={() => openModal(ev.experimentId)}
        onDragOver={(e) => {
          if (activeDragItem && activeDragItem.type === 'move') {
            e.preventDefault();
            e.stopPropagation();

            const draggedEventId =
              activeDragItem.eventId ||
              `${activeDragItem.experimentId}_${activeDragItem.phaseKey}`;

            const draggedDays =
              activeDragItem.currentStartDate && activeDragItem.currentEndDate
                ? getDaysBetween(
                    activeDragItem.currentStartDate,
                    activeDragItem.currentEndDate
                  )
                : parseDurationDays(activeDragItem.duration);

            // Only single-day cards can be vertically reordered
            if (draggedEventId !== ev.id && !isMultiDay && draggedDays <= 1) {
              const rect = e.currentTarget.getBoundingClientRect();
              const isTop = e.clientY - rect.top < rect.height / 2;
              const position = isTop ? 'above' : 'below';

              if (
                !dragOverCard ||
                dragOverCard.eventId !== ev.id ||
                dragOverCard.position !== position
              ) {
                setDragOverCard({ eventId: ev.id, position });
              }
            }
            if (dragOverDate !== ev.startDate) {
              setDragOverDate(ev.startDate);
            }
          }
        }}
        onDragLeave={(e) => {
          if (
            e.relatedTarget &&
            e.currentTarget.contains(e.relatedTarget as Node)
          ) {
            return;
          }
          if (dragOverCard?.eventId === ev.id) {
            setDragOverCard(null);
          }
        }}
        onDrop={(e) => {
          if (activeDragItem && activeDragItem.type === 'move') {
            e.preventDefault();
            e.stopPropagation();

            const draggedEventId =
              activeDragItem.eventId ||
              `${activeDragItem.experimentId}_${activeDragItem.phaseKey}`;

            const draggedDays =
              activeDragItem.currentStartDate && activeDragItem.currentEndDate
                ? getDaysBetween(
                    activeDragItem.currentStartDate,
                    activeDragItem.currentEndDate
                  )
                : parseDurationDays(activeDragItem.duration);

            // Only call handleCardDrop if both target and dragged are single-day phases
            if (draggedEventId !== ev.id && !isMultiDay && draggedDays <= 1) {
              const rect = e.currentTarget.getBoundingClientRect();
              const isTop = e.clientY - rect.top < rect.height / 2;
              const position = isTop ? 'above' : 'below';
              handleCardDrop(ev, position);
            } else {
              handleDayDrop(ev.startDate);
            }
          }
        }}
        style={{
          gridColumn: `${item.startCol + 1} / span ${item.spanCols}`,
          gridRow: item.trackIndex + 1,
        }}
        title={`${ev.experimentName} - ${meta.label}\n${ev.startDate} to ${
          ev.endDate || ev.startDate
        } (${totalDays} day${totalDays > 1 ? 's' : ''})${
          !isMultiDay ? '\nDrag up or down to reorder cards' : '\nLocked to top slots'
        }\nClick to view experiment`}
        className={`group relative min-w-0 h-auto min-h-[62px] py-2 px-2.5 rounded-xl border text-left cursor-grab active:cursor-grabbing transition-all select-none flex flex-col justify-between gap-1.5 shadow-2xs hover:shadow-md hover:border-[var(--acc)] pointer-events-auto ${
          meta.colorTheme.bg
        } ${meta.colorTheme.border} ${
          !item.isStart ? 'rounded-l-none border-l-0 border-dashed !ml-0' : 'ml-1.5'
        } ${
          !item.isEnd ? 'rounded-r-none border-r-0 border-dashed !mr-0' : 'mr-1.5'
        } ${
          reorderPos ? 'ring-2 ring-[var(--acc)] shadow-md z-30' : ''
        }`}
      >
        {/* Drop Indicator Bar: Above */}
        {reorderPos === 'above' && (
          <div className="absolute -top-1.5 left-0 right-0 h-1 bg-[var(--acc)] rounded-full z-40 shadow-xs pointer-events-none flex items-center">
            <div className="w-2.5 h-2.5 -ml-1 rounded-full bg-[var(--acc)] ring-2 ring-white dark:ring-gray-900 shadow-xs" />
          </div>
        )}

        {/* Drop Indicator Bar: Below */}
        {reorderPos === 'below' && (
          <div className="absolute -bottom-1.5 left-0 right-0 h-1 bg-[var(--acc)] rounded-full z-40 shadow-xs pointer-events-none flex items-center">
            <div className="w-2.5 h-2.5 -ml-1 rounded-full bg-[var(--acc)] ring-2 ring-white dark:ring-gray-900 shadow-xs" />
          </div>
        )}

        {/* Left Resize Handle (Only shown on actual start day) */}
        {item.isStart && (
          <div
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              handleDragStart(e, {
                type: 'resize-left',
                projectId: ev.projectId,
                experimentId: ev.experimentId,
                phaseKey: ev.phaseKey,
                currentStartDate: ev.startDate,
                currentEndDate: ev.endDate || ev.startDate,
              });
            }}
            onDragEnd={handleDragEnd}
            title="Drag left to start earlier"
            className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-black/15 dark:bg-white/20 hover:!bg-[var(--acc)] rounded-l transition-opacity z-10 flex items-center justify-center"
          >
            <div className="w-0.5 h-5 bg-white/80 rounded-full" />
          </div>
        )}

        {/* Right Resize Handle (Only shown on actual end day) */}
        {item.isEnd && (
          <div
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              handleDragStart(e, {
                type: 'resize-right',
                projectId: ev.projectId,
                experimentId: ev.experimentId,
                phaseKey: ev.phaseKey,
                currentStartDate: ev.startDate,
                currentEndDate: ev.endDate || ev.startDate,
              });
            }}
            onDragEnd={handleDragEnd}
            title="Drag right to extend duration"
            className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-black/15 dark:bg-white/20 hover:!bg-[var(--acc)] rounded-r transition-opacity z-10 flex items-center justify-center"
          >
            <div className="w-0.5 h-5 bg-white/80 rounded-full" />
          </div>
        )}

        {/* Top Header Row: Phase Type Badge & Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0 w-full">
          <div className="flex items-center gap-1.5 min-w-0 max-w-full">
            {/* Visual Grip Indicator on hover - only for single-day reorderable cards */}
            {!isMultiDay && (
              <GripVertical
                size={11}
                className="text-[var(--mut)] opacity-0 group-hover:opacity-70 transition-opacity shrink-0 cursor-grab"
              />
            )}

            {!item.isStart && (
              <span className="text-[10px] font-bold text-[var(--mut)] shrink-0">
                ‹
              </span>
            )}

            {/* Phase Type Badge */}
            <span
              className={`inline-flex items-center gap-1.5 min-w-0 text-[10px] font-semibold px-2 py-0.5 rounded-md ${meta.colorTheme.badge} shadow-3xs`}
              title={meta.label}
            >
              <span className="shrink-0">{getPhaseIcon(ev.phaseKey)}</span>
              <span className="truncate">{item.spanCols === 1 ? meta.shortLabel : meta.label}</span>
            </span>
          </div>

          {/* Action Buttons: Mark Complete (Check ✓) & Unschedule (✕) */}
          <div
            className="flex items-center gap-1 shrink-0 ml-auto z-20"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sequence Warning Icon */}
            {warning && (
              <span title={warning} className="shrink-0 p-0.5">
                <AlertTriangle size={12} className="text-amber-500" />
              </span>
            )}

            {/* Mark Completed Button with distinct Check icon and emerald styling */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                updatePhase(ev.projectId, ev.experimentId, ev.phaseKey, {
                  completed: !ev.completed,
                });
              }}
              title={ev.completed ? 'Mark Incomplete' : 'Mark Completed'}
              style={{
                padding: 0,
                width: 22,
                height: 22,
                minWidth: 22,
                minHeight: 22,
              }}
              className={`icon-btn flex items-center justify-center rounded-md transition-all shrink-0 cursor-pointer ${
                ev.completed
                  ? '!bg-emerald-600 !border !border-emerald-600 text-white shadow-2xs font-bold'
                  : '!bg-emerald-500/20 hover:!bg-emerald-500/35 !border !border-emerald-500/50 hover:!border-emerald-500/80 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              <Check
                size={13}
                strokeWidth={ev.completed ? 3.2 : 2.8}
                color={ev.completed ? '#ffffff' : '#10b981'}
                className="shrink-0"
              />
            </button>

            {/* Unschedule Button with distinct X icon and red styling */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                updatePhaseSchedule(
                  ev.projectId,
                  ev.experimentId,
                  ev.phaseKey,
                  '',
                  ''
                );
              }}
              title="Unschedule phase"
              style={{
                padding: 0,
                width: 22,
                height: 22,
                minWidth: 22,
                minHeight: 22,
              }}
              className="icon-btn flex items-center justify-center rounded-md !bg-rose-500/20 hover:!bg-rose-500/35 !border !border-rose-500/50 hover:!border-rose-500/80 text-rose-600 dark:text-rose-400 transition-all shrink-0 cursor-pointer"
            >
              <X
                size={13}
                strokeWidth={2.8}
                color="#ef4444"
                className="shrink-0"
              />
            </button>
          </div>
        </div>

        {/* Middle Section: Full Experiment Title (Wraps naturally, full width, no truncation) */}
        <div className="w-full min-w-0 py-0.5">
          <div
            className={`font-semibold text-xs leading-snug [overflow-wrap:anywhere] whitespace-normal text-[var(--ink)] ${
              ev.completed ? 'line-through opacity-60' : ''
            }`}
          >
            {ev.experimentName}
          </div>
        </div>

        {/* Bottom Footer Row: Duration, Paper Indicator & Date Range */}
        <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 pt-1 border-t border-[var(--line)]/30">
          {/* Duration Badge */}
          <span
            className="inline-flex items-center gap-1 min-w-0 max-w-full text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-black/6 dark:bg-white/10 text-[var(--ink)]"
            title={`Duration: ${totalDays} day${totalDays > 1 ? 's' : ''}`}
          >
            <Clock size={10} className="text-[var(--mut)] shrink-0" />
            <span className="truncate">{totalDays > 1 ? `${totalDays} days` : (ev.duration || '1 day')}</span>
          </span>

          {/* Paper Indicator Badge */}
          {ev.paperColor && (
            <span
              className="inline-flex items-center gap-1 min-w-0 max-w-full text-[10px] font-medium px-1.5 py-0.5 rounded border"
              style={{
                borderColor: `${ev.paperColor}50`,
                backgroundColor: `${ev.paperColor}15`,
                color: 'var(--ink)',
              }}
              title={`Paper: ${ev.paperName || 'Paper'} (${ev.projectName})`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0 shadow-3xs"
                style={{ backgroundColor: ev.paperColor }}
              />
              <FileText size={10} className="shrink-0 text-[var(--mut)]" />
              <span className="font-medium min-w-0 truncate max-w-[110px]">
                {ev.paperName || 'Paper'}
              </span>
            </span>
          )}

          {/* Date Range & Continuation Indicator */}
          <div className="ml-auto flex items-center gap-1 min-w-0 max-w-full text-[9px] font-mono text-[var(--mut)] opacity-80">
            <span className="truncate">
              {ev.startDate === (ev.endDate || ev.startDate)
                ? ev.startDate.slice(5)
                : `${ev.startDate.slice(5)} → ${(ev.endDate || ev.startDate).slice(5)}`}
            </span>
            {!item.isEnd && (
              <span className="text-[10px] font-bold text-[var(--mut)] ml-0.5">
                ›
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      {/* Main Calendar Section */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Calendar Top Bar with Dedicated Calendar Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--line)] bg-[var(--card)]/80 backdrop-blur-xs select-none">
          {/* Left: View Mode Toggle & Navigation */}
          <div className="flex items-center gap-2">
            <div className="flex items-center p-0.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] shadow-2xs">
              <button
                type="button"
                onClick={() => setViewMode('month')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  viewMode === 'month'
                    ? 'bg-[var(--card)] text-[var(--ink)] shadow-xs font-semibold'
                    : 'text-[var(--mut)] hover:text-[var(--ink)]'
                }`}
              >
                Month
              </button>
              <button
                type="button"
                onClick={() => setViewMode('week')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  viewMode === 'week'
                    ? 'bg-[var(--card)] text-[var(--ink)] shadow-xs font-semibold'
                    : 'text-[var(--mut)] hover:text-[var(--ink)]'
                }`}
              >
                Week
              </button>
            </div>

            <div className="flex items-center gap-1 border border-[var(--line)] rounded-lg bg-[var(--bg)] p-0.5">
              <button
                type="button"
                onClick={handlePrev}
                title={viewMode === 'month' ? 'Previous Month' : 'Previous Week'}
                className="p-1 rounded-md hover:bg-[var(--card)] text-[var(--mut)] hover:text-[var(--ink)] cursor-pointer"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={handleToday}
                className="px-2 py-0.5 text-xs font-medium rounded-md hover:bg-[var(--card)] text-[var(--ink)] cursor-pointer"
              >
                Today
              </button>
              <button
                type="button"
                onClick={handleNext}
                title={viewMode === 'month' ? 'Next Month' : 'Next Week'}
                className="p-1 rounded-md hover:bg-[var(--card)] text-[var(--mut)] hover:text-[var(--ink)] cursor-pointer"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="font-semibold text-sm tracking-tight text-[var(--ink)] ml-2">
              {headerDateLabel}
            </div>
          </div>

          {/* Right: Calendar Filters (Phase toggles, Project filter, Search, Backlog toggle) */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Calendar Phase Filters */}
            <div
              className="flex items-center gap-1 shrink-0"
              title="Filter calendar by workflow phase"
            >
              {phaseFilters.map((meta) => {
                const pk = meta.key;
                const isSelected = !hiddenCalPhases.has(pk);
                return (
                  <button
                    key={pk}
                    type="button"
                    onClick={() => toggleCalPhase(pk)}
                    aria-pressed={isSelected}
                    className={`px-2 py-1 text-[11px] rounded-md font-medium border flex items-center gap-1.5 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                      isSelected
                        ? `${meta.colorTheme.bg} ${meta.colorTheme.text} ${meta.colorTheme.border} shadow-2xs font-semibold`
                        : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mut)] opacity-60 hover:opacity-100 hover:bg-[var(--card)]'
                    }`}
                  >
                    {getPhaseIcon(pk)}
                    <span>{meta.shortLabel}</span>
                  </button>
                );
              })}
            </div>

            {/* Calendar Project Filter */}
            <div className="flex items-center gap-1 bg-[var(--bg)] border border-[var(--line)] rounded-lg px-2 py-1 text-xs">
              <Folder size={12} className="text-[var(--mut)]" />
              <select
                value={calProjectId}
                onChange={(e) => setCalProjectId(e.target.value)}
                className="bg-transparent text-[11px] font-medium text-[var(--ink)] outline-hidden cursor-pointer border-none"
              >
                <option value="all">All Projects ({activeProjects.length})</option>
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Calendar Search Box */}
            <div className="flex items-center gap-1 bg-[var(--bg)] border border-[var(--line)] rounded-lg px-2 py-1 text-xs w-36 focus-within:w-44 transition-all">
              <Search size={12} className="text-[var(--mut)] shrink-0" />
              <input
                type="text"
                placeholder="Search calendar..."
                value={calSearchQuery}
                onChange={(e) => setCalSearchQuery(e.target.value)}
                className="bg-transparent text-xs text-[var(--ink)] outline-hidden w-full placeholder:text-[var(--mut)]"
              />
              {calSearchQuery && (
                <button
                  type="button"
                  onClick={() => setCalSearchQuery('')}
                  className="text-[var(--mut)] hover:text-[var(--ink)]"
                >
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Toggle Unscheduled Drawer */}
            <button
              type="button"
              onClick={toggleTrayOpen}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border font-medium transition-all cursor-pointer ${
                isTrayOpen
                  ? 'bg-[var(--sel)] border-[var(--line)] text-[var(--ink)]'
                  : 'bg-[var(--bg)] border-[var(--line)] text-[var(--mut)] hover:text-[var(--ink)]'
              }`}
              title={
                isTrayOpen ? 'Collapse Unscheduled Backlog' : 'Expand Unscheduled Backlog'
              }
            >
              {isTrayOpen ? (
                <PanelRightClose size={14} />
              ) : (
                <PanelRightOpen size={14} />
              )}
              <span className="hidden sm:inline">Backlog</span>
              {totalUnscheduledPhasesCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--acc)] text-white font-mono font-bold">
                  {totalUnscheduledPhasesCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Calendar Body Grid */}
        <div className="flex-1 flex flex-col min-h-0 overflow-auto p-3">
          {viewMode === 'month' ? (
            /* Month View Grid with continuous multi-day spanning cards across rows */
            <div className="flex-1 flex flex-col min-h-0 border border-[var(--line)] rounded-xl bg-[var(--card)] overflow-hidden shadow-xs">
              {/* Day Header (Sunday to Saturday) */}
              <div className="grid grid-cols-7 border-b border-[var(--line)] bg-[var(--bg)] text-xs font-semibold text-[var(--mut)] py-2 select-none">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div key={day} className="text-center tracking-wider">
                    {day}
                  </div>
                ))}
              </div>

              {/* Month Weeks (Each week row has 7 day cells + overlay of continuous event cards) */}
              <div className="flex-1 flex flex-col divide-y divide-[var(--line)] min-h-[550px] overflow-y-auto">
                {monthWeeks.map((week, weekIndex) => {
                  const weekTrackEvents = computeWeekTracks(
                    week,
                    filteredEvents,
                    eventOrder
                  );

                  return (
                    <div
                      key={`week_${weekIndex}`}
                      className="flex-1 flex flex-col relative min-h-[100px] bg-[var(--card)]"
                    >
                      {/* Background Day Cells Layer */}
                      <div className="absolute inset-0 grid grid-cols-7 divide-x divide-[var(--line)] pointer-events-none">
                        {week.map((cell) => {
                          const isDragTarget = dragOverDate === cell.dateStr;
                          return (
                            <div
                              key={cell.dateStr}
                              className={`p-1 flex flex-col justify-between transition-colors ${
                                !cell.isCurrentMonth
                                  ? 'bg-[var(--bg)]/50 opacity-40'
                                  : 'bg-[var(--card)]'
                              } ${
                                isDragTarget
                                  ? '!bg-[var(--acc)]/10 ring-2 ring-inset ring-[var(--acc)]'
                                  : ''
                              }`}
                            >
                              <div className="flex items-center justify-between select-none">
                                <span
                                  className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                                    cell.isToday
                                      ? 'bg-[var(--acc)] text-white font-bold shadow-xs'
                                      : 'text-[var(--ink)]'
                                  }`}
                                >
                                  {cell.date.getDate()}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Drop Targets Layer (Captures drag events for each day column in this week) */}
                      <div className="absolute inset-0 grid grid-cols-7 z-0">
                        {week.map((cell) => (
                          <div
                            key={`drop_${cell.dateStr}`}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (dragOverDate !== cell.dateStr) {
                                setDragOverDate(cell.dateStr);
                              }
                            }}
                            onDragLeave={() => {
                              if (dragOverDate === cell.dateStr) {
                                setDragOverDate(null);
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              handleDayDrop(cell.dateStr);
                            }}
                            className="h-full w-full"
                          />
                        ))}
                      </div>

                      {/* Foreground Event Tracks Layer (Continuous Cards spanning across columns) */}
                      <div className="relative z-10 pt-7 pb-1.5 px-0 grid grid-cols-7 gap-y-1 pointer-events-none auto-rows-max">
                        {weekTrackEvents.map((item) =>
                          renderContinuousEventCard(item)
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Week View Grid (Sunday to Saturday) with Continuous Multi-day Spanning Track */
            <div className="flex-1 flex flex-col min-h-0 border border-[var(--line)] rounded-xl bg-[var(--card)] overflow-hidden shadow-xs">
              {/* Day Header */}
              <div className="grid grid-cols-7 border-b border-[var(--line)] bg-[var(--bg)] select-none">
                {weekDays.map((col) => {
                  const isDayToday = col.isToday;
                  return (
                    <div
                      key={col.dateStr}
                      className={`p-2.5 text-center border-r last:border-r-0 border-[var(--line)] ${
                        isDayToday ? 'bg-[var(--acc)]/5' : ''
                      }`}
                    >
                      <div className="text-xs uppercase tracking-wider text-[var(--mut)] font-semibold">
                        {col.date.toLocaleDateString(undefined, {
                          weekday: 'short',
                        })}
                      </div>
                      <div
                        className={`text-base font-bold mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full ${
                          isDayToday
                            ? 'bg-[var(--acc)] text-white shadow-xs'
                            : 'text-[var(--ink)]'
                        }`}
                      >
                        {col.date.getDate()}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Week View Body: 7 Day Columns with Continuous Multi-day Spanning Blocks */}
              <div className="flex-1 flex flex-col relative min-h-[450px] overflow-y-auto bg-[var(--card)]">
                {/* Background Day Columns Layer (Dividers & Highlight) */}
                <div className="absolute inset-0 grid grid-cols-7 divide-x divide-[var(--line)] pointer-events-none">
                  {weekDays.map((col) => {
                    const isDragTarget = dragOverDate === col.dateStr;
                    return (
                      <div
                        key={`bg_${col.dateStr}`}
                        className={`h-full transition-colors flex flex-col justify-end p-2.5 ${
                          col.isToday ? 'bg-[var(--acc)]/[0.03]' : 'bg-[var(--card)]'
                        } ${
                          isDragTarget
                            ? '!bg-[var(--acc)]/10 ring-2 ring-inset ring-[var(--acc)]'
                            : ''
                        }`}
                      >
                        <div className="text-[10px] text-[var(--mut)] font-mono select-none opacity-40">
                          {col.dateStr.slice(5)}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Drop Targets Layer (Captures drag events for each day column in this week) */}
                <div className="absolute inset-0 grid grid-cols-7 z-0">
                  {weekDays.map((col) => (
                    <div
                      key={`drop_${col.dateStr}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (dragOverDate !== col.dateStr) {
                          setDragOverDate(col.dateStr);
                        }
                      }}
                      onDragLeave={() => {
                        if (dragOverDate === col.dateStr) {
                          setDragOverDate(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleDayDrop(col.dateStr);
                      }}
                      className="h-full w-full"
                    />
                  ))}
                </div>

                {/* Foreground Event Tracks Layer: Continuous Blocks Spanning the Days */}
                <div className="relative z-10 py-3 px-0 grid grid-cols-7 gap-y-2.5 pointer-events-none auto-rows-max">
                  {weekTracks.map((item) => renderContinuousEventCard(item))}
                </div>

                {/* Empty State when no events are scheduled */}
                {weekTracks.length === 0 && (
                  <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-8 text-center pointer-events-none select-none">
                    <div className="w-12 h-12 rounded-2xl bg-[var(--bg)] border border-[var(--line)] flex items-center justify-center text-[var(--mut)] mb-3 shadow-2xs">
                      <FlaskConical size={22} className="opacity-70 text-[var(--acc)]" />
                    </div>
                    <p className="text-sm font-semibold text-[var(--ink)]">
                      No workflows scheduled for this week
                    </p>
                    <p className="text-xs text-[var(--mut)] mt-1 max-w-sm">
                      Drag uncompleted phases from the backlog on the right, or drop onto any day column.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Unscheduled Backlog Drawer (Grouped by Experiment) */}
      {isTrayOpen && (
        <aside
          onDragOver={(e) => {
            e.preventDefault();
            if (!isDragOverTray) setIsDragOverTray(true);
          }}
          onDragLeave={() => setIsDragOverTray(false)}
          onDrop={handleTrayDrop}
          style={{ width: trayWidth }}
          className={`relative shrink-0 border-l border-[var(--line)] bg-[var(--card)]/90 flex flex-col min-h-0 select-none transition-[width] duration-200 ease-out ${
            isResizingTray ? '!transition-none' : ''
          } ${
            isDragOverTray
              ? 'ring-2 ring-inset ring-amber-500 bg-amber-500/10'
              : ''
          }`}
        >
          {/* Invisible Fullscreen Overlay during resizing for zero drag stutter */}
          {isResizingTray && (
            <div className="fixed inset-0 z-50 cursor-col-resize select-none pointer-events-auto" />
          )}

          {/* Left Edge Resize Splitter Handle */}
          <div
            onMouseDown={handleTrayResizeMouseDown}
            title="Drag to resize backlog (Double click to reset)"
            onDoubleClick={() => {
              setTrayWidth(320);
              try {
                localStorage.setItem('lab_calendar_tray_width', '320');
              } catch {}
            }}
            className={`absolute -left-1.5 top-0 bottom-0 w-3 cursor-col-resize z-40 group flex items-center justify-center transition-colors hover:bg-[var(--acc)]/25 ${
              isResizingTray ? '!bg-[var(--acc)]/40' : ''
            }`}
          >
            <div
              className={`w-0.5 h-8 rounded-full bg-[var(--line)] group-hover:bg-[var(--acc)] transition-colors ${
                isResizingTray ? '!bg-[var(--acc)] !h-full' : ''
              }`}
            />
          </div>

          {/* Backlog Header */}
          <div className="p-3 border-b border-[var(--line)] flex items-center justify-between min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <FlaskConical size={15} className="text-[var(--acc)] shrink-0" />
              <span className="font-semibold text-xs tracking-tight truncate">
                Unscheduled Workflows
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--sel)] text-[var(--ink)] font-mono font-bold shrink-0">
                {totalUnscheduledPhasesCount}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {isTrayFiltered && (
                <button
                  type="button"
                  onClick={resetTrayFilters}
                  title="Reset unscheduled backlog filters"
                  className="text-[10px] text-[var(--mut)] hover:text-[var(--ink)] hover:bg-[var(--sel)] px-1.5 py-0.5 rounded border border-[var(--line)] flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <RotateCcw size={10} />
                  <span>Reset</span>
                </button>
              )}
              <button
                type="button"
                onClick={toggleTrayOpen}
                title="Collapse backlog drawer"
                className="p-1 rounded-md text-[var(--mut)] hover:text-[var(--ink)] hover:bg-[var(--sel)] cursor-pointer transition-colors"
              >
                <PanelRightClose size={14} />
              </button>
            </div>
          </div>

          {/* Dedicated Filter Set for Unscheduled Workflows */}
          <div className="p-2.5 border-b border-[var(--line)] bg-[var(--bg)]/40 space-y-2">
            {/* Phase Filter Buttons */}
            <div className="flex items-center gap-1.5 w-full flex-wrap">
              {phaseFilters.map((meta) => {
                const pk = meta.key;
                const isSelected = !hiddenTrayPhases.has(pk);
                return (
                  <button
                    key={pk}
                    type="button"
                    onClick={() => toggleTrayPhase(pk)}
                    aria-pressed={isSelected}
                    title={`Filter unscheduled by ${meta.label}`}
                    className={`flex-1 py-1.5 px-2 text-[11px] rounded-lg font-medium border flex items-center justify-center gap-1 transition-all cursor-pointer min-w-[70px] select-none ${
                      isSelected
                        ? `${meta.colorTheme.bg} ${meta.colorTheme.text} ${meta.colorTheme.border} font-semibold shadow-2xs`
                        : 'border-[var(--line)] bg-[var(--card)] text-[var(--mut)] opacity-60 hover:opacity-100 hover:bg-[var(--bg)]'
                    }`}
                  >
                    {getPhaseIcon(pk)}
                    <span className="truncate">{meta.shortLabel}</span>
                  </button>
                );
              })}
            </div>

            {/* Project Filter for Tray */}
            <div className="flex items-center gap-1 bg-[var(--card)] border border-[var(--line)] rounded-md px-2 py-1 text-xs">
              <Folder size={11} className="text-[var(--mut)] shrink-0" />
              <select
                value={trayProjectId}
                onChange={(e) => setTrayProjectId(e.target.value)}
                className="bg-transparent text-[11px] font-medium text-[var(--ink)] outline-hidden cursor-pointer border-none w-full"
              >
                <option value="all">All Projects ({activeProjects.length})</option>
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Search Input for Tray */}
            <div className="flex items-center gap-1 bg-[var(--card)] border border-[var(--line)] rounded-md px-2 py-1 text-xs">
              <Search size={11} className="text-[var(--mut)] shrink-0" />
              <input
                type="text"
                placeholder="Search unscheduled..."
                value={traySearchQuery}
                onChange={(e) => setTraySearchQuery(e.target.value)}
                className="bg-transparent text-[11px] text-[var(--ink)] outline-hidden w-full placeholder:text-[var(--mut)]"
              />
              {traySearchQuery && (
                <button
                  type="button"
                  onClick={() => setTraySearchQuery('')}
                  className="text-[var(--mut)] hover:text-[var(--ink)]"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          </div>

          <div className="px-3 py-1.5 text-[10px] text-[var(--mut)] bg-[var(--bg)]/20 border-b border-[var(--line)]">
            Drag any phase card onto a calendar day to schedule it.
          </div>

          {/* Unscheduled Experiment Groups List */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
            {unscheduledGroups.length === 0 ? (
              <div className="h-48 flex flex-col items-center justify-center text-center p-4 text-[var(--mut)] text-xs italic">
                {isTrayFiltered
                  ? 'No uncompleted phases match current backlog filters.'
                  : 'All uncompleted phases are scheduled!'}
              </div>
            ) : (
              unscheduledGroups.map((group) => (
                <div
                  key={group.experimentId}
                  className="border border-[var(--line)] rounded-xl bg-[var(--card)] p-2.5 shadow-2xs hover:border-[var(--acc)]/60 transition-all space-y-2"
                >
                  {/* Group Header: Experiment Name & Project / Paper */}
                  <div
                    onClick={() => openModal(group.experimentId)}
                    className="cursor-pointer group/title"
                  >
                    <div className="font-semibold text-xs text-[var(--ink)] group-hover/title:text-[var(--acc)] transition-colors leading-tight truncate">
                      {group.experimentName}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-[var(--mut)]">
                      {group.paperColor && (
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: group.paperColor }}
                        />
                      )}
                      <span className="truncate">{group.projectName}</span>
                    </div>
                  </div>

                  {/* Individual Phases for this Experiment */}
                  <div className="space-y-1.5 pt-1 border-t border-[var(--line)]/50">
                    {group.phases.map((ph) => {
                      const meta = phaseMetadata.get(ph.phaseKey)!;

                      return (
                        <div
                          key={ph.phaseKey}
                          draggable
                          onDragStart={(e) =>
                            handleDragStart(e, {
                              type: 'move',
                              projectId: group.projectId,
                              experimentId: group.experimentId,
                              phaseKey: ph.phaseKey,
                              duration: ph.duration,
                            })
                          }
                          onDragEnd={handleDragEnd}
                          onClick={() => openModal(group.experimentId)}
                          className={`flex items-center justify-between p-1.5 rounded-lg border text-xs cursor-grab active:cursor-grabbing hover:shadow-2xs transition-all select-none ${meta.colorTheme.bg} ${meta.colorTheme.border}`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <GripVertical
                              size={11}
                              className="text-[var(--mut)] opacity-60 shrink-0"
                            />
                            <div className="flex items-center gap-1 font-semibold text-[11px] truncate">
                              {getPhaseIcon(ph.phaseKey)}
                              <span>{meta.shortLabel}</span>
                            </div>
                          </div>

                          {/* Duration Badge on Phase Card */}
                          <div
                            className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-black/5 dark:bg-white/10 shrink-0 text-[var(--ink)]"
                            title="Phase duration"
                          >
                            <Clock size={9} className="text-[var(--mut)]" />
                            <span>{ph.duration || '1 day'}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      )}
    </div>
  );
};

// Date & Duration Helpers
function formatDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function calculateEndDate(startDateStr: string, days: number): string {
  if (days <= 1) return startDateStr;
  const [y, m, d] = startDateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + (days - 1));
  return formatDateIso(date);
}

function getDaysBetween(startStr: string, endStr: string): number {
  if (!startStr || !endStr) return 1;
  const [y1, m1, d1] = startStr.split('-').map(Number);
  const [y2, m2, d2] = endStr.split('-').map(Number);
  const date1 = new Date(y1, m1 - 1, d1);
  const date2 = new Date(y2, m2 - 1, d2);
  const diffTime = date2.getTime() - date1.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(1, diffDays + 1);
}

function formatDurationDays(days: number): string {
  if (days <= 1) return '1 day';
  return `${days} days`;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function isEventMultiDay(
  ev: CalendarEventItem,
  spanCols?: number
): boolean {
  if (spanCols && spanCols > 1) return true;
  const start = ev.startDate;
  const end = ev.endDate || ev.startDate;
  if (start && end && start !== end) {
    if (getDaysBetween(start, end) > 1) return true;
  }
  if (ev.duration && parseDurationDays(ev.duration) > 1) {
    return true;
  }
  return false;
}

// Compute collision-free tracks for a 7-day week row so multi-day events span across columns
function computeWeekTracks(
  weekDays: Array<{ date: Date; dateStr: string }>,
  events: CalendarEventItem[],
  eventOrder: string[] = []
): WeekTrackEvent[] {
  if (!weekDays || weekDays.length < 7) return [];
  const weekStart = weekDays[0].dateStr;
  const weekEnd = weekDays[6].dateStr;

  // Events overlapping with this week
  const active = events.filter((ev) => {
    const end = ev.endDate || ev.startDate;
    return ev.startDate <= weekEnd && end >= weekStart;
  });

  const mapped: WeekTrackEvent[] = active.map((ev) => {
    const end = ev.endDate || ev.startDate;
    let startCol = 0;
    let isStart = false;
    if (ev.startDate >= weekStart) {
      const idx = weekDays.findIndex((d) => d.dateStr === ev.startDate);
      startCol = idx >= 0 ? idx : 0;
      isStart = true;
    }

    let endCol = 6;
    let isEnd = false;
    if (end <= weekEnd) {
      const idx = weekDays.findIndex((d) => d.dateStr === end);
      endCol = idx >= 0 ? idx : 6;
      isEnd = true;
    }

    const spanCols = Math.max(1, endCol - startCol + 1);
    return {
      event: ev,
      startCol,
      endCol,
      spanCols,
      isStart,
      isEnd,
      trackIndex: 0,
    };
  });

  // Create quick rank lookup from custom eventOrder (only applied to single-day phases)
  const orderMap = new Map<string, number>();
  eventOrder.forEach((id, idx) => {
    orderMap.set(id, idx);
  });

  // 1. Multi-day cards are LOCKED to the topmost slots of all day columns they occupy.
  // 2. Multi-day cards are not reorderable (ordered by wider spans, then earlier startCol/date).
  // 3. Only single-day (or less) phases are placed below multi-day cards and can be vertically reordered.
  mapped.sort((a, b) => {
    const isMultiA = isEventMultiDay(a.event, a.spanCols);
    const isMultiB = isEventMultiDay(b.event, b.spanCols);

    // Multi-day cards ALWAYS sort before single-day cards so greedy placement assigns topmost tracks
    if (isMultiA && !isMultiB) return -1;
    if (!isMultiA && isMultiB) return 1;

    // Both are multi-day: wider spans first, then earlier start column, then start date (not reorderable)
    if (isMultiA && isMultiB) {
      if (b.spanCols !== a.spanCols) return b.spanCols - a.spanCols;
      if (a.startCol !== b.startCol) return a.startCol - b.startCol;
      return a.event.startDate.localeCompare(b.event.startDate);
    }

    // Both are single-day or less: editable by dragging (custom user eventOrder)
    const hasA = orderMap.has(a.event.id);
    const hasB = orderMap.has(b.event.id);
    if (hasA && hasB) {
      const rankA = orderMap.get(a.event.id)!;
      const rankB = orderMap.get(b.event.id)!;
      if (rankA !== rankB) return rankA - rankB;
    } else if (hasA && !hasB) {
      return -1;
    } else if (!hasA && hasB) {
      return 1;
    }
    if (b.spanCols !== a.spanCols) return b.spanCols - a.spanCols;
    return a.startCol - b.startCol;
  });

  // Assign trackIndex so events don't collide
  const tracks: boolean[][] = [];

  for (const item of mapped) {
    let t = 0;
    while (true) {
      if (!tracks[t]) {
        tracks[t] = [false, false, false, false, false, false, false];
      }
      let conflict = false;
      for (let col = item.startCol; col <= item.endCol; col++) {
        if (tracks[t][col]) {
          conflict = true;
          break;
        }
      }
      if (!conflict) {
        for (let col = item.startCol; col <= item.endCol; col++) {
          tracks[t][col] = true;
        }
        item.trackIndex = t;
        break;
      }
      t++;
    }
  }

  return mapped;
}

export default CalendarView;
