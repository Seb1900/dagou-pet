import { describe, expect, it } from "vitest";
import {
  centeredRectangleByArea,
  constrainWindowPositionToWorkArea,
  positionFromDragPointer,
  resizeSquareFromAnchor,
  resizeSquareFromBottomRight,
  scaleFromResizePointer,
  shouldIgnorePetMouseEvents
} from "../src/shared/window-geometry";

describe("shouldIgnorePetMouseEvents", () => {
  it.each([
    [false, true, false],
    [false, false, true],
    [true, true, true],
    [true, false, true]
  ])(
    "with clickThrough=%s and rendererInteractive=%s returns %s",
    (clickThrough, rendererInteractive, expected) => {
      expect(
        shouldIgnorePetMouseEvents(clickThrough, rendererInteractive)
      ).toBe(expected);
    }
  );
});

describe("centeredRectangleByArea", () => {
  it("preserves the center and aspect ratio while halving the area", () => {
    const source = { x: 100, y: 80, width: 400, height: 200 };
    const result = centeredRectangleByArea(source);

    expect(result.x + result.width / 2).toBeCloseTo(300);
    expect(result.y + result.height / 2).toBeCloseTo(180);
    expect(result.width / result.height).toBeCloseTo(2);
    expect(result.width * result.height).toBeCloseTo(
      source.width * source.height * 0.5
    );
    expect(result.width).toBeCloseTo(400 * Math.sqrt(0.5));
    expect(result.height).toBeCloseTo(200 * Math.sqrt(0.5));
  });

  it("rejects invalid rectangles and area ratios", () => {
    expect(() => centeredRectangleByArea(
      { x: 0, y: 0, width: 0, height: 20 }
    )).toThrow(RangeError);
    expect(() => centeredRectangleByArea(
      { x: 0, y: 0, width: 20, height: 20 },
      1.1
    )).toThrow(RangeError);
  });
});

describe("constrainWindowPositionToWorkArea", () => {
  const dragRegion = { x: 50, y: 40, width: 200, height: 100 };
  const workArea = { x: 0, y: 0, width: 1_000, height: 800 };

  it("leaves an in-bounds integer position unchanged", () => {
    expect(constrainWindowPositionToWorkArea(
      { x: 100, y: 120 },
      dragRegion,
      workArea
    )).toEqual({ x: 100, y: 120 });
  });

  it("keeps the central half-area rectangle inside every work-area edge", () => {
    expect(constrainWindowPositionToWorkArea(
      { x: -500, y: -500 },
      dragRegion,
      workArea
    )).toEqual({ x: -79, y: -54 });
    expect(constrainWindowPositionToWorkArea(
      { x: 2_000, y: 2_000 },
      dragRegion,
      workArea
    )).toEqual({ x: 779, y: 674 });
  });

  it("supports displays with negative screen coordinates", () => {
    expect(constrainWindowPositionToWorkArea(
      { x: -2_000, y: 2_000 },
      dragRegion,
      { x: -1_280, y: 0, width: 1_280, height: 1_024 }
    )).toEqual({ x: -1_359, y: 898 });
  });

  it("rounds inward so fractional geometry cannot cross an edge", () => {
    const position = constrainWindowPositionToWorkArea(
      { x: -10_000, y: -10_000 },
      { x: 25.25, y: 30.75, width: 80.5, height: 60.5 },
      { x: 100, y: 50, width: 500, height: 400 }
    );
    const collision = centeredRectangleByArea(
      { x: 25.25, y: 30.75, width: 80.5, height: 60.5 }
    );

    expect(position.x + collision.x).toBeGreaterThanOrEqual(100);
    expect(position.y + collision.y).toBeGreaterThanOrEqual(50);
  });

  it("centers an oversized collision rectangle deterministically", () => {
    expect(constrainWindowPositionToWorkArea(
      { x: 5_000, y: 5_000 },
      { x: 0, y: 0, width: 2_000, height: 2_000 },
      workArea
    )).toEqual({ x: -500, y: -600 });
  });
});

describe("positionFromDragPointer", () => {
  it("distinguishes a click from a drag and preserves the pointer offset", () => {
    expect(positionFromDragPointer({
      startWindowX: 800,
      startWindowY: 500,
      deltaX: 2,
      deltaY: 3
    })).toEqual({ x: 802, y: 503, moved: false });
    expect(positionFromDragPointer({
      startWindowX: 800,
      startWindowY: 500,
      deltaX: -40,
      deltaY: 25
    })).toEqual({ x: 760, y: 525, moved: true });
  });
});

describe("scaleFromResizePointer", () => {
  it.each([
    [false, false, 62, 10],
    [true, false, -62, 10],
    [false, true, 62, -10],
    [true, true, -62, -10]
  ])(
    "grows toward the visual resize corner with horizontal=%s vertical=%s",
    (flipHorizontal, flipVertical, deltaX, deltaY) => {
      expect(scaleFromResizePointer({
        startSize: 310,
        deltaX,
        deltaY,
        flipHorizontal,
        flipVertical
      })).toBeCloseTo(1.2);
    }
  );

  it("uses the dominant axis and clamps to the supported range", () => {
    expect(scaleFromResizePointer({
      startSize: 310,
      deltaX: 20,
      deltaY: -1_000,
      flipHorizontal: false,
      flipVertical: false
    })).toBe(0.65);
    expect(scaleFromResizePointer({
      startSize: 310,
      deltaX: 1_000,
      deltaY: 20,
      flipHorizontal: false,
      flipVertical: false
    })).toBe(1.6);
  });
});

describe("resizeSquareFromBottomRight", () => {
  it("keeps the lower-right anchor while resizing", () => {
    expect(
      resizeSquareFromBottomRight(
        { x: 900, y: 500, width: 310, height: 310 },
        400,
        { x: 0, y: 0, width: 1920, height: 1080 }
      )
    ).toEqual({ x: 810, y: 410, width: 400, height: 400 });
  });

  it("keeps a recoverable edge visible on any display", () => {
    expect(
      resizeSquareFromBottomRight(
        { x: -1900, y: 1300, width: 310, height: 310 },
        500,
        { x: -1280, y: 0, width: 1280, height: 1024 }
      )
    ).toEqual({ x: -1716, y: 960, width: 500, height: 500 });
  });

  it("keeps the opposite corner fixed for a mirrored resize handle", () => {
    expect(
      resizeSquareFromAnchor(
        { x: 300, y: 200, width: 310, height: 310 },
        400,
        { x: 0, y: 0, width: 1920, height: 1080 },
        "right",
        "top"
      )
    ).toEqual({ x: 210, y: 200, width: 400, height: 400 });
  });
});
