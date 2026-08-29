import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: nativeMocks.invoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

describe("native quit state protocol", () => {
  beforeEach(() => {
    vi.resetModules();
    nativeMocks.invoke.mockReset();
  });

  it("uses one native-issued session and monotonic renderer sequences", async () => {
    nativeMocks.invoke.mockImplementation((command: string) => {
      if (command === "get_quit_guard_session") return Promise.resolve(17);
      return Promise.resolve(true);
    });
    const native = await import("./native");

    await native.setQuitGuardReady(true);
    await native.setHasUnsavedChanges(true);
    await native.setHasUnsavedChanges(false);

    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(
      1,
      "get_quit_guard_session",
    );
    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(
      2,
      "set_quit_guard_ready",
      { ready: true, session: 17, sequence: 1 },
    );
    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(
      3,
      "set_has_unsaved_changes",
      { dirty: true, session: 17, sequence: 2 },
    );
    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(
      4,
      "set_has_unsaved_changes",
      { dirty: false, session: 17, sequence: 3 },
    );
  });

  it("refreshes the native session after a renderer-session rejection", async () => {
    let sessionRequestCount = 0;
    nativeMocks.invoke.mockImplementation(
      (command: string, payload?: { session?: number }) => {
        if (command === "get_quit_guard_session") {
          sessionRequestCount += 1;
          return Promise.resolve(sessionRequestCount === 1 ? 23 : 24);
        }
        if (payload?.session === 23) {
          return Promise.reject(new Error("session changed"));
        }
        return Promise.resolve(true);
      },
    );
    const native = await import("./native");

    await expect(native.setQuitGuardReady(true)).rejects.toThrow(
      "session changed",
    );
    await expect(native.setQuitGuardReady(true)).resolves.toBe(true);

    expect(sessionRequestCount).toBe(2);
    expect(nativeMocks.invoke).toHaveBeenLastCalledWith(
      "set_quit_guard_ready",
      { ready: true, session: 24, sequence: 2 },
    );
  });

  it("maps structured native error codes through the active language", async () => {
    const native = await import("./native");
    const translate = vi.fn((key: string) => `localized:${key}`);

    expect(
      native.describeNativeError(
        { code: "CONFLICT", message: "The document changed on disk." },
        translate,
      ),
    ).toBe(
      "localized:This file changed outside Viva. Review it and try again.",
    );
    expect(translate).toHaveBeenCalledOnce();
  });

  it("keeps the native detail for an unknown structured error", async () => {
    const native = await import("./native");

    expect(
      native.describeNativeError(
        { code: "NEW_NATIVE_CODE", message: "Specific failure" },
        (key) => key,
      ),
    ).toBe("Specific failure");
  });
});
