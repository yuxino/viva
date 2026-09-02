export type UpdateFailureStage = "check" | "download" | "install" | "relaunch";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "verifying"
  | "installing"
  | "restartReady"
  | "error";

export interface UpdateState {
  currentVersion: string;
  downloadedBytes: number;
  failureStage: UpdateFailureStage | null;
  notes: string;
  phase: UpdatePhase;
  totalBytes: number | null;
  version: string;
}

export type UpdateAction =
  | { type: "reset" }
  | { type: "checking"; currentVersion: string }
  | { type: "current"; currentVersion: string }
  | {
      type: "available";
      currentVersion: string;
      version: string;
      notes: string;
    }
  | { type: "downloadStarted" }
  | { type: "downloadMetadata"; totalBytes?: number }
  | { type: "downloadProgress"; chunkLength: number }
  | { type: "verifying" }
  | { type: "installing" }
  | { type: "restartReady" }
  | { type: "failed"; stage: UpdateFailureStage };

export const initialUpdateState: UpdateState = {
  currentVersion: "",
  downloadedBytes: 0,
  failureStage: null,
  notes: "",
  phase: "idle",
  totalBytes: null,
  version: "",
};

export function updateReducer(
  state: UpdateState,
  action: UpdateAction,
): UpdateState {
  switch (action.type) {
    case "reset":
      return { ...initialUpdateState, currentVersion: state.currentVersion };
    case "checking":
      return {
        ...initialUpdateState,
        currentVersion: action.currentVersion,
        phase: "checking",
      };
    case "current":
      return {
        ...initialUpdateState,
        currentVersion: action.currentVersion,
        phase: "current",
      };
    case "available":
      return {
        currentVersion: action.currentVersion,
        downloadedBytes: 0,
        failureStage: null,
        notes: action.notes,
        phase: "available",
        totalBytes: null,
        version: action.version,
      };
    case "downloadStarted":
      return {
        ...state,
        downloadedBytes: 0,
        failureStage: null,
        phase: "downloading",
        totalBytes: null,
      };
    case "downloadMetadata":
      return {
        ...state,
        totalBytes:
          typeof action.totalBytes === "number" && action.totalBytes > 0
            ? action.totalBytes
            : null,
      };
    case "downloadProgress":
      return {
        ...state,
        downloadedBytes:
          state.downloadedBytes + Math.max(0, action.chunkLength),
      };
    case "verifying":
    case "installing":
    case "restartReady":
      return { ...state, failureStage: null, phase: action.type };
    case "failed":
      return { ...state, failureStage: action.stage, phase: "error" };
  }
}

export function updateProgressPercent(state: UpdateState): number | null {
  if (!state.totalBytes) return null;
  return Math.min(
    100,
    Math.floor((state.downloadedBytes / state.totalBytes) * 100),
  );
}
