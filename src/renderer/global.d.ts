import type {
  AudioSampleName,
  DogInputEvent,
  PetMoveRequest
} from "../shared/contracts";
import type { AppSettings } from "../shared/settings";

declare global {
  interface Window {
    dagou: {
      getSettings(): Promise<AppSettings>;
      updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
      resizePet(scale: number): Promise<AppSettings>;
      movePet(request: PetMoveRequest): void;
      setPetMouseInteractive(interactive: boolean): void;
      loadAudio(name: AudioSampleName): Promise<ArrayBuffer>;
      notifyReady(): void;
      notifyFailed(message: string): void;
      onInput(callback: (event: DogInputEvent) => void): () => void;
      onSettingsChanged(callback: (settings: AppSettings) => void): () => void;
    };
  }
}

export {};
