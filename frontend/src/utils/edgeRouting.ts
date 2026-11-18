import type { NodePosition } from '../types/lab';
import { NODE_HEIGHT, NODE_WIDTH } from './dag';

export interface EdgeInput {
  source: string;
  target: string;
}

export interface RoutedEdge {
  source: string;
  target: string;
  pathData: string;
  arrowData: string;
  sourcePoint: { x: number; y: number };
  targetPoint: { x: number; y: number };
}

interface NodeBox {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Creates an SVG path string from an array of waypoints with filleted, rounded corners.
 */
function createRoundedPath(points: Point[], radius = 14): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  // Remove duplicate adjacent points
  const cleanPts: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = cleanPts[cleanPts.length - 1];
    if (Math.abs(points[i].x - prev.x) > 0.5 || Math.abs(points[i].y - prev.y) > 0.5) {
      cleanPts.push(points[i]);
    }
  }

  if (cleanPts.length < 3) {
    return `M ${cleanPts[0].x} ${cleanPts[0].y} L ${cleanPts[cleanPts.length - 1].x} ${cleanPts[cleanPts.length - 1].y}`;
  }

  let d = `M ${cleanPts[0].x} ${cleanPts[0].y}`;

  for (let i = 1; i < cleanPts.length - 1; i++) {
    const pPrev = cleanPts[i - 1];
    const pCurr = cleanPts[i];
    const pNext = cleanPts[i + 1];

    const d1x = pCurr.x - pPrev.x;
    const d1y = pCurr.y - pPrev.y;
    const len1 = Math.hypot(d1x, d1y);

    const d2x = pNext.x - pCurr.x;
    const d2y = pNext.y - pCurr.y;
    const len2 = Math.hypot(d2x, d2y);

    const r = Math.min(radius, len1 / 2, len2 / 2);

    if (r < 1 || len1 < 1 || len2 < 1) {
      d += ` L ${pCurr.x} ${pCurr.y}`;
      continue;
    }

    const startX = pCurr.x - (d1x / len1) * r;
    const startY = pCurr.y - (d1y / len1) * r;

    const endX = pCurr.x + (d2x / len2) * r;
    const endY = pCurr.y + (d2y / len2) * r;

    d += ` L ${startX.toFixed(1)} ${startY.toFixed(1)}`;
    d += ` Q ${pCurr.x.toFixed(1)} ${pCurr.y.toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}`;
  }

  const last = cleanPts[cleanPts.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;

  return d;
}

/**
 * Checks if a direct horizontal corridor between source and target
 * is obstructed by any intermediate node situated in the space between the columns.
 */
function isPathObstructed(
  sBox: NodeBox,
  tBox: NodeBox,
  sPoint: Point,
  tPoint: Point,
  allNodes: NodeBox[]
): boolean {
  // If target is behind or doesn't have enough forward horizontal gap to make a clean S-curve
  if (tPoint.x <= sPoint.x + 36) {
    return true;
  }

  // The horizontal space strictly between the source right edge and target left edge
  const corridorLeft = sBox.right + 8;
  const corridorRight = tBox.left - 8;

  if (corridorLeft >= corridorRight) {
    // Target partially overlaps horizontally with source column
    return true;
  }

  const corridorTop = Math.min(sPoint.y, tPoint.y) - 8;
  const corridorBottom = Math.max(sPoint.y, tPoint.y) + 8;

  for (const obs of allNodes) {
    if (obs.id === sBox.id || obs.id === tBox.id) continue;

    // Check if intermediate obstacle sits in the horizontal gap between the columns
    const xOverlap = Math.max(corridorLeft, obs.left) < Math.min(corridorRight, obs.right);
    const yOverlap = Math.max(corridorTop, obs.top) < Math.min(corridorBottom, obs.bottom);

    if (xOverlap && yOverlap) {
      return true;
    }
  }

  return false;
}

/**
 * Computes obstacle-avoiding, non-crossing edge paths for all flowchart connectors.
 */
