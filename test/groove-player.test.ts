import { describe, expect, it, vi } from "vitest";
import type {
  AudioSampleName,
  DogKeyInputEvent
} from "../src/shared/contracts";
import {
  createGrooveVoices,
  GROOVE_CHORDS,
  GROOVE_FIRST_HIT_DELAY_MS,
  GROOVE_LOOKAHEAD_MS,
  GROOVE_MAX_QUEUED_STEPS,
  GROOVE_QUANTIZE_TOLERANCE_MS,
  GROOVE_SOURCE_MIDI,
  GROOVE_STEPS_PER_BAR,
  GROOVE_TARGET_MIDI,
  GroovePlayer,
  grooveAccent,
  grooveStepMilliseconds,
  quantizeGrooveStep,
  type GrooveOutput
} from "../src/renderer/groove-player";
import { MELODY_PITCH_STEPS } from "../src/shared/key-classifier";

function input(
  pressId: number,
  overrides: Partial<DogKeyInputEvent> = {}
): DogKeyInputEvent {
  return {
    type: "key",
    phase: "down",
    pressId,
    role: "normal",
    pitchStep: 0,
    pan: 0,
    heldCount: 1,
    timestamp: pressId,
    ...overrides
  };
}

function setup(nowSeconds = 0) {
  let now = nowSeconds;
  const scheduleVoices = vi.fn();
  const releaseGroup = vi.fn();
  const currentTime = vi.fn(() => now);
  const output: GrooveOutput = {
    currentTime,
    scheduleVoices,
    releaseGroup
  };
  const player = new GroovePlayer(output);
  player.configure({ grooveBpm: 128, soundMode: "alternate" });
  return {
    player,
    currentTime,
    scheduleVoices,
    releaseGroup,
    setNow: (next: number) => {
      now = next;
    }
  };
}

function pitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

describe("groove quantization", () => {
  it("places continuous input on the first safe grid line within one step", () => {
    const bpm = 128;
    const originMs = 1_000;
    const stepMs = grooveStepMilliseconds(bpm);

    for (const nowMs of [1_000, 1_017, 1_100, 1_500, 2_031.25]) {
      const quantized = quantizeGrooveStep(nowMs, originMs, bpm);
      const safeNowMs = nowMs + GROOVE_LOOKAHEAD_MS;
      expect(quantized.atMs).toBeGreaterThanOrEqual(safeNowMs - 1e-9);
      expect(quantized.atMs).toBeLessThan(safeNowMs + stepMs);
      expect(quantized.atMs).toBeCloseTo(
        originMs + quantized.stepIndex * stepMs,
        9
      );
    }
  });

  it("does not skip exact grid boundaries after long floating-point runs", () => {
    for (const bpm of [96, 128, 168]) {
      const originMs = 1_234.567;
      const stepMs = grooveStepMilliseconds(bpm);
      for (const stepIndex of [1, 202, 10_000]) {
        const boundaryNow =
          originMs + stepIndex * stepMs - GROOVE_LOOKAHEAD_MS;
        expect(quantizeGrooveStep(boundaryNow, originMs, bpm)).toMatchObject({
          stepIndex
        });
        expect(quantizeGrooveStep(
          boundaryNow + GROOVE_QUANTIZE_TOLERANCE_MS * 2,
          originMs,
          bpm
        ).stepIndex).toBe(stepIndex + 1);
      }
    }
  });

  it("schedules the first hit 12 ms ahead initially and after an idle reset", () => {
    const { player, scheduleVoices, setNow } = setup(10);

    player.handle(input(1));
    expect(scheduleVoices.mock.calls[0][2]).toBeCloseTo(
      10 + GROOVE_FIRST_HIT_DELAY_MS / 1_000,
      9
    );

    setNow(13.1);
    player.handle(input(2));
    expect(scheduleVoices.mock.calls[1][2]).toBeCloseTo(
      13.1 + GROOVE_FIRST_HIT_DELAY_MS / 1_000,
      9
    );
    expect(scheduleVoices.mock.calls[1][0]).not.toBe(
      scheduleVoices.mock.calls[0][0]
    );
  });

  it("queues a short rapid burst into consecutive sixteenth-note slots", () => {
    const { player, scheduleVoices } = setup(2);
    const stepSeconds = grooveStepMilliseconds(128) / 1_000;

    for (
      let pressId = 1;
      pressId <= GROOVE_MAX_QUEUED_STEPS + 1;
      pressId += 1
    ) {
      player.handle(input(pressId));
    }

    const starts = scheduleVoices.mock.calls.map((call) => call[2] as number);
    expect(starts[0]).toBeCloseTo(2.012, 9);
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index] - starts[index - 1]).toBeCloseTo(stepSeconds, 9);
    }
  });

  it("caps overload at two future slots and replaces an existing group", () => {
    const { player, scheduleVoices } = setup(5);

    for (let pressId = 1; pressId <= 12; pressId += 1) {
      player.handle(input(pressId, { pitchStep: pressId % 5 }));
    }

    const groupIds = scheduleVoices.mock.calls.map((call) => call[0] as string);
    const stepIndices = groupIds.map((groupId) => Number(groupId.split(":")[1]));
    expect(new Set(groupIds).size).toBe(GROOVE_MAX_QUEUED_STEPS + 1);
    expect(Math.max(...stepIndices)).toBe(GROOVE_MAX_QUEUED_STEPS);
    expect(groupIds.slice(GROOVE_MAX_QUEUED_STEPS + 1).every(
      (groupId) => groupIds.slice(0, GROOVE_MAX_QUEUED_STEPS + 1).includes(groupId)
    )).toBe(true);
  });

  it("never replaces a group that is already inside the scheduling margin", () => {
    const { player, scheduleVoices } = setup(0);

    player.handle(input(1, { role: "jiao" }));
    for (let pressId = 2; pressId <= 9; pressId += 1) {
      player.handle(input(pressId));
    }
    player.handle(input(10, { role: "jiao" }));

    const firstGroup = scheduleVoices.mock.calls[0][0] as string;
    const replacement = scheduleVoices.mock.calls.at(-1)!;
    expect(replacement[0]).not.toBe(firstGroup);
    expect(replacement[2]).toBeGreaterThanOrEqual(GROOVE_LOOKAHEAD_MS / 1_000);
  });
});

