import type React from "react";
import { useEffect } from "react";
import { Circle } from "react-konva";
import type Konva from "konva";
import type { BezierPoint } from "../types";
import { HIT_RADIUS } from "../constants";

interface VectorPointsProps {
  initialPoints: BezierPoint[];
  selectedPointIndex: number | null;
  selectedPoints: Set<number>;
  transform: { zoom: number; offsetX: number; offsetY: number };
  fitScale: number;
  pointRefs: React.MutableRefObject<{ [key: number]: Konva.Circle | null }>;
  selected?: boolean;
  disabled?: boolean;
  transformMode?: boolean;
  pointRadius?: {
    enabled?: number;
    disabled?: number;
  };
  pointFill?: string;
  pointStroke?: string;
  pointStrokeSelected?: string;
  pointStrokeWidth?: number;
  activePointId?: string | null;
  maxPoints?: number;
  nearestPointIndex?: number | null;
  nearestPointDistance?: number;
  onPointClick?: (e: Konva.KonvaEventObject<MouseEvent>, pointIndex: number) => void;
}

export const VectorPoints: React.FC<VectorPointsProps> = ({
  initialPoints,
  selectedPointIndex,
  selectedPoints,
  transform,
  fitScale,
  pointRefs,
  selected = true,
  disabled = false,
  transformMode = false,
  pointRadius,
  pointFill = "#ffffff",
  pointStroke = "#3b82f6",
  pointStrokeSelected = "#ffffff",
  pointStrokeWidth = 2,
  activePointId = null,
  maxPoints,
  nearestPointIndex = null,
  nearestPointDistance = 0,
  onPointClick,
}) => {
  // CRITICAL: For single-point regions, we need to allow clicks even when not selected
  // Single-point regions have no segments to click on, so clicking the point must trigger region selection
  // BUT: Never allow clicks when disabled or in transform mode
  const isSinglePointRegion = initialPoints.length === 1;
  const shouldListenToClicks = !disabled && !transformMode && (selected || isSinglePointRegion);

  // Debug logging
  console.log('VectorPoints rendered:', {
    pointCount: initialPoints.length,
    nearestPointIndex,
    nearestPointDistance: nearestPointDistance?.toFixed ? nearestPointDistance.toFixed(1) : nearestPointDistance,
    selected,
    disabled
  });

  return (
    <>
      {initialPoints.map((point, index) => {
        // Scale up radius to compensate for Layer scaling
        const scale = transform.zoom * fitScale;
        // Use configurable radius with fallbacks to defaults
        const enabledRadius = pointRadius?.enabled ?? 6;
        const disabledRadius = pointRadius?.disabled ?? 4;
        const baseRadius = selected ? enabledRadius : disabledRadius;
        // Check if maxPoints is reached
        const isMaxPointsReached = maxPoints !== undefined && initialPoints.length >= maxPoints;
        // Check if multiple points are selected
        const isMultiSelection = selectedPoints.size > 1;
        // Point is explicitly selected if it's in selectedPoints or is the selectedPointIndex
        const isExplicitlySelected = selectedPointIndex === index || selectedPoints.has(index);
        // Active point should only be rendered as selected if:
        // - It's explicitly selected, OR
        // - (selected AND maxPoints not reached AND not in multi-selection AND it's the active point)
        const isSelected =
          isExplicitlySelected ||
          (selected &&
            !isMaxPointsReached &&
            !isMultiSelection &&
            activePointId !== null &&
            point.id === activePointId);
        
        // Calculate proximity-based radius multiplier
        // When mouse is near the point, make it bigger and easier to grab
        const PROXIMITY_THRESHOLD = 100; // pixels - distance at which point starts growing (increased for testing)
        const MAX_GROWTH = 2.5; // maximum radius multiplier when at very close distance (increased for testing)
        let proximityMultiplier = 1;
        if (nearestPointIndex === index && nearestPointDistance !== undefined && nearestPointDistance < PROXIMITY_THRESHOLD) {
          // Calculate growth based on inverse distance: closer distance = bigger multiplier
          // Formula: 1 + (1 - (distance / threshold)) * (MAX_GROWTH - 1)
          proximityMultiplier = 1 + (1 - nearestPointDistance / PROXIMITY_THRESHOLD) * (MAX_GROWTH - 1);
        }
        
        // Make selected points larger, also apply proximity multiplier
        const radiusMultiplier = isSelected ? Math.max(1.3, proximityMultiplier) : proximityMultiplier;
        const scaledRadius = (baseRadius * radiusMultiplier) / scale;

        return (
          <>
            {/* White outline ring for selected points - rendered outside the colored stroke */}
            {selected && isSelected && (
              <Circle
                key={`point-outline-${index}-${point.x}-${point.y}`}
                x={point.x}
                y={point.y}
                radius={scaledRadius}
                fill="transparent"
                stroke={pointStrokeSelected}
                strokeScaleEnabled={false}
                strokeWidth={pointStrokeWidth + 5}
                listening={false}
                name={`point-outline-${index}`}
              />
            )}
            {/* Main point circle with colored stroke */}
            <Circle
              key={`point-${index}-${point.x}-${point.y}`}
              ref={(node) => {
                pointRefs.current[index] = node;
              }}
              x={point.x}
              y={point.y}
              radius={scaledRadius}
              fill={pointFill}
              stroke={pointStroke}
              strokeScaleEnabled={false}
              strokeWidth={pointStrokeWidth}
              listening={shouldListenToClicks}
              name={`point-${index}`}
              // Use custom hit function to create a larger clickable area around the point
              // This makes points easier to click even when the cursor is not exactly over the point
              hitFunc={(context, shape) => {
                // Calculate a larger hit radius using the constant (scaled for current zoom)
                const hitRadius = HIT_RADIUS.SELECTION / scale;
                context.beginPath();
                context.arc(0, 0, hitRadius, 0, Math.PI * 2);
                context.fillStrokeShape(shape);
              }}
              onClick={
                onPointClick
                  ? (e) => {
                      // For single-point regions, call onPointClick but don't stop propagation
                      // The onPointClick handler in KonvaVector will directly call handleClickWithDebouncing
                      // to trigger region selection
                      if (isSinglePointRegion && !e.evt.altKey && !e.evt.shiftKey && !e.evt.ctrlKey && !e.evt.metaKey) {
                        // Don't stop propagation - let onPointClick handle it and call onClick directly
                        onPointClick(e, index);
                        return;
                      }

                      // Stop propagation immediately to prevent the event from bubbling to VectorShape onClick
                      // This prevents the shape from being selected/unselected when clicking on points
                      e.evt.stopImmediatePropagation();
                      e.evt.stopPropagation();
                      e.evt.preventDefault();
                      e.cancelBubble = true;
                      onPointClick(e, index);
                    }
                  : undefined
              }
            />
          </>
        );
      })}
    </>
  );
};
