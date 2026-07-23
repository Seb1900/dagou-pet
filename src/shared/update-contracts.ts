type UpdatePhase =
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
  message: string;
}

export type ExternalTarget = "project" | "feedback" | "releases";
