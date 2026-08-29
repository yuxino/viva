import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCloseProtection } from "./useCloseProtection";

const closeMocks = vi.hoisted(() => ({
  cancelApplicationQuit: vi.fn(),
  confirmApplicationQuit: vi.fn(),
  nativeShell: true,
  setHasUnsavedChanges: vi.fn(),
}));

vi.mock("../lib/native", () => ({
  cancelApplicationQuit: closeMocks.cancelApplicationQuit,
  confirmApplicationQuit: closeMocks.confirmApplicationQuit,
  describeNativeError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  hasNativeShell: () => closeMocks.nativeShell,
  setHasUnsavedChanges: closeMocks.setHasUnsavedChanges,
}));

function beforeUnloadEvent(): BeforeUnloadEvent {
  return new Event("beforeunload", {
    bubbles: false,
    cancelable: true,
  }) as BeforeUnloadEvent;
}

describe("useCloseProtection", () => {
  beforeEach(() => {
    closeMocks.nativeShell = true;
    closeMocks.cancelApplicationQuit.mockReset().mockResolvedValue(undefined);
    closeMocks.confirmApplicationQuit.mockReset().mockResolvedValue(undefined);
    closeMocks.setHasUnsavedChanges.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks ordinary unloads only while the document is dirty", () => {
    const hook = renderHook(
      ({ dirty }) => useCloseProtection(dirty),
      { initialProps: { dirty: true } },
    );

    const dirtyEvent = beforeUnloadEvent();
    act(() => window.dispatchEvent(dirtyEvent));
    expect(dirtyEvent.defaultPrevented).toBe(true);

    hook.rerender({ dirty: false });
    const cleanEvent = beforeUnloadEvent();
    act(() => window.dispatchEvent(cleanEvent));
    expect(cleanEvent.defaultPrevented).toBe(false);
    expect(closeMocks.setHasUnsavedChanges).toHaveBeenNthCalledWith(1, true);
    expect(closeMocks.setHasUnsavedChanges).toHaveBeenNthCalledWith(2, false);
  });

  it("allows an approved quit and restores protection when native quit fails", async () => {
    let rejectQuit: ((error: Error) => void) | undefined;
    closeMocks.confirmApplicationQuit.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        rejectQuit = reject;
      }),
    );
    const onCloseError = vi.fn();
    const hook = renderHook(() => useCloseProtection(true, onCloseError));

    let closePromise: Promise<boolean> | undefined;
    act(() => {
      closePromise = hook.result.current.requestClose();
    });
    const approvedEvent = beforeUnloadEvent();
    act(() => window.dispatchEvent(approvedEvent));
    expect(approvedEvent.defaultPrevented).toBe(false);

    let result: boolean | undefined;
    await act(async () => {
      rejectQuit?.(new Error("Native quit failed"));
      result = await closePromise;
    });

    expect(result).toBe(false);
    expect(onCloseError).toHaveBeenCalledWith("Native quit failed");
    const failedEvent = beforeUnloadEvent();
    act(() => window.dispatchEvent(failedEvent));
    expect(failedEvent.defaultPrevented).toBe(true);
  });

  it("cancels a deferred native termination and reports cancellation failure", async () => {
    const onCloseError = vi.fn();
    closeMocks.cancelApplicationQuit
      .mockRejectedValueOnce(new Error("Cancel reply failed"))
      .mockResolvedValueOnce(undefined);
    const hook = renderHook(() => useCloseProtection(true, onCloseError));

    expect(await hook.result.current.cancelClose()).toBe(false);
    expect(onCloseError).toHaveBeenCalledWith("Cancel reply failed");
    expect(await hook.result.current.cancelClose()).toBe(true);
  });

  it("does not invoke native quit commands in an ordinary browser", async () => {
    closeMocks.nativeShell = false;
    const hook = renderHook(() => useCloseProtection(true));

    expect(await hook.result.current.requestClose()).toBe(false);
    expect(await hook.result.current.cancelClose()).toBe(true);
    expect(closeMocks.confirmApplicationQuit).not.toHaveBeenCalled();
    expect(closeMocks.cancelApplicationQuit).not.toHaveBeenCalled();
    expect(closeMocks.setHasUnsavedChanges).not.toHaveBeenCalled();
  });

  it("retries a failed dirty-state update before Windows can end the session", async () => {
    vi.useFakeTimers();
    closeMocks.setHasUnsavedChanges
      .mockRejectedValueOnce(new Error("bridge busy"))
      .mockResolvedValueOnce(true);
    const hook = renderHook(() => useCloseProtection(true));

    await act(async () => {
      await Promise.resolve();
    });
    expect(closeMocks.setHasUnsavedChanges).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(closeMocks.setHasUnsavedChanges).toHaveBeenCalledTimes(2);
    expect(closeMocks.setHasUnsavedChanges).toHaveBeenLastCalledWith(true);
    hook.unmount();
  });
});
