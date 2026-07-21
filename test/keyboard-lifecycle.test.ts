import { describe, expect, it, vi } from "vitest";
import {
  KeyboardLifecycle,
  type KeyboardLifecycleState,
  type ManagedKeyboardHook
} from "../src/main/keyboard-lifecycle";

function setup() {
  const hook: ManagedKeyboardHook = {
    start: vi.fn(),
    stop: vi.fn()
  };
  const lifecycle = new KeyboardLifecycle(hook);
  const state: KeyboardLifecycleState = {
    listening: true,
    rendererReady: false,
    systemSuspended: false
  };
  return { hook, lifecycle, state };
}

describe("KeyboardLifecycle", () => {
  it("waits for the renderer before starting and does not start twice", () => {
    const { hook, lifecycle, state } = setup();
    lifecycle.sync(state);
    expect(hook.start).not.toHaveBeenCalled();
    state.rendererReady = true;
    lifecycle.sync(state);
    lifecycle.sync(state);
    expect(hook.start).toHaveBeenCalledTimes(1);
  });

  it("stops for pause and restarts after listening resumes", () => {
    const { hook, lifecycle, state } = setup();
    state.rendererReady = true;
    lifecycle.sync(state);
    state.listening = false;
    lifecycle.sync(state);
    state.listening = true;
    lifecycle.sync(state);
    expect(hook.start).toHaveBeenCalledTimes(2);
    expect(hook.stop).toHaveBeenCalledTimes(1);
  });

  it("stays stopped across suspend until listening also resumes", () => {
    const { hook, lifecycle, state } = setup();
    state.rendererReady = true;
    lifecycle.sync(state);
    state.systemSuspended = true;
    lifecycle.sync(state);
    state.listening = false;
    state.systemSuspended = false;
    lifecycle.sync(state);
    expect(hook.start).toHaveBeenCalledTimes(1);
    state.listening = true;
    lifecycle.sync(state);
    expect(hook.start).toHaveBeenCalledTimes(2);
  });

  it("does not restart after disposal", () => {
    const { hook, lifecycle, state } = setup();
    state.rendererReady = true;
    lifecycle.sync(state);
    lifecycle.dispose();
    lifecycle.sync(state);
    expect(hook.start).toHaveBeenCalledTimes(1);
    expect(hook.stop).toHaveBeenCalledTimes(1);
  });
});
