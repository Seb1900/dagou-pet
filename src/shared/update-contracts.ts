export type UpdatePhase =
  | "disabled"
  | "manual"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  percent: number | null;
  bytesPerSecond: number | null;
  message: string;
}

export interface AppInfo {
  name: string;
  version: string;
  author: string;
  copyright: string;
  electronVersion: string;
  buildCommit: string | null;
  updateMode: "installed" | "manual" | "disabled";
  settingsNotice: string | null;
}

export type ExternalTarget = "project" | "feedback" | "releases";
