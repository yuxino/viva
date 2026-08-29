import { afterEach, describe, expect, it } from "vitest";
import { getAppShortcutLabels, getVivaPlatform } from "./keyboard";

afterEach(() => {
  delete document.documentElement.dataset.platform;
});

describe("platform shortcut labels", () => {
  it("preserves the compact macOS symbols", () => {
    document.documentElement.dataset.platform = "macos";

    const labels = getAppShortcutLabels();

    expect(getVivaPlatform()).toBe("macos");
    expect(labels.openFolder).toBe("⌘O");
    expect(labels.newDocument).toBe("⌘N");
    expect(labels.newWindow).toBe("⇧⌘N");
    expect(labels.save).toBe("⌘S");
    expect(labels.toggleSidebar).toBe("⇧⌘B");
    expect(labels.focusMode).toBe("⇧⌘↵");
    expect(labels.view(3)).toBe("⌘3");
  });

  it("uses explicit Control labels on Windows", () => {
    document.documentElement.dataset.platform = "windows";

    const labels = getAppShortcutLabels();

    expect(getVivaPlatform()).toBe("windows");
    expect(labels.openFolder).toBe("Ctrl+O");
    expect(labels.newDocument).toBe("Ctrl+N");
    expect(labels.newWindow).toBe("Shift+Ctrl+N");
    expect(labels.save).toBe("Ctrl+S");
    expect(labels.toggleSidebar).toBe("Shift+Ctrl+B");
    expect(labels.focusMode).toBe("Shift+Ctrl+Enter");
    expect(labels.view(3)).toBe("Ctrl+3");
  });
});
