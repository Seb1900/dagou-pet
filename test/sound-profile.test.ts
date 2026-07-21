import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIO_SAMPLE_NAMES } from "../src/shared/contracts";
import {
  SUSTAIN_PROFILES,
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
  it("keeps all sustain regions inside their source clips", () => {
    expect(SUSTAIN_PROFILES.da.loopStart).toBeLessThan(SUSTAIN_PROFILES.da.loopEnd);
    expect(SUSTAIN_PROFILES.gou.loopStart).toBeLessThan(SUSTAIN_PROFILES.gou.loopEnd);
    expect(SUSTAIN_PROFILES.jiao.crossfade).toBeLessThan(
      SUSTAIN_PROFILES.jiao.loopEnd - SUSTAIN_PROFILES.jiao.loopStart
    );
    for (const name of AUDIO_SAMPLE_NAMES) {
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

  it("converts semitone offsets to playback ratios", () => {
    expect(pitchRate(0)).toBe(1);
    expect(pitchRate(12)).toBe(2);
    expect(pitchRate(-12)).toBe(0.5);
  });
});
