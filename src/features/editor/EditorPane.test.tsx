import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorPane } from "./EditorPane";
import {
  continueMarkdownLine,
  formatMarkdownSelection,
  indentText,
  offsetAtPosition,
  sourceLineFromScroll,
  typewriterScrollTop,
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

  it.each([
    ["Tab", false],
    ["Shift+Tab", true],
  ])(
    "lets one %s escape the editor after Escape",
    (_label, shiftKey) => {
      render(<ControlledEditor />);
      const editor = screen.getByRole("textbox", {
        name: "Markdown editor",
      });
      editor.focus();

      fireEvent.keyDown(editor, { key: "Escape" });
      const exitTab = createEvent.keyDown(editor, { key: "Tab", shiftKey });
      fireEvent(editor, exitTab);

      expect(exitTab.defaultPrevented).toBe(false);
      expect(editor).toHaveValue("hello");

      const editingTab = createEvent.keyDown(editor, { key: "Tab", shiftKey });
      fireEvent(editor, editingTab);
      expect(editingTab.defaultPrevented).toBe(true);
    },
  );

  it.each([
    { isComposing: true, keyCode: 27 },
    { isComposing: false, keyCode: 229 },
  ])("keeps Tab in the editor after an IME Escape %#", (native) => {
    render(<ControlledEditor />);
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(0, 0);

    fireEvent.keyDown(editor, { ...native, key: "Escape" });
    const editingTab = createEvent.keyDown(editor, { key: "Tab" });
    fireEvent(editor, editingTab);

    expect(editingTab.defaultPrevented).toBe(true);
    expect(editor).toHaveValue("  hello");
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

  it.each([
    { isComposing: true, keyCode: 13 },
    { isComposing: false, keyCode: 229 },
  ])(
    "does not turn an IME confirmation into a new Markdown list item %#",
    (native) => {
    const onChange = vi.fn();
    render(<EditorPane onChange={onChange} value="- 中文输入" />);
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length);

    fireEvent.keyDown(editor, { ...native, key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
    },
  );

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

  it.each([
    ["Bold", "**hello**", 2, 7],
    ["Italic", "*hello*", 1, 6],
    ["Inline Code", "`hello`", 1, 6],
  ])(
    "formats a selection with the %s context action and preserves the selection",
    (label, expectedValue, expectedStart, expectedEnd) => {
      render(<ControlledEditor />);
      const editor = screen.getByRole("textbox", {
        name: "Markdown editor",
      }) as HTMLTextAreaElement;
      editor.focus();
      editor.setSelectionRange(0, 5);

      fireEvent.contextMenu(editor);
      fireEvent.click(
        screen.getByRole("menuitem", { name: new RegExp(`^${label}`) }),
      );

      expect(editor).toHaveValue(expectedValue);
      expect(editor.selectionStart).toBe(expectedStart);
      expect(editor.selectionEnd).toBe(expectedEnd);
    },
  );

  it("keeps the caret line centered in typewriter mode without publishing the synthetic scroll", () => {
    const onSourceLineChange = vi.fn();
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.vivaTypewriterCaret === "true" ? 600 : 0;
      },
    );
    render(
      <EditorPane
        onChange={vi.fn()}
        onSourceLineChange={onSourceLineChange}
        typewriterMode
        value={"one\ntwo\nthree"}
      />,
    );
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    Object.defineProperties(editor, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_200 },
    });
    editor.scrollTop = 0;
    editor.setSelectionRange(7, 7);

    fireEvent.select(editor);

    expect(editor.scrollTop).toBe(412);
    fireEvent.scroll(editor);
    expect(onSourceLineChange).not.toHaveBeenCalled();
  });

  it("reuses an exact typewriter measurement for the same value and caret", () => {
    const append = vi.spyOn(document.body, "append");
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.vivaTypewriterCaret === "true" ? 600 : 0;
      },
    );
    render(
      <EditorPane
        onChange={vi.fn()}
        typewriterMode
        value={"one\ntwo\nthree"}
      />,
    );
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    Object.defineProperties(editor, {
      clientHeight: { configurable: true, value: 400 },
      clientWidth: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1_200 },
    });
    editor.setSelectionRange(7, 7);

    fireEvent.select(editor);
    fireEvent.select(editor);

    const mirrorAppends = append.mock.calls.filter(([node]) =>
      (node as HTMLElement).querySelector?.("[data-viva-typewriter-caret]"),
    );
    expect(mirrorAppends).toHaveLength(1);
  });

  it("does not reposition the editor when typewriter mode is off", () => {
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockReturnValue(600);
    render(<EditorPane onChange={vi.fn()} value={"one\ntwo\nthree"} />);
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    Object.defineProperties(editor, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_200 },
    });
    editor.scrollTop = 73;
    editor.setSelectionRange(7, 7);

    fireEvent.select(editor);

    expect(editor.scrollTop).toBe(73);
  });

  it("waits for IME composition to finish before typewriter repositioning", () => {
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.vivaTypewriterCaret === "true" ? 600 : 0;
      },
    );
    render(
      <EditorPane
        onChange={vi.fn()}
        typewriterMode
        value={"one\ntwo\nthree"}
      />,
    );
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    Object.defineProperties(editor, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_200 },
    });
    editor.scrollTop = 73;
    editor.setSelectionRange(7, 7);

    fireEvent.compositionStart(editor);
    fireEvent.select(editor);
    expect(editor.scrollTop).toBe(73);

    fireEvent.compositionEnd(editor);
    expect(editor.scrollTop).toBe(412);
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

  it("reveals an external find selection in a large document without focusing it", () => {
    const value = "x".repeat(600_000);
    const selection = {
      direction: "none" as const,
      end: value.length,
      start: value.length - 1,
    };
    const view = render(
      <EditorPane
        onChange={vi.fn()}
        selection={selection}
        value={value}
      />,
    );
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    Object.defineProperties(editor, {
      clientHeight: { configurable: true, value: 400 },
      clientWidth: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1_200 },
    });
    editor.scrollTop = 0;

    view.rerender(
      <EditorPane
        onChange={vi.fn()}
        revealSelectionRequestId={1}
        selection={selection}
        value={value}
      />,
    );

    expect(editor).not.toHaveFocus();
    expect(editor.scrollTop).toBe(800);
  });

  it("uses a bounded typewriter approximation without a mirror for a mid-large document", () => {
    const append = vi.spyOn(document.body, "append");
    const value = "x".repeat(128 * 1024);
    render(
      <EditorPane onChange={vi.fn()} typewriterMode value={value} />,
    );
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    Object.defineProperties(editor, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_200 },
    });
    editor.scrollTop = 0;
    editor.setSelectionRange(value.length, value.length);

    fireEvent.select(editor);

    expect(append).not.toHaveBeenCalled();
    expect(editor.scrollTop).toBe(800);
  });

  it("delegates pasted images with the exact source selection", () => {
    const onPasteImage = vi.fn();
    const file = new File(["image"], "capture.png", { type: "image/png" });
    render(
      <EditorPane
        onChange={vi.fn()}
        onPasteImage={onPasteImage}
        value="hello"
      />,
    );
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(1, 4, "backward");

    const notCancelled = fireEvent.paste(editor, {
      clipboardData: {
        items: [
          {
            getAsFile: () => file,
            kind: "file",
            type: "image/png",
          },
        ],
      },
    });

    expect(notCancelled).toBe(false);
    expect(onPasteImage).toHaveBeenCalledWith(file, {
      direction: "backward",
      end: 4,
      start: 1,
    });
  });

  it("leaves ordinary text paste to the textarea", () => {
    const onPasteImage = vi.fn();
    render(
      <EditorPane
        onChange={vi.fn()}
        onPasteImage={onPasteImage}
        value="hello"
      />,
    );
    const editor = screen.getByRole("textbox", {
      name: "Markdown editor",
    });

    const notCancelled = fireEvent.paste(editor, {
      clipboardData: {
        items: [{ getAsFile: () => null, kind: "string", type: "text/plain" }],
      },
    });

    expect(notCancelled).toBe(true);
    expect(onPasteImage).not.toHaveBeenCalled();
  });

  it("pastes a clipboard image from the custom context menu", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const readText = vi.fn().mockResolvedValue("fallback text");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: vi.fn().mockResolvedValue([
          {
            getType: vi.fn().mockResolvedValue(
              new Blob([Uint8Array.of(137, 80, 78, 71)], {
                type: "image/png",
              }),
            ),
            types: ["image/png"],
          },
        ]),
        readText,
      },
    });
    try {
      const onPasteImage = vi.fn();
      render(
        <EditorPane
          onChange={vi.fn()}
          onPasteImage={onPasteImage}
          value="hello"
        />,
      );
      const editor = screen.getByRole("textbox", {
        name: "Markdown editor",
      }) as HTMLTextAreaElement;
      editor.setSelectionRange(1, 4, "backward");

      fireEvent.contextMenu(editor);
      fireEvent.click(screen.getByRole("menuitem", { name: /^Paste/ }));

      await waitFor(() => expect(onPasteImage).toHaveBeenCalledOnce());
      const [file, selection] = onPasteImage.mock.calls[0] as [
        File,
        { direction: string; end: number; start: number },
      ];
      expect(file).toBeInstanceOf(File);
      expect(file.type).toBe("image/png");
      expect(file.size).toBe(4);
      expect(selection).toEqual({ direction: "backward", end: 4, start: 1 });
      expect(readText).not.toHaveBeenCalled();
    } finally {
      if (descriptor) {
        Object.defineProperty(navigator, "clipboard", descriptor);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  });

  it("keeps text paste as the custom context-menu fallback", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: vi.fn().mockResolvedValue([
          { getType: vi.fn(), types: ["text/plain"] },
        ]),
        readText: vi.fn().mockResolvedValue(" world"),
      },
    });
    try {
      function ContextPasteEditor() {
        const [value, setValue] = useState("hello");
        return (
          <EditorPane
            onChange={setValue}
            onPasteImage={vi.fn()}
            value={value}
          />
        );
      }
      render(<ContextPasteEditor />);
      const editor = screen.getByRole("textbox", {
        name: "Markdown editor",
      }) as HTMLTextAreaElement;
      editor.setSelectionRange(editor.value.length, editor.value.length);

      fireEvent.contextMenu(editor);
      fireEvent.click(screen.getByRole("menuitem", { name: /^Paste/ }));

      await waitFor(() => expect(editor).toHaveValue("hello world"));
    } finally {
      if (descriptor) {
        Object.defineProperty(navigator, "clipboard", descriptor);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
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

  it("centers and clamps typewriter caret scroll positions", () => {
    expect(typewriterScrollTop(600, 24, 1_200, 400)).toBe(412);
    expect(typewriterScrollTop(20, 24, 1_200, 400)).toBe(0);
    expect(typewriterScrollTop(1_180, 24, 1_200, 400)).toBe(800);
    expect(typewriterScrollTop(600, 24, 400, 400)).toBe(0);
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
