import type {
  AudioSampleName,
  DogKeyInputEvent,
  DogKeyRole,
  KeyboardSampleName
} from "../shared/contracts";

export interface SustainProfile {
  loopStart: number;
  loopEnd: number;
  crossfade: number;
}

export const SUSTAIN_PROFILES: Record<KeyboardSampleName, SustainProfile> = {
  da: { loopStart: 0.0635, loopEnd: 0.1195, crossfade: 0.01 },
  gou: { loopStart: 0.145, loopEnd: 0.197, crossfade: 0.01 },
  jiao: { loopStart: 0.139, loopEnd: 0.22, crossfade: 0.014 }
};

export interface VoiceSpec {
  sample: AudioSampleName;
  role: DogKeyRole;
  pitchSemitones: number;
  gain: number;
  pan: number;
}

const SAMPLE_GAINS: Record<AudioSampleName, number> = {
  da: 0.92,
  gou: 0.92,
  jiao: 1,
  ei: 0.92
};

export function createVoiceSpec(
  sample: KeyboardSampleName,
  input: Pick<DogKeyInputEvent, "role" | "pitchStep" | "pan">
): VoiceSpec {
  return {
    sample,
    role: input.role,
    pitchSemitones: input.pitchStep,
    gain: SAMPLE_GAINS[sample],
    pan: input.pan
  };
}

export function createEiVoiceSpec(): VoiceSpec {
  return {
    sample: "ei",
    role: "normal",
    pitchSemitones: 0,
    gain: SAMPLE_GAINS.ei,
    pan: 0
  };
}

export function pitchRate(semitones: number): number {
  return 2 ** (semitones / 12);
}
