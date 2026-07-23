import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { SUSTAIN_PROFILES } from "../src/renderer/sound-profile";

interface TestProcessor {
  voices: Map<number, {
    state: string;
    position: number;
    held: boolean;
    released: boolean;
    releasePending: boolean;
    forcedFadeRemaining: number;
    sustainRendered: number;
    currentRate: number;
    targetRate: number;
    groupId: string | null;
  }>;
  pendingGroups: Map<string, {
    startFrame: number;
    voices: readonly { pressId: number }[];
    held: boolean;
  }>;
  frameCursor: number;
  handleMessage(message: unknown): void;
  process(inputs: unknown[], outputs: Float32Array[][]): boolean;
}

function loadProcessor(initialCurrentFrame = 0): new () => TestProcessor {
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
    currentFrame: initialCurrentFrame,
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
  it("plays ei once without a sustain profile and rejects held ei voices", () => {
    const Processor = loadProcessor();
    const processor = new Processor();
    processor.handleMessage({
      type: "initialize",
      samples: {
        da: sine(300, 120),
        gou: sine(300, 90),
        jiao: sine(500, 120),
        ei: sine(220, 80)
      },
      profiles: SUSTAIN_PROFILES
    });
    const spec = {
      sample: "ei",
      role: "normal",
      pitchSemitones: 0,
      gain: 0.92,
      pan: 0
    };

    processor.handleMessage({ type: "one-shot", pressId: -1, spec });
    processor.handleMessage({ type: "note-on", pressId: 1, spec });
    expect(processor.voices.has(-1)).toBe(true);
    expect(processor.voices.has(1)).toBe(false);
    expect(renderBlock(processor)[0][0].some((value) => Math.abs(value) > 0))
      .toBe(true);
    renderBlock(processor);
    expect(processor.voices.has(-1)).toBe(false);
  });

  it("drops pending groups and fades active voices on stop-all", () => {
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
    const da = {
      sample: "da",
      role: "normal",
      pitchSemitones: 0,
      gain: 0.92,
      pan: 0
    };
    processor.handleMessage({ type: "note-on", pressId: 1, spec: da });
    processor.handleMessage({
      type: "note-off",
      pressId: 1,
      followUp: {
        pressId: -1,
        spec: { ...da, sample: "gou" }
      }
    });
    processor.handleMessage({
      type: "schedule-voices",
      groupId: "future",
      startFrame: 10_000,
      held: false,
      voices: [{ pressId: -2, spec: da }]
    });

    processor.handleMessage({ type: "stop-all" });

    expect(processor.pendingGroups.size).toBe(0);
    expect(processor.voices.has(1)).toBe(true);
    expect(processor.voices.get(1)?.forcedFadeRemaining).toBe(18);
    renderBlock(processor);
    expect(processor.voices.size).toBe(0);
  });

  it("stays silent until an absolute target frame inside a render block", () => {
    const Processor = loadProcessor(1000);
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
      type: "schedule-voices",
      groupId: "step-1",
      startFrame: 1200,
      voices: [
        {
          pressId: -1,
          spec: {
            sample: "da",
            role: "normal",
            pitchSemitones: 0,
            gain: 0.7,
            pan: 0
          }
        }
      ]
    });

    const firstBlock = renderBlock(processor);
    expect(firstBlock[0][0].every((value) => value === 0)).toBe(true);
    expect(processor.frameCursor).toBe(1128);

    const targetBlock = renderBlock(processor);
    const framesBeforeTarget = 1200 - 1128;
    expect(
      targetBlock[0][0]
        .slice(0, framesBeforeTarget)
        .every((value) => value === 0)
    ).toBe(true);
    expect(
      targetBlock[0][0]
        .slice(framesBeforeTarget)
        .some((value) => Math.abs(value) > 0)
    ).toBe(true);
  });

  it("replaces every pending voice in the same group without affecting other groups", () => {
    const Processor = loadProcessor(500);
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
    const spec = {
      sample: "da",
      role: "normal",
      pitchSemitones: 0,
      gain: 0.5,
      pan: 0
    };
    processor.handleMessage({
      type: "schedule-voices",
      groupId: "other-step",
      startFrame: 900,
      voices: [{ pressId: -10, spec }]
    });
    processor.handleMessage({
      type: "schedule-voices",
      groupId: "replaceable-step",
      startFrame: 800,
      voices: [
        { pressId: -1, spec },
        { pressId: -2, spec: { ...spec, sample: "gou" } }
      ]
    });
    processor.handleMessage({
      type: "schedule-voices",
      groupId: "replaceable-step",
      startFrame: 850,
      voices: [{ pressId: -3, spec: { ...spec, sample: "jiao", role: "jiao" } }]
    });

    expect([...processor.pendingGroups.keys()].sort()).toEqual([
      "other-step",
      "replaceable-step"
    ]);
    expect(processor.pendingGroups.get("replaceable-step")).toMatchObject({
      startFrame: 850,
      voices: [{ pressId: -3 }]
    });
    expect(processor.voices.has(-1)).toBe(false);
    expect(processor.voices.has(-2)).toBe(false);
    expect(processor.voices.has(-3)).toBe(false);
    expect(processor.voices.has(-10)).toBe(false);
  });

  it("does not restart a scheduled group after it has begun playing", () => {
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
    const spec = {
      sample: "da",
      role: "normal",
      pitchSemitones: 0,
      gain: 0.5,
      pan: 0
    };
    processor.handleMessage({
      type: "schedule-voices",
      groupId: "started-step",
      startFrame: 0,
      voices: [{ pressId: -1, spec }]
    });
    renderBlock(processor);
    processor.handleMessage({
      type: "schedule-voices",
      groupId: "started-step",
      startFrame: 128,
      voices: [{ pressId: -2, spec: { ...spec, sample: "gou" } }]
    });

    expect(processor.voices.has(-1)).toBe(true);
    expect(processor.voices.has(-2)).toBe(false);
    expect(processor.pendingGroups.has("started-step")).toBe(false);
  });

  it("turns a released pending held group into a complete one-shot", () => {
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
    const spec = {
      sample: "da",
      role: "normal",
      pitchSemitones: 0,
      gain: 0.5,
      pan: 0
    };
    processor.handleMessage({
      type: "schedule-voices",
      groupId: "pending-held",
      startFrame: 256,
      held: true,
      voices: [{ pressId: -1, spec }]
    });
    processor.handleMessage({
      type: "release-group",
      groupId: "pending-held"
    });

    expect(processor.pendingGroups.get("pending-held")?.held).toBe(false);
    renderBlock(processor);
    renderBlock(processor);
    renderBlock(processor);
    expect(processor.voices.get(-1)).toMatchObject({
      held: false,
      released: true,
      state: "forward"
    });
    renderBlock(processor);
    renderBlock(processor);
    expect(processor.voices.has(-1)).toBe(false);
  });

  it("releases every started voice in a held group into natural tails", () => {
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
    const spec = {
      sample: "da",
      role: "normal",
      pitchSemitones: 0,
      gain: 0.5,
      pan: 0
    };
    processor.handleMessage({
      type: "schedule-voices",
      groupId: "started-held",
      startFrame: 0,
      held: true,
      voices: [
        { pressId: -1, spec },
        { pressId: -2, spec: { ...spec, sample: "gou" } }
      ]
    });
    renderBlock(processor);
    renderBlock(processor);
    expect(
      [...processor.voices.values()].every((voice) => voice.state === "sustain")
    ).toBe(true);

    processor.handleMessage({
      type: "release-group",
      groupId: "started-held"
    });
    expect(
      [...processor.voices.values()].every(
        (voice) => voice.releasePending && voice.forcedFadeRemaining === 0
      )
    ).toBe(true);
    const firstTailBlock = renderBlock(processor);
    expect(
      firstTailBlock[0][0].some((value) => Math.abs(value) > 0)
    ).toBe(true);
    renderBlock(processor);
    renderBlock(processor);
    expect(
      [...processor.voices.values()].some(
        (voice) => voice.groupId === "started-held"
      )
    ).toBe(false);
  });

  it("keeps full triads intact during maximum-tempo jiao overlap", () => {
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
    const spec = {
      sample: "jiao",
      role: "jiao",
      pitchSemitones: -7,
      gain: 0.4,
      pan: 0
    };
    for (let group = 0; group < 8; group += 1) {
      processor.handleMessage({
        type: "schedule-voices",
        groupId: `fast-${group}`,
        startFrame: group * 89,
        voices: Array.from({ length: 3 }, (_, voice) => ({
          pressId: -(group * 3 + voice + 1),
          spec
        }))
      });
    }

    for (let block = 0; block < 5; block += 1) renderBlock(processor);

    const groupCounts = new Map<string, number>();
    for (const voice of processor.voices.values() as Iterable<{
      groupId: string;
    }>) {
      groupCounts.set(voice.groupId, (groupCounts.get(voice.groupId) ?? 0) + 1);
    }
    expect(processor.voices.size).toBe(24);
    expect([...groupCounts.values()].every((count) => count === 3)).toBe(true);
  });

  it("reclaims scheduled voices as a whole group", () => {
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
    const spec = {
      sample: "jiao",
      role: "jiao",
      pitchSemitones: 0,
      gain: 0.4,
      pan: 0
    };
    for (let group = 0; group < 13; group += 1) {
      processor.handleMessage({
        type: "schedule-voices",
        groupId: `triad-${group}`,
        startFrame: 0,
        voices: Array.from({ length: 3 }, (_, voice) => ({
          pressId: -(group * 3 + voice + 1),
          spec
        }))
      });
    }

    renderBlock(processor);

    const groupCounts = new Map<string, number>();
    for (const voice of processor.voices.values() as Iterable<{
      groupId: string;
    }>) {
      groupCounts.set(voice.groupId, (groupCounts.get(voice.groupId) ?? 0) + 1);
    }
    expect(processor.voices.size).toBe(36);
    expect(groupCounts.has("triad-0")).toBe(false);
    expect([...groupCounts.values()].every((count) => count === 3)).toBe(true);
  });

  it("starts a queued gou in the same render block where da finishes", () => {
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
      followUp: {
        pressId: -1,
        spec: { ...daSpec, sample: "gou" }
      }
    });

    renderBlock(processor);
    expect(processor.voices.has(1)).toBe(true);
    expect(processor.voices.has(-1)).toBe(false);
    renderBlock(processor);
    const transitionBlock = renderBlock(processor);
    expect(processor.voices.has(1)).toBe(false);
    expect(processor.voices.has(-1)).toBe(true);
    expect(processor.voices.get(-1)?.position).toBeGreaterThan(0);
    expect(
      transitionBlock[0][0].slice(64).some((value) => Math.abs(value) > 0)
    ).toBe(true);
  });

  it("holds one attack until release and continues through its natural tail", () => {
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

    processor.handleMessage({ type: "note-off", pressId: 1 });
    const releasedVoice = processor.voices.get(1)!;
    expect(releasedVoice.releasePending).toBe(true);
    expect(releasedVoice.forcedFadeRemaining).toBe(0);
    const tailBlock = renderBlock(processor);
    expect(releasedVoice.state).toBe("tail");
    expect(releasedVoice.position).toBeGreaterThan(
      SUSTAIN_PROFILES.da.loopEnd * 1000
    );
    expect(
      tailBlock[0][0].slice(0, 16).some((value) => Math.abs(value) > 0)
    ).toBe(true);
    renderBlock(processor);
    expect(processor.voices.has(1)).toBe(false);
  });

  it("does not guess key state or truncate a long hold", () => {
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
      pressId: 9,
      spec: {
        sample: "da",
        role: "normal",
        pitchSemitones: 0,
        gain: 0.8,
        pan: 0
      }
    });
    renderBlock(processor);
    const voice = processor.voices.get(9)!;
    expect(voice.state).toBe("sustain");

    voice.sustainRendered = 120_000;
    renderBlock(processor);

    expect(voice.held).toBe(true);
    expect(voice.released).toBe(false);
    expect(voice.forcedFadeRemaining).toBe(0);
    processor.handleMessage({ type: "note-off", pressId: 9 });
    for (let index = 0; index < 4 && processor.voices.has(9); index += 1) {
      renderBlock(processor);
    }
    expect(processor.voices.has(9)).toBe(false);
  });

  it("freezes jiao vibrato and reconnects its natural tail on release", () => {
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
    const voice = processor.voices.get(3)!;

    processor.handleMessage({ type: "note-off", pressId: 3 });
    const frozenRate = voice.currentRate;
    expect(voice.releasePending).toBe(true);
    expect(voice.forcedFadeRemaining).toBe(0);
    expect(voice.targetRate).toBe(frozenRate);

    const firstTailBlock = renderBlock(processor);
    expect(processor.voices.has(3)).toBe(true);
    expect(voice.state).toBe("tail");
    expect(firstTailBlock[0][0].some((value) => Math.abs(value) > 0)).toBe(true);
    for (let index = 0; index < 4 && processor.voices.has(3); index += 1) {
      renderBlock(processor);
    }
    expect(processor.voices.has(3)).toBe(false);
  });

  it("starts a queued gou after a held da finishes its natural tail", () => {
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
      followUp: {
        pressId: -4,
        spec: { ...daSpec, sample: "gou" }
      }
    });

    renderBlock(processor);
    expect(processor.voices.has(4)).toBe(true);
    expect(processor.voices.has(-4)).toBe(false);
    const releaseBlock = renderBlock(processor);
    expect(processor.voices.has(4)).toBe(false);
    expect(processor.voices.has(-4)).toBe(true);
    expect(processor.voices.get(-4)?.position).toBeGreaterThan(0);
    expect(releaseBlock[0][0].some((value) => Math.abs(value) > 0)).toBe(true);
  });
});
