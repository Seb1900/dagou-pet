import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "../src/renderer/audio-engine";

class FakeAudioParam {
  constructor(public value = 1) {}
  cancelScheduledValues = vi.fn();
  setTargetAtTime = vi.fn((value: number) => {
    this.value = value;
  });
}

class FakeAudioNode {
  readonly connections: FakeAudioNode[] = [];
  disconnected = false;
  connect(target: FakeAudioNode): FakeAudioNode {
    this.connections.push(target);
    return target;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam();
}

class FakeCompressorNode extends FakeAudioNode {
  readonly threshold = new FakeAudioParam();
  readonly knee = new FakeAudioParam();
  readonly ratio = new FakeAudioParam();
  readonly attack = new FakeAudioParam();
  readonly release = new FakeAudioParam();
}

class FakeMessagePort {
  readonly messages: unknown[] = [];
  readonly postMessage = vi.fn((message: unknown) => this.messages.push(message));
  readonly close = vi.fn();
}

class FakeAudioWorkletNode extends FakeAudioNode {
  static latest: FakeAudioWorkletNode | null = null;
  readonly port = new FakeMessagePort();
  constructor() {
    super();
    FakeAudioWorkletNode.latest = this;
  }
}

class FakeAudioContext {
  static latest: FakeAudioContext | null = null;
  readonly currentTime = 10;
  readonly state = "running";
  readonly destination = new FakeAudioNode();
  readonly gains: FakeGainNode[] = [];
  readonly audioWorklet = { addModule: vi.fn(async () => undefined) };
  compressor: FakeCompressorNode | null = null;
  readonly resume = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);

  constructor() {
    FakeAudioContext.latest = this;
  }

  createGain(): GainNode {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node as unknown as GainNode;
  }

  createDynamicsCompressor(): DynamicsCompressorNode {
    this.compressor = new FakeCompressorNode();
    return this.compressor as unknown as DynamicsCompressorNode;
  }

  async decodeAudioData(): Promise<AudioBuffer> {
    const left = new Float32Array([0, 0.5, -0.5, 0]);
    const right = new Float32Array([0, 0.25, -0.25, 0]);
    return {
      length: 4,
      numberOfChannels: 2,
      getChannelData: (channel: number) => (channel === 0 ? left : right)
    } as AudioBuffer;
  }
}

async function setup() {
  vi.stubGlobal("window", { AudioContext: FakeAudioContext });
  vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
  const engine = new AudioEngine();
  await engine.initialize(async () => new ArrayBuffer(8));
  const context = FakeAudioContext.latest!;
  const worklet = FakeAudioWorkletNode.latest!;
  return { context, worklet, engine };
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeAudioContext.latest = null;
  FakeAudioWorkletNode.latest = null;
});

describe("AudioEngine", () => {
  it("loads the worklet, downmixes all three samples and configures mastering", async () => {
    const { context, worklet, engine } = await setup();
    expect(context.audioWorklet.addModule).toHaveBeenCalledTimes(1);
    expect(context.compressor?.threshold.value).toBe(-8);
    expect(context.compressor?.ratio.value).toBe(8);
    expect(context.gains[0].connections[0]).toBe(context.compressor);
    expect(context.compressor?.connections[0]).toBe(context.destination);
    expect(worklet.port.messages[0]).toMatchObject({ type: "initialize" });
    engine.dispose();
  });

  it("sends note lifecycle, one-shot and live jiao pitch commands", async () => {
    const { worklet, engine } = await setup();
    const spec = {
      sample: "jiao" as const,
      role: "jiao" as const,
      pitchSemitones: 2,
      gain: 0.6,
      pan: 0
    };
    engine.noteOn(4, spec);
    engine.setJiaoSustainPitch(3);
    engine.noteOff(4, "tail");
    engine.playOneShot({ ...spec, sample: "gou", role: "normal" });
    expect(worklet.port.messages.slice(1)).toEqual([
      { type: "note-on", pressId: 4, spec },
      { type: "jiao-pitch", semitones: 3 },
      { type: "note-off", pressId: 4, release: "tail" },
      {
        type: "one-shot",
        pressId: -1,
        spec: { ...spec, sample: "gou", role: "normal" }
      }
    ]);
    engine.dispose();
  });

  it("queues a follow-up voice behind the released voice", async () => {
    const { worklet, engine } = await setup();
    const da = {
      sample: "da" as const,
      role: "normal" as const,
      pitchSemitones: 2,
      gain: 0.9,
      pan: 0.1
    };
    const gou = { ...da, sample: "gou" as const };
    engine.noteOn(8, da);
    engine.noteOff(8, "tail", gou);
    expect(worklet.port.messages.slice(1)).toEqual([
      { type: "note-on", pressId: 8, spec: da },
      {
        type: "note-off",
        pressId: 8,
        release: "tail",
        followUp: { pressId: -1, spec: gou }
      }
    ]);
    engine.dispose();
  });

  it("mutes through the master gain and stops all voices on disposal", async () => {
    const { context, worklet, engine } = await setup();
    engine.setMuted(true);
    expect(context.gains[0].gain.value).toBe(0);
    engine.dispose();
    expect(worklet.port.messages.at(-1)).toEqual({ type: "stop-all" });
    expect(worklet.disconnected).toBe(true);
    expect(context.close).toHaveBeenCalled();
  });
});
