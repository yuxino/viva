import { useRef } from "react";
import { Button, Dialog } from "../../components/ui";
import { useI18n } from "../../i18n";
import "./entryDialogs.css";

export interface MoveToTrashDialogProps {
  busy?: boolean;
  dirty?: boolean;
  entryName: string;
  error?: string | null;
  onCancel: () => void;
  onMoveToTrash: () => void;
  open: boolean;
  openDocumentCount?: number;
}

export function MoveToTrashDialog({
  busy = false,
  dirty = false,
  entryName,
  error = null,
  onCancel,
  onMoveToTrash,
  open,
  openDocumentCount = 0,
}: MoveToTrashDialogProps) {
  const { fmt, t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const normalizedOpenDocumentCount = Math.max(
    0,
    Math.trunc(openDocumentCount),
  );

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
            onClick={onMoveToTrash}
            variant="danger"
          >
            {dirty ? t("Save & Move to Trash") : t("Move to Trash")}
          </Button>
        </>
      }
      initialFocusRef={cancelRef}
      onClose={onCancel}
      open={open}
      size="small"
      title={fmt("Move “%@” to Trash?", entryName)}
    >
      <div className="move-to-trash-dialog__copy">
        <p>
          {t(
            "This item will be moved to the system Trash. You can recover it there.",
          )}
        </p>
        {dirty || normalizedOpenDocumentCount > 0 ? (
          <div className="move-to-trash-dialog__warning">
            {dirty ? (
              <p>{t("Unsaved changes will be saved before this item is moved.")}</p>
            ) : null}
            {normalizedOpenDocumentCount > 0 ? (
              <p>
                {fmt(
                  normalizedOpenDocumentCount === 1
                    ? "%d open document will close after this item is moved."
                    : "%d open documents will close after this item is moved.",
                  normalizedOpenDocumentCount,
                )}
              </p>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p className="entry-name-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
