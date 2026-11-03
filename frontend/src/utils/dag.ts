import type { Project, Experiment, FilterState, NodePosition } from '../types/lab';

export const MIN_NODE_WIDTH = 200;
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 74;
export const GAP_X = 80;
export const GAP_Y = 26;

let measureCanvas: HTMLCanvasElement | null = null;

export function measureTextWidth(
  text: string,
  font = '600 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
): number {
  if (typeof document === 'undefined') {
    return text.length * 8.2;
  }
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas');
  }
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return text.length * 8.2;
  ctx.font = font;
  return ctx.measureText(text).width;
}

export interface NodeWidthOptions {
  canvasWidth?: number;
  isMini?: boolean;
  maxAllowedWidth?: number;
}

/**
 * Calculates dynamic node width based on experiment name length.
 * When `isMini: true` (e.g. in All Projects view), nodes expand wide enough to read their full titles
 * without truncation.
 */
export function calculateNodeWidth(
  name: string,
  canvasWidthOrOptions: number | NodeWidthOptions = 1200
): number {
  const isOptions = typeof canvasWidthOrOptions === 'object' && canvasWidthOrOptions !== null;
  const canvasWidth = isOptions ? canvasWidthOrOptions.canvasWidth ?? 1200 : canvasWidthOrOptions;
  const isMini = isOptions ? Boolean(canvasWidthOrOptions.isMini) : false;

  const textWidth = measureTextWidth(name);

  if (isMini) {
    // For mini flowcharts in All Projects view:
    // Ensure nodes are wide enough to read their titles completely without truncation.
    // Chrome: 4px border-left + 8px padding-left + 8px padding-right + 1px border-right = 21px
    // Buffer: 19px safety buffer for font metrics and subpixel rounding (total +40px)
    const neededWidth = Math.ceil(textWidth + 40);
    const maxAllowed =
      isOptions && canvasWidthOrOptions.maxAllowedWidth != null
        ? canvasWidthOrOptions.maxAllowedWidth
        : 1200;
    return Math.min(maxAllowed, Math.max(MIN_NODE_WIDTH, neededWidth));
  }

  const maxAllowedWidth =
    isOptions && canvasWidthOrOptions.maxAllowedWidth != null
      ? canvasWidthOrOptions.maxAllowedWidth
      : Math.max(MIN_NODE_WIDTH, Math.floor(canvasWidth * 0.25));
  // Overhead: 4px border-l + 8px pl + 8px pr + 24px pencil button space + 14px safety buffer
  const neededWidth = Math.ceil(textWidth + 58);
  return Math.min(maxAllowedWidth, Math.max(MIN_NODE_WIDTH, neededWidth));
}

export function depth(
  project: { exps: Experiment[] },
  e: Experiment,
  memo: Record<string, number> = {}
): number {
  if (memo[e.id] != null) return memo[e.id];
  memo[e.id] = 0;
  const ds = e.deps
    .map((d) => project.exps.find((x) => x.id === d))
    .filter((x): x is Experiment => Boolean(x));
  const val = ds.length ? 1 + Math.max(...ds.map((d) => depth(project, d, memo))) : 0;
  memo[e.id] = val;
  return val;
}

export function getDescendants(
  project: { exps: Experiment[] },
  id: string,
  set = new Set<string>()
): Set<string> {
  project.exps
    .filter((x) => x.deps.includes(id))
    .forEach((x) => {
      if (!set.has(x.id)) {
        set.add(x.id);
        getDescendants(project, x.id, set);
      }
    });
  return set;
}

export function wouldCreateCycle(
  project: { exps: Experiment[] },
  sourceId: string,
  targetId: string
): boolean {
  if (sourceId === targetId) return true;
  // If target is already an ancestor of source, then adding source -> target creates a cycle
  return getDescendants(project, targetId).has(sourceId);
}

