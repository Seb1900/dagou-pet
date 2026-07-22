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

export interface DragPointerDelta {
  startWindowX: number;
  startWindowY: number;
  deltaX: number;
  deltaY: number;
  threshold?: number;
}

export interface DragPointerResult {
  x: number;
  y: number;
  moved: boolean;
}

export interface WindowPosition {
  x: number;
  y: number;
}

export function shouldIgnorePetMouseEvents(
  clickThrough: boolean,
  rendererInteractive: boolean
): boolean {
  return clickThrough || !rendererInteractive;
}

export function centeredRectangleByArea(
  rectangle: WindowRectangle,
  areaRatio = 0.5
): WindowRectangle {
  if (
    !Number.isFinite(areaRatio) ||
    areaRatio <= 0 ||
    areaRatio > 1 ||
    !Number.isFinite(rectangle.x) ||
    !Number.isFinite(rectangle.y) ||
    !Number.isFinite(rectangle.width) ||
    rectangle.width <= 0 ||
    !Number.isFinite(rectangle.height) ||
    rectangle.height <= 0
  ) {
    throw new RangeError("Invalid centered rectangle geometry");
  }
  const scale = Math.sqrt(areaRatio);
  const width = rectangle.width * scale;
  const height = rectangle.height * scale;
  return {
    x: rectangle.x + (rectangle.width - width) / 2,
    y: rectangle.y + (rectangle.height - height) / 2,
    width,
    height
  };
}

function constrainAxis(
  requested: number,
  collisionStart: number,
  collisionLength: number,
  workAreaStart: number,
  workAreaLength: number
): number {
  const minimum = Math.ceil(workAreaStart - collisionStart);
  const maximum = Math.floor(
    workAreaStart + workAreaLength - collisionStart - collisionLength
  );
  if (minimum > maximum) {
    return Math.round(
      workAreaStart + workAreaLength / 2 -
      collisionStart - collisionLength / 2
    );
  }
  return Math.min(maximum, Math.max(minimum, Math.round(requested)));
}

export function constrainWindowPositionToWorkArea(
  requested: WindowPosition,
  dragRegion: WindowRectangle,
  workArea: WindowRectangle,
  collisionAreaRatio = 0.5
): WindowPosition {
  if (
    !Number.isFinite(requested.x) ||
    !Number.isFinite(requested.y) ||
    !Number.isFinite(workArea.x) ||
    !Number.isFinite(workArea.y) ||
    !Number.isFinite(workArea.width) ||
    workArea.width <= 0 ||
    !Number.isFinite(workArea.height) ||
    workArea.height <= 0
  ) {
    throw new RangeError("Invalid work area geometry");
  }
  const collision = centeredRectangleByArea(
    dragRegion,
    collisionAreaRatio
  );
  return {
    x: constrainAxis(
      requested.x,
      collision.x,
      collision.width,
      workArea.x,
      workArea.width
    ),
    y: constrainAxis(
      requested.y,
      collision.y,
      collision.height,
      workArea.y,
      workArea.height
    )
  };
}

export function positionFromDragPointer({
  startWindowX,
  startWindowY,
  deltaX,
  deltaY,
  threshold = 4
}: DragPointerDelta): DragPointerResult {
  return {
    x: Math.round(startWindowX + deltaX),
    y: Math.round(startWindowY + deltaY),
    moved: Math.hypot(deltaX, deltaY) >= threshold
  };
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