describe("groove harmony", () => {
  const samples: readonly AudioSampleName[] = ["da", "gou", "jiao"];

  it("provides eight stable source-specific notes with a near-original tier", () => {
    for (const sample of samples) {
      expect(GROOVE_TARGET_MIDI[sample]).toHaveLength(8);
      expect(new Set(GROOVE_TARGET_MIDI[sample])).toHaveProperty("size", 8);
      const nearestShift = Math.min(...GROOVE_TARGET_MIDI[sample].map(
        (midi) => Math.abs(midi - GROOVE_SOURCE_MIDI[sample])
      ));
      expect(nearestShift).toBeLessThan(1);
    }
  });

  it("maps all eight keyboard regions to distinct weak-beat primary notes", () => {
    for (const sample of samples) {
      const actual = MELODY_PITCH_STEPS.map((pitchStep) => {
        const [primary] = createGrooveVoices(
          sample,
          { role: "normal", pitchStep, pan: 0 },
          1
        );
        return primary.pitchSemitones + GROOVE_SOURCE_MIDI[sample];
      });
      expect(actual).toEqual(GROOVE_TARGET_MIDI[sample]);
    }
  });

  it("uses current chord tones for every strong-beat voice", () => {
    GROOVE_CHORDS.forEach((chord, chordIndex) => {
      for (const pitchStep of MELODY_PITCH_STEPS) {
        const voices = createGrooveVoices(
          "da",
          { role: "normal", pitchStep, pan: 0 },
          chordIndex * GROOVE_STEPS_PER_BAR
        );
        expect(voices).toHaveLength(3);
        expect(voices.every((voice) => chord.pitchClasses.includes(
          pitchClass(voice.pitchSemitones + GROOVE_SOURCE_MIDI.da)
        ))).toBe(true);
      }
    });
  });

  it("keeps jiao on chord tones even on weak beats", () => {
    GROOVE_CHORDS.forEach((chord, chordIndex) => {
      for (const pitchStep of MELODY_PITCH_STEPS) {
        const voices = createGrooveVoices(
          "jiao",
          { role: "jiao", pitchStep, pan: 0 },
          chordIndex * GROOVE_STEPS_PER_BAR + 1
        );
        expect(voices).toHaveLength(3);
        expect(voices.every((voice) => chord.pitchClasses.includes(
          pitchClass(voice.pitchSemitones + GROOVE_SOURCE_MIDI.jiao)
        ))).toBe(true);
      }
    });
  });

  it("keeps primary transposition bounded and harmony quieter than the source voice", () => {
    for (const sample of samples) {
      for (let stepIndex = 0; stepIndex < GROOVE_STEPS_PER_BAR * 4; stepIndex += 1) {
        for (const pitchStep of MELODY_PITCH_STEPS) {
          const [primary, ...harmony] = createGrooveVoices(
            sample,
            { role: sample === "jiao" ? "jiao" : "normal", pitchStep, pan: 0 },
            stepIndex
          );
          expect(Math.abs(primary.pitchSemitones)).toBeLessThanOrEqual(7);
          expect(harmony.reduce((sum, voice) => sum + voice.gain, 0))
            .toBeLessThan(primary.gain * 0.3);
        }
      }
    }
  });

  it("avoids close dissonant intervals in every harmony voice", () => {
    const consonantIntervals = new Set([3, 4, 5, 7, 8, 9]);
    for (const sample of samples) {
      GROOVE_CHORDS.forEach((_chord, chordIndex) => {
        for (const pitchStep of MELODY_PITCH_STEPS) {
          const [primary, ...harmony] = createGrooveVoices(
            sample,
            { role: sample === "jiao" ? "jiao" : "normal", pitchStep, pan: 0 },
            chordIndex * GROOVE_STEPS_PER_BAR + 1
          );
          expect(harmony.every((voice) => consonantIntervals.has(
            Math.round(Math.abs(voice.pitchSemitones - primary.pitchSemitones))
          ))).toBe(true);
        }
      });
    }
  });

  it("applies a clear bar, half-bar, beat and offbeat accent hierarchy", () => {
    expect(grooveAccent(0)).toBeGreaterThan(grooveAccent(4));
    expect(grooveAccent(4)).toBeGreaterThan(grooveAccent(2));
    expect(grooveAccent(2)).toBeGreaterThan(grooveAccent(1));
  });
});

