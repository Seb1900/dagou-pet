import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  GROOVE_BPM_MAX,
  GROOVE_BPM_MIN,
  VOLUME_MAX,
  volumeGainToPercent,
  volumePercentToGain,
  normalizeSettings
} from "../src/shared/settings";

describe("normalizeSettings", () => {
  it("falls back for invalid input", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("broken")).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.volume).toBe(0.8);
    expect(DEFAULT_SETTINGS.volume / VOLUME_MAX).toBe(0.5);
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
    expect(high.volume).toBe(VOLUME_MAX);
    expect(high.scale).toBe(5);
    expect(high.reactionIntensity).toBe(2);
    expect(low.volume).toBe(0);
    expect(low.scale).toBe(0.65);
    expect(low.reactionIntensity).toBe(0.5);
  });

  it("maps the expanded volume range without changing old gain values", () => {
    expect(volumeGainToPercent(0.8)).toBe(50);
    expect(volumePercentToGain(50)).toBe(0.8);
    expect(volumePercentToGain(100)).toBe(1.6);
    expect(volumeGainToPercent(5)).toBe(100);
    expect(volumePercentToGain(-10)).toBe(0);
  });

  it("normalizes sound mode and jiao keys", () => {
    const settings = normalizeSettings({
      soundMode: "da-gou",
      jiaoKeyCodes: [1, 2, 2, -1, "3"]
    });
    expect(settings.soundMode).toBe("da-gou");
    expect(settings.jiaoKeyCodes).toEqual([1, 2]);
  });

  it("normalizes playback mode and rounds a clamped groove tempo", () => {
    expect(normalizeSettings({
      playbackMode: "instant",
      grooveBpm: 127.6
    })).toMatchObject({
      playbackMode: "instant",
      grooveBpm: 128
    });
    expect(normalizeSettings({ grooveBpm: -1 }).grooveBpm).toBe(
      GROOVE_BPM_MIN
    );
    expect(normalizeSettings({ grooveBpm: 999 }).grooveBpm).toBe(
      GROOVE_BPM_MAX
    );
    expect(normalizeSettings({
      playbackMode: "unknown",
      grooveBpm: Number.NaN
    })).toMatchObject({
      playbackMode: DEFAULT_SETTINGS.playbackMode,
      grooveBpm: DEFAULT_SETTINGS.grooveBpm
    });
  });

  it("keeps only finite positions and booleans", () => {
    const settings = normalizeSettings({
      x: 120,
      y: Number.NaN,
      listening: false,
      clickThrough: "yes",
      alwaysOnTop: false,
      flipHorizontal: true,
      flipVertical: false
    });
    expect(settings.x).toBe(120);
    expect(settings.y).toBeNull();
    expect(settings.listening).toBe(false);
    expect(settings.clickThrough).toBe(false);
    expect(settings.alwaysOnTop).toBe(false);
    expect(settings.flipHorizontal).toBe(true);
    expect(settings.flipVertical).toBe(false);
  });
});
