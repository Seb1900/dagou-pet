export const IPC_CHANNELS = {
  getSettings: "dagou:get-settings",
  updateSettings: "dagou:update-settings",
  resizePet: "dagou:resize-pet",
  openSettings: "dagou:open-settings",
  getAppInfo: "dagou:get-app-info",
  openExternal: "dagou:open-external",
  getUpdateState: "dagou:get-update-state",
  checkForUpdates: "dagou:check-for-updates",
  downloadUpdate: "dagou:download-update",
  installUpdate: "dagou:install-update",
  updateStateChanged: "dagou:update-state-changed",
  movePet: "dagou:move-pet",
  setPetMouseInteractive: "dagou:set-pet-mouse-interactive",
  input: "dagou:input",
  loadAudio: "dagou:load-audio",
  rendererFailed: "dagou:renderer-failed",
  rendererReady: "dagou:renderer-ready",
  settingsChanged: "dagou:settings-changed"
} as const;

export const KEYBOARD_SAMPLE_NAMES = ["da", "gou", "jiao"] as const;
export type KeyboardSampleName = (typeof KEYBOARD_SAMPLE_NAMES)[number];

export const AUDIO_SAMPLE_NAMES = [...KEYBOARD_SAMPLE_NAMES, "ei"] as const;
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
