import { describe, expect, it } from "vitest";
import {
  initialUpdateState,
  updateProgressPercent,
  updateReducer,
} from "./updateState";

describe("updateReducer", () => {
  it("moves from a manual check to current and available states", () => {
    const checking = updateReducer(initialUpdateState, {
      type: "checking",
      currentVersion: "2.0.6",
    });
    expect(checking.phase).toBe("checking");
    expect(
      updateReducer(checking, { type: "current", currentVersion: "2.0.6" }),
    ).toMatchObject({ phase: "current", currentVersion: "2.0.6" });
    expect(
      updateReducer(checking, {
        type: "available",
        currentVersion: "2.0.6",
        version: "2.0.7",
        notes: "Signed updater release",
      }),
    ).toMatchObject({
      phase: "available",
      currentVersion: "2.0.6",
      version: "2.0.7",
      notes: "Signed updater release",
    });
  });

  it("keeps real byte progress and never invents a total", () => {
    let state = updateReducer(initialUpdateState, {
      type: "available",
      currentVersion: "2.0.6",
      version: "2.0.7",
      notes: "",
    });
    state = updateReducer(state, { type: "downloadStarted" });
    state = updateReducer(state, { type: "downloadMetadata" });
    state = updateReducer(state, { type: "downloadProgress", chunkLength: 12 });
    expect(state).toMatchObject({ downloadedBytes: 12, totalBytes: null });
    expect(updateProgressPercent(state)).toBeNull();

    state = updateReducer(state, { type: "downloadMetadata", totalBytes: 40 });
    state = updateReducer(state, { type: "downloadProgress", chunkLength: 8 });
    expect(updateProgressPercent(state)).toBe(50);
  });

  it("distinguishes verification, install, restart, and retryable failures", () => {
    const downloading = updateReducer(
      {
        ...initialUpdateState,
        phase: "available",
        currentVersion: "2.0.6",
        version: "2.0.7",
      },
      { type: "downloadStarted" },
    );
    expect(updateReducer(downloading, { type: "verifying" }).phase).toBe(
      "verifying",
    );
    expect(updateReducer(downloading, { type: "installing" }).phase).toBe(
      "installing",
    );
    expect(updateReducer(downloading, { type: "restartReady" }).phase).toBe(
      "restartReady",
    );
    expect(
      updateReducer(downloading, { type: "failed", stage: "download" }),
    ).toMatchObject({ phase: "error", failureStage: "download" });
  });
});
