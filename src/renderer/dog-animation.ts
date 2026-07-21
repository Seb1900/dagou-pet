import type {
  DogKeyInputEvent,
  DogKeyRole
} from "../shared/contracts";

const MAX_DISPLACEMENT = 1.8;
const MAX_VELOCITY = 11.5;
const SHY_DELAY_MS = 3_000;
const TAIL_WAG_DURATION_MS = 1_050;

export type DogVisualState = "idle" | "shy" | "bark01" | "bark02";

export function selectDogVisualState(
  activeRoles: Iterable<DogKeyRole>,
  now: number,
  lastInteractionAt: number,
  normalMouthUntil: number,
  jiaoMouthUntil: number
): DogVisualState {
  let hasNormal = false;
  let hasJiao = false;
  for (const role of activeRoles) {
    if (role === "jiao") hasJiao = true;
    else hasNormal = true;
  }
  if (hasJiao || now < jiaoMouthUntil) return "bark02";
  if (hasNormal || now < normalMouthUntil) return "bark01";
  return now - lastInteractionAt >= SHY_DELAY_MS ? "shy" : "idle";
}

export class DogAnimator {
  private readonly activePresses = new Map<number, DogKeyRole>();
  private displacement = 0;
  private velocity = 0;
  private heat = 0;
  private holdLevel = 0;
  private normalMouthUntil = 0;
  private jiaoMouthUntil = 0;
  private holdStartedAt = 0;
  private lastInteractionAt = performance.now();
  private lastFrame = performance.now();
  private frameId: number | null = null;
  private shyTimerId: number | null = null;
  private tailWagTimerId: number | null = null;
  private disposed = false;
  private reactionIntensity = 1.25;

  constructor(
    private readonly dog: HTMLElement,
    private readonly jelly: HTMLElement
  ) {
    this.applyVisualState("idle");
    this.scheduleShyState();
  }

  setReactionIntensity(value: number): void {
    this.reactionIntensity = Math.min(2, Math.max(0.5, value));
  }

  wakeFromShy(): void {
    const now = performance.now();
    this.lastInteractionAt = now;
    this.clearShyTimer();
    if (this.activePresses.size === 0) this.applyVisualState("idle");
    this.scheduleShyState();
  }

  showShy(): void {
    this.clearShyTimer();
    this.normalMouthUntil = 0;
    this.jiaoMouthUntil = 0;
    this.lastInteractionAt = performance.now() - SHY_DELAY_MS;
    if (this.activePresses.size === 0) this.applyVisualState("shy");
  }

  pet(): void {
    const now = performance.now();
    this.showShy();
    const impulse = 0.82 * this.reactionIntensity;
    this.velocity = Math.min(MAX_VELOCITY, this.velocity + impulse * 4.8);
    this.heat = Math.min(
      1.35,
      this.heat + 0.16 * this.reactionIntensity
    );
    this.restartTailWag();
    this.startAnimating(now);
  }

  trigger(role: DogKeyRole): void {
    const now = performance.now();
    const isJiao = role === "jiao";
    const impulse = (isJiao ? 1.45 : 0.72) * this.reactionIntensity;
    this.lastInteractionAt = now;
    this.velocity = Math.min(MAX_VELOCITY, this.velocity + impulse * 4.8);
    this.heat = Math.min(
      1.35,
      this.heat + (isJiao ? 0.24 : 0.13) * this.reactionIntensity
    );
    if (isJiao) this.jiaoMouthUntil = Math.max(this.jiaoMouthUntil, now + 390);
    else this.normalMouthUntil = Math.max(this.normalMouthUntil, now + 140);
    this.startAnimating(now);
  }

  handleKey(event: DogKeyInputEvent): void {
    const now = performance.now();
    this.lastInteractionAt = now;
    if (event.phase === "down") {
      if (this.activePresses.size === 0) this.holdStartedAt = now;
      this.activePresses.set(event.pressId, event.role);
      this.startAnimating(now);
      return;
    }
    this.activePresses.delete(event.pressId);
    if (this.activePresses.size === 0) this.holdStartedAt = 0;
    if (event.role === "jiao") {
      this.jiaoMouthUntil = Math.max(this.jiaoMouthUntil, now + 240);
    } else {
      this.normalMouthUntil = Math.max(this.normalMouthUntil, now + 100);
    }
    this.startAnimating(now);
  }

  reset(): void {
    this.stopAnimating();
    this.activePresses.clear();
    this.displacement = 0;
    this.velocity = 0;
    this.heat = 0;
    this.holdLevel = 0;
    this.normalMouthUntil = 0;
    this.jiaoMouthUntil = 0;
    this.holdStartedAt = 0;
    this.clearTailWag();
    this.lastInteractionAt = performance.now();
    this.dog.style.transform = "";
    this.jelly.style.transform = "";
    this.applyVisualState("idle");
    this.scheduleShyState();
  }

