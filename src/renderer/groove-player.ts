import type {
  DogInputEvent,
  DogKeyInputEvent,
  KeyboardSampleName
} from "../shared/contracts";
import { MELODY_PITCH_STEPS } from "../shared/key-classifier";
import type { AppSettings, SoundMode } from "../shared/settings";
import { createVoiceSpec, type VoiceSpec } from "./sound-profile";

export const GROOVE_STEPS_PER_BEAT = 2;
export const GROOVE_STEPS_PER_BAR = 8;
export const GROOVE_LOOKAHEAD_MS = 24;
export const GROOVE_MAX_QUEUED_STEPS = 2;
export const GROOVE_FIRST_HIT_DELAY_MS = 12;
export const GROOVE_IDLE_RESET_MS = 3_000;
export const GROOVE_QUANTIZE_TOLERANCE_MS = 0.001;

// Weighted-median YIN anchors for the bundled recordings.
export const GROOVE_SOURCE_MIDI: Readonly<Record<KeyboardSampleName, number>> =
  Object.freeze({
    da: 70.8990412038,
    gou: 62.8424257167,
    jiao: 71.08
  });

// Eight C-major notes per sample, centered around the recording's own range.
// This keeps a recognizable near-original tier while avoiding global A4
// normalization and the extreme gou transposition it caused.
export const GROOVE_TARGET_MIDI: Readonly<
  Record<KeyboardSampleName, readonly number[]>
> = Object.freeze({
  da: Object.freeze([65, 67, 69, 71, 72, 74, 76, 77]),
  gou: Object.freeze([57, 59, 60, 62, 64, 65, 67, 69]),
  jiao: Object.freeze([65, 67, 69, 71, 72, 74, 76, 77])
});

export interface GrooveChord {
  readonly name: "I" | "V" | "vi" | "IV";
  readonly pitchClasses: readonly number[];
}

export const GROOVE_CHORDS: readonly GrooveChord[] = Object.freeze([
  { name: "I", pitchClasses: Object.freeze([0, 4, 7]) },
  { name: "V", pitchClasses: Object.freeze([7, 11, 2]) },
  { name: "vi", pitchClasses: Object.freeze([9, 0, 4]) },
  { name: "IV", pitchClasses: Object.freeze([5, 9, 0]) }
]);

const CONSONANT_INTERVALS = new Set([3, 4, 5, 7, 8, 9]);
const MAX_HARMONY_TRANSPOSITION = 7;

export interface GrooveOutput {
  currentTime(): number;
  scheduleVoices(
    groupId: string,
    specs: readonly VoiceSpec[],
    startTime: number,
    held?: boolean
  ): void;
  releaseGroup(groupId: string, release?: "tail" | "fade"): void;
}

interface GrooveHit {
  input: DogKeyInputEvent;
  sample: KeyboardSampleName;
  ownerPressId: number;
  held: boolean;
}

interface ScheduledGrooveHit extends GrooveHit {
  atMs: number;
  stepIndex: number;
  groupId: string;
}

interface ActiveGroovePress {
  input: DogKeyInputEvent;
  downStep: number;
  groupId: string | null;
}

interface QueueResult {
  stepIndex: number;
  groupId: string | null;
}

export function grooveStepMilliseconds(bpm: number): number {
  return 60_000 / bpm / GROOVE_STEPS_PER_BEAT;
}

export interface QuantizedGrooveStep {
  stepIndex: number;
  atMs: number;
}

export function quantizeGrooveStep(
  nowMs: number,
  originMs: number,
  bpm: number,
  minimumStep = 0
): QuantizedGrooveStep {
  const stepMs = grooveStepMilliseconds(bpm);
  const safeElapsed = nowMs + GROOVE_LOOKAHEAD_MS - originMs;
  const nextStep = Math.max(
    minimumStep,
    0,
    Math.ceil((safeElapsed - GROOVE_QUANTIZE_TOLERANCE_MS) / stepMs)
  );
  return { stepIndex: nextStep, atMs: originMs + nextStep * stepMs };
}

