import { contextBridge, ipcRenderer } from "electron";
import type {
  AudioSampleName,
  DogInputEvent,
  PetDragRegion,
  PetMoveRequest
} from "../shared/contracts";
import type { AppSettings } from "../shared/settings";
import type {
  ExternalTarget,
  UpdateState
} from "../shared/update-contracts";

// Sandboxed preloads cannot require local modules unless they are bundled.
const IPC_CHANNELS = {
  getSettings: "dagou:get-settings",
  updateSettings: "dagou:update-settings",
  resetSettings: "dagou:reset-settings",
  resizePet: "dagou:resize-pet",
  openSettings: "dagou:open-settings",
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

const api = {
  getSettings(): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.getSettings) as Promise<AppSettings>;
  },

  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return ipcRenderer.invoke(
      IPC_CHANNELS.updateSettings,
      patch
    ) as Promise<AppSettings>;
  },

  resetSettings(): Promise<AppSettings> {
    return ipcRenderer.invoke(
      IPC_CHANNELS.resetSettings
    ) as Promise<AppSettings>;
  },

  resizePet(scale: number): void {
    ipcRenderer.send(IPC_CHANNELS.resizePet, scale);
  },

  openSettings(anchor: PetDragRegion): void {
    ipcRenderer.send(IPC_CHANNELS.openSettings, anchor);
  },

  openExternal(target: ExternalTarget): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.openExternal, target) as Promise<void>;
  },

  getUpdateState(): Promise<UpdateState> {
    return ipcRenderer.invoke(
      IPC_CHANNELS.getUpdateState
    ) as Promise<UpdateState>;
  },

  checkForUpdates(): Promise<UpdateState> {
    return ipcRenderer.invoke(
      IPC_CHANNELS.checkForUpdates
    ) as Promise<UpdateState>;
  },

  downloadUpdate(): Promise<UpdateState> {
    return ipcRenderer.invoke(
      IPC_CHANNELS.downloadUpdate
    ) as Promise<UpdateState>;
  },

  installUpdate(): void {
    ipcRenderer.send(IPC_CHANNELS.installUpdate);
  },

  movePet(request: PetMoveRequest): void {
    ipcRenderer.send(IPC_CHANNELS.movePet, request);
  },

  setPetMouseInteractive(interactive: boolean): void {
    ipcRenderer.send(IPC_CHANNELS.setPetMouseInteractive, interactive);
  },

  async loadAudio(name: AudioSampleName): Promise<ArrayBuffer> {
    const bytes = (await ipcRenderer.invoke(
      IPC_CHANNELS.loadAudio,
      name
    )) as Uint8Array;
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  },

  notifyReady(): void {
    ipcRenderer.send(IPC_CHANNELS.rendererReady);
  },

  notifyFailed(message: string): void {
    ipcRenderer.send(IPC_CHANNELS.rendererFailed, message);
  },

  onInput(callback: (event: DogInputEvent) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: DogInputEvent) => {
      callback(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.input, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.input, listener);
  },

  onSettingsChanged(callback: (settings: AppSettings) => void): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: AppSettings
    ) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.settingsChanged, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.settingsChanged, listener);
  },

  onUpdateStateChanged(callback: (state: UpdateState) => void): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: UpdateState
    ) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.updateStateChanged, listener);
    return () => ipcRenderer.removeListener(
      IPC_CHANNELS.updateStateChanged,
      listener
    );
  }
};

contextBridge.exposeInMainWorld("dagou", api);
