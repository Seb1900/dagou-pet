import {
  AUDIO_SAMPLE_NAMES,
  type AudioSampleName
} from "../shared/contracts";
import {
  SUSTAIN_PROFILES,
  type VoiceSpec
} from "./sound-profile";

interface WorkletMessage {
  type: string;
  [key: string]: unknown;
}

const processorUrl = new URL("./sustain-processor.js", import.meta.url);

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private volume = 0.72;
  private muted = false;
  private oneShotId = -1;

  async initialize(
    loader: (name: AudioSampleName) => Promise<ArrayBuffer>
  ): Promise<void> {
    const AudioContextClass = window.AudioContext;
    this.context = new AudioContextClass({ latencyHint: "interactive" });
    this.master = this.context.createGain();
    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.value = -8;
    this.compressor.knee.value = 10;
    this.compressor.ratio.value = 8;
    this.compressor.attack.value = 0.002;
    this.compressor.release.value = 0.12;
    this.master.connect(this.compressor);
    this.compressor.connect(this.context.destination);
    this.applyMasterGain();

    const decodedEntries = await Promise.all(
      AUDIO_SAMPLE_NAMES.map(async (name) => {
        const bytes = await loader(name);
        const decoded = await this.context!.decodeAudioData(bytes.slice(0));
        return [name, this.toMono(decoded)] as const;
      })
    );

    await this.context.audioWorklet.addModule(processorUrl);
    this.worklet = new AudioWorkletNode(this.context, "dagou-sustain-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
    this.worklet.connect(this.master);

    const samples = Object.fromEntries(decodedEntries) as Record<
      AudioSampleName,
      Float32Array
    >;
    this.post(
      { type: "initialize", samples, profiles: SUSTAIN_PROFILES },
      AUDIO_SAMPLE_NAMES.map((name) => samples[name].buffer)
    );
  }

  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
    this.applyMasterGain();
  }

  setMuted(value: boolean): void {
    this.muted = value;
    this.applyMasterGain();
  }

  noteOn(pressId: number, spec: VoiceSpec): void {
    this.resume();
    this.post({ type: "note-on", pressId, spec });
  }

  noteOff(
    pressId: number,
    release: "tail" | "fade",
    followUp?: VoiceSpec
  ): void {
    const message: WorkletMessage = { type: "note-off", pressId, release };
    if (followUp) {
      message.followUp = { pressId: this.oneShotId--, spec: followUp };
    }
    this.post(message);
  }

  playOneShot(spec: VoiceSpec): void {
    this.resume();
    this.post({ type: "one-shot", pressId: this.oneShotId--, spec });
  }

  currentTime(): number {
    return this.context?.currentTime ?? performance.now() / 1000;
  }

  scheduleVoices(
    groupId: string,
    specs: readonly VoiceSpec[],
    startTime: number,
    held = false
  ): void {
    if (!this.context || !this.worklet || specs.length === 0) return;
    this.resume();
    const voices = specs.map((spec) => ({
      pressId: this.oneShotId--,
      spec
    }));
    this.post({
      type: "schedule-voices",
      groupId,
      startFrame: Math.max(0, Math.round(startTime * this.context.sampleRate)),
      held,
      voices
    });
  }

  releaseGroup(
    groupId: string,
    release: "tail" | "fade" = "tail"
  ): void {
    this.post({ type: "release-group", groupId, release });
  }

  setJiaoSustainPitch(semitones: number): void {
    this.post({ type: "jiao-pitch", semitones });
  }

  stopAll(): void {
    this.post({ type: "stop-all" });
  }

  dispose(): void {
    this.stopAll();
    this.worklet?.disconnect();
    this.worklet?.port.close();
    this.master?.disconnect();
    this.compressor?.disconnect();
    if (this.context) void this.context.close();
    this.worklet = null;
    this.context = null;
    this.master = null;
    this.compressor = null;
  }

  private toMono(buffer: AudioBuffer): Float32Array {
    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const source = buffer.getChannelData(channel);
      for (let index = 0; index < mono.length; index += 1) {
        mono[index] += source[index] / buffer.numberOfChannels;
      }
    }
    return mono;
  }

  private resume(): void {
    if (this.context?.state === "suspended") void this.context.resume();
  }

  private post(message: WorkletMessage, transfer: Transferable[] = []): void {
    this.worklet?.port.postMessage(message, transfer);
  }

  private applyMasterGain(): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const target = this.muted ? 0 : this.volume;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(target, now, 0.012);
  }
}
