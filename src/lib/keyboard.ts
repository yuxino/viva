type ShortcutEvent = Pick<KeyboardEvent, "ctrlKey" | "metaKey">;

export type VivaPlatform = "macos" | "windows";

export interface AppShortcutLabels {
  commandPalette: string;
  focusMode: string;
  newDocument: string;
  newWindow: string;
  openFolder: string;
  quickOpen: string;
  save: string;
  toggleSidebar: string;
  view: (index: number) => string;
}

export function getVivaPlatform(): VivaPlatform {
  const explicitPlatform = document.documentElement.dataset.platform;
  if (explicitPlatform === "macos" || explicitPlatform === "windows") {
    return explicitPlatform;
  }
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "macos" : "windows";
}

export function getAppShortcutLabels(): AppShortcutLabels {
  const macos = getVivaPlatform() === "macos";
  const primary = macos ? "⌘" : "Ctrl+";
  const shiftedPrimary = macos ? "⇧⌘" : "Shift+Ctrl+";

  return {
    commandPalette: `${primary}K`,
    focusMode: `${shiftedPrimary}${macos ? "↵" : "Enter"}`,
    newDocument: `${primary}N`,
    newWindow: `${shiftedPrimary}N`,
    openFolder: `${primary}O`,
    quickOpen: `${primary}P`,
    save: `${primary}S`,
    toggleSidebar: `${shiftedPrimary}B`,
    view: (index) => `${primary}${index}`,
  };
}

export function hasPrimaryShortcutModifier(event: ShortcutEvent): boolean {
  return getVivaPlatform() === "macos"
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}
