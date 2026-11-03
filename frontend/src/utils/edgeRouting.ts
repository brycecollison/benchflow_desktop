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

    // Sibling nodes in the source column or target column do not block the open space between columns
    const isSameColumnAsSource = Math.abs(obs.left - sBox.left) < 50;
    const isSameColumnAsTarget = Math.abs(obs.left - tBox.left) < 50;
    if (isSameColumnAsSource || isSameColumnAsTarget) {
      continue;
    }

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

  // 2. Identify which edges need bypass routing around obstacles
  interface PlannedBypass {
    edge: EdgeInput;
    sourcePoint: Point;
    targetPoint: Point;
    direction: 'top' | 'bottom';
    minObsTop: number;
    maxObsBottom: number;
    gutterY?: number;
    entryX?: number;
    exitX?: number;
    isSourceLevelClear?: boolean;
  }

  const directEdges: { edge: EdgeInput; sourcePoint: Point; targetPoint: Point }[] = [];
  const bypassEdges: PlannedBypass[] = [];

  const allNodesList = Object.values(nodeBoxes);

  for (const edge of edges) {
    const key = `${edge.source}->${edge.target}`;
    const sPoint = sourcePortMap.get(key);
    const tPoint = targetPortMap.get(key);
    if (!sPoint || !tPoint) continue;

    const sBox = nodeBoxes[edge.source];
    const tBox = nodeBoxes[edge.target];
    if (!sBox || !tBox) continue;

    const isForward = tPoint.x > sPoint.x + 36;
    const hasObstacle =
      !isForward || isPathObstructed(sBox, tBox, sPoint, tPoint, allNodesList);

    if (!hasObstacle && isForward) {
      directEdges.push({ edge, sourcePoint: sPoint, targetPoint: tPoint });
    } else {
      // Find obstacle bounding box extents strictly in intermediate space between source and target
      const xMin = Math.min(sPoint.x, tPoint.x);
      const xMax = Math.max(sPoint.x, tPoint.x);
      const relevantObstacles = allNodesList.filter(
        (b) =>
          b.id !== edge.source &&
          b.id !== edge.target &&
          Math.max(xMin, b.left) < Math.min(xMax, b.right)
      );

      const minObsTop = Math.min(
        sBox.top,
        tBox.top,
        ...relevantObstacles.map((b) => b.top)
      );
      const maxObsBottom = Math.max(
        sBox.bottom,
        tBox.bottom,
        ...relevantObstacles.map((b) => b.bottom)
      );

      // Check if the horizontal run at sourcePoint.y is forward and clear of intermediate obstacles
      const isSourceYClear =
        isForward &&
        !relevantObstacles.some(
          (obs) =>
            sPoint.y >= obs.top - 8 &&
            sPoint.y <= obs.bottom + 8
        );

      const avgY = (sPoint.y + tPoint.y) / 2;
      const midObs = (minObsTop + maxObsBottom) / 2;
      const direction: 'top' | 'bottom' =
        minObsTop > 60 && avgY < midObs ? 'top' : 'bottom';

      bypassEdges.push({
        edge,
        sourcePoint: sPoint,
        targetPoint: tPoint,
        direction,
        minObsTop,
        maxObsBottom,
        isSourceLevelClear: isSourceYClear,
      });
    }
  }

  // 3. Assign horizontal gutter Y coordinates (lanes) for edges that need bypass
  const bottomBypasses = bypassEdges.filter((b) => b.direction === 'bottom');
  const topBypasses = bypassEdges.filter((b) => b.direction === 'top');

  // For bottom bypasses:
  // If the run at sourcePoint.y is clear, keep it at sourcePoint.y to avoid unnecessary vertical drop!
  bottomBypasses.sort((a, b) => a.sourcePoint.y - b.sourcePoint.y);
  bottomBypasses.forEach((item, laneIdx) => {
    if (item.isSourceLevelClear) {
      // Clear horizontally: run straight at sourcePoint.y, no vertical dip!
      item.gutterY = item.sourcePoint.y;
    } else {
      // Blocked: route into bottom gutter
      item.gutterY = item.maxObsBottom + 18 + laneIdx * 16;
    }
  });

  // For top bypasses:
  topBypasses.sort((a, b) => b.sourcePoint.y - a.sourcePoint.y);
  topBypasses.forEach((item, laneIdx) => {
    if (item.isSourceLevelClear) {
      item.gutterY = item.sourcePoint.y;
    } else {
      item.gutterY = Math.max(12, item.minObsTop - 18 - laneIdx * 16);
    }
  });

  // 4. Assign vertical entry X coordinates per target node for bypasses
  // This guarantees that on vertical runs:
  // - When approaching from below: middle connection stays to the LEFT of lower connection!
  // - When approaching from above: upper connection stays to the RIGHT of lower connection!
  const targetBypassGroups = new Map<string, PlannedBypass[]>();
  bypassEdges.forEach((b) => {
    if (!targetBypassGroups.has(b.edge.target)) {
      targetBypassGroups.set(b.edge.target, []);
    }
    targetBypassGroups.get(b.edge.target)!.push(b);
  });

  targetBypassGroups.forEach((groupBypasses) => {
    const fromBelow = groupBypasses.filter(
      (b) => b.gutterY != null && b.gutterY > b.targetPoint.y
    );
    const fromAbove = groupBypasses.filter(
      (b) => b.gutterY != null && b.gutterY <= b.targetPoint.y
    );

    // Coming from below: sort by targetPoint.y ascending (higher target port to lower target port)
    // Higher target port (middle connection) gets SMALLER X (further left)
    // Lower target port (lower connection) gets LARGER X (further right, closer to target)
    fromBelow.sort((a, b) => a.targetPoint.y - b.targetPoint.y);
    const countBelow = fromBelow.length;
    fromBelow.forEach((b, idx) => {
      const offsetLeft = 18 + (countBelow - 1 - idx) * 14;
      b.entryX = b.targetPoint.x - offsetLeft;
    });

    // Coming from above: sort by targetPoint.y ascending (higher target port to lower target port)
    // Higher port is reached first coming down, so it peels off at LARGER X (closer to target)
    // Lower port continues down on the LEFT at SMALLER X
    fromAbove.sort((a, b) => a.targetPoint.y - b.targetPoint.y);
    fromAbove.forEach((b, idx) => {
      const offsetLeft = 18 + idx * 14;
      b.entryX = b.targetPoint.x - offsetLeft;
    });
  });

  // 5. Assign exit X coordinates per source node for bypasses
  const sourceBypassGroups = new Map<string, PlannedBypass[]>();
  bypassEdges.forEach((b) => {
    if (!sourceBypassGroups.has(b.edge.source)) {
      sourceBypassGroups.set(b.edge.source, []);
    }
    sourceBypassGroups.get(b.edge.source)!.push(b);
  });

  sourceBypassGroups.forEach((groupBypasses) => {
    groupBypasses.sort((a, b) => a.targetPoint.y - b.targetPoint.y);
    groupBypasses.forEach((b, idx) => {
      b.exitX = b.sourcePoint.x + 18 + idx * 8;
    });
  });

  // 6. Build final path strings
  const routedResult: RoutedEdge[] = [];

  // Direct edges (Clean, graceful, horizontal S-curves)
  for (const item of directEdges) {
    const { edge, sourcePoint, targetPoint } = item;
    const dx = targetPoint.x - sourcePoint.x;
    const cpDist = Math.min(dx * 0.5, Math.max(24, dx * 0.45));
    const cp1x = sourcePoint.x + cpDist;
    const cp2x = targetPoint.x - cpDist;

    const pathData = `M ${sourcePoint.x} ${sourcePoint.y} C ${cp1x.toFixed(1)} ${sourcePoint.y} ${cp2x.toFixed(1)} ${targetPoint.y} ${targetPoint.x} ${targetPoint.y}`;
    const arrowData = `M ${targetPoint.x - 7} ${targetPoint.y - 4.5} L ${targetPoint.x} ${targetPoint.y} L ${targetPoint.x - 7} ${targetPoint.y + 4.5}`;

    routedResult.push({
      source: edge.source,
      target: edge.target,
      pathData,
      arrowData,
      sourcePoint,
      targetPoint,
    });
  }

  // Bypass edges (Obstacle avoidance with filleted corners)
  for (const item of bypassEdges) {
    const { edge, sourcePoint, targetPoint } = item;
    const gutterY = item.gutterY ?? sourcePoint.y;
    const entryX = item.entryX ?? targetPoint.x - 18;
    const isDirectLevel = Math.abs(gutterY - sourcePoint.y) < 2;

    const waypoints: Point[] = isDirectLevel
      ? [
          sourcePoint,
          { x: entryX, y: sourcePoint.y },
          { x: entryX, y: targetPoint.y },
          targetPoint,
        ]
      : [
          sourcePoint,
          { x: item.exitX ?? sourcePoint.x + 18, y: sourcePoint.y },
          { x: item.exitX ?? sourcePoint.x + 18, y: gutterY },
          { x: entryX, y: gutterY },
          { x: entryX, y: targetPoint.y },
          targetPoint,
        ];

    const pathData = createRoundedPath(waypoints, 14);
    const arrowData = `M ${targetPoint.x - 7} ${targetPoint.y - 4.5} L ${targetPoint.x} ${targetPoint.y} L ${targetPoint.x - 7} ${targetPoint.y + 4.5}`;

    routedResult.push({
      source: edge.source,
      target: edge.target,
      pathData,
      arrowData,
      sourcePoint,
      targetPoint,
    });
  }

  return routedResult;
}
