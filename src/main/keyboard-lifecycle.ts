export interface KeyboardLifecycleState {
  listening: boolean;
  rendererReady: boolean;
  systemSuspended: boolean;
}

export interface ManagedKeyboardHook {
  start(): void;
  stop(): void;
}

export class KeyboardLifecycle {
  private active = false;
  private disposed = false;

  constructor(private readonly hook: ManagedKeyboardHook) {}

  sync(state: KeyboardLifecycleState): void {
    if (this.disposed) return;
    const shouldRun =
      state.listening && state.rendererReady && !state.systemSuspended;
    if (shouldRun === this.active) return;

    if (shouldRun) {
      this.hook.start();
      this.active = true;
      return;
    }

    this.active = false;
    this.hook.stop();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.active) return;
    this.active = false;
    this.hook.stop();
  }
}
