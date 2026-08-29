import { useId, useRef, type ChangeEvent } from "react";
import { CloseIcon, FolderOpenIcon } from "../../components/icons";
import { Button, IconButton, SegmentedControl } from "../../components/ui";
import { useI18n, type TranslationKey } from "../../i18n";
import {
  BUILTIN_BACKGROUND_URL,
  DEFAULT_BACKGROUND_SETTINGS,
  MAX_BACKGROUND_BLUR,
  MAX_BACKGROUND_OPACITY,
  formatBackgroundBytes,
  type BackgroundPosition,
  type BackgroundSource,
} from "../../lib/background";
import { BackgroundLayer } from "./BackgroundLayer";
import type { BackgroundSettingsController } from "./useBackgroundSettings";
import "./appearance.css";

export interface AppearancePanelProps {
  className?: string;
  controller: BackgroundSettingsController;
}

const SOURCES: ReadonlyArray<{
  description: TranslationKey;
  label: TranslationKey;
  value: BackgroundSource;
}> = [
  {
    description: "Keep the writing canvas completely neutral.",
    label: "None",
    value: "none",
  },
  {
    description: "Use Viva’s quiet warm-toned illustration.",
    label: "Viva illustration",
    value: "viva",
  },
  {
    description: "Keep one image privately on this device.",
    label: "Custom local image",
    value: "custom",
  },
];

const POSITIONS: ReadonlyArray<{
  label: TranslationKey;
  value: BackgroundPosition;
}> = [
  { label: "Top left", value: "top-left" },
  { label: "Top", value: "top" },
  { label: "Top right", value: "top-right" },
  { label: "Left", value: "left" },
  { label: "Center", value: "center" },
  { label: "Right", value: "right" },
  { label: "Bottom left", value: "bottom-left" },
  { label: "Bottom", value: "bottom" },
  { label: "Bottom right", value: "bottom-right" },
];

function joinClassNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function AppearancePanel({
  className,
  controller,
}: AppearancePanelProps) {
  const { fmt, t } = useI18n();
  const fileInputId = useId();
  const opacityId = useId();
  const blurId = useId();
  const sourceName = useId();
  const positionName = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    assetUrl,
    clearError,
    error,
    operation,
    removeCustomImage,
    reset,
    selectCustomImage,
    settings,
    setBlur,
    setFit,
    setOpacity,
    setPosition,
    setSource,
  } = controller;
  const busy = operation !== "idle";
  const status =
    operation === "loading"
      ? t("Loading the saved image…")
      : operation === "processing"
        ? t("Preparing and saving the image…")
        : operation === "resetting"
          ? t("Resetting the background…")
          : null;
  const selectedSourceLabel = t(
    SOURCES.find((option) => option.value === settings.source)?.label ?? "None",
  );
  const hasNonDefaultState =
    settings.source !== DEFAULT_BACKGROUND_SETTINGS.source ||
    settings.opacity !== DEFAULT_BACKGROUND_SETTINGS.opacity ||
    settings.blur !== DEFAULT_BACKGROUND_SETTINGS.blur ||
    settings.fit !== DEFAULT_BACKGROUND_SETTINGS.fit ||
    settings.position !== DEFAULT_BACKGROUND_SETTINGS.position ||
    Boolean(settings.customImage) || Boolean(error);

  const requestCustomImage = () => fileInputRef.current?.click();

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void selectCustomImage(file);
  };

  const handleSourceChange = (source: BackgroundSource) => {
    if (source === "custom" && !settings.customImage) {
      requestCustomImage();
      return;
    }
    setSource(source);
  };

  return (
    <section
      aria-busy={busy || undefined}
      className={joinClassNames("appearance-panel", className)}
    >
      <header className="appearance-panel__header">
        <div>
          <h2 className="appearance-panel__title">{t("Background")}</h2>
          <p className="appearance-panel__intro">
            {t(
              "Add atmosphere around the page while keeping the writing surface clear.",
            )}
          </p>
        </div>
        <Button
          disabled={busy || !hasNonDefaultState}
          onClick={() => void reset()}
          size="small"
          variant="ghost"
        >
          {t("Reset")}
        </Button>
      </header>

      <div
        aria-label={fmt("Background preview: %@", selectedSourceLabel)}
        className="appearance-panel__preview"
        role="img"
      >
        <BackgroundLayer assetUrl={assetUrl} settings={settings} />
        <div aria-hidden="true" className="appearance-panel__preview-paper">
          <span>VIVA</span>
          <strong>{t("A quiet workspace")}</strong>
          <i />
          <i />
          <i />
        </div>
      </div>

      {error ? (
        <div className="appearance-panel__error" role="alert">
          <span>{error}</span>
          <IconButton
            label={t("Dismiss error")}
            onClick={clearError}
            size="small"
            tooltip={false}
          >
            <CloseIcon size={16} />
          </IconButton>
        </div>
      ) : null}

      <div
        aria-label={t("Background status")}
        aria-live="polite"
        className="appearance-panel__status"
        role="status"
      >
        {status}
      </div>

      <fieldset className="appearance-panel__source" disabled={busy}>
        <legend>{t("Image")}</legend>
        <div className="appearance-panel__source-list">
          {SOURCES.map((option) => {
            const checked = settings.source === option.value;
            const thumbnailUrl =
              option.value === "viva"
                ? BUILTIN_BACKGROUND_URL
                : option.value === "custom"
                  ? assetUrl
                  : null;
            return (
              <label
                className={joinClassNames(
                  "appearance-panel__source-option",
                  checked && "is-active",
                )}
                key={option.value}
              >
                <input
                  checked={checked}
                  name={sourceName}
                  onChange={() => handleSourceChange(option.value)}
                  type="radio"
                  value={option.value}
                />
                <span className="appearance-panel__source-copy">
                  <strong>{t(option.label)}</strong>
                  <small>{t(option.description)}</small>
                </span>
                <span
                  aria-hidden="true"
                  className="appearance-panel__source-thumb"
                  data-empty={!thumbnailUrl || undefined}
                  style={
                    thumbnailUrl
                      ? { backgroundImage: `url(${JSON.stringify(thumbnailUrl)})` }
                      : undefined
                  }
                />
              </label>
            );
          })}
        </div>
      </fieldset>

      <input
        accept="image/jpeg,image/png,image/webp"
        className="visually-hidden"
        disabled={busy}
        id={fileInputId}
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />

      <div className="appearance-panel__custom-row">
        <div className="appearance-panel__custom-copy">
          {settings.customImage ? (
            <>
              <strong>{settings.customImage.name}</strong>
              <small>
                {settings.customImage.width} × {settings.customImage.height} ·{" "}
                {formatBackgroundBytes(settings.customImage.bytes)}
              </small>
            </>
          ) : (
            <small>{t("JPEG, PNG, or WebP · up to 24 MiB")}</small>
          )}
        </div>
        <div className="appearance-panel__custom-actions">
          <Button
            disabled={busy}
            onClick={requestCustomImage}
            size="small"
            startIcon={<FolderOpenIcon size={16} />}
          >
            {settings.customImage ? t("Change") : t("Choose image")}
          </Button>
          {settings.customImage ? (
            <Button
              disabled={busy}
              onClick={() => void removeCustomImage()}
              size="small"
              variant="ghost"
            >
              {t("Remove")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="appearance-panel__controls">
        <div className="appearance-panel__control">
          <div className="appearance-panel__control-heading">
            <label htmlFor={opacityId}>{t("Opacity")}</label>
            <output htmlFor={opacityId}>
              {Math.round(settings.opacity * 100)}%
            </output>
          </div>
          <input
            aria-valuetext={fmt(
              "%d percent",
              Math.round(settings.opacity * 100),
            )}
            disabled={busy || settings.source === "none"}
            id={opacityId}
            max={MAX_BACKGROUND_OPACITY}
            min="0"
            onChange={(event) => setOpacity(event.currentTarget.valueAsNumber)}
            step="0.01"
            type="range"
            value={settings.opacity}
          />
        </div>

        <div className="appearance-panel__control">
          <div className="appearance-panel__control-heading">
            <label htmlFor={blurId}>{t("Blur")}</label>
            <output htmlFor={blurId}>{Math.round(settings.blur)} px</output>
          </div>
          <input
            aria-valuetext={fmt(
              Math.round(settings.blur) === 1 ? "%d pixel" : "%d pixels",
              Math.round(settings.blur),
            )}
            disabled={busy || settings.source === "none"}
            id={blurId}
            max={MAX_BACKGROUND_BLUR}
            min="0"
            onChange={(event) => setBlur(event.currentTarget.valueAsNumber)}
            step="1"
            type="range"
            value={settings.blur}
          />
        </div>

        <div className="appearance-panel__control appearance-panel__control--inline">
          <span>{t("Fit")}</span>
          <SegmentedControl
            disabled={busy || settings.source === "none"}
            label={t("Background image fit")}
            onChange={setFit}
            options={[
              { label: t("Cover"), value: "cover" },
              { label: t("Contain"), value: "contain" },
            ]}
            size="small"
            value={settings.fit}
          />
        </div>

        <fieldset
          className="appearance-panel__position"
          disabled={busy || settings.source === "none"}
        >
          <legend>{t("Position")}</legend>
          <div
            aria-label={t("Background image position")}
            className="appearance-panel__position-grid"
          >
            {POSITIONS.map((position) => (
              <label key={position.value} title={t(position.label)}>
                <input
                  checked={settings.position === position.value}
                  className="visually-hidden"
                  name={positionName}
                  onChange={() => setPosition(position.value)}
                  type="radio"
                  value={position.value}
                />
                <span aria-hidden="true" />
                <span className="visually-hidden">{t(position.label)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}
