import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceImageCacheLike } from "../../lib/media";
import { LiveEditorPane } from "./LiveEditorPane";

function installIntersectionObserver() {
  let callback: IntersectionObserverCallback | null = null;
  let observer: TestIntersectionObserver | null = null;
  const observed = new Set<Element>();

  class TestIntersectionObserver {
    constructor(nextCallback: IntersectionObserverCallback) {
      callback = nextCallback;
      observer = this;
    }

    disconnect() {
      observed.clear();
    }

    observe(target: Element) {
      observed.add(target);
    }

    takeRecords() {
      return [];
    }

    unobserve(target: Element) {
      observed.delete(target);
    }
  }

  vi.stubGlobal(
    "IntersectionObserver",
    TestIntersectionObserver as unknown as typeof IntersectionObserver,
  );

  return {
    enter(target: Element) {
      if (!callback || !observer || !observed.has(target)) {
        throw new Error("Expected the image placeholder to be observed.");
      }
      callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      );
    },
  };
}

function EditableFixture({ onLinkRequest = vi.fn() }) {
  const [value, setValue] = useState("# Quiet title\n\nA calm paragraph.");
  const [, setPosition] = useState({ column: 1, line: 1 });
  return (
    <LiveEditorPane
      documentId="note.md"
      onChange={setValue}
      onLinkRequest={onLinkRequest}
      onPositionChange={setPosition}
      value={value}
    />
  );
}

