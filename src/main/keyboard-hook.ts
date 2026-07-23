import { uIOhook, type UiohookKeyboardEvent } from "uiohook-napi";
import type {
  DogInputEvent,
  DogKeyInputEvent
} from "../shared/contracts";
import type { KeyExpression } from "../shared/key-classifier";
import type { PhysicalKeyStateProbe } from "./windows-key-state";

interface ActivePress extends KeyExpression {
  pressId: number;
}

const PHYSICAL_KEY_POLL_MS = 50;

export class KeyboardHook {
  private readonly activePresses = new Map<number, ActivePress>();
  private physicalKeyPollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private nextPressId = 1;

  constructor(
    private readonly emit: (event: DogInputEvent) => void,
    private readonly resolveKey: (keyCode: number) => KeyExpression,
    private readonly probePhysicalKey: PhysicalKeyStateProbe | null = null
  ) {
    uIOhook.on("keydown", this.onKeyDown);
    uIOhook.on("keyup", this.onKeyUp);
  }

  start(): void {
    if (this.running) return;
    this.resetState(false);
    try {
      uIOhook.start();
      this.running = true;
    } catch (error: unknown) {
      this.running = false;
      this.resetState(true);
      try {
        uIOhook.stop();
      } catch {
        // Preserve the original start error.
      }
      throw error;
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    try {
      uIOhook.stop();
    } finally {
      this.resetState(true);
    }
  }

  dispose(): void {
    try {
      this.stop();
    } finally {
      uIOhook.off("keydown", this.onKeyDown);
      uIOhook.off("keyup", this.onKeyUp);
    }
  }

  private readonly onKeyDown = (event: UiohookKeyboardEvent): void => {
    if (!this.running) return;
    if (this.activePresses.has(event.keycode)) return;
    const active: ActivePress = {
      pressId: this.nextPressId++,
      ...this.resolveKey(event.keycode)
    };
    this.activePresses.set(event.keycode, active);
    this.startPhysicalKeyPolling();
    this.emitKey("down", active);
  };

  private readonly onKeyUp = (event: UiohookKeyboardEvent): void => {
    if (!this.running) return;
    const active = this.activePresses.get(event.keycode);
    if (!active) return;
    this.releaseActivePress(event.keycode, active);
  };

  private startPhysicalKeyPolling(): void {
    if (!this.probePhysicalKey || this.physicalKeyPollTimer) return;
    this.physicalKeyPollTimer = setInterval(() => {
      if (!this.running) return;
      for (const [keyCode, active] of [...this.activePresses]) {
        let isPressed: boolean | null = null;
        try {
          isPressed = this.probePhysicalKey?.(keyCode) ?? null;
        } catch {
          // A transient native-state failure must not truncate a real hold.
        }
        if (
          isPressed === false &&
          this.activePresses.get(keyCode) === active
        ) {
          this.releaseActivePress(keyCode, active);
        }
      }
    }, PHYSICAL_KEY_POLL_MS);
    this.physicalKeyPollTimer.unref();
  }

  private stopPhysicalKeyPolling(): void {
    if (!this.physicalKeyPollTimer) return;
    clearInterval(this.physicalKeyPollTimer);
    this.physicalKeyPollTimer = null;
  }

  private releaseActivePress(keyCode: number, active: ActivePress): void {
    this.activePresses.delete(keyCode);
    if (this.activePresses.size === 0) this.stopPhysicalKeyPolling();
    this.emitKey("up", active);
  }

  private emitKey(
    phase: DogKeyInputEvent["phase"],
    active: ActivePress
  ): void {
    this.emit({
      type: "key",
      phase,
      pressId: active.pressId,
      role: active.role,
      pitchStep: active.pitchStep,
      pan: active.pan
    });
  }

  private resetState(notifyRenderer: boolean): void {
    this.stopPhysicalKeyPolling();
    this.activePresses.clear();
    if (notifyRenderer) {
      this.emit({ type: "reset" });
    }
  }
}
