import React from 'react';
import type { NodePosition } from '../../types/lab';
import { NODE_WIDTH, NODE_HEIGHT } from '../../utils/dag';
import { confirmDialog } from '../../store/useDialogStore';

interface FlowEdgeProps {
  sourcePos: NodePosition;
  targetPos: NodePosition;
  sourceId: string;
  targetId: string;
  sourceWidth?: number;
  pathData?: string;
  arrowData?: string;
  onRemove: (sourceId: string, targetId: string) => void;
}

export const FlowEdge: React.FC<FlowEdgeProps> = ({
  sourcePos,
  targetPos,
  sourceId,
  targetId,
  sourceWidth,
  pathData: customPathData,
  arrowData: customArrowData,
  onRemove,
}) => {
  const sw = sourceWidth || NODE_WIDTH;
  const x1 = sourcePos.x + sw;
  const y1 = sourcePos.y + NODE_HEIGHT / 2;
  const x2 = targetPos.x;
  const y2 = targetPos.y + NODE_HEIGHT / 2;
  const mx = (x1 + x2) / 2;

  const pathData = customPathData || `M${x1},${y1}C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  const arrowData = customArrowData || `M${x2 - 6},${y2 - 4}L${x2},${y2}L${x2 - 6},${y2 + 4}`;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await confirmDialog({
      title: 'Remove Dependency',
      message: 'Remove this dependency connection between experiments?',
      confirmLabel: 'Remove Connection',
      variant: 'warning',
    });
    if (confirmed) {
      onRemove(sourceId, targetId);
    }
  };

  return (
    <g className="flow-edge-group">
      {/* Invisible wider stroke for easy hover & click */}
      <path
        d={pathData}
        fill="none"
        stroke="transparent"
        strokeWidth="14"
        className="edge-hit"
        onClick={handleClick}
      />
      {/* Visual visible Bezier curve */}
      <path
        d={pathData}
        fill="none"
        stroke="var(--mut)"
        strokeWidth="1.5"
        className="transition-colors pointer-events-none"
      />
      {/* Arrowhead marker at target */}
      <path
        d={arrowData}
        fill="none"
        stroke="var(--mut)"
        strokeWidth="1.5"
        className="transition-colors pointer-events-none"
      />
    </g>
  );
};
