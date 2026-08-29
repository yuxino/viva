import { useEffect, useRef } from "react";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { useI18n } from "../i18n";

export interface UnsavedChangesDialogProps {
  documentName: string;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
  open: boolean;
  saving?: boolean;
  scope?: "document" | "application";
}

export function UnsavedChangesDialog({
  documentName,
  onCancel,
  onDiscard,
  onSave,
  open,
  saving = false,
  scope = "document",
}: UnsavedChangesDialogProps) {
  const { fmt, t } = useI18n();
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) queueMicrotask(() => saveRef.current?.focus());
  }, [open]);

  return (
    <Dialog
      description={
        scope === "application"
          ? t("Viva has changes that have not been written to disk.")
          : t("Your changes have not been written to disk.")
      }
      dismissible={!saving}
      footer={
        <>
          <Button disabled={saving} onClick={onDiscard} variant="danger">
            {t("Don’t save")}
          </Button>
          <span className="viva-dialog__footer-spacer" />
          <Button disabled={saving} onClick={onCancel} variant="ghost">
            {t("Cancel")}
          </Button>
          <Button loading={saving} onClick={onSave} ref={saveRef} variant="primary">
            {t("Save")}
          </Button>
        </>
      }
      onClose={onCancel}
      open={open}
      size="small"
      title={fmt("Save changes to “%@”?", documentName)}
    >
      {scope === "application"
        ? t("Closing Viva without saving will discard the latest edits.")
        : t("Closing this tab without saving will discard the latest edits.")}
    </Dialog>
  );
}
