import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorPane } from "./EditorPane";
import {
  continueMarkdownLine,
  formatMarkdownSelection,
  indentText,
  offsetAtPosition,
  sourceLineFromScroll,
} from "./editing";

function ControlledEditor() {
  const [value, setValue] = useState("hello");
  return <EditorPane onChange={setValue} value={value} />;
}

beforeEach(() => {
  document.documentElement.dataset.platform = "macos";
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.platform;
});

describe("EditorPane", () => {
  it("inserts spaces for Tab and restores the resulting selection", () => {
    render(<ControlledEditor />);
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(0, 0);

    fireEvent.keyDown(editor, { key: "Tab" });

    expect(editor).toHaveValue("  hello");
    expect(editor.selectionStart).toBe(2);
    expect(editor.selectionEnd).toBe(2);
  });

  it("reports line and Unicode-aware column changes", () => {
    const onPositionChange = vi.fn();
    render(
      <EditorPane
        onChange={vi.fn()}
        onPositionChange={onPositionChange}
        value={"first\n你a"}
      />,
    );
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(8, 8);
    fireEvent.select(editor);

    expect(onPositionChange).toHaveBeenLastCalledWith({ line: 2, column: 3 });
    expect(screen.getByLabelText("Cursor position")).toHaveTextContent(
      "Ln 2, Col 3",
    );
  });

  it("continues task lists on Enter", () => {
    function TaskEditor() {
      const [value, setValue] = useState("- [x] Ship Viva");
      return <EditorPane onChange={setValue} value={value} />;
    }
    render(<TaskEditor />);
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length);

    fireEvent.keyDown(editor, { key: "Enter" });

    expect(editor).toHaveValue("- [x] Ship Viva\n- [ ] ");
    expect(editor.selectionStart).toBe(editor.value.length);
  });

  it("does not turn an IME confirmation into a new Markdown list item", () => {
    const onChange = vi.fn();
    render(<EditorPane onChange={onChange} value="- 中文输入" />);
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length);

    fireEvent.keyDown(editor, { isComposing: true, key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("formats a selection with the native bold shortcut", () => {
    render(<ControlledEditor />);
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(0, 5);

    fireEvent.keyDown(editor, { key: "b", metaKey: true });

    expect(editor).toHaveValue("**hello**");
    expect(editor.selectionStart).toBe(2);
    expect(editor.selectionEnd).toBe(7);
  });

  it("leaves macOS Control shortcuts available to the text editor", () => {
    render(<ControlledEditor />);
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(0, 5);

    fireEvent.keyDown(editor, { key: "b", ctrlKey: true });

    expect(editor).toHaveValue("hello");
  });

  it("does not scan a large document for live cursor status", () => {
    const onPositionChange = vi.fn();
    const value = "x".repeat(512 * 1024 + 1);
    render(
      <EditorPane
        onChange={vi.fn()}
        onPositionChange={onPositionChange}
        value={value}
      />,
    );
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(value.length, value.length);
    fireEvent.select(editor);

    expect(onPositionChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Cursor position")).not.toBeInTheDocument();
  });

  it("opens the text menu with the keyboard and selects all text", () => {
    render(<ControlledEditor />);
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    editor.focus();

    fireEvent.keyDown(editor, { key: "F10", shiftKey: true });
    const menu = screen.getByRole("menu", { name: "Text editing menu" });
    expect(menu).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: /Select all/ }));

    expect(editor.selectionStart).toBe(0);
    expect(editor.selectionEnd).toBe(5);
  });
});

describe("editor text operations", () => {
  it("outdents all selected lines without consuming a following line", () => {
    expect(
      indentText("  one\n  two\nthree", { start: 0, end: 12 }, 2, true),
    ).toEqual({
      value: "one\ntwo\nthree",
      selection: { start: 0, end: 8, direction: "none" },
    });
  });

  it("maps scrolling progress to source lines", () => {
    expect(sourceLineFromScroll("1\n2\n3\n4\n5", 50, 200, 100)).toBe(3);
  });

  it("maps one-based Unicode line and column positions to editor offsets", () => {
    expect(offsetAtPosition("one\n你🙂x\nthree", 2, 3)).toBe(7);
    expect(offsetAtPosition("one\ntwo", 99, 99)).toBe(7);
    expect(offsetAtPosition("one\ntwo", 1, 99)).toBe(3);
  });

  it("continues and exits Markdown lists without a visible toolbar", () => {
    expect(
      continueMarkdownLine("1. first", { start: 8, end: 8 }),
    ).toEqual({
      value: "1. first\n2. ",
      selection: { start: 12, end: 12, direction: "none" },
    });
    expect(continueMarkdownLine("- ", { start: 2, end: 2 })).toEqual({
      value: "",
      selection: { start: 0, end: 0, direction: "none" },
    });
  });

  it("wraps and unwraps Markdown formatting", () => {
    const wrapped = formatMarkdownSelection(
      "hello",
      { start: 0, end: 5 },
      "italic",
    );
    expect(wrapped.value).toBe("*hello*");
    expect(
      formatMarkdownSelection(wrapped.value, { start: 1, end: 6 }, "italic"),
    ).toEqual({
      value: "hello",
      selection: { start: 0, end: 5, direction: "none" },
    });
  });
});
