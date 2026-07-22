import type { DogInputEvent, DogKeyInputEvent } from "../shared/contracts";
import type {
  AppSettings,
  PlaybackMode,
  SoundMode
} from "../shared/settings";
import { GroovePlayer } from "./groove-player";
import { createVoiceSpec, type VoiceSpec } from "./sound-profile";

export interface SoundOutput {
  noteOn(pressId: number, spec: VoiceSpec): void;
  noteOff(
    pressId: number,
    release: "tail" | "fade",
    followUp?: VoiceSpec
  ): void;
  playOneShot(spec: VoiceSpec): void;
  currentTime(): number;
  scheduleVoices(
    groupId: string,
    specs: readonly VoiceSpec[],
    startTime: number,
    held?: boolean
  ): void;
  releaseGroup(groupId: string, release?: "tail" | "fade"): void;
  setJiaoSustainPitch(semitones: number): void;
  stopAll(): void;
}

interface ActiveSound {
  input: DogKeyInputEvent;
  mode: SoundMode;
}

export class SoundController {
  private readonly active = new Map<number, ActiveSound>();
  private mode: SoundMode = "alternate";
  private playbackMode: PlaybackMode = "groove";
  private grooveBpm = 128;
  private nextAlternate: "da" | "gou" = "da";
  private alternateDaExpression: Pick<
    DogKeyInputEvent,
    "pitchStep" | "pan"
  > | null = null;
  private configured = false;
  private readonly groove: GroovePlayer;

  constructor(private readonly output: SoundOutput) {
    this.groove = new GroovePlayer(output);
  }

  configure(settings: Pick<
    AppSettings,
    "soundMode" | "jiaoSustainPitch" | "playbackMode" | "grooveBpm"
  >): void {
    const playbackChanged = settings.playbackMode !== this.playbackMode;
    const activeGrooveTempoChanged =
      settings.grooveBpm !== this.grooveBpm &&
      settings.playbackMode === "groove" &&
      this.playbackMode === "groove";
    if (
      this.configured &&
      (settings.soundMode !== this.mode ||
        playbackChanged ||
        activeGrooveTempoChanged)
    ) {
      this.reset();
    }
    this.mode = settings.soundMode;
    this.playbackMode = settings.playbackMode;
    this.grooveBpm = settings.grooveBpm;
    this.groove.configure(settings);
    this.configured = true;
    this.output.setJiaoSustainPitch(settings.jiaoSustainPitch);
  }

  handle(event: DogInputEvent): void {
    if (event.type === "reset") {
      this.reset();
      return;
    }
    if (this.playbackMode === "groove") {
      this.groove.handle(event);
      return;
    }
    if (event.phase === "down") this.handleDown(event);
    else this.handleUp(event);
  }

  reset(): void {
    this.active.clear();
    this.nextAlternate = "da";
    this.alternateDaExpression = null;
    this.groove.reset();
    this.output.stopAll();
  }

  private handleDown(event: DogKeyInputEvent): void {
    if (this.active.has(event.pressId)) return;
    const spec = event.role === "jiao"
      ? createVoiceSpec("jiao", event)
      : this.mode === "da-gou"
        ? createVoiceSpec("da", event)
        : this.takeAlternateSpec(event);
    this.active.set(event.pressId, { input: event, mode: this.mode });
    this.output.noteOn(event.pressId, spec);
  }

  private handleUp(event: DogKeyInputEvent): void {
    const active = this.active.get(event.pressId);
    if (!active) return;
    this.active.delete(event.pressId);
    if (active.input.role === "jiao" || active.mode === "alternate") {
      this.output.noteOff(event.pressId, "tail");
      return;
    }
    this.output.noteOff(
      event.pressId,
      "tail",
      createVoiceSpec("gou", active.input)
    );
  }

  private takeAlternateSpec(event: DogKeyInputEvent): VoiceSpec {
    if (this.nextAlternate === "da") {
      this.nextAlternate = "gou";
      this.alternateDaExpression = {
        pitchStep: event.pitchStep,
        pan: event.pan
      };
      return createVoiceSpec("da", event);
    }

    this.nextAlternate = "da";
    const expression = this.alternateDaExpression ?? event;
    this.alternateDaExpression = null;
    return createVoiceSpec("gou", {
      role: event.role,
      pitchStep: expression.pitchStep,
      pan: expression.pan
    });
  }
}
