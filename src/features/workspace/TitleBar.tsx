import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import { getVivaPlatform } from "../../lib/keyboard";

export interface TitleBarProps {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  center?: ReactNode;
  actions?: ReactNode;
  dirty?: boolean;
  draggable?: boolean;
  ariaLabel?: string;
  className?: string;
}

function joinClassNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function performWindowAction(
  action: (window: ReturnType<typeof getCurrentWindow>) => Promise<void>,
): void {
  void action(getCurrentWindow()).catch(() => {
    // Native window controls are unavailable in ordinary browser previews.
  });
}

function WindowsWindowControls() {
  const { t } = useI18n();
  return (
    <div
      aria-label={t("Window controls")}
      className="title-bar__window-controls"
      role="group"
    >
      <button
        aria-label={t("Minimize window")}
        className="title-bar__window-control"
        onClick={() => performWindowAction((window) => window.minimize())}
        type="button"
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 12 12">
          <path d="M1.5 6.5h9" />
        </svg>
      </button>
      <button
        aria-label={t("Maximize or restore window")}
        className="title-bar__window-control"
        onClick={() => performWindowAction((window) => window.toggleMaximize())}
        type="button"
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 12 12">
          <rect height="8" width="8" x="2" y="2" />
        </svg>
      </button>
      <button
        aria-label={t("Close window")}
        className="title-bar__window-control title-bar__window-control--close"
        onClick={() => performWindowAction((window) => window.close())}
        type="button"
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 12 12">
          <path d="m2 2 8 8M10 2l-8 8" />
        </svg>
      </button>
    </div>
  );
}

export function TitleBar({
  title,
  subtitle,
  leading,
  center,
  actions,
  dirty = false,
  draggable = true,
  ariaLabel,
  className,
}: TitleBarProps) {
  const { t } = useI18n();
  const dragRegion = draggable ? { "data-tauri-drag-region": true } : {};

  return (
    <header
      aria-label={ariaLabel ?? t("Window title")}
      className={joinClassNames(
        "title-bar",
        dirty && "is-dirty",
        className,
      )}
      {...dragRegion}
    >
      {leading ? <div className="title-bar__leading">{leading}</div> : null}
      <div className="title-bar__identity" {...dragRegion}>
        <span className="title-bar__title" {...dragRegion}>
          {title}
        </span>
        {dirty ? (
          <span aria-label={t("Unsaved changes")} className="title-bar__dirty">
            ●
          </span>
        ) : null}
        {subtitle ? (
          <span className="title-bar__subtitle" {...dragRegion}>
            {subtitle}
          </span>
        ) : null}
      </div>
      {center ? <div className="title-bar__center">{center}</div> : null}
      {actions ? <div className="title-bar__actions">{actions}</div> : null}
      {getVivaPlatform() === "windows" ? <WindowsWindowControls /> : null}
    </header>
  );
}
