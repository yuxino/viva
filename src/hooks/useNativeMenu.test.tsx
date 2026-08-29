import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useNativeMenu,
  type NativeMenuCommand,
} from "./useNativeMenu";

const menuMocks = vi.hoisted(() => ({
  handler: undefined as
    | ((event: { payload: string }) => void)
    | undefined,
  listen: vi.fn(),
  resolveListen: undefined as
    | ((unlisten: () => void) => void)
    | undefined,
  unlisten: vi.fn(),
  setQuitGuardReady: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: menuMocks.listen,
}));

vi.mock("../lib/native", () => ({
  hasNativeShell: () => true,
  setQuitGuardReady: menuMocks.setQuitGuardReady,
}));

describe("useNativeMenu", () => {
  beforeEach(() => {
    menuMocks.handler = undefined;
    menuMocks.resolveListen = undefined;
    menuMocks.unlisten.mockReset();
    menuMocks.setQuitGuardReady.mockReset().mockResolvedValue(undefined);
    menuMocks.listen.mockReset().mockImplementation(
      (_eventName: string, handler: (event: { payload: string }) => void) => {
        menuMocks.handler = handler;
        return new Promise<() => void>((resolve) => {
          menuMocks.resolveListen = resolve;
        });
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("executes Windows undo and redo events in the focused WebView editor", async () => {
    const onCommand = vi.fn<(command: NativeMenuCommand) => void>();
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    const hook = renderHook(() => useNativeMenu(onCommand));

    await waitFor(() => expect(menuMocks.listen).toHaveBeenCalledOnce());
    act(() => menuMocks.handler?.({ payload: "edit.undo" }));
    act(() => menuMocks.handler?.({ payload: "edit.redo" }));

    expect(execCommand).toHaveBeenNthCalledWith(1, "undo");
    expect(execCommand).toHaveBeenNthCalledWith(2, "redo");
    expect(onCommand).not.toHaveBeenCalled();

    await act(async () => {
      menuMocks.resolveListen?.(menuMocks.unlisten);
    });
    hook.unmount();
    Reflect.deleteProperty(document, "execCommand");
  });

  it("does not resubscribe while registration is pending and uses the latest callback", async () => {
    const firstCallback = vi.fn<(command: NativeMenuCommand) => void>();
    const latestCallback = vi.fn<(command: NativeMenuCommand) => void>();
    const hook = renderHook(
      ({ onCommand }) => useNativeMenu(onCommand),
      { initialProps: { onCommand: firstCallback } },
    );

    await waitFor(() => expect(menuMocks.listen).toHaveBeenCalledOnce());
    hook.rerender({ onCommand: latestCallback });

    expect(menuMocks.listen).toHaveBeenCalledOnce();
    expect(menuMocks.unlisten).not.toHaveBeenCalled();

    act(() => menuMocks.handler?.({ payload: "file.save" }));
    expect(firstCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledOnce();
    expect(latestCallback).toHaveBeenCalledWith("file.save");

    await act(async () => {
      menuMocks.resolveListen?.(menuMocks.unlisten);
    });
    expect(menuMocks.setQuitGuardReady).toHaveBeenCalledWith(true);
    hook.unmount();
    expect(menuMocks.setQuitGuardReady).toHaveBeenCalledWith(false);
    expect(menuMocks.unlisten).toHaveBeenCalledOnce();
  });

  it("retries arming quit protection after a transient native failure", async () => {
    vi.useFakeTimers();
    menuMocks.setQuitGuardReady
      .mockRejectedValueOnce(new Error("bridge not ready"))
      .mockResolvedValue(undefined);
    const hook = renderHook(() => useNativeMenu(vi.fn()));

    await act(async () => {
      menuMocks.resolveListen?.(menuMocks.unlisten);
      await Promise.resolve();
    });
    expect(menuMocks.setQuitGuardReady).toHaveBeenCalledTimes(1);
    expect(menuMocks.setQuitGuardReady).toHaveBeenLastCalledWith(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(menuMocks.setQuitGuardReady).toHaveBeenCalledTimes(2);
    expect(menuMocks.setQuitGuardReady).toHaveBeenLastCalledWith(true);

    hook.unmount();
    expect(menuMocks.setQuitGuardReady).toHaveBeenLastCalledWith(false);
  });

  it("dearms the native guard when unmounted during an arming request", async () => {
    let resolveArm: (() => void) | undefined;
    menuMocks.setQuitGuardReady.mockImplementation((ready: boolean) => {
      if (!ready) return Promise.resolve();
      return new Promise<void>((resolve) => {
        resolveArm = resolve;
      });
    });
    const hook = renderHook(() => useNativeMenu(vi.fn()));

    await act(async () => {
      menuMocks.resolveListen?.(menuMocks.unlisten);
      await Promise.resolve();
    });
    hook.unmount();
    expect(menuMocks.setQuitGuardReady).toHaveBeenCalledWith(false);

    await act(async () => {
      resolveArm?.();
      await Promise.resolve();
    });
    expect(
      menuMocks.setQuitGuardReady.mock.calls.filter(([ready]) => !ready),
    ).toHaveLength(1);
  });

  it("reports registration failure while leaving native quit fail-closed", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onError = vi.fn();
    menuMocks.listen.mockRejectedValue(new Error("event bridge failed"));

    const hook = renderHook(() => useNativeMenu(vi.fn(), onError));

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError).toHaveBeenCalledWith(
      "Safe quit controls are unavailable. Viva will keep retrying; save your work before forcing it to close.",
    );
    expect(menuMocks.setQuitGuardReady).not.toHaveBeenCalledWith(true);
    expect(consoleError).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it("retries native menu registration before arming the quit guard", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onError = vi.fn();
    menuMocks.listen.mockRejectedValueOnce(new Error("event bridge busy"));
    const hook = renderHook(() => useNativeMenu(vi.fn(), onError));

    await act(async () => {
      await Promise.resolve();
    });
    expect(menuMocks.listen).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(menuMocks.listen).toHaveBeenCalledTimes(2);

    await act(async () => {
      menuMocks.resolveListen?.(menuMocks.unlisten);
      await Promise.resolve();
    });
    expect(menuMocks.setQuitGuardReady).toHaveBeenCalledWith(true);
    hook.unmount();
  });

  it("keeps retrying at a bounded rate after all quick attempts fail", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    menuMocks.setQuitGuardReady.mockRejectedValue(new Error("bridge unavailable"));
    const onError = vi.fn();
    const hook = renderHook(() => useNativeMenu(vi.fn(), onError));

    await act(async () => {
      menuMocks.resolveListen?.(menuMocks.unlisten);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(850);
    });
    expect(menuMocks.setQuitGuardReady).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(menuMocks.setQuitGuardReady).toHaveBeenCalledTimes(5);
    expect(onError).toHaveBeenCalledOnce();

    hook.unmount();
  });
});
