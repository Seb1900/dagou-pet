import { describe, expect, it, vi } from "vitest";
import type { DogKeyInputEvent } from "../src/shared/contracts";
import { SoundController, type SoundOutput } from "../src/renderer/sound-controller";

function input(
  pressId: number,
  phase: "down" | "up",
  role: "normal" | "jiao" = "normal",
  pitchStep = 0,
  pan = 0.1
): DogKeyInputEvent {
  return {
    type: "key",
    pressId,
    phase,
    role,
    pitchStep,
    pan,
    heldCount: phase === "down" ? 1 : 0,
    timestamp: 1
  };
}

function setup(mode: "alternate" | "da-gou" = "alternate") {
  const output: SoundOutput = {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    playOneShot: vi.fn(),
    setJiaoSustainPitch: vi.fn(),
    stopAll: vi.fn()
  };
  const controller = new SoundController(output);
  controller.configure({ soundMode: mode, jiaoSustainPitch: 0 });
  return { controller, output };
}

describe("SoundController", () => {
  it("alternates da and gou globally without consuming a jiao step", () => {
    const { controller, output } = setup();
    controller.handle(input(1, "down"));
    controller.handle(input(2, "down", "jiao"));
    controller.handle(input(3, "down"));

    const starts = vi.mocked(output.noteOn).mock.calls;
    expect(starts[0][1].sample).toBe("da");
    expect(starts[1][1].sample).toBe("jiao");
    expect(starts[2][1].sample).toBe("gou");
  });

  it("pairs each gou with the preceding da pitch and pan", () => {
    const { controller, output } = setup();
    controller.handle(input(1, "down", "normal", -5, -0.2));
    controller.handle(input(2, "down", "normal", 4, 0.2));
    controller.handle(input(3, "down", "normal", 2, 0.1));

    const starts = vi.mocked(output.noteOn).mock.calls;
    expect(starts[0][1]).toMatchObject({ sample: "da", pitchSemitones: -5, pan: -0.2 });
    expect(starts[1][1]).toMatchObject({ sample: "gou", pitchSemitones: -5, pan: -0.2 });
    expect(starts[2][1]).toMatchObject({ sample: "da", pitchSemitones: 2, pan: 0.1 });
  });

  it("releases alternating and jiao voices into their natural tails", () => {
    const { controller, output } = setup();
    controller.handle(input(1, "down"));
    controller.handle(input(1, "up"));
    controller.handle(input(2, "down", "jiao"));
    controller.handle(input(2, "up", "jiao"));
    expect(output.noteOff).toHaveBeenNthCalledWith(1, 1, "tail");
    expect(output.noteOff).toHaveBeenNthCalledWith(2, 2, "tail");
  });

  it("starts da on down and a matching-pitch gou on up in da-gou mode", () => {
    const { controller, output } = setup("da-gou");
    controller.handle(input(7, "down", "normal", 4));
    controller.handle(input(7, "up", "normal", 4));
    expect(vi.mocked(output.noteOn).mock.calls[0][1]).toMatchObject({
      sample: "da",
      pitchSemitones: 4
    });
    expect(output.noteOff).toHaveBeenCalledWith(
      7,
      "tail",
      expect.objectContaining({ sample: "gou", pitchSemitones: 4 })
    );
    expect(output.playOneShot).not.toHaveBeenCalled();
  });

  it("clears held voices and alternation when mode changes or input resets", () => {
    const { controller, output } = setup();
    controller.handle(input(1, "down"));
    controller.configure({ soundMode: "da-gou", jiaoSustainPitch: 2 });
    controller.handle({ type: "reset", heldCount: 0, timestamp: 2 });
    expect(output.stopAll).toHaveBeenCalledTimes(2);
    expect(output.setJiaoSustainPitch).toHaveBeenLastCalledWith(2);
  });
});
