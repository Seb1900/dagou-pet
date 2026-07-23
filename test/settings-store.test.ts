import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsStore } from "../src/main/settings-store";
import { DEFAULT_SETTINGS } from "../src/shared/settings";

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "dagou-settings-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SettingsStore", () => {
  it("writes a versioned file and backs up the previous settings", () => {
    const directory = temporaryDirectory();
    const store = new SettingsStore(directory);
    store.update({ volume: 0.4 });
    store.update({ volume: 0.6 });

    const current = JSON.parse(readFileSync(join(directory, "settings.json"), "utf8"));
    const backup = JSON.parse(readFileSync(join(directory, "settings.json.bak"), "utf8"));
    expect(current.schemaVersion).toBe(1);
    expect(current.settings.volume).toBe(0.6);
    expect(backup.settings.volume).toBe(0.4);
  });

  it("migrates the legacy flat settings format", () => {
    const directory = temporaryDirectory();
    writeFileSync(
      join(directory, "settings.json"),
      JSON.stringify({ volume: 0.35, scale: 1.7 }),
      "utf8"
    );

    const store = new SettingsStore(directory);
    expect(store.get().volume).toBe(0.35);
    expect(store.get().scale).toBe(1.7);
    const stored = JSON.parse(readFileSync(join(directory, "settings.json"), "utf8"));
    expect(stored.schemaVersion).toBe(1);
  });

  it("recovers a damaged primary file from its backup", () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "settings.json"), "broken", "utf8");
    writeFileSync(
      join(directory, "settings.json.bak"),
      JSON.stringify({ schemaVersion: 1, settings: { volume: 0.25 } }),
      "utf8"
    );

    const store = new SettingsStore(directory);
    expect(store.get().volume).toBe(0.25);
  });

  it("restores defaults while preserving the supplied pet position", () => {
    const directory = temporaryDirectory();
    const store = new SettingsStore(directory);
    store.update({
      volume: 1.5,
      scale: 3,
      playbackMode: "instant",
      jiaoKeyCodes: [1, 2]
    });

    const restored = store.reset({ x: -420, y: 180 });

    expect(restored).toEqual({
      ...DEFAULT_SETTINGS,
      x: -420,
      y: 180,
      jiaoKeyCodes: [...DEFAULT_SETTINGS.jiaoKeyCodes]
    });
    (restored.jiaoKeyCodes as number[]).push(999);
    expect(store.get().jiaoKeyCodes).toEqual(DEFAULT_SETTINGS.jiaoKeyCodes);
    const stored = JSON.parse(
      readFileSync(join(directory, "settings.json"), "utf8")
    );
    expect(stored.settings).toEqual(store.get());
  });
});