export function matchesFilter(e: Experiment, filter: Partial<FilterState> | any): boolean {
  if (!filter) return true;

  // 1. Status Filter
  const statusValues: string[] = Array.isArray(filter.status)
    ? filter.status
    : typeof filter.status === 'string' && filter.status
    ? [filter.status]
    : [];

  if (statusValues.length > 0) {
    const matches = statusValues.includes(e.status);
    if (filter.statusNot ? matches : !matches) {
      return false;
    }
  }

  // 2. Priority Filter
  const priorityValues: string[] = Array.isArray(filter.priority)
    ? filter.priority
    : typeof filter.priority === 'string' && filter.priority
    ? [filter.priority]
    : [];

  if (priorityValues.length > 0) {
    const expPriority = e.priority || '';
    const matches =
      priorityValues.includes(expPriority) ||
      (expPriority === '' &&
        (priorityValues.includes('-') ||
          priorityValues.includes('none') ||
          priorityValues.includes('None')));
    if (filter.priorityNot ? matches : !matches) {
      return false;
    }
  }

  // 3. Paper Filter
  const paperValues: string[] = Array.isArray(filter.paper)
    ? filter.paper
    : typeof filter.paper === 'string' && filter.paper
    ? [filter.paper]
    : [];

  if (paperValues.length > 0) {
    const expPaper = e.paper || '';
    const matches =
      paperValues.includes(expPaper) ||
      (expPaper === '' &&
        (paperValues.includes('-') ||
          paperValues.includes('none') ||
          paperValues.includes('None')));
    if (filter.paperNot ? matches : !matches) {
      return false;
    }
  }

  return true;
}

export interface LayoutOptions {
  canvasWidth?: number;
  isMini?: boolean;
  ignoreCustomPositions?: boolean;
  maxAllowedWidth?: number;
}

export interface LayoutResult {
  positions: Record<string, NodePosition>;
  nodeWidths: Record<string, number>;
  width: number;
  height: number;
  visibleExperiments: Experiment[];
}

export function calculateLayout(
  project: Project,
  filter: FilterState,
  optionsOrWidth: number | LayoutOptions = 1200
): LayoutResult {
  const isOptions = typeof optionsOrWidth === 'object' && optionsOrWidth !== null;
  const canvasWidth = isOptions ? optionsOrWidth.canvasWidth ?? 1200 : optionsOrWidth;
  const isMini = isOptions ? Boolean(optionsOrWidth.isMini) : false;
  const ignoreCustomPositions = isOptions ? Boolean(optionsOrWidth.ignoreCustomPositions) : false;
  const maxAllowedWidth = isOptions ? optionsOrWidth.maxAllowedWidth : undefined;

  const visibleExperiments = project.exps.filter((e) => matchesFilter(e, filter));
  if (!visibleExperiments.length) {
    return { positions: {}, nodeWidths: {}, width: 0, height: 0, visibleExperiments: [] };
  }

  const memo: Record<string, number> = {};
  const layers: Experiment[][] = [];

  visibleExperiments.forEach((e) => {
    const d = depth({ exps: visibleExperiments }, e, memo);
    if (!layers[d]) layers[d] = [];
    layers[d].push(e);
  });

  const nodeWidths: Record<string, number> = {};
  visibleExperiments.forEach((e) => {
    nodeWidths[e.id] = calculateNodeWidth(e.name, {
      canvasWidth,
      isMini,
      maxAllowedWidth,
    });
  });

  const positions: Record<string, NodePosition> = {};
  let currentLayerX = 20;

  layers.forEach((layer) => {
    let maxLayerWidth = MIN_NODE_WIDTH;
    (layer || []).forEach((e, idxInLayer) => {
      const w = nodeWidths[e.id] || MIN_NODE_WIDTH;
      if (w > maxLayerWidth) maxLayerWidth = w;
      positions[e.id] = {
        x: (!ignoreCustomPositions && e.px != null) ? e.px : currentLayerX,
        y: (!ignoreCustomPositions && e.py != null) ? e.py : idxInLayer * (NODE_HEIGHT + GAP_Y) + 20,
      };
    });
    currentLayerX += maxLayerWidth + GAP_X;
  });

  let maxRightEdge = 0;
  let maxY = 0;
  visibleExperiments.forEach((e) => {
    const pos = positions[e.id];
    if (pos) {
      const w = nodeWidths[e.id] || MIN_NODE_WIDTH;
      if (pos.x + w > maxRightEdge) maxRightEdge = pos.x + w;
      if (pos.y > maxY) maxY = pos.y;
    }
  });

  return {
    positions,
    nodeWidths,
    width: maxRightEdge + 60,
    height: maxY + NODE_HEIGHT + 60,
    visibleExperiments,
  };
}