export function calculateRoutedEdges(
  edges: EdgeInput[],
  positions: Record<string, NodePosition>,
  nodeWidths: Record<string, number>
): RoutedEdge[] {
  if (!edges.length) return [];

  // Build node bounding boxes
  const nodeBoxes: Record<string, NodeBox> = {};
  for (const [id, pos] of Object.entries(positions)) {
    if (!pos) continue;
    const width = nodeWidths[id] || NODE_WIDTH;
    nodeBoxes[id] = {
      id,
      left: pos.x,
      right: pos.x + width,
      top: pos.y,
      bottom: pos.y + NODE_HEIGHT,
    };
  }

  // 1. Calculate Distributed Ports to eliminate crossings at node boundaries
  const outgoingMap = new Map<string, EdgeInput[]>();
  const incomingMap = new Map<string, EdgeInput[]>();

  for (const edge of edges) {
    if (!positions[edge.source] || !positions[edge.target]) continue;
    if (!outgoingMap.has(edge.source)) outgoingMap.set(edge.source, []);
    outgoingMap.get(edge.source)!.push(edge);

    if (!incomingMap.has(edge.target)) incomingMap.set(edge.target, []);
    incomingMap.get(edge.target)!.push(edge);
  }

  // Assign source departure points sorted by target Y
  const sourcePortMap = new Map<string, Point>();
  outgoingMap.forEach((outEdges, sourceId) => {
    const sPos = positions[sourceId];
    const sWidth = nodeWidths[sourceId] || NODE_WIDTH;
    const sX = sPos.x + sWidth;

    const sorted = [...outEdges].sort((a, b) => {
      const aY = positions[a.target]?.y ?? 0;
      const bY = positions[b.target]?.y ?? 0;
      return aY - bY;
    });

    const count = sorted.length;
    sorted.forEach((edge, idx) => {
      const key = `${edge.source}->${edge.target}`;
      const fraction = (idx + 1) / (count + 1);
      const sY = sPos.y + NODE_HEIGHT * fraction;
      sourcePortMap.set(key, { x: sX, y: sY });
    });
  });

  // Assign target arrival points sorted by source Y
  const targetPortMap = new Map<string, Point>();
  incomingMap.forEach((inEdges, targetId) => {
    const tPos = positions[targetId];
    const tX = tPos.x;

    const sorted = [...inEdges].sort((a, b) => {
      const aY = positions[a.source]?.y ?? 0;
      const bY = positions[b.source]?.y ?? 0;
      return aY - bY;
    });

    const count = sorted.length;
    sorted.forEach((edge, idx) => {
      const key = `${edge.source}->${edge.target}`;
      const fraction = (idx + 1) / (count + 1);
      const tY = tPos.y + NODE_HEIGHT * fraction;
      targetPortMap.set(key, { x: tX, y: tY });
    });
  });

  const allNodesList = Object.values(nodeBoxes);
  const CLEAR = 6;

  // True when an axis-aligned segment stays clear of every tile except the edge's own two.
  const segmentClear = (a: Point, b: Point, skip: EdgeInput) =>
    !allNodesList.some(
      (box) =>
        box.id !== skip.source &&
        box.id !== skip.target &&
        Math.max(Math.min(a.x, b.x), box.left - CLEAR) <= Math.min(Math.max(a.x, b.x), box.right + CLEAR) &&
        Math.max(Math.min(a.y, b.y), box.top - CLEAR) <= Math.min(Math.max(a.y, b.y), box.bottom + CLEAR)
    );
  const pathClear = (pts: Point[], edge: EdgeInput) =>
    pts.every((pt, i) => i === 0 || segmentClear(pts[i - 1], pt, edge));

  // Slide a vertical run at x sideways (dir +1 right, -1 left) until it clears every tile between y1 and y2.
  const clearX = (x: number, y1: number, y2: number, dir: 1 | -1, edge: EdgeInput) => {
    for (let i = 0; i < 50 && !segmentClear({ x, y: y1 }, { x, y: y2 }, edge); i++) {
      const blocker = allNodesList.find(
        (box) =>
          box.id !== edge.source &&
          box.id !== edge.target &&
          x > box.left - CLEAR && x < box.right + CLEAR &&
          Math.max(Math.min(y1, y2), box.top - CLEAR) < Math.min(Math.max(y1, y2), box.bottom + CLEAR)
      );
      if (!blocker) break;
      x = dir > 0 ? blocker.right + 18 : blocker.left - 18;
    }
    return x;
  };

  // 2. Separate edges that can use a direct S-curve from those that must route around tiles
  interface PlannedBypass {
    edge: EdgeInput;
    sourcePoint: Point;
    targetPoint: Point;
    exitOffset: number;
    entryOffset: number;
  }

  const directEdges: { edge: EdgeInput; sourcePoint: Point; targetPoint: Point }[] = [];
  const bypassEdges: PlannedBypass[] = [];

  for (const edge of edges) {
    const key = `${edge.source}->${edge.target}`;
    const sPoint = sourcePortMap.get(key);
    const tPoint = targetPortMap.get(key);
    const sBox = nodeBoxes[edge.source];
    const tBox = nodeBoxes[edge.target];
    if (!sPoint || !tPoint || !sBox || !tBox) continue;

    if (!isPathObstructed(sBox, tBox, sPoint, tPoint, allNodesList)) {
      directEdges.push({ edge, sourcePoint: sPoint, targetPoint: tPoint });
    } else {
      bypassEdges.push({ edge, sourcePoint: sPoint, targetPoint: tPoint, exitOffset: 18, entryOffset: 18 });
    }
  }

  // 3. Lane offsets so parallel vertical runs at one tile do not sit on top of each other.
  // Entering from below, higher ports turn in further left; entering from above, the reverse.
  const byTarget = new Map<string, PlannedBypass[]>();
  const bySource = new Map<string, PlannedBypass[]>();
  for (const b of bypassEdges) {
    if (!byTarget.has(b.edge.target)) byTarget.set(b.edge.target, []);
    byTarget.get(b.edge.target)!.push(b);
    if (!bySource.has(b.edge.source)) bySource.set(b.edge.source, []);
    bySource.get(b.edge.source)!.push(b);
  }
  byTarget.forEach((group) => {
    const below = group.filter((b) => b.sourcePoint.y > b.targetPoint.y).sort((a, b) => a.targetPoint.y - b.targetPoint.y);
    const above = group.filter((b) => b.sourcePoint.y <= b.targetPoint.y).sort((a, b) => a.targetPoint.y - b.targetPoint.y);
    below.forEach((b, i) => { b.entryOffset = 18 + (below.length - 1 - i) * 14; });
    above.forEach((b, i) => { b.entryOffset = 18 + i * 14; });
  });
  bySource.forEach((group) => {
    group.sort((a, b) => a.targetPoint.y - b.targetPoint.y).forEach((b, i) => { b.exitOffset = 18 + i * 8; });
  });

  // 4. Pick the simplest clear route: one bend near the target, one bend near the source,
  // and only then a detour above or below everything in between.
  const routedResult: RoutedEdge[] = [];
  const arrowFor = (t: Point) =>
    `M ${t.x - 7} ${t.y - 4.5} L ${t.x} ${t.y} L ${t.x - 7} ${t.y + 4.5}`;

  for (const item of directEdges) {
    const { edge, sourcePoint, targetPoint } = item;
    const dx = targetPoint.x - sourcePoint.x;
    const cpDist = Math.min(dx * 0.5, Math.max(24, dx * 0.45));
    const cp1x = sourcePoint.x + cpDist;
    const cp2x = targetPoint.x - cpDist;

    routedResult.push({
      source: edge.source,
      target: edge.target,
      pathData: `M ${sourcePoint.x} ${sourcePoint.y} C ${cp1x.toFixed(1)} ${sourcePoint.y} ${cp2x.toFixed(1)} ${targetPoint.y} ${targetPoint.x} ${targetPoint.y}`,
      arrowData: arrowFor(targetPoint),
      sourcePoint,
      targetPoint,
    });
  }

  let topLanes = 0;
  let bottomLanes = 0;
  for (const item of bypassEdges) {
    const { edge, sourcePoint: s, targetPoint: t } = item;
    const oneBend = (x: number): Point[] => [s, { x, y: s.y }, { x, y: t.y }, t];
    const entryX = clearX(t.x - item.entryOffset, s.y, t.y, -1, edge);
    const exitX = clearX(s.x + item.exitOffset, s.y, t.y, 1, edge);

    let waypoints: Point[] | undefined = [entryX, exitX]
      .filter((x) => x > s.x + 8 && x < t.x - 8)
      .map(oneBend)
      .find((pts) => pathClear(pts, edge));

    if (!waypoints) {
      // Detour through the gutter above or below every tile spanned by the edge.
      const xMin = Math.min(s.x, t.x) - 60;
      const xMax = Math.max(s.x, t.x) + 60;
      const spanned = allNodesList.filter((b) => Math.max(xMin, b.left) < Math.min(xMax, b.right));
      const top = Math.min(...spanned.map((b) => b.top));
      const bottom = Math.max(...spanned.map((b) => b.bottom));
      const avgY = (s.y + t.y) / 2;
      const goTop = top - 18 - topLanes * 16 >= 2 && avgY - top < bottom - avgY;
      const gutterY = goTop ? top - 18 - topLanes++ * 16 : bottom + 18 + bottomLanes++ * 16;
      const outX = clearX(s.x + item.exitOffset, s.y, gutterY, 1, edge);
      const inX = clearX(t.x - item.entryOffset, gutterY, t.y, -1, edge);
      waypoints = [s, { x: outX, y: s.y }, { x: outX, y: gutterY }, { x: inX, y: gutterY }, { x: inX, y: t.y }, t];
    }

    routedResult.push({
      source: edge.source,
      target: edge.target,
      pathData: createRoundedPath(waypoints, 14),
      arrowData: arrowFor(t),
      sourcePoint: s,
      targetPoint: t,
    });
  }

  return routedResult;
}
