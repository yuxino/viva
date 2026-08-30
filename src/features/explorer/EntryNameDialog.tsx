import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { useI18n } from "../../i18n";
import { isImeKeyEvent } from "../../lib/keyboard";
import "./entryDialogs.css";

export type EntryNameDialogMode = "new-file" | "new-folder" | "rename";
export type EntryNameKind = "file" | "folder";

export interface EntryNameDialogProps {
  busy?: boolean;
  entryKind?: EntryNameKind;
  error?: string | null;
  initialValue?: string;
  mode: EntryNameDialogMode;
  onCancel: () => void;
  onSubmit: (name: string) => void;
  onValueChange?: (value: string) => void;
  open: boolean;
}

function filenameSelectionEnd(value: string): number {
  const extensionStart = value.lastIndexOf(".");
  return extensionStart > 0 ? extensionStart : value.length;
}

export function EntryNameDialog({
  busy = false,
  entryKind = "file",
  error = null,
  initialValue = "",
  mode,
  onCancel,
  onSubmit,
  onValueChange,
  open,
}: EntryNameDialogProps) {
  const { fmt, t } = useI18n();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const suppressImeCancelRef = useRef(false);
  const selectionPendingRef = useRef(true);
  const formId = useId();
  const errorId = useId();

  useLayoutEffect(() => {
    if (!open) return;
    setValue(initialValue);
    composingRef.current = false;
    suppressImeCancelRef.current = false;
    selectionPendingRef.current = true;
  }, [initialValue, mode, open]);

  const isFileName =
    mode === "new-file" || (mode === "rename" && entryKind === "file");
  const title =
    mode === "new-file"
      ? t("New Markdown File")
      : mode === "new-folder"
        ? t("New Folder")
        : fmt("Rename “%@”", initialValue);
  const fieldLabel =
    mode === "new-file"
      ? t("File name")
      : mode === "new-folder"
        ? t("Folder name")
        : t("Name");
  const submitLabel =
    mode === "new-file"
      ? t("Create File")
      : mode === "new-folder"
        ? t("Create Folder")
        : t("Rename");
  const trimmedValue = value.trim();
  const submitValue = () => {
    if (busy || !trimmedValue) return;
    onSubmit(trimmedValue);
  };

  return (
    <Dialog
      className="entry-dialog"
      dismissible={!busy}
      footer={
        <>
          <Button disabled={busy} onClick={onCancel} variant="ghost">
            {t("Cancel")}
          </Button>
          <Button
            disabled={!trimmedValue}
            form={formId}
            loading={busy}
            type="submit"
            variant="primary"
          >
            {submitLabel}
          </Button>
        </>
      }
      initialFocusRef={inputRef}
      onClose={(reason) => {
        if (
          reason === "escape" &&
          (composingRef.current || suppressImeCancelRef.current)
        ) {
          suppressImeCancelRef.current = false;
          return;
        }
        onCancel();
      }}
      open={open}
      size="small"
      title={title}
    >
      <form
        className="entry-name-dialog__form"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          submitValue();
        }}
      >
        <label className="entry-name-dialog__label" htmlFor={`${formId}-name`}>
          {fieldLabel}
        </label>
        <input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          autoCapitalize="off"
          autoComplete="off"
          className="entry-name-dialog__input"
          disabled={busy}
          id={`${formId}-name`}
          maxLength={255}
          onChange={(event) => {
            const nextValue = event.currentTarget.value;
            setValue(nextValue);
            onValueChange?.(nextValue);
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onFocus={(event) => {
            if (!selectionPendingRef.current) return;
            selectionPendingRef.current = false;
            const end = isFileName
              ? filenameSelectionEnd(event.currentTarget.value)
              : event.currentTarget.value.length;
            event.currentTarget.setSelectionRange(0, end);
          }}
          onKeyDown={(event) => {
            const imeEvent = isImeKeyEvent(event.nativeEvent);
            if (imeEvent && event.key === "Escape") {
              suppressImeCancelRef.current = true;
            } else if (!imeEvent) {
              suppressImeCancelRef.current = false;
            }
            if (event.key !== "Enter") return;
            if (imeEvent) return;
            event.preventDefault();
            submitValue();
          }}
          ref={inputRef}
          spellCheck={false}
          type="text"
          value={value}
        />
        {error ? (
          <p className="entry-name-dialog__error" id={errorId} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
