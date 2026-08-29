import { useEffect } from "react";
import { hasPrimaryShortcutModifier } from "../lib/keyboard";

export interface AppShortcutHandlers {
  closeTab: () => void;
  commandPalette: () => void;
  editView: () => void;
  focusMode: () => void;
  liveView: () => void;
  newDocument: () => void;
  newWindow: () => void;
  openFolder: () => void;
  previewView: () => void;
  quickOpen: () => void;
  save: () => void;
  saveAs: () => void;
  splitView: () => void;
  toggleSidebar: () => void;
}

export function useAppShortcuts(handlers: AppShortcutHandlers): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const command = hasPrimaryShortcutModifier(event);
      if (!command || event.altKey) return;
      const key = event.key.toLocaleLowerCase();

      const run = (handler: () => void) => {
        event.preventDefault();
        handler();
      };

      if (key === "o" && !event.shiftKey) run(handlers.openFolder);
      else if (key === "n" && event.shiftKey) run(handlers.newWindow);
      else if (key === "n") run(handlers.newDocument);
      else if (key === "s" && event.shiftKey) run(handlers.saveAs);
      else if (key === "s") run(handlers.save);
      else if (key === "p" && !event.shiftKey) run(handlers.quickOpen);
      else if (key === "k" && !event.shiftKey) run(handlers.commandPalette);
      else if (key === "w" && !event.shiftKey) run(handlers.closeTab);
      else if (key === "b" && event.shiftKey) run(handlers.toggleSidebar);
      else if (key === "enter" && event.shiftKey) run(handlers.focusMode);
      else if (key === "1" && !event.shiftKey) run(handlers.liveView);
      else if (key === "2" && !event.shiftKey) run(handlers.editView);
      else if (key === "3" && !event.shiftKey) run(handlers.splitView);
      else if (key === "4" && !event.shiftKey) run(handlers.previewView);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlers]);
}
