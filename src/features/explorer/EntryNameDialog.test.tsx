import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { EntryNameDialog } from "./EntryNameDialog";

describe("EntryNameDialog", () => {
  it.each([
    ["new-file" as const, "Draft.md", "New Markdown File", 5],
    ["new-folder" as const, "Drafts", "New Folder", 6],
    ["rename" as const, "chapter.md", "Rename “chapter.md”", 7],
  ])(
    "focuses and selects the editable filename for %s",
    async (mode, initialValue, title, selectionEnd) => {
      render(
        <EntryNameDialog
          initialValue={initialValue}
          mode={mode}
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
          open
        />,
      );

      const input = screen.getByRole("textbox") as HTMLInputElement;
      await waitFor(() => expect(input).toHaveFocus());
      expect(screen.getByRole("dialog", { name: title })).toBeVisible();
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(selectionEnd);
    },
  );

  it("submits a trimmed controlled value with Enter", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <EntryNameDialog
        initialValue="First.md"
        mode="new-file"
        onCancel={vi.fn()}
        onSubmit={onSubmit}
        open
      />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  Notes.md  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith("Notes.md");

    rerender(
      <EntryNameDialog
        initialValue="Renamed.md"
        mode="new-file"
        onCancel={vi.fn()}
        onSubmit={onSubmit}
        open
      />,
    );
    expect(input).toHaveValue("Renamed.md");
  });

  it.each([
    { isComposing: true, keyCode: 13 },
    { isComposing: false, keyCode: 229 },
  ])("does not treat an IME confirmation as form submission %#", (native) => {
    const onSubmit = vi.fn();
    render(
      <EntryNameDialog
        initialValue="中文.md"
        mode="new-file"
        onCancel={vi.fn()}
        onSubmit={onSubmit}
        open
      />,
    );

    const event = createEvent.keyDown(screen.getByRole("textbox"), {
      ...native,
      key: "Enter",
    });
    fireEvent(screen.getByRole("textbox"), event);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not dismiss while Escape cancels an active composition", () => {
    const onCancel = vi.fn();
    render(
      <EntryNameDialog
        initialValue="中文.md"
        mode="new-file"
        onCancel={onCancel}
        onSubmit={vi.fn()}
        open
      />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { isComposing: true, key: "Escape" });
    fireEvent.compositionEnd(input);

    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );

    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows native errors inline and locks dismissal while busy", () => {
    const onCancel = vi.fn();
    render(
      <EntryNameDialog
        busy
        error="A file already exists at this location."
        initialValue="Draft.md"
        mode="rename"
        onCancel={onCancel}
        onSubmit={vi.fn()}
        open
      />,
    );

    const input = screen.getByRole("textbox");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("A file already exists at this location.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", alert.id);
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rename" })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels with Escape and restores focus after closing", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">
            New file
          </button>
          <EntryNameDialog
            initialValue="Draft.md"
            mode="new-file"
            onCancel={() => setOpen(false)}
            onSubmit={vi.fn()}
            open={open}
          />
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "New file" });
    trigger.focus();
    fireEvent.click(trigger);
    const input = screen.getByRole("textbox");
    await waitFor(() => expect(input).toHaveFocus());

    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("renders translated field and action labels", () => {
    render(
      <I18nProvider initialPreference="zh-Hans" storage={null}>
        <EntryNameDialog
          initialValue="资料"
          mode="new-folder"
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
          open
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("dialog", { name: "新建文件夹" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "文件夹名称" })).toBeVisible();
    expect(screen.getByRole("button", { name: "新建文件夹" })).toBeVisible();
  });
});
