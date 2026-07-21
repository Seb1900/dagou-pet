import { describe, expect, it } from "vitest";
import { PressedKeyTracker } from "../src/shared/pressed-key-tracker";

describe("PressedKeyTracker", () => {
  it("always ignores operating-system key repeat", () => {
    const tracker = new PressedKeyTracker();
    expect(tracker.keyDown(12)).toBe(true);
    expect(tracker.keyDown(12)).toBe(false);
    expect(tracker.heldCount).toBe(1);
    expect(tracker.keyUp(12)).toBe(true);
    expect(tracker.heldCount).toBe(0);
  });

  it("resets all held state", () => {
    const tracker = new PressedKeyTracker();
    tracker.keyDown(1);
    tracker.keyDown(2);
    tracker.reset();
    expect(tracker.heldCount).toBe(0);
    expect(tracker.keyUp(1)).toBe(false);
  });
});
