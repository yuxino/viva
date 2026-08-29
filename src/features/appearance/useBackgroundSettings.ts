import { useCallback, useEffect, useState } from "react";
import { useI18n, type TranslationKey } from "../../i18n";
import {
  BackgroundError,
  DEFAULT_BACKGROUND_SETTINGS,
  deleteCustomBackgroundImage,
  loadBackgroundSettings,
  normalizeBackgroundSettings,
  pruneCustomBackgroundImages,
  resetBackgroundStorage,
  resolveBackgroundAsset,
  saveBackgroundSettings,
  saveCustomBackgroundImage,
  type BackgroundFit,
  type BackgroundPosition,
  type BackgroundSettings,
  type BackgroundSource,
} from "../../lib/background";

export type BackgroundOperation = "idle" | "loading" | "processing" | "resetting";

export type BackgroundSettingsPatch = Partial<
  Pick<BackgroundSettings, "blur" | "fit" | "opacity" | "position" | "source">
>;

export interface BackgroundSettingsController {
  assetUrl: string | null;
  clearError: () => void;
  error: string | null;
  operation: BackgroundOperation;
  removeCustomImage: () => Promise<void>;
  reset: () => Promise<void>;
  selectCustomImage: (file: File) => Promise<void>;
  settings: BackgroundSettings;
  setBlur: (blur: number) => void;
  setFit: (fit: BackgroundFit) => void;
  setOpacity: (opacity: number) => void;
  setPosition: (position: BackgroundPosition) => void;
  setSource: (source: BackgroundSource) => boolean;
  update: (patch: BackgroundSettingsPatch) => void;
}

const backgroundErrorKeys = {
  "empty-file": "Choose a non-empty image file.",
  "encoded-too-large":
    "The prepared background is still larger than 8 MiB. Choose a simpler image.",
  "image-missing":
    "The saved custom background is no longer available. Choose it again.",
  "invalid-image": "Viva could not prepare the selected image.",
  "source-too-large": "The image is larger than 24 MiB. Choose a smaller image.",
  "storage-failed": "Viva could not access background storage.",
  "storage-unavailable": "Background storage is unavailable in this environment.",
  "unsafe-dimensions": "The image dimensions are too large to use safely.",
  "unsupported-type": "Use a JPEG, PNG, or WebP image.",
} as const satisfies Record<BackgroundError["code"], TranslationKey>;

function errorMessage(
  error: unknown,
  t: (key: TranslationKey) => string,
): string {
  if (error instanceof BackgroundError) return t(backgroundErrorKeys[error.code]);
  return error instanceof Error
    ? error.message
    : t("Viva could not update the background settings.");
}

export function useBackgroundSettings(): BackgroundSettingsController {
  const { t } = useI18n();
  const [settings, setSettings] = useState(loadBackgroundSettings);
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [operation, setOperation] = useState<BackgroundOperation>("idle");
  const [error, setError] = useState<string | null>(null);

  const persist = useCallback((next: BackgroundSettings) => {
    const normalized = saveBackgroundSettings(
      normalizeBackgroundSettings(next),
    );
    setSettings(normalized);
    return normalized;
  }, []);

  const update = useCallback(
    (patch: BackgroundSettingsPatch) => {
      setError(null);
      try {
        persist({ ...settings, ...patch });
      } catch (storageError) {
        setError(errorMessage(storageError, t));
      }
    },
    [persist, settings, t],
  );

  useEffect(() => {
    let active = true;
    let revoke: () => void = () => undefined;

    setAssetUrl(null);
    if (settings.source === "custom") setOperation("loading");

    void resolveBackgroundAsset(settings)
      .then((asset) => {
        if (!active) {
          asset?.revoke();
          return;
        }
        revoke = asset?.revoke ?? (() => undefined);
        setAssetUrl(asset?.url ?? null);
        setOperation((current) => (current === "loading" ? "idle" : current));
      })
      .catch((assetError: unknown) => {
        if (!active) return;
        setAssetUrl(null);
        setError(errorMessage(assetError, t));
        setOperation((current) => (current === "loading" ? "idle" : current));
      });

    return () => {
      active = false;
      revoke();
    };
  }, [settings.customImage?.id, settings.source, t]);

  useEffect(() => {
    void pruneCustomBackgroundImages(settings.customImage?.id ?? null).catch(
      (cleanupError: unknown) => {
        setError(errorMessage(cleanupError, t));
      },
    );
  }, [settings.customImage?.id, t]);

  const selectCustomImage = useCallback(
    async (file: File) => {
      setError(null);
      setOperation("processing");
      try {
        const customImage = await saveCustomBackgroundImage(file);
        try {
          persist({ ...settings, customImage, source: "custom" });
        } catch (storageError) {
          try {
            await deleteCustomBackgroundImage(customImage.id);
          } catch {
            setError(
              t(
                "The new image could not be committed or removed. Use Reset to retry local cleanup.",
              ),
            );
            return;
          }
          throw storageError;
        }
        if (settings.customImage && settings.customImage.id !== customImage.id) {
          try {
            await deleteCustomBackgroundImage(settings.customImage.id);
          } catch {
            setError(
              t(
                "The new background is saved, but the previous local image could not be removed. Use Reset to retry cleanup.",
              ),
            );
          }
        }
      } catch (selectionError) {
        setError(errorMessage(selectionError, t));
      } finally {
        setOperation("idle");
      }
    },
    [persist, settings, t],
  );

  const removeCustomImage = useCallback(async () => {
    setError(null);
    setOperation("resetting");
    try {
      const next = normalizeBackgroundSettings({
        ...settings,
        customImage: null,
        source: "none",
      });
      saveBackgroundSettings(next);
      try {
        await deleteCustomBackgroundImage(settings.customImage?.id ?? null);
      } catch (removalError) {
        saveBackgroundSettings(settings);
        throw removalError;
      }
      setSettings(next);
    } catch (removalError) {
      setError(errorMessage(removalError, t));
    } finally {
      setOperation("idle");
    }
  }, [persist, settings, t]);

  const reset = useCallback(async () => {
    setError(null);
    setOperation("resetting");
    try {
      await resetBackgroundStorage();
      setSettings({ ...DEFAULT_BACKGROUND_SETTINGS });
    } catch (resetError) {
      setError(errorMessage(resetError, t));
    } finally {
      setOperation("idle");
    }
  }, [t]);

  const setSource = useCallback(
    (source: BackgroundSource) => {
      if (source === "custom" && !settings.customImage) {
        setError(t("Choose a local image before selecting Custom."));
        return false;
      }
      update({ source });
      return true;
    },
    [settings.customImage, t, update],
  );

  return {
    assetUrl,
    clearError: () => setError(null),
    error,
    operation,
    removeCustomImage,
    reset,
    selectCustomImage,
    settings,
    setBlur: (blur) => update({ blur }),
    setFit: (fit) => update({ fit }),
    setOpacity: (opacity) => update({ opacity }),
    setPosition: (position) => update({ position }),
    setSource,
    update,
  };
}
