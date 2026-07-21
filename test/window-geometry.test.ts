import { describe, expect, it } from "vitest";
import {
  resizeSquareFromAnchor,
  resizeSquareFromBottomRight,
  scaleFromResizePointer
} from "../src/shared/window-geometry";

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
