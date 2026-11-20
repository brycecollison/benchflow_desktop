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

  // 4. Deviations Filter ('yes' = at least one logged deviation)
  const deviationValues: string[] = Array.isArray(filter.deviations) ? filter.deviations : [];
  if (deviationValues.length > 0) {
    const matches = deviationValues.includes(hasDeviations(e) ? 'yes' : 'no');
    if (filter.deviationsNot ? matches : !matches) {
      return false;
    }
  }

  return true;
}

export function hasDeviations(e: Experiment): boolean {
  return Object.values(e.deviations || {}).some((entries) => entries.length > 0);
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

  const layerX: number[] = [];
  let currentLayerX = 20;
  layers.forEach((layer, i) => {
    layerX[i] = currentLayerX;
    currentLayerX += Math.max(MIN_NODE_WIDTH, ...(layer || []).map((e) => nodeWidths[e.id] || MIN_NODE_WIDTH)) + GAP_X;
  });

  const rows = assignRows(visibleExperiments, memo);
  const rowY = (row: number) => row * (NODE_HEIGHT + GAP_Y) + 20;
  const autoPositions: Record<string, NodePosition> = {};
  visibleExperiments.forEach((e) => {
    autoPositions[e.id] = { x: layerX[memo[e.id]], y: rowY(rows[e.id]) };
  });

  const hasCustom = !ignoreCustomPositions && visibleExperiments.some((e) => e.px != null && e.py != null);
  const positions: Record<string, NodePosition> = hasCustom
    ? placeAroundCustom(visibleExperiments, memo, nodeWidths, autoPositions)
    : autoPositions;

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

/**
 * Grid rows per experiment so a dependency chain stays on one horizontal line.
 * A child reuses a parent's row when the straight run to it is free; otherwise it takes the
 * nearest free row below. Cells crossed by a straight run are reserved so no tile sits on a line.
 */
function assignRows(exps: Experiment[], layerOf: Record<string, number>): Record<string, number> {
  const ids = new Set(exps.map((e) => e.id));
  const parentsOf = (e: Experiment) => [...new Set(e.deps)].filter((d) => ids.has(d));
  const children = new Map<string, Experiment[]>();
  exps.forEach((e) => parentsOf(e).forEach((d) => {
    if (!children.has(d)) children.set(d, []);
    children.get(d)!.push(e);
  }));

  const rowOf: Record<string, number> = {};
  const taken = new Set<string>();
  const free = (row: number, from: number, to: number) => {
    for (let l = from; l <= to; l++) if (taken.has(`${l}:${row}`)) return false;
    return true;
  };
  let nextRow = 0;

  const place = (e: Experiment) => {
    const layer = layerOf[e.id];
    const parents = parentsOf(e).filter((d) => rowOf[d] != null).sort((a, b) => rowOf[a] - rowOf[b]);
    let row: number | undefined;
    let from = layer;
    for (const p of parents) {
      if (layerOf[p] < layer && free(rowOf[p], layerOf[p] + 1, layer)) {
        row = rowOf[p];
        from = layerOf[p] + 1;
        break;
      }
    }
    if (row == null) {
      if (parents.length) {
        from = Math.min(layer, ...parents.map((p) => layerOf[p] + 1));
        row = rowOf[parents[0]];
        while (!free(row, from, layer)) row++;
      } else {
        row = nextRow;
      }
    }
    for (let l = from; l <= layer; l++) taken.add(`${l}:${row}`);
    rowOf[e.id] = row;
    nextRow = Math.max(nextRow, row + 1);
    for (const child of children.get(e.id) || []) {
      if (rowOf[child.id] == null && parentsOf(child).every((d) => rowOf[d] != null)) place(child);
    }
  };

  exps.forEach((e) => { if (!parentsOf(e).length && rowOf[e.id] == null) place(e); });
  // Anything left is part of a dependency cycle; give it its own row.
  exps.forEach((e) => { if (rowOf[e.id] == null) place(e); });
  return rowOf;
}

/**
 * Keeps hand-placed tiles where they are and puts unplaced ones level with a parent when
 * that spot is empty, otherwise at the nearest empty spot below.
 */
/**
 * Positions to save when a tile is dragged: the tile itself, plus the tiles below it in its old
 * column moved up into the space it left. Nothing else moves if it stayed in its own slot.
 */
export function moveWithColumnCollapse(
  id: string,
  to: NodePosition,
  positions: Record<string, NodePosition>,
  widths: Record<string, number>
): Record<string, NodePosition> {
  const moves: Record<string, NodePosition> = { [id]: to };
  const from = positions[id];
  if (!from) return moves;
  const w = (n: string) => widths[n] || MIN_NODE_WIDTH;
  const leftSlot = Math.abs(to.x - from.x) >= w(id) || Math.abs(to.y - from.y) >= NODE_HEIGHT;
  if (!leftSlot) return moves;

  const below = Object.entries(positions).filter(([other, p]) =>
    other !== id && p.x < from.x + w(id) && from.x < p.x + w(other) && p.y >= from.y + NODE_HEIGHT
  );
  if (!below.length) return moves;
  // Close exactly the slot that was left, never more than one tile's worth.
  const shift = Math.min(Math.min(...below.map(([, p]) => p.y)) - from.y, NODE_HEIGHT + GAP_Y);
  below.forEach(([other, p]) => { moves[other] = { x: p.x, y: p.y - shift }; });
  return moves;
}

function placeAroundCustom(
  exps: Experiment[],
  layerOf: Record<string, number>,
  widths: Record<string, number>,
  auto: Record<string, NodePosition>
): Record<string, NodePosition> {
  const positions: Record<string, NodePosition> = {};
  exps.forEach((e) => {
    if (e.px != null && e.py != null) positions[e.id] = { x: e.px, y: e.py };
  });
  const overlaps = (id: string, p: NodePosition) => Object.entries(positions).some(([other, q]) =>
    p.x < q.x + (widths[other] || MIN_NODE_WIDTH) + GAP_X / 2 &&
    q.x < p.x + (widths[id] || MIN_NODE_WIDTH) + GAP_X / 2 &&
    p.y < q.y + NODE_HEIGHT + GAP_Y &&
    q.y < p.y + NODE_HEIGHT + GAP_Y
  );

  [...exps]
    .filter((e) => !positions[e.id])
    .sort((a, b) => layerOf[a.id] - layerOf[b.id])
    .forEach((e) => {
      const parents = e.deps.map((d) => ({ id: d, pos: positions[d] })).filter((p) => p.pos);
      const x = parents.length
        ? Math.max(...parents.map((p) => p.pos.x + (widths[p.id] || MIN_NODE_WIDTH))) + GAP_X
        : auto[e.id].x;
      const parentsAtAuto = parents.every((p) => p.pos.x === auto[p.id].x && p.pos.y === auto[p.id].y);
      const candidates = [
        ...(parentsAtAuto ? [auto[e.id]] : []),
        ...parents.map((p) => ({ x, y: p.pos.y })),
        parents.length ? { x, y: auto[e.id].y } : auto[e.id],
      ];
      let spot = candidates.find((c) => !overlaps(e.id, c));
      if (!spot) {
        spot = { ...candidates[0] };
        while (overlaps(e.id, spot)) spot.y += NODE_HEIGHT + GAP_Y;
      }
      positions[e.id] = spot;
    });
  return positions;
}