describe("LiveEditorPane", () => {
  it("edits one rendered block without rewriting the surrounding Markdown", () => {
    render(<EditableFixture />);

    fireEvent.click(screen.getByRole("heading", { name: "Quiet title" }));
    const editor = screen.getByRole("textbox", {
      name: "Editing block from line 1",
    });
    expect(editor).toHaveValue("# Quiet title\n");

    fireEvent.change(editor, { target: { value: "# Better title\n" } });
    fireEvent.blur(editor);

    expect(
      screen.getByRole("heading", { name: "Better title" }),
    ).toBeVisible();
    expect(screen.getByText("A calm paragraph.")).toBeVisible();
  });

  it("opens a rendered block for editing from its context menu", () => {
    render(<EditableFixture />);
    const block = screen.getAllByRole("group")[0];
    expect(block).toBeDefined();

    fireEvent.contextMenu(block!);
    expect(screen.getByRole("menu", { name: "Live block menu" })).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit block" }));

    expect(
      screen.getByRole("textbox", { name: "Editing block from line 1" }),
    ).toBeVisible();
  });

  it("places the caret in the clicked occurrence of repeated rendered text", () => {
    render(
      <LiveEditorPane
        documentId="repeated.md"
        onChange={vi.fn()}
        value="one **one**"
      />,
    );
    const emphasized = document.querySelector("strong");
    const secondOccurrence = emphasized?.firstChild;
    expect(emphasized).not.toBeNull();
    expect(secondOccurrence?.textContent).toBe("one");

    const caretDocument = document as Document & {
      caretPositionFromPoint?: () => { offset: number; offsetNode: Node };
    };
    const original = Object.getOwnPropertyDescriptor(
      caretDocument,
      "caretPositionFromPoint",
    );
    Object.defineProperty(caretDocument, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offset: 1, offsetNode: secondOccurrence! }),
    });
    try {
      fireEvent.click(emphasized!, { clientX: 12, clientY: 12 });
      const editor = screen.getByRole("textbox", {
        name: "Editing block from line 1",
      });
      expect(editor).toHaveProperty("selectionStart", 7);
      expect(editor).toHaveProperty("selectionEnd", 7);
    } finally {
      if (original) {
        Object.defineProperty(caretDocument, "caretPositionFromPoint", original);
      } else {
        Reflect.deleteProperty(caretDocument, "caretPositionFromPoint");
      }
    }
  });

  it("ignores hidden link destinations when mapping a repeated visible word", () => {
    render(
      <LiveEditorPane
        documentId="links.md"
        onChange={vi.fn()}
        value="**one** [one](https://example.com/a/very/very/long/path)"
      />,
    );
    const firstOccurrence = document.querySelector("strong")?.firstChild;
    expect(firstOccurrence?.textContent).toBe("one");
    const caretDocument = document as Document & {
      caretPositionFromPoint?: () => { offset: number; offsetNode: Node };
    };
    const original = Object.getOwnPropertyDescriptor(
      caretDocument,
      "caretPositionFromPoint",
    );
    Object.defineProperty(caretDocument, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offset: 1, offsetNode: firstOccurrence! }),
    });
    try {
      fireEvent.click(document.querySelector("strong")!, {
        clientX: 12,
        clientY: 12,
      });
      expect(
        screen.getByRole("textbox", { name: "Editing block from line 1" }),
      ).toHaveProperty("selectionStart", 3);
    } finally {
      if (original) {
        Object.defineProperty(caretDocument, "caretPositionFromPoint", original);
      } else {
        Reflect.deleteProperty(caretDocument, "caretPositionFromPoint");
      }
    }
  });

  it("ignores parentheses inside an angle-bracket link destination", () => {
    const value = '[one](<https://x.test/a(b>) **one**';
    render(
      <LiveEditorPane documentId="links.md" onChange={vi.fn()} value={value} />,
    );
    const secondOccurrence = document.querySelector("strong")?.firstChild;
    expect(secondOccurrence?.textContent).toBe("one");
    const caretDocument = document as Document & {
      caretPositionFromPoint?: () => { offset: number; offsetNode: Node };
    };
    const original = Object.getOwnPropertyDescriptor(
      caretDocument,
      "caretPositionFromPoint",
    );
    Object.defineProperty(caretDocument, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offset: 1, offsetNode: secondOccurrence! }),
    });
    try {
      fireEvent.click(document.querySelector("strong")!, {
        clientX: 12,
        clientY: 12,
      });
      expect(
        screen.getByRole("textbox", { name: "Editing block from line 1" }),
      ).toHaveProperty("selectionStart", value.lastIndexOf("one") + 1);
    } finally {
      if (original) {
        Object.defineProperty(caretDocument, "caretPositionFromPoint", original);
      } else {
        Reflect.deleteProperty(caretDocument, "caretPositionFromPoint");
      }
    }
  });

  it("treats a quote at the start of an unbracketed link as destination text", () => {
    const value = '[one]("a) **one**';
    render(
      <LiveEditorPane documentId="links.md" onChange={vi.fn()} value={value} />,
    );
    const secondOccurrence = document.querySelector("strong")?.firstChild;
    expect(secondOccurrence?.textContent).toBe("one");
    const caretDocument = document as Document & {
      caretPositionFromPoint?: () => { offset: number; offsetNode: Node };
    };
    const original = Object.getOwnPropertyDescriptor(
      caretDocument,
      "caretPositionFromPoint",
    );
    Object.defineProperty(caretDocument, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offset: 1, offsetNode: secondOccurrence! }),
    });
    try {
      fireEvent.click(document.querySelector("strong")!, {
        clientX: 12,
        clientY: 12,
      });
      expect(
        screen.getByRole("textbox", { name: "Editing block from line 1" }),
      ).toHaveProperty("selectionStart", value.lastIndexOf("one") + 1);
    } finally {
      if (original) {
        Object.defineProperty(caretDocument, "caretPositionFromPoint", original);
      } else {
        Reflect.deleteProperty(caretDocument, "caretPositionFromPoint");
      }
    }
  });

  it("opens rendered links with the primary modifier instead of editing", () => {
    const onLinkRequest = vi.fn();
    render(
      <LiveEditorPane
        documentId="links.md"
        onChange={vi.fn()}
        onLinkRequest={onLinkRequest}
        value="[Viva](https://example.com)"
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "Viva" }), {
      metaKey: true,
    });
    expect(onLinkRequest).toHaveBeenCalledWith("https://example.com");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps full-document reference links resolved across editable blocks", () => {
    render(
      <LiveEditorPane
        documentId="references.md"
        onChange={vi.fn()}
        value={"[Viva][site]\n\n[site]: https://example.com"}
      />,
    );

    expect(screen.getByRole("link", { name: "Viva" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
  });

  it("keeps a multi-paragraph list item in one live block", () => {
    render(
      <LiveEditorPane
        documentId="list.md"
        onChange={vi.fn()}
        value={"- First paragraph\n\n  Second paragraph\n\n- Next item"}
      />,
    );

    expect(screen.getAllByRole("list")).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders task-list checkboxes without making them editable controls", () => {
    render(
      <LiveEditorPane
        documentId="tasks.md"
        onChange={vi.fn()}
        value={"- [x] Done\n- [ ] Next"}
      />,
    );

    const checkboxes = screen.getAllByRole("checkbox", { hidden: true });
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
    expect(checkboxes.every((checkbox) => checkbox.hasAttribute("disabled"))).toBe(
      true,
    );
  });

  it("loads a local image inline, opens it, and releases its cache lease", async () => {
    const intersections = installIntersectionObserver();
    const release = vi.fn();
    const cache: WorkspaceImageCacheLike = {
      acquire: vi.fn().mockResolvedValue({
        height: 720,
        mediaType: "image/png",
        relativePath: "art/room.png",
        release,
        sizeBytes: 16,
        url: "blob:viva-room",
        width: 1280,
      }),
    };
    const onImageRequest = vi.fn();
    const { rerender, unmount } = render(
      <LiveEditorPane
        documentId="notes/day.md"
        imageCache={cache}
        imageCacheRevision={0}
        onChange={vi.fn()}
        onImageRequest={onImageRequest}
        value="![Room](../art/room.png)"
        workspaceRoot="/workspace"
      />,
    );

    try {
      const placeholder = screen.getByRole("img", {
        name: "Loading image · Room",
      });
      expect(placeholder).not.toHaveAttribute("data-viva-image");
      expect(placeholder).not.toHaveAttribute("data-image-src");
      expect(placeholder).not.toHaveAttribute("data-image-alt");
      expect(cache.acquire).not.toHaveBeenCalled();
      intersections.enter(placeholder);

      const image = await screen.findByRole("img", { name: "Room" });
      expect(image).toHaveAttribute("src", "blob:viva-room");
      expect(image).not.toHaveAttribute("loading");
      fireEvent.click(image);
      expect(onImageRequest).toHaveBeenCalledWith("../art/room.png", "Room");
      fireEvent.keyDown(
        screen.getByRole("button", { name: "Open full-size image · Room" }),
        { key: "Enter" },
      );
      expect(onImageRequest).toHaveBeenCalledTimes(2);

      rerender(
        <LiveEditorPane
          documentId="notes/day.md"
          imageCache={cache}
          imageCacheRevision={0}
          onChange={vi.fn()}
          onImageRequest={onImageRequest}
          value="![Room](../art/room.png)"
          workspaceRoot="/workspace"
        />,
      );
      expect(document.querySelector("img.markdown-local-image")).toHaveAttribute(
        "src",
        "blob:viva-room",
      );
      expect(cache.acquire).toHaveBeenCalledTimes(1);

      rerender(
        <LiveEditorPane
          documentId="notes/day.md"
          imageCache={cache}
          imageCacheRevision={1}
          onChange={vi.fn()}
          onImageRequest={onImageRequest}
          value="![Room](../art/room.png)"
          workspaceRoot="/workspace"
        />,
      );
      intersections.enter(
        screen.getByRole("img", { name: "Loading image · Room" }),
      );
      await waitFor(() => expect(cache.acquire).toHaveBeenCalledTimes(2));
      unmount();
      expect(release).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the platform modifier in the Live editing hint", () => {
    document.documentElement.dataset.platform = "windows";
    try {
      render(<EditableFixture />);
      expect(screen.getAllByRole("group")[0]).toHaveAttribute(
        "aria-description",
        "Click to edit this block · Ctrl-click links to open",
      );
    } finally {
      delete document.documentElement.dataset.platform;
    }
  });

  it("keeps remote images inert in Live mode", () => {
    const cache: WorkspaceImageCacheLike = { acquire: vi.fn() };
    const onImageRequest = vi.fn();
    render(
      <LiveEditorPane
        documentId="notes/day.md"
        imageCache={cache}
        onChange={vi.fn()}
        onImageRequest={onImageRequest}
        value="![Tracker](https://example.com/pixel.png)"
        workspaceRoot="/workspace"
      />,
    );

    const placeholder = screen.getByRole("img", {
      name: "Remote image blocked · Tracker",
    });
    fireEvent.click(placeholder);
    expect(cache.acquire).not.toHaveBeenCalled();
    expect(onImageRequest).not.toHaveBeenCalled();
  });

  it("restores keyboard focus to the rendered block after Escape", async () => {
    render(<EditableFixture />);
    const block = screen.getAllByRole("group")[0];
    expect(block).toBeDefined();
    fireEvent.keyDown(block!, { key: "Enter" });
    const editor = screen.getByRole("textbox", {
      name: "Editing block from line 1",
    });
    fireEvent.keyDown(editor, { key: "Escape" });
    await waitFor(() => expect(screen.getAllByRole("group")[0]).toHaveFocus());
  });

  it.each([
    { isComposing: true, keyCode: 27 },
    { isComposing: false, keyCode: 229 },
  ])("keeps the active block open when IME consumes Escape %#", (native) => {
    render(<EditableFixture />);
    const block = screen.getAllByRole("group")[0];
    expect(block).toBeDefined();
    fireEvent.keyDown(block!, { key: "Enter" });
    const editor = screen.getByRole("textbox", {
      name: "Editing block from line 1",
    });

    fireEvent.keyDown(editor, { ...native, key: "Escape" });

    expect(
      screen.getByRole("textbox", { name: "Editing block from line 1" }),
    ).toHaveFocus();
    expect(screen.queryAllByRole("group")).toHaveLength(1);
  });

  it("uses one roving tab stop for large rendered documents", () => {
    const value = Array.from(
      { length: 100 },
      (_, index) => `Paragraph ${index + 1}.`,
    ).join("\n\n");
    render(
      <LiveEditorPane
        documentId="large.md"
        onChange={vi.fn()}
        value={value}
      />,
    );
    const blocks = screen.getAllByRole("group");
    expect(blocks).toHaveLength(100);
    expect(blocks.filter((block) => block.tabIndex === 0)).toHaveLength(1);

    blocks[0]!.focus();
    fireEvent.keyDown(blocks[0]!, { key: "ArrowDown" });
    expect(blocks[1]).toHaveFocus();
    expect(blocks[0]).toHaveAttribute("tabindex", "-1");
    expect(blocks[1]).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(blocks[1]!, { key: "End" });
    expect(blocks.at(-1)).toHaveFocus();
    fireEvent.keyDown(blocks.at(-1)!, { key: "Enter" });
    expect(
      screen.getByRole("textbox", { name: "Editing block from line 199" }),
    ).toHaveFocus();
  });

  it("maps an image paste selection from an active block to the full document", () => {
    const value = "First paragraph.\n\nSecond paragraph.";
    const secondStart = value.indexOf("Second");
    const file = new File(["image"], "capture.png", { type: "image/png" });
    const onPasteImage = vi.fn();
    render(
      <LiveEditorPane
        documentId="paste.md"
        onChange={vi.fn()}
        onPasteImage={onPasteImage}
        value={value}
      />,
    );
    fireEvent.click(screen.getByText("Second paragraph."));
    const editor = screen.getByRole("textbox", {
      name: "Editing block from line 3",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(7, 16);

    fireEvent.paste(editor, {
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

    expect(onPasteImage).toHaveBeenCalledWith(file, {
      direction: "none",
      end: secondStart + 16,
      start: secondStart + 7,
    });
  });

  it("reveals a Unicode match in the containing Markdown block", () => {
    const value = "# 🐱 Intro\n\nSecond 🐱 café paragraph.";
    const start = value.indexOf("café");
    const blockStart = value.indexOf("Second");
    render(
      <LiveEditorPane
        documentId="unicode.md"
        onChange={vi.fn()}
        revealSelection={{ end: start + "café".length, start }}
        value={value}
      />,
    );

    const editor = screen.getByRole("textbox", {
      name: "Editing block from line 3",
    });
    expect(editor).toHaveValue("Second 🐱 café paragraph.");
    expect(editor).toHaveProperty("selectionStart", start - blockStart);
    expect(editor).toHaveProperty(
      "selectionEnd",
      start - blockStart + "café".length,
    );
  });

  it("does not steal focus when a programmatic reveal activates another block", () => {
    const value = "First paragraph.\n\nTarget paragraph.";
    const start = value.indexOf("Target");
    const { rerender } = render(
      <>
        <input aria-label="Find query" type="search" />
        <LiveEditorPane
          documentId="focus.md"
          onChange={vi.fn()}
          revealSelectionRequestId={0}
          value={value}
        />
      </>,
    );
    const query = screen.getByRole("searchbox", { name: "Find query" });
    query.focus();

    rerender(
      <>
        <input aria-label="Find query" type="search" />
        <LiveEditorPane
          documentId="focus.md"
          onChange={vi.fn()}
          revealSelection={{ end: start + 6, start }}
          revealSelectionRequestId={1}
          value={value}
        />
      </>,
    );

    const editor = screen.getByRole("textbox", {
      name: "Editing block from line 3",
    });
    expect(query).toHaveFocus();
    expect(editor).toHaveProperty("selectionStart", 0);
    expect(editor).toHaveProperty("selectionEnd", 6);
  });

  it("replays the same selection coordinates for a new reveal request", async () => {
    const { rerender } = render(
      <LiveEditorPane
        documentId="replace.md"
        onChange={vi.fn()}
        revealSelection={{ end: 1, start: 0 }}
        revealSelectionRequestId={1}
        value="aa"
      />,
    );
    const initialEditor = screen.getByRole("textbox", {
      name: "Editing block from line 1",
    }) as HTMLTextAreaElement;
    initialEditor.setSelectionRange(1, 1);

    rerender(
      <LiveEditorPane
        documentId="replace.md"
        onChange={vi.fn()}
        revealSelection={{ end: 1, start: 0 }}
        revealSelectionRequestId={2}
        value="a"
      />,
    );

    await waitFor(() => {
      const editor = screen.getByRole("textbox", {
        name: "Editing block from line 1",
      });
      expect(editor).toHaveValue("a");
      expect(editor).toHaveProperty("selectionStart", 0);
      expect(editor).toHaveProperty("selectionEnd", 1);
    });
  });

  it("updates a revealed selection inside the already active block", () => {
    const value = "Alpha 🐱 beta gamma\n\nUntouched block.";
    const beta = value.indexOf("beta");
    const gamma = value.indexOf("gamma");
    const { rerender } = render(
      <LiveEditorPane
        documentId="same-block.md"
        onChange={vi.fn()}
        revealSelection={{ end: beta + 4, start: beta }}
        value={value}
      />,
    );
    const editor = screen.getByRole("textbox", {
      name: "Editing block from line 1",
    });
    const untouchedBlock = screen
      .getByText("Untouched block.")
      .closest('[role="group"]');

    rerender(
      <LiveEditorPane
        documentId="same-block.md"
        onChange={vi.fn()}
        revealSelection={{ end: gamma + 5, start: gamma }}
        value={value}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Editing block from line 1" }),
    ).toBe(editor);
    expect(
      screen.getByText("Untouched block.").closest('[role="group"]'),
    ).toBe(untouchedBlock);
    expect(editor).toHaveProperty("selectionStart", gamma);
    expect(editor).toHaveProperty("selectionEnd", gamma + 5);
  });

  it("does not reapply a stale reveal selection while the user edits", () => {
    const initialValue = "Alpha beta\n\nUntouched block.";
    const start = initialValue.indexOf("beta");

    function Fixture() {
      const [value, setValue] = useState(initialValue);
      return (
        <LiveEditorPane
          documentId="editing.md"
          onChange={setValue}
          revealSelection={{ end: start + 4, start }}
          value={value}
        />
      );
    }

    render(<Fixture />);
    const editor = screen.getByRole("textbox", {
      name: "Editing block from line 1",
    });
    fireEvent.change(editor, {
      target: { value: "Alpha beta revised\n\n" },
    });

    expect(editor).toHaveValue("Alpha beta revised\n\n");
    expect(editor).toHaveProperty(
      "selectionStart",
      "Alpha beta revised\n\n".length,
    );
    expect(screen.getByText("Untouched block.")).toBeVisible();
  });

  it("scrolls a newly revealed block into view", () => {
    const scrollIntoView = vi.fn();
    const original = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    try {
      const value = "First paragraph.\n\nTarget paragraph.";
      const start = value.indexOf("Target");
      render(
        <LiveEditorPane
          documentId="scroll.md"
          onChange={vi.fn()}
          revealSelection={{ end: start + 6, start }}
          value={value}
        />,
      );

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      if (original) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollIntoView",
          original,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      }
    }
  });

  it("ignores cross-block and out-of-range reveal selections without disturbing editing", () => {
    const value = "Alpha paragraph.\n\nBeta paragraph.";
    const beta = value.indexOf("Beta");
    const { rerender } = render(
      <LiveEditorPane
        documentId="boundaries.md"
        onChange={vi.fn()}
        revealSelection={{ end: beta + 4, start: beta }}
        value={value}
      />,
    );
    const editor = screen.getByRole("textbox", {
      name: "Editing block from line 3",
    });
    expect(editor).toHaveProperty("selectionStart", 0);
    expect(editor).toHaveProperty("selectionEnd", 4);

    rerender(
      <LiveEditorPane
        documentId="boundaries.md"
        onChange={vi.fn()}
        revealSelection={{ end: beta + 4, start: 2 }}
        value={value}
      />,
    );
    expect(editor).toHaveProperty("selectionStart", 0);
    expect(editor).toHaveProperty("selectionEnd", 4);

    rerender(
      <LiveEditorPane
        documentId="boundaries.md"
        onChange={vi.fn()}
        revealSelection={{ end: value.length + 10, start: value.length + 2 }}
        value={value}
      />,
    );
    expect(editor).toHaveProperty("selectionStart", 0);
    expect(editor).toHaveProperty("selectionEnd", 4);
  });

  it("uses the new document when the same reveal request crosses a document switch", () => {
    const first = "First match";
    const second = "# Heading\n\nNext match";
    const firstStart = first.indexOf("match");
    const secondStart = second.indexOf("match");
    const { rerender } = render(
      <LiveEditorPane
        documentId="first.md"
        onChange={vi.fn()}
        revealSelection={{ end: firstStart + 5, start: firstStart }}
        value={first}
      />,
    );
    expect(
      screen.getByRole("textbox", { name: "Editing block from line 1" }),
    ).toHaveValue(first);

    rerender(
      <LiveEditorPane
        documentId="second.md"
        onChange={vi.fn()}
        revealSelection={{ end: secondStart + 5, start: secondStart }}
        value={second}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Editing block from line 3" }),
    ).toHaveValue("Next match");
  });
});
