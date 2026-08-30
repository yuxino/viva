import { useRef } from "react";
import { Button, Dialog } from "../../components/ui";
import { useI18n } from "../../i18n";
import "./entryDialogs.css";

export interface DuplicateEntryDialogProps {
  busy?: boolean;
  dirty: boolean;
  entryName: string;
  error?: string | null;
  onCancel: () => void;
  onSaveAndDuplicate: () => void;
  open: boolean;
}

export function DuplicateEntryDialog({
  busy = false,
  dirty,
  entryName,
  error = null,
  onCancel,
  onSaveAndDuplicate,
  open,
}: DuplicateEntryDialogProps) {
  const { fmt, t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);

  if (!dirty) return null;

  return (
    <Dialog
      className="entry-dialog"
      dismissible={!busy}
      footer={
        <>
          <Button
            disabled={busy}
            onClick={onCancel}
            ref={cancelRef}
            variant="ghost"
          >
            {t("Cancel")}
          </Button>
          <Button
            loading={busy}
            onClick={onSaveAndDuplicate}
            variant="primary"
          >
            {t("Save & Duplicate")}
          </Button>
        </>
      }
      initialFocusRef={cancelRef}
      onClose={onCancel}
      open={open}
      size="small"
      title={fmt("Save “%@” before duplicating?", entryName)}
    >
      <div className="duplicate-entry-dialog__copy">
        <p>
          {t(
            "Your latest edits must be saved before Viva can create the copy.",
          )}
        </p>
        {error ? (
          <p className="entry-name-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
