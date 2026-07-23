import { beforeEach, describe, expect, it, vi } from "vitest";

const hookMock = vi.hoisted(() => {
  const listeners = new Map<string, (event: { keycode: number }) => void>();
  return {
    listeners,
    on: vi.fn((event: string, listener: (value: { keycode: number }) => void) => {
      listeners.set(event, listener);
    }),
    off: vi.fn(),
    start: vi.fn(),
    stop: vi.fn()
  };
});

vi.mock("uiohook-napi", () => ({ uIOhook: hookMock }));

import { KeyboardHook } from "../src/main/keyboard-hook";

beforeEach(() => {
  hookMock.listeners.clear();
  vi.clearAllMocks();
});

describe("KeyboardHook", () => {
  it("ignores operating-system key repeat and unmatched key-up events", () => {
    const emit = vi.fn();
    const resolveKey = vi.fn(() => ({
      role: "normal" as const,
      pitchStep: 2,
      pan: 0.25
    }));
    const hook = new KeyboardHook(emit, resolveKey);
    hook.start();

    hookMock.listeners.get("keydown")?.({ keycode: 12 });
    hookMock.listeners.get("keydown")?.({ keycode: 12 });
    hookMock.listeners.get("keyup")?.({ keycode: 99 });
    hookMock.listeners.get("keyup")?.({ keycode: 12 });
    hookMock.listeners.get("keyup")?.({ keycode: 12 });

    expect(resolveKey).toHaveBeenCalledOnce();
    expect(emit.mock.calls).toEqual([
      [{
        type: "key",
        phase: "down",
        pressId: 1,
        role: "normal",
        pitchStep: 2,
        pan: 0.25
      }],
      [{
        type: "key",
        phase: "up",
        pressId: 1,
        role: "normal",
        pitchStep: 2,
        pan: 0.25
      }]
    ]);

    hook.dispose();
  });

  it("clears held keys and notifies the renderer when stopped", () => {
    const emit = vi.fn();
    const hook = new KeyboardHook(emit, () => ({
      role: "normal",
      pitchStep: 0,
      pan: 0
    }));
    hook.start();
    hookMock.listeners.get("keydown")?.({ keycode: 7 });

    hook.stop();
    hook.start();
    hookMock.listeners.get("keydown")?.({ keycode: 7 });

    expect(emit.mock.calls).toEqual([
      [expect.objectContaining({ type: "key", phase: "down", pressId: 1 })],
      [{ type: "reset" }],
      [expect.objectContaining({ type: "key", phase: "down", pressId: 2 })]
    ]);

    hook.dispose();
  });

  it("recovers a lost key-up from the physical key state", () => {
    vi.useFakeTimers();
    try {
      const emit = vi.fn();
      let physicallyPressed = true;
      const probe = vi.fn(() => physicallyPressed);
      const hook = new KeyboardHook(emit, () => ({
        role: "normal",
        pitchStep: 1,
        pan: 0
      }), probe);
      hook.start();
      hookMock.listeners.get("keydown")?.({ keycode: 8 });
      vi.advanceTimersByTime(50);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(probe).toHaveBeenCalledOnce();

      physicallyPressed = false;
      vi.advanceTimersByTime(50);
      hookMock.listeners.get("keydown")?.({ keycode: 8 });

      expect(emit.mock.calls).toEqual([
        [expect.objectContaining({ type: "key", phase: "down", pressId: 1 })],
        [expect.objectContaining({ type: "key", phase: "up", pressId: 1 })],
        [expect.objectContaining({ type: "key", phase: "down", pressId: 2 })]
      ]);
      expect(vi.getTimerCount()).toBe(1);
      hookMock.listeners.get("keyup")?.({ keycode: 8 });
      expect(vi.getTimerCount()).toBe(0);
      hook.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never truncates a physical long hold", () => {
    vi.useFakeTimers();
    try {
      const emit = vi.fn();
      const hook = new KeyboardHook(emit, () => ({
        role: "normal",
        pitchStep: 0,
        pan: 0
      }), () => true);
      hook.start();
      hookMock.listeners.get("keydown")?.({ keycode: 9 });
      hookMock.listeners.get("keydown")?.({ keycode: 9 });

      vi.advanceTimersByTime(120_000);

      expect(emit.mock.calls).toEqual([
        [expect.objectContaining({ type: "key", phase: "down", pressId: 1 })]
      ]);
      hookMock.listeners.get("keyup")?.({ keycode: 9 });
      hook.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not guess when native key state is unavailable", () => {
    vi.useFakeTimers();
    try {
      const emit = vi.fn();
      const probe = vi
        .fn<() => boolean | null>()
        .mockReturnValueOnce(null)
        .mockImplementationOnce(() => {
          throw new Error("temporary native failure");
        })
        .mockReturnValue(true);
      const hook = new KeyboardHook(emit, () => ({
        role: "normal",
        pitchStep: 0,
        pan: 0
      }), probe);
      hook.start();
      hookMock.listeners.get("keydown")?.({ keycode: 11 });

      vi.advanceTimersByTime(150);

      expect(emit.mock.calls).toEqual([
        [expect.objectContaining({ type: "key", phase: "down", pressId: 1 })]
      ]);
      hook.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels physical-state polling when the hook resets", () => {
    vi.useFakeTimers();
    try {
      const emit = vi.fn();
      const hook = new KeyboardHook(emit, () => ({
        role: "normal",
        pitchStep: 0,
        pan: 0
      }), () => true);
      hook.start();
      hookMock.listeners.get("keydown")?.({ keycode: 10 });
      expect(vi.getTimerCount()).toBe(1);
      hook.stop();

      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(100);

      expect(emit.mock.calls).toEqual([
        [expect.objectContaining({ type: "key", phase: "down", pressId: 1 })],
        [{ type: "reset" }]
      ]);
      hook.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
