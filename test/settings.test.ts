import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/shared/settings";

describe("normalizeSettings", () => {
  it("falls back for invalid input", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("broken")).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps volume and scale", () => {
    const high = normalizeSettings({
      volume: 5,
      scale: 9,
      reactionIntensity: 8
    });
    const low = normalizeSettings({
      volume: -1,
      scale: 0.1,
      reactionIntensity: 0
    });
    expect(high.volume).toBe(1);
    expect(high.scale).toBe(1.6);
    expect(high.reactionIntensity).toBe(2);
    expect(low.volume).toBe(0);
    expect(low.scale).toBe(0.65);
    expect(low.reactionIntensity).toBe(0.5);
  });

  it("normalizes sound mode, jiao keys and pitch controls", () => {
    const settings = normalizeSettings({
      soundMode: "da-gou",
      jiaoKeyCodes: [1, 2, 2, -1, "3"],
      melodyEnabled: false,
      jiaoSustainPitch: 99
    });
    expect(settings.soundMode).toBe("da-gou");
    expect(settings.jiaoKeyCodes).toEqual([1, 2]);
    expect(settings.melodyEnabled).toBe(false);
    expect(settings.jiaoSustainPitch).toBe(7);
  });

  it("keeps only finite positions and booleans", () => {
    const settings = normalizeSettings({
      x: 120,
      y: Number.NaN,
      muted: true,
      listening: false,
      clickThrough: "yes",
      alwaysOnTop: false,
      flipHorizontal: true,
      flipVertical: false
    });
    expect(settings.x).toBe(120);
    expect(settings.y).toBeNull();
    expect(settings.muted).toBe(true);
    expect(settings.listening).toBe(false);
    expect(settings.clickThrough).toBe(false);
    expect(settings.alwaysOnTop).toBe(false);
    expect(settings.flipHorizontal).toBe(true);
    expect(settings.flipVertical).toBe(false);
  });
});
