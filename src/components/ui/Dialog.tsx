import {
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { CloseIcon } from "../icons";
import { useI18n } from "../../i18n";
import { IconButton } from "./IconButton";
import { cx } from "./utils";
import "./ui.css";

export type DialogCloseReason = "escape" | "backdrop" | "close-button";

export interface DialogProps {
  children: ReactNode;
  className?: string;
  closeLabel?: string;
  description?: ReactNode;
  dismissible?: boolean;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: (reason: DialogCloseReason) => void;
  open: boolean;
  size?: "small" | "medium" | "large";
  title: ReactNode;
}

export function Dialog({
  children,
  className,
  closeLabel,
  description,
  dismissible = true,
  footer,
  initialFocusRef,
  onClose,
  open,
  size = "medium",
  title,
}: DialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  function restorePreviousFocus(dialog: HTMLDialogElement): void {
    const active = document.activeElement;
    if (
      active &&
      active !== document.body &&
      active !== dialog &&
      !dialog.contains(active)
    ) {
      previousFocusRef.current = null;
      return;
    }
    previousFocusRef.current?.focus();
    previousFocusRef.current = null;
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
      queueMicrotask(() => initialFocusRef?.current?.focus());
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
      restorePreviousFocus(dialog);
    }
  }, [initialFocusRef, open]);

  useEffect(
    () => () => {
      const dialog = dialogRef.current;
      if (dialog) restorePreviousFocus(dialog);
    },
    [],
  );

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (
      dismissible &&
      event.button === 0 &&
      event.target === event.currentTarget
    ) {
      onClose("backdrop");
    }
  };

  return (
    <dialog
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      className={cx("viva-dialog", className)}
      data-size={size}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose("escape");
      }}
      onMouseDown={handleBackdropClick}
      ref={dialogRef}
    >
      <div className="viva-dialog__surface">
        <header className="viva-dialog__header">
          <div className="viva-dialog__heading">
            <h2 className="viva-dialog__title" id={titleId}>
              {title}
            </h2>
            {description ? (
              <div className="viva-dialog__description" id={descriptionId}>
                {description}
              </div>
            ) : null}
          </div>
          {dismissible ? (
            <IconButton
              label={closeLabel ?? t("Close dialog")}
              onClick={() => onClose("close-button")}
              size="small"
              tooltip={false}
            >
              <CloseIcon />
            </IconButton>
          ) : null}
        </header>
        <div className="viva-dialog__body">{children}</div>
        {footer ? <footer className="viva-dialog__footer">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
