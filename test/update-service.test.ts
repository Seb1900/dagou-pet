import { describe, expect, it, vi } from "vitest";
import {
  UpdateService,
  type UpdaterAdapter
} from "../src/main/update-service";
import type { UpdateState } from "../src/shared/update-contracts";

class FakeUpdater {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  allowDowngrade = true;
  disableWebInstaller = false;
  checkForUpdates = vi.fn(async () => undefined);
  downloadUpdate = vi.fn(async () => undefined);
  quitAndInstall = vi.fn();
  private readonly listeners = new Map<string, Array<(value?: unknown) => void>>();

  on(event: string, listener: (value?: unknown) => void): this {
    const entries = this.listeners.get(event) ?? [];
    entries.push(listener);
    this.listeners.set(event, entries);
    return this;
  }

  emit(event: string, value?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}

function installedService(): {
  service: UpdateService;
  updater: FakeUpdater;
  published: UpdateState[];
} {
  const updater = new FakeUpdater();
  const published: UpdateState[] = [];
  const service = new UpdateService(
    "installed",
    "0.2.0",
    updater as unknown as UpdaterAdapter,
    (state) => published.push(state),
    vi.fn(async () => undefined)
  );
  return { service, updater, published };
}

describe("UpdateService", () => {
  it("opens the official release page in portable mode", async () => {
    const openReleases = vi.fn(async () => undefined);
    const service = new UpdateService(
      "manual",
      "0.2.0",
      null,
      vi.fn(),
      openReleases
    );

    const state = await service.check();

    expect(openReleases).toHaveBeenCalledOnce();
    expect(state.phase).toBe("manual");
    expect(state.message).toContain("官方发布页");
  });

  it("checks for an update and reports the available version", async () => {
    const { service, updater, published } = installedService();

    await service.check();
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(service.getState().phase).toBe("checking");

    updater.emit("update-available", { version: "0.3.0" });
    expect(service.getState()).toMatchObject({
      phase: "available",
      availableVersion: "0.3.0"
    });
    expect(published.at(-1)?.phase).toBe("available");
  });

  it("tracks download progress and installs only after download", async () => {
    const { service, updater } = installedService();
    service.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    updater.emit("update-available", { version: "0.3.0" });
    await service.download();
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();
    expect(service.getState().phase).toBe("downloading");

    updater.emit("download-progress", { percent: 43.6 });
    expect(service.getState()).toMatchObject({
      phase: "downloading",
      percent: 43.6
    });

    updater.emit("update-downloaded", { version: "0.3.0" });
    service.install();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("surfaces updater errors without throwing from user actions", async () => {
    const { service, updater } = installedService();
    updater.checkForUpdates.mockRejectedValueOnce(new Error("network offline"));

    const state = await service.check();

    expect(state.phase).toBe("error");
    expect(state.message).toContain("network offline");
  });

  it("configures release safety defaults", () => {
    const { updater } = installedService();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.disableWebInstaller).toBe(true);
  });
});
