import { uIOhook, type UiohookKeyboardEvent } from "uiohook-napi";
import type {
  DogInputEvent,
  DogKeyInputEvent
} from "../shared/contracts";
import type { KeyExpression } from "../shared/key-classifier";
import { PressedKeyTracker } from "../shared/pressed-key-tracker";

interface ActivePress extends KeyExpression {
  pressId: number;
}

export class KeyboardHook {
  private readonly tracker = new PressedKeyTracker();
  private readonly activePresses = new Map<number, ActivePress>();
  private running = false;
  private nextPressId = 1;

  constructor(
    private readonly emit: (event: DogInputEvent) => void,
    private readonly resolveKey: (keyCode: number) => KeyExpression
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
    if (!this.running || !this.tracker.keyDown(event.keycode)) return;
    const active: ActivePress = {
      pressId: this.nextPressId++,
      ...this.resolveKey(event.keycode)
    };
    this.activePresses.set(event.keycode, active);
    this.emitKey("down", active);
  };

  private readonly onKeyUp = (event: UiohookKeyboardEvent): void => {
    if (!this.running || !this.tracker.keyUp(event.keycode)) return;
    const active = this.activePresses.get(event.keycode);
    this.activePresses.delete(event.keycode);
    if (active) this.emitKey("up", active);
  };

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
      pan: active.pan,
      heldCount: this.tracker.heldCount,
      timestamp: Date.now()
    });
  }

  private resetState(notifyRenderer: boolean): void {
    this.tracker.reset();
    this.activePresses.clear();
    if (notifyRenderer) {
      this.emit({ type: "reset", heldCount: 0, timestamp: Date.now() });
    }
  }
}