  dispose(): void {
    this.disposed = true;
    this.stopAnimating();
    this.clearTailWag();
  }

  private readonly tick = (time: number): void => {
    this.frameId = null;
    const dt = Math.min(0.05, Math.max(0.001, (time - this.lastFrame) / 1000));
    this.lastFrame = time;

    this.velocity += -42 * this.displacement * dt;
    this.velocity *= Math.exp(-9.5 * dt);
    this.velocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, this.velocity));
    this.displacement += this.velocity * dt;
    this.displacement = Math.max(
      -MAX_DISPLACEMENT,
      Math.min(MAX_DISPLACEMENT, this.displacement)
    );
    this.heat *= Math.exp(-2.35 * dt);

    const isLongHold =
      this.activePresses.size > 0 && time - this.holdStartedAt > 220;
    const holdTarget = isLongHold ? 1 : 0;
    const holdSpeed = isLongHold ? 2.1 : 7.5;
    this.holdLevel += (holdTarget - this.holdLevel) * Math.min(1, holdSpeed * dt);

    const positive = Math.max(0, this.displacement);
    const lift = positive * 34 + this.heat * 7;
    const scaleX = 1 + positive * 0.16 + this.heat * 0.05;
    const scaleY = 1 - positive * 0.085 + this.heat * 0.03;
    const rotation =
      -positive * 5.8 + Math.sin(time * 0.025) * this.heat * 3.2;
    this.dog.style.transform =
      `translateY(${-lift.toFixed(2)}px) ` +
      `rotate(${rotation.toFixed(2)}deg) ` +
      `scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;

    const shake = this.holdLevel * 6.5 * this.reactionIntensity;
    const shakeX = Math.sin(time * 0.145) * shake;
    const shakeY = Math.cos(time * 0.19) * shake * 0.55;
    const jellyScale = 1 + this.holdLevel * 0.2 * this.reactionIntensity;
    this.jelly.style.transform =
      `translate(${shakeX.toFixed(2)}px, ${shakeY.toFixed(2)}px) ` +
      `scale(${jellyScale.toFixed(4)})`;

    this.applyVisualState(
      selectDogVisualState(
        this.activePresses.values(),
        time,
        this.lastInteractionAt,
        this.normalMouthUntil,
        this.jiaoMouthUntil
      )
    );
    if (this.needsAnimationFrame(time)) {
      this.frameId = requestAnimationFrame(this.tick);
      return;
    }

    this.displacement = 0;
    this.velocity = 0;
    this.heat = 0;
    this.holdLevel = 0;
    this.dog.style.transform = "";
    this.jelly.style.transform = "";
    this.scheduleShyState();
  };

  private startAnimating(now: number): void {
    if (this.disposed) return;
    this.clearShyTimer();
    if (this.frameId !== null) return;
    this.lastFrame = now;
    this.frameId = requestAnimationFrame(this.tick);
  }

  private stopAnimating(): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.clearShyTimer();
  }

  private needsAnimationFrame(now: number): boolean {
    return (
      this.activePresses.size > 0 ||
      Math.abs(this.displacement) > 0.002 ||
      Math.abs(this.velocity) > 0.02 ||
      this.heat > 0.002 ||
      this.holdLevel > 0.002 ||
      now < this.normalMouthUntil ||
      now < this.jiaoMouthUntil
    );
  }

  private scheduleShyState(): void {
    if (this.disposed || this.activePresses.size > 0) return;
    this.clearShyTimer();
    const delay = Math.max(
      0,
      SHY_DELAY_MS - (performance.now() - this.lastInteractionAt)
    );
    this.shyTimerId = window.setTimeout(() => {
      this.shyTimerId = null;
      if (this.frameId === null && this.activePresses.size === 0) {
        this.applyVisualState("shy");
      }
    }, delay);
  }

  private clearShyTimer(): void {
    if (this.shyTimerId !== null) window.clearTimeout(this.shyTimerId);
    this.shyTimerId = null;
  }

  private restartTailWag(): void {
    this.clearTailWag();
    void this.dog.offsetWidth;
    this.dog.classList.add("is-tail-wagging");
    this.tailWagTimerId = window.setTimeout(() => {
      this.tailWagTimerId = null;
      this.dog.classList.remove("is-tail-wagging");
    }, TAIL_WAG_DURATION_MS);
  }

  private clearTailWag(): void {
    if (this.tailWagTimerId !== null) {
      window.clearTimeout(this.tailWagTimerId);
    }
    this.tailWagTimerId = null;
    this.dog.classList.remove("is-tail-wagging");
  }

  private applyVisualState(state: DogVisualState): void {
    this.dog.classList.toggle("is-shy", state === "shy");
    this.dog.classList.toggle("is-bark01", state === "bark01");
    this.dog.classList.toggle("is-bark02", state === "bark02");
    this.dog.classList.toggle("is-jiao", state === "bark02");
  }
}
