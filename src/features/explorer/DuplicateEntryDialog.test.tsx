import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { DuplicateEntryDialog } from "./DuplicateEntryDialog";

describe("DuplicateEntryDialog", () => {
  it("only opens for a dirty document", () => {
    const { rerender } = render(
      <DuplicateEntryDialog
        dirty={false}
        entryName="Draft.md"
        onCancel={vi.fn()}
        onSaveAndDuplicate={vi.fn()}
        open
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(
      <DuplicateEntryDialog
        dirty
        entryName="Draft.md"
        onCancel={vi.fn()}
        onSaveAndDuplicate={vi.fn()}
        open={false}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("explains the save requirement and safely focuses Cancel", async () => {
    const onCancel = vi.fn();
    const onSaveAndDuplicate = vi.fn();
    render(
      <DuplicateEntryDialog
        dirty
        entryName="Draft.md"
        onCancel={onCancel}
        onSaveAndDuplicate={onSaveAndDuplicate}
        open
      />,
    );

    expect(
      screen.getByRole("dialog", {
        name: "Save “Draft.md” before duplicating?",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Your latest edits must be saved before Viva can create the copy.",
      ),
    ).toBeVisible();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(cancel).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Save & Duplicate" }));
    expect(onSaveAndDuplicate).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels explicitly and locks dismissal while busy", () => {
    const onCancel = vi.fn();
    const onSaveAndDuplicate = vi.fn();
    const { rerender } = render(
      <DuplicateEntryDialog
        dirty
        entryName="Draft.md"
        onCancel={onCancel}
        onSaveAndDuplicate={onSaveAndDuplicate}
        open
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();

    onCancel.mockClear();
    rerender(
      <DuplicateEntryDialog
        busy
        dirty
        entryName="Draft.md"
        onCancel={onCancel}
        onSaveAndDuplicate={onSaveAndDuplicate}
        open
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save & Duplicate" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Close dialog" }),
    ).toBeNull();

    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSaveAndDuplicate).not.toHaveBeenCalled();
  });

  it("shows an inline operation error without dismissing the dialog", () => {
    render(
      <DuplicateEntryDialog
        dirty
        entryName="Draft.md"
        error="The copy could not be created."
        onCancel={vi.fn()}
        onSaveAndDuplicate={vi.fn()}
        open
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The copy could not be created.",
    );
  });

  it("renders concise Simplified Chinese copy", () => {
    render(
      <I18nProvider initialPreference="zh-Hans" storage={null}>
        <DuplicateEntryDialog
          dirty
          entryName="草稿.md"
          onCancel={vi.fn()}
          onSaveAndDuplicate={vi.fn()}
          open
        />
      </I18nProvider>,
    );

    expect(
      screen.getByRole("dialog", { name: "复制“草稿.md”前先保存？" }),
    ).toBeVisible();
    expect(
      screen.getByText("创建副本前，需要先保存最新编辑。"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "保存并创建副本" }),
    ).toBeVisible();
  });
});
