import { useCallback, useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import {
  cancelApplicationQuit,
  confirmApplicationQuit,
  describeNativeError,
  hasNativeShell,
  setHasUnsavedChanges,
} from "../lib/native";

export interface CloseProtection {
  cancelClose: () => Promise<boolean>;
  requestClose: () => Promise<boolean>;
}

export function useCloseProtection(
  hasUnsavedChanges: boolean,
  onCloseError?: (message: string) => void,
): CloseProtection {
  const { fmt, t } = useI18n();
  const dirtyRef = useRef(hasUnsavedChanges);
  const forceCloseRef = useRef(false);
  const onCloseErrorRef = useRef(onCloseError);
  dirtyRef.current = hasUnsavedChanges;
  onCloseErrorRef.current = onCloseError;

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (forceCloseRef.current || !dirtyRef.current) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(() => {
    if (!hasNativeShell()) return;
    let disposed = false;
    const synchronizeDirtyState = async () => {
      const quickRetryDelays = [0, 100, 250, 500];
      let attempt = 0;
      while (!disposed) {
        const delay = quickRetryDelays[attempt] ?? 5_000;
        if (delay > 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
        }
        if (disposed) return;
        try {
          await setHasUnsavedChanges(hasUnsavedChanges);
          return;
        } catch (error) {
          attempt += 1;
          if (attempt === quickRetryDelays.length) {
            onCloseErrorRef.current?.(
              fmt(
                "System shutdown protection is unavailable. Viva will keep retrying: %@",
                describeNativeError(error, t),
              ),
            );
          }
        }
      }
    };
    void synchronizeDirtyState();
    return () => {
      disposed = true;
    };
  }, [fmt, hasUnsavedChanges, t]);

  const requestClose = useCallback(async () => {
    forceCloseRef.current = true;
    if (!hasNativeShell()) {
      forceCloseRef.current = false;
      return false;
    }
    try {
      await confirmApplicationQuit();
      return true;
    } catch (error) {
      forceCloseRef.current = false;
      onCloseErrorRef.current?.(describeNativeError(error, t));
      return false;
    }
  }, [t]);

  const cancelClose = useCallback(async () => {
    if (!hasNativeShell()) return true;
    try {
      await cancelApplicationQuit();
      forceCloseRef.current = false;
      return true;
    } catch (error) {
      onCloseErrorRef.current?.(describeNativeError(error, t));
      return false;
    }
  }, [t]);

  return { cancelClose, requestClose };
}
