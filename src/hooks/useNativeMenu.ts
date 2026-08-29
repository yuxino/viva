import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import { hasNativeShell, setQuitGuardReady } from "../lib/native";

export type NativeMenuCommand =
  | "app.quit"
  | "edit.redo"
  | "edit.undo"
  | "file.new"
  | "file.newWindow"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "file.closeTab"
  | "help.showCommands"
  | "view.toggleSidebar"
  | "view.toggleFocus"
  | "view.live"
  | "view.edit"
  | "view.split"
  | "view.preview";

function executeNativeEditCommand(command: NativeMenuCommand): boolean {
  if (command !== "edit.undo" && command !== "edit.redo") return false;
  document.execCommand(command === "edit.undo" ? "undo" : "redo");
  return true;
}

export function useNativeMenu(
  onCommand: (command: NativeMenuCommand) => void,
  onError?: (message: string) => void,
): void {
  const { t } = useI18n();
  const onCommandRef = useRef(onCommand);
  const onErrorRef = useRef(onError);
  const safetyMessageRef = useRef(
    t(
      "Safe quit controls are unavailable. Viva will keep retrying; save your work before forcing it to close.",
    ),
  );
  onCommandRef.current = onCommand;
  onErrorRef.current = onError;
  safetyMessageRef.current = t(
    "Safe quit controls are unavailable. Viva will keep retrying; save your work before forcing it to close.",
  );

  useEffect(() => {
    if (!hasNativeShell()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const armQuitGuard = async () => {
      const quickRetryDelays = [0, 100, 250, 500];
      let attempt = 0;
      while (!disposed) {
        const delay = quickRetryDelays[attempt] ?? 5_000;
        if (delay > 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
        }
        if (disposed) return;
        try {
          await setQuitGuardReady(true);
          return;
        } catch (error) {
          attempt += 1;
          if (attempt === quickRetryDelays.length) {
            console.error("Viva could not arm native quit protection.", error);
            onErrorRef.current?.(safetyMessageRef.current);
          }
        }
      }
    };

    const registerNativeMenu = async () => {
      const quickRetryDelays = [0, 100, 250, 500];
      let attempt = 0;
      while (!disposed) {
        const delay = quickRetryDelays[attempt] ?? 5_000;
        if (delay > 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
        }
        if (disposed) return;
        try {
          const stop = await listen<string>("viva://menu", (event) => {
            const command = event.payload as NativeMenuCommand;
            if (!executeNativeEditCommand(command)) {
              onCommandRef.current(command);
            }
          });
          if (disposed) {
            stop();
            return;
          }
          unlisten = stop;
          void armQuitGuard();
          return;
        } catch (error) {
          attempt += 1;
          if (attempt === 1) {
            console.error("Viva could not register native menu handling.", error);
            onErrorRef.current?.(safetyMessageRef.current);
          }
        }
      }
    };

    void registerNativeMenu();
    return () => {
      disposed = true;
      void setQuitGuardReady(false).catch(() => undefined);
      unlisten?.();
    };
  }, []);
}
