import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIO_SAMPLE_NAMES,
  KEYBOARD_SAMPLE_NAMES
} from "../src/shared/contracts";
import {
  SUSTAIN_PROFILES,
  createEiVoiceSpec,
  createVoiceSpec,
  pitchRate
} from "../src/renderer/sound-profile";

function wavDurationSeconds(path: string): number {
  const bytes = readFileSync(path);
  let byteRate = 0;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunk = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (chunk === "fmt ") byteRate = bytes.readUInt32LE(offset + 16);
    if (chunk === "data") dataSize = size;
    offset += 8 + size + (size % 2);
  }
  if (byteRate <= 0 || dataSize <= 0) throw new Error(`Invalid WAV: ${path}`);
  return dataSize / byteRate;
}

describe("sound profiles", () => {
  it("keeps calibration tied to the bundled recordings", () => {
    const expectedHashes = {
      da: "271e33f66f0fef82414c2d589c8358cb00d300e8fef41518d2260ceabb22be49",
      gou: "fb83df74ebfc5a701a4a35bc8126d9b28651e3b7ca814c55dac4e80fcd75bc85",
      jiao: "dfb6164871e310b1c8d8d9fbcfb3d4f70aba64e18018841fda96c547426001a2",
      ei: "aef310f076560d13c53c9e4dae52cb5ab2aac43d7fc83a2af29dd2ba44fd2e38"
    } as const;
    for (const name of AUDIO_SAMPLE_NAMES) {
      const bytes = readFileSync(
        resolve(process.cwd(), "assets", "dagou", "sounds", `${name}.wav`)
      );
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        expectedHashes[name]
      );
    }
  });

  it("keeps all sustain regions inside their source clips", () => {
    expect(SUSTAIN_PROFILES.da.loopStart).toBeLessThan(SUSTAIN_PROFILES.da.loopEnd);
    expect(SUSTAIN_PROFILES.gou.loopStart).toBeLessThan(SUSTAIN_PROFILES.gou.loopEnd);
    expect(SUSTAIN_PROFILES.jiao.crossfade).toBeLessThan(
      SUSTAIN_PROFILES.jiao.loopEnd - SUSTAIN_PROFILES.jiao.loopStart
    );
    for (const name of KEYBOARD_SAMPLE_NAMES) {
      const duration = wavDurationSeconds(
        resolve(process.cwd(), "assets", "dagou", "sounds", `${name}.wav`)
      );
      expect(SUSTAIN_PROFILES[name].loopEnd).toBeLessThan(duration);
    }
  });

  it("preserves deterministic key pitch and pan", () => {
    const spec = createVoiceSpec("gou", {
      role: "normal",
      pitchStep: 4,
      pan: 0.2
    });
    expect(spec).toMatchObject({
      sample: "gou",
      role: "normal",
      pitchSemitones: 4,
      pan: 0.2
    });
  });

  it("keeps ei as an original-pitch interaction one-shot", () => {
    expect(createEiVoiceSpec()).toEqual({
      sample: "ei",
      role: "normal",
      pitchSemitones: 0,
      gain: 0.92,
      pan: 0
    });
    expect(KEYBOARD_SAMPLE_NAMES).not.toContain("ei");
    expect(AUDIO_SAMPLE_NAMES).toContain("ei");
    expect(SUSTAIN_PROFILES).not.toHaveProperty("ei");
  });

  it("converts semitone offsets to playback ratios", () => {
    expect(pitchRate(0)).toBe(1);
    expect(pitchRate(12)).toBe(2);
    expect(pitchRate(-12)).toBe(0.5);
  });
});