function closestPitchIndex(pitchStep: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < MELODY_PITCH_STEPS.length; index += 1) {
    const distance = Math.abs(pitchStep - MELODY_PITCH_STEPS[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function pitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

function chordCandidates(
  chord: GrooveChord,
  sourceMidi: number
): number[] {
  const minimum = Math.ceil(sourceMidi - MAX_HARMONY_TRANSPOSITION);
  const maximum = Math.floor(sourceMidi + MAX_HARMONY_TRANSPOSITION);
  const candidates: number[] = [];
  for (let midi = minimum; midi <= maximum; midi += 1) {
    if (chord.pitchClasses.includes(pitchClass(midi))) candidates.push(midi);
  }
  return candidates;
}

function closestChordTone(
  targetMidi: number,
  chord: GrooveChord,
  sourceMidi: number
): number {
  return chordCandidates(chord, sourceMidi).sort((left, right) =>
    Math.abs(left - targetMidi) - Math.abs(right - targetMidi) ||
    Math.abs(left - sourceMidi) - Math.abs(right - sourceMidi)
  )[0] ?? Math.round(targetMidi);
}

function harmonyTones(
  primaryMidi: number,
  chord: GrooveChord,
  sourceMidi: number,
  count: number
): number[] {
  return chordCandidates(chord, sourceMidi)
    .filter((midi) => midi !== primaryMidi)
    .filter((midi) => CONSONANT_INTERVALS.has(Math.abs(midi - primaryMidi)))
    .sort((left, right) =>
      Math.abs(left - primaryMidi) - Math.abs(right - primaryMidi) ||
      Math.abs(left - sourceMidi) - Math.abs(right - sourceMidi)
    )
    .slice(0, count);
}

export function grooveAccent(stepIndex: number): number {
  const stepInBar = stepIndex % GROOVE_STEPS_PER_BAR;
  if (stepInBar === 0) return 1.24;
  if (stepInBar === 4) return 1.17;
  if (stepInBar % GROOVE_STEPS_PER_BEAT === 0) return 1.1;
  return 0.92;
}

function clampPan(value: number): number {
  return Math.min(0.72, Math.max(-0.72, value));
}

export function createGrooveVoices(
  sample: KeyboardSampleName,
  input: Pick<DogKeyInputEvent, "role" | "pitchStep" | "pan">,
  stepIndex: number
): VoiceSpec[] {
  const chordIndex = Math.floor(stepIndex / GROOVE_STEPS_PER_BAR) %
    GROOVE_CHORDS.length;
  const chord = GROOVE_CHORDS[chordIndex];
  const strongBeat = stepIndex % GROOVE_STEPS_PER_BEAT === 0;
  const pitchIndex = closestPitchIndex(input.pitchStep);
  const sourceMidi = GROOVE_SOURCE_MIDI[sample];
  const requestedMidi = GROOVE_TARGET_MIDI[sample][pitchIndex];
  const primaryMidi = strongBeat || input.role === "jiao"
    ? closestChordTone(requestedMidi, chord, sourceMidi)
    : requestedMidi;
  const harmony = harmonyTones(
    primaryMidi,
    chord,
    sourceMidi,
    strongBeat || input.role === "jiao" ? 2 : 1
  );
  const accent = grooveAccent(stepIndex);
  const primaryPan = clampPan(input.pan * 1.55);
  const base = createVoiceSpec(sample, {
    role: input.role,
    pitchStep: primaryMidi - sourceMidi,
    pan: primaryPan
  });
  const voices: VoiceSpec[] = [
    { ...base, gain: base.gain * 0.88 * accent }
  ];
  harmony.forEach((midi, index) => {
    voices.push({
      ...base,
      pitchSemitones: midi - sourceMidi,
      gain: base.gain * (index === 0 ? 0.14 : 0.08) * accent,
      pan: index === 0
        ? (primaryPan <= 0 ? 0.28 : -0.28)
        : 0
    });
  });
  return voices;
}

export class GroovePlayer {
  private readonly scheduled = new Map<number, ScheduledGrooveHit>();
  private readonly activePresses = new Map<number, ActiveGroovePress>();
  private bpm = 128;
  private soundMode: SoundMode = "alternate";
  private originMs: number | null = null;
  private lastInputMs = Number.NEGATIVE_INFINITY;
  private nextAvailableStep = 0;
  private nextAlternate: "da" | "gou" = "da";
  private alternateDaInput: DogKeyInputEvent | null = null;
  private transportId = 0;

  constructor(private readonly output: GrooveOutput) {}

  configure(settings: Pick<AppSettings, "grooveBpm" | "soundMode">): void {
    this.bpm = settings.grooveBpm;
    this.soundMode = settings.soundMode;
  }

  handle(event: DogInputEvent): void {
    if (event.type === "reset") {
      this.reset();
      return;
    }
    if (event.phase === "down") this.handleDown(event);
    else this.handleUp(event);
  }

  reset(): void {
    this.scheduled.clear();
    this.activePresses.clear();
    this.originMs = null;
    this.lastInputMs = Number.NEGATIVE_INFINITY;
    this.nextAvailableStep = 0;
    this.nextAlternate = "da";
    this.alternateDaInput = null;
    this.transportId += 1;
  }

  private handleDown(input: DogKeyInputEvent): void {
    if (this.activePresses.has(input.pressId)) return;
    const nowMs = this.output.currentTime() * 1000;
    const idle = nowMs - this.lastInputMs >= GROOVE_IDLE_RESET_MS;
    if (idle) {
      this.nextAlternate = "da";
      this.alternateDaInput = null;
    }
    let hitInput = input;
    let sample: KeyboardSampleName;
    if (input.role === "jiao") {
      sample = "jiao";
    } else if (this.soundMode === "da-gou") {
      sample = "da";
    } else if (this.nextAlternate === "da") {
      sample = "da";
      this.nextAlternate = "gou";
      this.alternateDaInput = input;
    } else {
      sample = "gou";
      this.nextAlternate = "da";
      hitInput = this.alternateDaInput ?? input;
      this.alternateDaInput = null;
    }
    const queued = this.queue({
      input: hitInput,
      sample,
      ownerPressId: input.pressId,
      held: true
    }, 0, nowMs);
    this.activePresses.set(input.pressId, {
      input,
      downStep: queued.stepIndex,
      groupId: queued.groupId
    });
  }

  private handleUp(input: DogKeyInputEvent): void {
    const active = this.activePresses.get(input.pressId);
    if (!active) return;
    this.activePresses.delete(input.pressId);
    if (active.groupId) this.output.releaseGroup(active.groupId, "tail");
    if (active.input.role === "normal" && this.soundMode === "da-gou") {
      this.queue({
        input: active.input,
        sample: "gou",
        ownerPressId: input.pressId,
        held: false
      }, active.downStep + 1);
    }
  }

  private queue(
    hit: GrooveHit,
    minimumStep = 0,
    nowMs = this.output.currentTime() * 1000
  ): QueueResult {
    const idle = nowMs - this.lastInputMs >= GROOVE_IDLE_RESET_MS;
    if (this.originMs === null || idle) {
      this.scheduled.clear();
      this.originMs = nowMs + GROOVE_FIRST_HIT_DELAY_MS;
      this.nextAvailableStep = 0;
      this.transportId += 1;
    }
    this.lastInputMs = nowMs;
    for (const [step, scheduled] of this.scheduled) {
      if (scheduled.atMs < nowMs) this.scheduled.delete(step);
    }
    const base = idle
      ? { stepIndex: 0, atMs: this.originMs }
      : quantizeGrooveStep(nowMs, this.originMs, this.bpm, minimumStep);
    const stepIndex = Math.max(base.stepIndex, this.nextAvailableStep);
    const maximumStep = base.stepIndex + GROOVE_MAX_QUEUED_STEPS - 1;
    if (stepIndex > maximumStep) {
      const safelyReplaceable = [...this.scheduled.values()]
        .filter((scheduled) => scheduled.atMs >= nowMs + GROOVE_LOOKAHEAD_MS);
      const replaceable = safelyReplaceable
        .filter((scheduled) => scheduled.sample === hit.sample)
        .sort((left, right) => right.stepIndex - left.stepIndex)[0] ??
        safelyReplaceable.sort((left, right) => right.stepIndex - left.stepIndex)[0];
      if (replaceable) {
        this.detachGroupFromOwner(replaceable);
        replaceable.input = hit.input;
        replaceable.sample = hit.sample;
        replaceable.ownerPressId = hit.ownerPressId;
        replaceable.held = hit.held;
        this.schedule(replaceable);
        return { stepIndex: replaceable.stepIndex, groupId: replaceable.groupId };
      }
      return { stepIndex: maximumStep, groupId: null };
    }

    const atMs = this.originMs + stepIndex * grooveStepMilliseconds(this.bpm);
    const scheduled: ScheduledGrooveHit = {
      ...hit,
      stepIndex,
      atMs,
      groupId: `${this.transportId}:${stepIndex}`
    };
    this.scheduled.set(stepIndex, scheduled);
    this.schedule(scheduled);
    this.nextAvailableStep = stepIndex + 1;
    return { stepIndex, groupId: scheduled.groupId };
  }

  private detachGroupFromOwner(hit: ScheduledGrooveHit): void {
    const active = this.activePresses.get(hit.ownerPressId);
    if (active?.groupId === hit.groupId) active.groupId = null;
  }

  private schedule(hit: ScheduledGrooveHit): void {
    this.output.scheduleVoices(
      hit.groupId,
      createGrooveVoices(hit.sample, hit.input, hit.stepIndex),
      hit.atMs / 1000,
      hit.held
    );
  }
}
