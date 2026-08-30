import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MoveToTrashDialog } from "./MoveToTrashDialog";

describe("MoveToTrashDialog", () => {
  it("makes recovery explicit and keeps danger styling on the move action", async () => {
    const onMoveToTrash = vi.fn();
    render(
      <MoveToTrashDialog
        entryName="archive.md"
        onCancel={vi.fn()}
        onMoveToTrash={onMoveToTrash}
        open
      />,
    );

    expect(
      screen.getByText(
        "This item will be moved to the system Trash. You can recover it there.",
      ),
    ).toBeVisible();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(cancel).toHaveFocus());
    const move = screen.getByRole("button", { name: "Move to Trash" });
    expect(move).toHaveAttribute("data-variant", "danger");
    expect(cancel).toHaveAttribute("data-variant", "ghost");

    fireEvent.click(move);
    expect(onMoveToTrash).toHaveBeenCalledOnce();
  });

  it("offers save-and-move with dirty and open-document warnings", () => {
    render(
      <MoveToTrashDialog
        dirty
        entryName="Drafts"
        onCancel={vi.fn()}
        onMoveToTrash={vi.fn()}
        open
        openDocumentCount={2}
      />,
    );

    expect(
      screen.getByText(
        "Unsaved changes will be saved before this item is moved.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("2 open documents will close after this item is moved."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save & Move to Trash" }),
    ).toBeVisible();
  });

  it("locks both actions and Escape while the move is busy", () => {
    const onCancel = vi.fn();
    const onMoveToTrash = vi.fn();
    render(
      <MoveToTrashDialog
        busy
        entryName="archive.md"
        onCancel={onCancel}
        onMoveToTrash={onMoveToTrash}
        open
      />,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move to Trash" })).toBeDisabled();
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(onCancel).not.toHaveBeenCalled();
    expect(onMoveToTrash).not.toHaveBeenCalled();
  });

  it("keeps a failed move visible inside the dialog", () => {
    render(
      <MoveToTrashDialog
        entryName="archive.md"
        error="The item is still in its folder."
        onCancel={vi.fn()}
        onMoveToTrash={vi.fn()}
        open
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The item is still in its folder.",
    );
  });

  it("restores the invoking control after cancellation", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">
            Trash item
          </button>
          <MoveToTrashDialog
            entryName="archive.md"
            onCancel={() => setOpen(false)}
            onMoveToTrash={vi.fn()}
            open={open}
          />
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Trash item" });
    trigger.focus();
    fireEvent.click(trigger);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(cancel).toHaveFocus());

    fireEvent.click(cancel);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });
});
