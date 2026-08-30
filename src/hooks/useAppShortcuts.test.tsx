import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useAppShortcuts,
  type AppShortcutHandlers,
} from "./useAppShortcuts";

function createHandlers(): AppShortcutHandlers {
  return {
    closeTab: vi.fn(),
    commandPalette: vi.fn(),
    editView: vi.fn(),
    find: vi.fn(),
    focusMode: vi.fn(),
    liveView: vi.fn(),
    newDocument: vi.fn(),
    newWindow: vi.fn(),
    openFolder: vi.fn(),
    previewView: vi.fn(),
    quickOpen: vi.fn(),
    replace: vi.fn(),
    save: vi.fn(),
    saveAs: vi.fn(),
    splitView: vi.fn(),
    toggleSidebar: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.platform;
});

describe("useAppShortcuts", () => {
  it("uses Command without taking over macOS Control bindings", () => {
    document.documentElement.dataset.platform = "macos";
    const handlers = createHandlers();
    renderHook(() => useAppShortcuts(handlers));

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(handlers.newDocument).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(handlers.newDocument).toHaveBeenCalledOnce();

    fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    expect(handlers.newWindow).toHaveBeenCalledOnce();
  });

  it("uses Control rather than Meta on Windows", () => {
    document.documentElement.dataset.platform = "windows";
    const handlers = createHandlers();
    renderHook(() => useAppShortcuts(handlers));

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(handlers.newDocument).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(handlers.newDocument).toHaveBeenCalledOnce();

    fireEvent.keyDown(window, { key: "n", ctrlKey: true, shiftKey: true });
    expect(handlers.newWindow).toHaveBeenCalledOnce();
  });

  it("opens find and the platform-native replace shortcut", () => {
    document.documentElement.dataset.platform = "macos";
    const macHandlers = createHandlers();
    const macHook = renderHook(() => useAppShortcuts(macHandlers));

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    fireEvent.keyDown(window, { altKey: true, key: "f", metaKey: true });
    expect(macHandlers.find).toHaveBeenCalledOnce();
    expect(macHandlers.replace).toHaveBeenCalledOnce();
    macHook.unmount();

    document.documentElement.dataset.platform = "windows";
    const windowsHandlers = createHandlers();
    renderHook(() => useAppShortcuts(windowsHandlers));

    fireEvent.keyDown(window, { ctrlKey: true, key: "f" });
    fireEvent.keyDown(window, { ctrlKey: true, key: "h" });
    expect(windowsHandlers.find).toHaveBeenCalledOnce();
    expect(windowsHandlers.replace).toHaveBeenCalledOnce();
  });
});
