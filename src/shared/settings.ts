import { DEFAULT_JIAO_KEY_CODES } from "./key-classifier";

export const SOUND_MODES = ["alternate", "da-gou"] as const;
export type SoundMode = (typeof SOUND_MODES)[number];
export const PLAYBACK_MODES = ["groove", "instant"] as const;
export type PlaybackMode = (typeof PLAYBACK_MODES)[number];
export const GROOVE_BPM_MIN = 96;
export const GROOVE_BPM_MAX = 168;
export const PET_WINDOW_BASE_SIZE = 310;
export const PET_SCALE_MIN = 0.65;
export const PET_SCALE_MAX = 5;
export const REACTION_INTENSITY_MIN = 0.5;
export const REACTION_INTENSITY_MAX = 2;

export interface AppSettings {
  volume: number;
  muted: boolean;
  listening: boolean;
  clickThrough: boolean;
  alwaysOnTop: boolean;
  scale: number;
  reactionIntensity: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  x: number | null;
  y: number | null;
  playbackMode: PlaybackMode;
  grooveBpm: number;
  soundMode: SoundMode;
  jiaoKeyCodes: readonly number[];
  melodyEnabled: boolean;
  jiaoSustainPitch: number;
}

export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
  volume: 0.72,
  muted: false,
  listening: true,
  clickThrough: false,
  alwaysOnTop: true,
  scale: 1,
  reactionIntensity: 1.25,
  flipHorizontal: false,
  flipVertical: false,
  x: null,
  y: null,
  playbackMode: "groove",
  grooveBpm: 128,
  soundMode: "alternate",
  jiaoKeyCodes: DEFAULT_JIAO_KEY_CODES,
  melodyEnabled: true,
  jiaoSustainPitch: 0
});

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function soundModeOr(value: unknown): SoundMode {
  return value === "da-gou" || value === "alternate"
    ? value
    : DEFAULT_SETTINGS.soundMode;
}

function playbackModeOr(value: unknown): PlaybackMode {
  return value === "instant" || value === "groove"
    ? value
    : DEFAULT_SETTINGS.playbackMode;
}

function keyCodesOr(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return [...DEFAULT_JIAO_KEY_CODES];
  return [
    ...new Set(
      value.filter(
        (item): item is number =>
          typeof item === "number" &&
          Number.isInteger(item) &&
          item >= 0 &&
          item <= 0xffff
      )
    )
  ].slice(0, 64);
}

export function normalizeSettings(value: unknown): AppSettings {
  const source = asRecord(value);
  return {
    volume: clampNumber(source.volume, DEFAULT_SETTINGS.volume, 0, 1),
    muted: booleanOr(source.muted, DEFAULT_SETTINGS.muted),
    listening: booleanOr(source.listening, DEFAULT_SETTINGS.listening),
    clickThrough: booleanOr(
      source.clickThrough,
      DEFAULT_SETTINGS.clickThrough
    ),
    alwaysOnTop: booleanOr(source.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop),
    scale: clampNumber(
      source.scale,
      DEFAULT_SETTINGS.scale,
      PET_SCALE_MIN,
      PET_SCALE_MAX
    ),
    reactionIntensity: clampNumber(
      source.reactionIntensity,
      DEFAULT_SETTINGS.reactionIntensity,
      REACTION_INTENSITY_MIN,
      REACTION_INTENSITY_MAX
    ),
    flipHorizontal: booleanOr(
      source.flipHorizontal,
      DEFAULT_SETTINGS.flipHorizontal
    ),
    flipVertical: booleanOr(source.flipVertical, DEFAULT_SETTINGS.flipVertical),
    x: finiteOrNull(source.x),
    y: finiteOrNull(source.y),
    playbackMode: playbackModeOr(source.playbackMode),
    grooveBpm: Math.round(clampNumber(
      source.grooveBpm,
      DEFAULT_SETTINGS.grooveBpm,
      GROOVE_BPM_MIN,
      GROOVE_BPM_MAX
    )),
    soundMode: soundModeOr(source.soundMode),
    jiaoKeyCodes: keyCodesOr(source.jiaoKeyCodes),
    melodyEnabled: booleanOr(
      source.melodyEnabled,
      DEFAULT_SETTINGS.melodyEnabled
    ),
    jiaoSustainPitch: clampNumber(
      source.jiaoSustainPitch,
      DEFAULT_SETTINGS.jiaoSustainPitch,
      -7,
      7
    )
  };
}
