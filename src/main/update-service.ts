import type { UpdateState } from "../shared/update-contracts";

interface UpdateInfoLike {
  version: string;
}

interface ProgressInfoLike {
  percent: number;
  bytesPerSecond: number;
}

export interface UpdaterAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  disableWebInstaller: boolean;
  on(event: "checking-for-update", listener: () => void): this;
  on(event: "update-not-available", listener: (info: UpdateInfoLike) => void): this;
  on(event: "update-available", listener: (info: UpdateInfoLike) => void): this;
  on(event: "download-progress", listener: (info: ProgressInfoLike) => void): this;
  on(event: "update-downloaded", listener: (info: UpdateInfoLike) => void): this;
  on(event: "update-cancelled", listener: () => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export type UpdateMode = "installed" | "manual" | "disabled";

export class UpdateService {
  private state: UpdateState;

  constructor(
    private readonly mode: UpdateMode,
    currentVersion: string,
    private readonly updater: UpdaterAdapter | null,
    private readonly publish: (state: UpdateState) => void,
    private readonly openReleases: () => Promise<void>
  ) {
    this.state = this.initialState(currentVersion);
    if (mode === "installed" && updater) this.bindUpdater(updater);
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  async check(): Promise<UpdateState> {
    if (this.mode === "manual") {
      await this.openReleases();
      return this.setState({
        phase: "manual",
        message: "免安装版请在官方发布页下载新版"
      });
    }
    if (this.mode === "disabled" || !this.updater) return this.getState();
    if (this.state.phase === "checking" || this.state.phase === "downloading") {
      return this.getState();
    }
    this.setState({
      phase: "checking",
      availableVersion: null,
      percent: null,
      bytesPerSecond: null,
      message: "正在检查更新"
    });
    try {
      await this.updater.checkForUpdates();
    } catch (error: unknown) {
      this.fail(error);
    }
    return this.getState();
  }

  async download(): Promise<UpdateState> {
    if (!this.updater || this.state.phase !== "available") {
      return this.getState();
    }
    this.setState({
      phase: "downloading",
      percent: 0,
      bytesPerSecond: 0,
      message: "正在下载更新"
    });
    try {
      await this.updater.downloadUpdate();
    } catch (error: unknown) {
      this.fail(error);
    }
    return this.getState();
  }

  install(): void {
    if (!this.updater || this.state.phase !== "downloaded") return;
    this.updater.quitAndInstall(false, true);
  }

  private initialState(currentVersion: string): UpdateState {
    if (this.mode === "disabled") {
      return {
        phase: "disabled",
        currentVersion,
        availableVersion: null,
        percent: null,
        bytesPerSecond: null,
        message: "开发版不检查更新"
      };
    }
    if (this.mode === "manual") {
      return {
        phase: "manual",
        currentVersion,
        availableVersion: null,
        percent: null,
        bytesPerSecond: null,
        message: "免安装版手动下载更新"
      };
    }
    return {
      phase: "idle",
      currentVersion,
      availableVersion: null,
      percent: null,
      bytesPerSecond: null,
      message: "尚未检查更新"
    };
  }

  private bindUpdater(updater: UpdaterAdapter): void {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = this.state.currentVersion.includes("-");
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    updater.on("checking-for-update", () => {
      this.setState({ phase: "checking", message: "正在检查更新" });
    });
    updater.on("update-not-available", () => {
      this.setState({
        phase: "up-to-date",
        availableVersion: null,
        percent: null,
        bytesPerSecond: null,
        message: "当前已是新版"
      });
    });
    updater.on("update-available", (info) => {
      this.setState({
        phase: "available",
        availableVersion: info.version,
        percent: null,
        bytesPerSecond: null,
        message: `发现版本 ${info.version}`
      });
    });
    updater.on("download-progress", (info) => {
      const percent = Math.min(100, Math.max(0, info.percent));
      this.setState({
        phase: "downloading",
        percent,
        bytesPerSecond: Math.max(0, info.bytesPerSecond),
        message: `正在下载 ${Math.round(percent)}%`
      });
    });
    updater.on("update-downloaded", (info) => {
      this.setState({
        phase: "downloaded",
        availableVersion: info.version,
        percent: 100,
        bytesPerSecond: 0,
        message: "更新已下载，重启后安装"
      });
    });
    updater.on("update-cancelled", () => {
      this.setState({
        phase: "available",
        percent: null,
        bytesPerSecond: null,
        message: "更新下载已取消"
      });
    });
    updater.on("error", (error) => this.fail(error));
  }

  private fail(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    const message = detail.length > 140 ? `${detail.slice(0, 137)}...` : detail;
    this.setState({
      phase: "error",
      percent: null,
      bytesPerSecond: null,
      message: `更新失败：${message}`
    });
  }

  private setState(patch: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getState();
    this.publish(snapshot);
    return snapshot;
  }
}
