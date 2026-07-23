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

declare global {
  interface Window {
    dagou: {
      getSettings(): Promise<AppSettings>;
      updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
      resetSettings(): Promise<AppSettings>;
      resizePet(scale: number): void;
      openSettings(anchor: PetDragRegion): void;
      openExternal(target: ExternalTarget): Promise<void>;
      getUpdateState(): Promise<UpdateState>;
      checkForUpdates(): Promise<UpdateState>;
      downloadUpdate(): Promise<UpdateState>;
      installUpdate(): void;
      movePet(request: PetMoveRequest): void;
      setPetMouseInteractive(interactive: boolean): void;
      loadAudio(name: AudioSampleName): Promise<ArrayBuffer>;
      notifyReady(): void;
      notifyFailed(message: string): void;
      onInput(callback: (event: DogInputEvent) => void): () => void;
      onSettingsChanged(callback: (settings: AppSettings) => void): () => void;
      onUpdateStateChanged(callback: (state: UpdateState) => void): () => void;
    };
  }
}

export {};
