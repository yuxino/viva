type ShortcutEvent = Pick<KeyboardEvent, "ctrlKey" | "metaKey">;
type ImeKeyboardEvent = Pick<KeyboardEvent, "isComposing" | "keyCode">;

export type VivaPlatform = "macos" | "windows";

export interface AppShortcutLabels {
  commandPalette: string;
  find: string;
  focusMode: string;
  newDocument: string;
  newWindow: string;
  openFolder: string;
  quickOpen: string;
  replace: string;
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
    find: `${primary}F`,
    focusMode: `${shiftedPrimary}${macos ? "↵" : "Enter"}`,
    newDocument: `${primary}N`,
    newWindow: `${shiftedPrimary}N`,
    openFolder: `${primary}O`,
    quickOpen: `${primary}P`,
    replace: macos ? `⌥${primary}F` : `${primary}H`,
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

/**
 * Older WebKit releases can emit the key that commits an IME composition
 * immediately after `compositionend`. At that point `isComposing` is false,
 * while the legacy key code remains 229.
 */
export function isImeKeyEvent(event: ImeKeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}
