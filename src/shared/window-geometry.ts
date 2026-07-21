import {
  PET_SCALE_MAX,
  PET_SCALE_MIN,
  PET_WINDOW_BASE_SIZE
} from "./settings";

export interface WindowRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type HorizontalAnchor = "left" | "right";
export type VerticalAnchor = "top" | "bottom";

export interface ResizePointerDelta {
  startSize: number;
  deltaX: number;
  deltaY: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
}

export function scaleFromResizePointer({
  startSize,
  deltaX,
  deltaY,
  flipHorizontal,
  flipVertical
}: ResizePointerDelta): number {
  const orientedX = deltaX * (flipHorizontal ? -1 : 1);
  const orientedY = deltaY * (flipVertical ? -1 : 1);
  const delta = Math.abs(orientedX) >= Math.abs(orientedY)
    ? orientedX
    : orientedY;
  const size = Math.min(
    PET_WINDOW_BASE_SIZE * PET_SCALE_MAX,
    Math.max(PET_WINDOW_BASE_SIZE * PET_SCALE_MIN, startSize + delta)
  );
  return size / PET_WINDOW_BASE_SIZE;
}

export function resizeSquareFromAnchor(
  bounds: WindowRectangle,
  size: number,
  workArea: WindowRectangle,
  horizontalAnchor: HorizontalAnchor,
  verticalAnchor: VerticalAnchor,
  visibleEdge = 64
): WindowRectangle {
  const anchoredX = horizontalAnchor === "right"
    ? bounds.x + bounds.width - size
    : bounds.x;
  const anchoredY = verticalAnchor === "bottom"
    ? bounds.y + bounds.height - size
    : bounds.y;
  return {
    x: Math.min(
      workArea.x + workArea.width - visibleEdge,
      Math.max(workArea.x - size + visibleEdge, anchoredX)
    ),
    y: Math.min(
      workArea.y + workArea.height - visibleEdge,
      Math.max(workArea.y, anchoredY)
    ),
    width: size,
    height: size
  };
}

export function resizeSquareFromBottomRight(
  bounds: WindowRectangle,
  size: number,
  workArea: WindowRectangle,
  visibleEdge = 64
): WindowRectangle {
  return resizeSquareFromAnchor(
    bounds,
    size,
    workArea,
    "right",
    "bottom",
    visibleEdge
  );
}
