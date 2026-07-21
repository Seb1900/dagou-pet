import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DogAnimator,
  selectDogVisualState
} from "../src/renderer/dog-animation";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("selectDogVisualState", () => {
  it("enters shy only after three seconds without interaction", () => {
    expect(selectDogVisualState([], 2_999, 0, 0, 0)).toBe("idle");
    expect(selectDogVisualState([], 3_000, 0, 0, 0)).toBe("shy");
  });

  it("uses bark01 for every normal da/gou press and hold", () => {
    expect(selectDogVisualState(["normal"], 9_000, 0, 0, 0)).toBe("bark01");
    expect(selectDogVisualState([], 1_100, 1_000, 1_200, 0)).toBe("bark01");
  });

  it("gives jiao bark02 priority over normal voices and shy", () => {
    expect(selectDogVisualState(["normal", "jiao"], 9_000, 0, 0, 0)).toBe(
      "bark02"
    );
    expect(selectDogVisualState([], 4_000, 0, 0, 4_100)).toBe("bark02");
  });

  it("sleeps without animation frames until an interaction wakes it", () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockReturnValue(100);
    const requestFrame = vi.fn(() => 1);
    const cancelFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const element = () => ({
      style: { transform: "" },
      classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() }
    }) as unknown as HTMLElement;

    const animator = new DogAnimator(element(), element());
    expect(requestFrame).not.toHaveBeenCalled();
    animator.trigger("normal");
    expect(requestFrame).toHaveBeenCalledTimes(1);
    animator.dispose();
    expect(cancelFrame).toHaveBeenCalledWith(1);
  });

  it("switches between immediate shy, scale wake and petting", () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockReturnValue(100);
    const requestFrame = vi.fn(() => 8);
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const classes = new Set<string>();
    const dog = {
      offsetWidth: 282,
      style: { transform: "" },
      classList: {
        toggle: (name: string, enabled: boolean) => {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name)
      }
    } as unknown as HTMLElement;
    const jelly = {
      style: { transform: "" },
      classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() }
    } as unknown as HTMLElement;
    const animator = new DogAnimator(dog, jelly);

    animator.showShy();
    expect(classes.has("is-shy")).toBe(true);
    animator.wakeFromShy();
    expect(classes.has("is-shy")).toBe(false);
    animator.pet();
    expect(classes.has("is-shy")).toBe(true);
    expect(classes.has("is-tail-wagging")).toBe(true);
    expect(requestFrame).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_050);
    expect(classes.has("is-tail-wagging")).toBe(false);
    animator.dispose();
  });
});