describe("groove phrase state", () => {
  it("starts a new phrase with da and does not reuse the prior da expression", () => {
    const { player, currentTime, scheduleVoices, setNow } = setup(1);
    player.handle(input(1, { pitchStep: -5, pan: -0.2 }));
    player.handle(input(2, { pitchStep: 4, pan: 0.2 }));

    setNow(4.1);
    player.handle(input(3, { pitchStep: 2, pan: 0.1 }));

    const [first, second, third] = scheduleVoices.mock.calls.map(
      (call) => call[1][0]
    );
    expect(first.sample).toBe("da");
    expect(second.sample).toBe("gou");
    expect(third.sample).toBe("da");
    expect(third.pan).not.toBe(first.pan);
    expect(currentTime).toHaveBeenCalledTimes(3);
  });

  it("releases held presses even after a new transport begins", () => {
    const { player, releaseGroup, scheduleVoices, setNow } = setup(1);
    player.configure({ grooveBpm: 128, soundMode: "da-gou" });
    player.handle(input(1));
    const firstGroup = scheduleVoices.mock.calls[0][0] as string;

    setNow(4.1);
    player.handle(input(2));
    player.handle(input(1, { phase: "up", heldCount: 0 }));

    expect(releaseGroup).toHaveBeenCalledWith(firstGroup, "tail");
    expect(scheduleVoices).toHaveBeenCalledTimes(3);
    expect(scheduleVoices.mock.calls.at(-1)?.[1][0].sample).toBe("gou");
  });

  it("does not let a replaced press release the new owner of a queued group", () => {
    const { player, releaseGroup, scheduleVoices } = setup();
    player.handle(input(1));
    player.handle(input(2));
    player.handle(input(3));
    player.handle(input(4));
    const replacedGroup = scheduleVoices.mock.calls.at(-1)?.[0] as string;

    player.handle(input(2, { phase: "up", heldCount: 3 }));
    expect(releaseGroup).not.toHaveBeenCalledWith(replacedGroup, "tail");

    player.handle(input(4, { phase: "up", heldCount: 2 }));
    expect(releaseGroup).toHaveBeenCalledWith(replacedGroup, "tail");
  });
});
