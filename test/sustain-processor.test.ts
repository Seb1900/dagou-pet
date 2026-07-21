import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { SUSTAIN_PROFILES } from "../src/renderer/sound-profile";

interface TestProcessor {
  voices: Map<number, unknown>;
  handleMessage(message: unknown): void;
  process(inputs: unknown[], outputs: Float32Array[][]): boolean;
}

function loadProcessor(): new () => TestProcessor {
  let registered: (new () => TestProcessor) | null = null;
  class AudioWorkletProcessorStub {
    readonly port: { onmessage: ((event: { data: unknown }) => void) | null } = {
      onmessage: null
    };
  }
  const source = readFileSync(
    resolve(process.cwd(), "src/renderer/sustain-processor.js"),
    "utf8"
  );
  runInNewContext(source, {
    AudioWorkletProcessor: AudioWorkletProcessorStub,
    sampleRate: 1000,
    registerProcessor: (_name: string, processor: new () => TestProcessor) => {
      registered = processor;
    },
    Float32Array,
    Map,
    Set,
    Math,
    Number,
    Object
  });
  if (!registered) throw new Error("Audio worklet did not register its processor");
  return registered;
}

function sine(length: number, frequency: number): Float32Array {
  return Float32Array.from(
    { length },
    (_, index) => Math.sin((index / 1000) * frequency * Math.PI * 2) * 0.5
  );
}

function renderBlock(processor: TestProcessor): Float32Array[][] {
  const output = [[new Float32Array(128), new Float32Array(128)]];
  expect(processor.process([], output)).toBe(true);
  for (const channel of output[0]) {
    expect([...channel].every(Number.isFinite)).toBe(true);
  }
  return output;
}

describe("DagouSustainProcessor", () => {
  it("finishes a quick da before starting its queued gou", () => {
    const Processor = loadProcessor();
    const processor = new Processor();
    const samples = {
      da: sine(300, 120),
      gou: sine(300, 90),
      jiao: sine(500, 120)
    };
    processor.handleMessage({
      type: "initialize",
      samples,
      profiles: SUSTAIN_PROFILES
    });
    const daSpec = {
      sample: "da",
      role: "normal",
      pitchSemitones: 0,
      gain: 0.5,
      pan: 0
    };
    processor.handleMessage({ type: "note-on", pressId: 1, spec: daSpec });
    processor.handleMessage({
      type: "note-off",
      pressId: 1,
      release: "tail",
      followUp: {
        pressId: -1,
        spec: { ...daSpec, sample: "gou" }
      }
    });

    renderBlock(processor);
    expect(processor.voices.has(1)).toBe(true);
    expect(processor.voices.has(-1)).toBe(false);
    renderBlock(processor);
    renderBlock(processor);
    expect(processor.voices.has(1)).toBe(false);
    expect(processor.voices.has(-1)).toBe(true);
  });

  it("holds one attack indefinitely and fades after release", () => {
    const Processor = loadProcessor();
    const processor = new Processor();
    processor.handleMessage({
      type: "initialize",
      samples: {
        da: sine(300, 120),
        gou: sine(300, 90),
        jiao: sine(500, 120)
      },
      profiles: SUSTAIN_PROFILES
    });
    processor.handleMessage({
      type: "note-on",
      pressId: 1,
      spec: {
        sample: "da",
        role: "normal",
        pitchSemitones: 0,
        gain: 0.5,
        pan: 0
      }
    });

    let energy = 0;
    for (let index = 0; index < 20; index += 1) {
      const output = renderBlock(processor);
      energy += output[0][0].reduce((sum, value) => sum + Math.abs(value), 0);
    }
    expect(energy).toBeGreaterThan(1);
    expect(processor.voices.has(1)).toBe(true);

    processor.handleMessage({ type: "note-off", pressId: 1, release: "tail" });
    expect(processor.voices.has(1)).toBe(true);
    renderBlock(processor);
    renderBlock(processor);
    expect(processor.voices.has(1)).toBe(false);
  });

  it("smoothly accepts live jiao pitch changes and forced release", () => {
    const Processor = loadProcessor();
    const processor = new Processor();
    processor.handleMessage({
      type: "initialize",
      samples: {
        da: sine(300, 120),
        gou: sine(300, 90),
        jiao: sine(500, 120)
      },
      profiles: SUSTAIN_PROFILES
    });
    processor.handleMessage({
      type: "note-on",
      pressId: 2,
      spec: {
        sample: "jiao",
        role: "jiao",
        pitchSemitones: 2,
        gain: 0.6,
        pan: 0.2
      }
    });
    renderBlock(processor);
    renderBlock(processor);
    processor.handleMessage({ type: "jiao-pitch", semitones: 4 });
    processor.handleMessage({ type: "note-off", pressId: 2, release: "fade" });
    renderBlock(processor);
    expect(processor.voices.has(2)).toBe(false);
  });

  it("uses subtle jiao vibrato and a short smooth release fade", () => {
    const Processor = loadProcessor();
    const processor = new Processor();
    processor.handleMessage({
      type: "initialize",
      samples: {
        da: sine(300, 120),
        gou: sine(300, 90),
        jiao: sine(500, 120)
      },
      profiles: SUSTAIN_PROFILES
    });
    processor.handleMessage({
      type: "note-on",
      pressId: 3,
      spec: {
        sample: "jiao",
        role: "jiao",
        pitchSemitones: 0,
        gain: 0.6,
        pan: 0
      }
    });
    for (let index = 0; index < 10; index += 1) renderBlock(processor);
    const voice = processor.voices.get(3) as {
      targetRate: number;
      forcedFadeRemaining: number;
    };
    expect(voice.targetRate).toBeGreaterThan(0.98);
    expect(voice.targetRate).toBeLessThan(1.02);

    processor.handleMessage({ type: "note-off", pressId: 3, release: "tail" });
    expect(voice.forcedFadeRemaining).toBe(200);
    const firstFadeBlock = renderBlock(processor);
    expect(processor.voices.has(3)).toBe(true);
    const secondFadeBlock = renderBlock(processor);
    expect(processor.voices.has(3)).toBe(false);
    const energy = (output: Float32Array[][]) =>
      output[0][0].reduce((sum, value) => sum + Math.abs(value), 0);
    expect(energy(secondFadeBlock)).toBeLessThan(energy(firstFadeBlock));
  });

  it("starts a queued gou after a held da finishes fading", () => {
    const Processor = loadProcessor();
    const processor = new Processor();
    const samples = {
      da: sine(300, 120),
      gou: sine(300, 90),
      jiao: sine(500, 120)
    };
    processor.handleMessage({
      type: "initialize",
      samples,
      profiles: SUSTAIN_PROFILES
    });
    const daSpec = {
      sample: "da",
      role: "normal",
      pitchSemitones: 0,
      gain: 0.5,
      pan: 0
    };
    processor.handleMessage({ type: "note-on", pressId: 4, spec: daSpec });
    for (let index = 0; index < 10; index += 1) renderBlock(processor);
    processor.handleMessage({
      type: "note-off",
      pressId: 4,
      release: "tail",
      followUp: {
        pressId: -4,
        spec: { ...daSpec, sample: "gou" }
      }
    });

    renderBlock(processor);
    expect(processor.voices.has(4)).toBe(true);
    expect(processor.voices.has(-4)).toBe(false);
    renderBlock(processor);
    expect(processor.voices.has(4)).toBe(false);
    expect(processor.voices.has(-4)).toBe(true);
  });
});
