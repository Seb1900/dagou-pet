export const IPC_CHANNELS = {
  getSettings: "dagou:get-settings",
  updateSettings: "dagou:update-settings",
  resizePet: "dagou:resize-pet",
  movePet: "dagou:move-pet",
  setPetMouseInteractive: "dagou:set-pet-mouse-interactive",
  input: "dagou:input",
  loadAudio: "dagou:load-audio",
  rendererFailed: "dagou:renderer-failed",
  rendererReady: "dagou:renderer-ready",
  settingsChanged: "dagou:settings-changed"
} as const;

export const AUDIO_SAMPLE_NAMES = ["da", "gou", "jiao"] as const;
export type AudioSampleName = (typeof AUDIO_SAMPLE_NAMES)[number];
export type DogKeyRole = "normal" | "jiao";

export interface PetPoint {
  x: number;
  y: number;
}

export interface PetDragRegion extends PetPoint {
  width: number;
  height: number;
}

export interface PetMoveRequest {
  position: PetPoint;
  pointer: PetPoint;
  dragRegion: PetDragRegion;
}

export interface DogKeyInputEvent {
  type: "key";
  phase: "down" | "up";
  pressId: number;
  role: DogKeyRole;
  pitchStep: number;
  pan: number;
  heldCount: number;
  timestamp: number;
}

export interface DogResetInputEvent {
  type: "reset";
  heldCount: 0;
  timestamp: number;
}

export type DogInputEvent = DogKeyInputEvent | DogResetInputEvent;
