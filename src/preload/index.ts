import { contextBridge, ipcRenderer } from "electron";
import type {
  AudioSampleName,
  DogInputEvent,
  PetMoveRequest
} from "../shared/contracts";
import type { AppSettings } from "../shared/settings";

// Sandboxed preloads cannot require local modules unless they are bundled.
const IPC_CHANNELS = {
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

  resizePet(scale: number): Promise<AppSettings> {
    return ipcRenderer.invoke(
      IPC_CHANNELS.resizePet,
      scale
    ) as Promise<AppSettings>;
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
  }
};

contextBridge.exposeInMainWorld("dagou", api);
