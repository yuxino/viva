import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { Button } from "../../components/ui";
import { useI18n } from "../../i18n";
import type { VivaPlatform } from "../../lib/keyboard";
import {
  initialUpdateState,
  updateProgressPercent,
  updateReducer,
  type UpdateFailureStage,
} from "./updateState";

export const VIVA_RELEASES_URL = "https://github.com/yuxino/viva/releases";

export interface AppUpdate {
  body?: string;
  currentVersion: string;
  version: string;
  close: () => Promise<void>;
  download: (onEvent: (event: DownloadEvent) => void) => Promise<void>;
  install: (options: { restartAfterInstall: boolean }) => Promise<void>;
}

export interface UpdaterAdapter {
  check: () => Promise<AppUpdate | null>;
  getCurrentVersion: () => Promise<string>;
  openReleases: () => Promise<void>;
  relaunch: () => Promise<void>;
}

const officialUpdaterAdapter: UpdaterAdapter = {
  check: () => check({ timeout: 15_000 }) as Promise<Update | null>,
  getCurrentVersion: getVersion,
  openReleases: () => openUrl(VIVA_RELEASES_URL),
  relaunch,
};

interface UpdatePanelProps {
  adapter?: UpdaterAdapter;
  platform: VivaPlatform;
}

function formattedBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function UpdatePanel({
  adapter = officialUpdaterAdapter,
  platform,
}: UpdatePanelProps) {
  const { fmt, t } = useI18n();
  const [state, dispatch] = useReducer(updateReducer, initialUpdateState);
  const inFlightRef = useRef(false);
  const updateRef = useRef<AppUpdate | null>(null);
  const mountedRef = useRef(true);
  const percent = updateProgressPercent(state);

  const closeCurrentUpdate = useCallback(async () => {
    const current = updateRef.current;
    updateRef.current = null;
    if (current) await current.close().catch(() => undefined);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void closeCurrentUpdate();
    };
  }, [closeCurrentUpdate]);

  const checkForUpdates = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    await closeCurrentUpdate();
    let currentVersion = state.currentVersion;
    try {
      currentVersion = await adapter.getCurrentVersion();
      if (!mountedRef.current) return;
      dispatch({ type: "checking", currentVersion });
      const update = await adapter.check();
      if (!mountedRef.current) {
        await update?.close().catch(() => undefined);
        return;
      }
      if (!update) {
        dispatch({ type: "current", currentVersion });
        return;
      }
      updateRef.current = update;
      dispatch({
        type: "available",
        currentVersion: update.currentVersion || currentVersion,
        version: update.version,
        notes: update.body?.trim() ?? "",
      });
    } catch {
      if (mountedRef.current) dispatch({ type: "failed", stage: "check" });
    } finally {
      inFlightRef.current = false;
    }
  }, [adapter, closeCurrentUpdate, state.currentVersion]);

  const installDownloaded = useCallback(
    async (update: AppUpdate) => {
      dispatch({ type: "installing" });
      try {
        await update.install({ restartAfterInstall: platform === "windows" });
        if (!mountedRef.current) return;
        if (platform === "macos") dispatch({ type: "restartReady" });
        await closeCurrentUpdate();
      } catch {
        if (mountedRef.current) dispatch({ type: "failed", stage: "install" });
      }
    },
    [closeCurrentUpdate, platform],
  );

  const downloadAndInstall = useCallback(async () => {
    if (inFlightRef.current || !updateRef.current) return;
    inFlightRef.current = true;
    const update = updateRef.current;
    dispatch({ type: "downloadStarted" });
    try {
      await update.download((event) => {
        if (!mountedRef.current) return;
        if (event.event === "Started") {
          dispatch({
            type: "downloadMetadata",
            totalBytes: event.data.contentLength,
          });
        } else if (event.event === "Progress") {
          dispatch({
            type: "downloadProgress",
            chunkLength: event.data.chunkLength,
          });
        } else {
          dispatch({ type: "verifying" });
        }
      });
      if (mountedRef.current) await installDownloaded(update);
    } catch {
      if (mountedRef.current) dispatch({ type: "failed", stage: "download" });
    } finally {
      inFlightRef.current = false;
    }
  }, [installDownloaded]);

  const retryInstall = useCallback(async () => {
    if (inFlightRef.current || !updateRef.current) return;
    inFlightRef.current = true;
    try {
      await installDownloaded(updateRef.current);
    } finally {
      inFlightRef.current = false;
    }
  }, [installDownloaded]);

  const restart = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await adapter.relaunch();
    } catch {
      if (mountedRef.current) dispatch({ type: "failed", stage: "relaunch" });
      inFlightRef.current = false;
    }
  }, [adapter]);

  const retry = () => {
    const actions: Record<UpdateFailureStage, () => Promise<void>> = {
      check: checkForUpdates,
      download: downloadAndInstall,
      install: retryInstall,
      relaunch: restart,
    };
    if (state.failureStage) void actions[state.failureStage]();
  };

  const postpone = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    await closeCurrentUpdate();
    if (mountedRef.current) dispatch({ type: "reset" });
    inFlightRef.current = false;
  };

  const openRecovery = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await adapter.openReleases();
    } catch {
      // Keep the updater error and its recovery actions available.
    } finally {
      inFlightRef.current = false;
    }
  };

  const errorMessage =
    state.failureStage === "check"
      ? t("Viva could not check for updates.")
      : state.failureStage === "install"
        ? t("The verified update could not be installed.")
        : state.failureStage === "relaunch"
          ? t("Viva could not restart to finish the update.")
          : t("The update could not be downloaded or verified.");

  return (
    <section aria-labelledby="software-update-title" className="software-update">
      <div className="software-update__heading">
        <div>
          <h2 id="software-update-title">{t("Software Update")}</h2>
          <p>{t("Updates are downloaded only after you approve them and must pass Viva’s signature check.")}</p>
        </div>
        {state.phase === "idle" || state.phase === "current" ? (
          <Button
            onClick={() => void checkForUpdates()}
            size="small"
          >
            {t("Check for updates")}
          </Button>
        ) : null}
      </div>

      <div aria-atomic="true" aria-live="polite" className="software-update__status">
        {state.phase === "idle" ? (
          <p>{t("Viva checks one fixed, secure release feed.")}</p>
        ) : state.phase === "checking" ? (
          <p>{t("Checking for updates…")}</p>
        ) : state.phase === "current" ? (
          <p>{fmt("Viva %@ is up to date.", state.currentVersion)}</p>
        ) : state.phase === "available" ? (
          <>
            <p className="software-update__available">
              {fmt("Viva %@ is available.", state.version)}
            </p>
            {state.notes ? (
              <div className="software-update__notes">
                <h3>{t("Release notes")}</h3>
                <p>{state.notes}</p>
              </div>
            ) : null}
            {platform === "windows" ? (
              <p>
                {t("Viva will close after verification. The Windows installer will finish the update and reopen Viva.")}
              </p>
            ) : null}
            <div className="software-update__actions">
              <Button onClick={() => void downloadAndInstall()} size="small" variant="primary">
                {platform === "windows" ? t("Download and install") : t("Download update")}
              </Button>
              <Button onClick={() => void postpone()} size="small" variant="ghost">
                {t("Not now")}
              </Button>
            </div>
          </>
        ) : state.phase === "downloading" ? (
          <>
            <p>
              {percent === null
                ? fmt("Downloaded %@", formattedBytes(state.downloadedBytes))
                : fmt("Downloading update… %d percent", percent)}
            </p>
            <progress
              aria-label={t("Update download progress")}
              max={percent === null ? undefined : 100}
              value={percent === null ? undefined : percent}
            />
          </>
        ) : state.phase === "verifying" ? (
          <p>{t("Download complete. Verifying Viva’s update signature…")}</p>
        ) : state.phase === "installing" ? (
          <p>
            {platform === "windows"
              ? t("Starting the verified Windows installer…")
              : t("Installing the verified update…")}
          </p>
        ) : state.phase === "restartReady" ? (
          <>
            <p>{t("The verified update is installed and ready.")}</p>
            <Button onClick={() => void restart()} size="small" variant="primary">
              {t("Restart and finish update")}
            </Button>
          </>
        ) : (
          <>
            <p className="software-update__error" role="alert">{errorMessage}</p>
            <div className="software-update__actions">
              <Button onClick={retry} size="small">{t("Retry")}</Button>
              <a
                href={VIVA_RELEASES_URL}
                onClick={(event) => {
                  event.preventDefault();
                  void openRecovery();
                }}
              >
                {t("Open GitHub Releases")}
              </a>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
