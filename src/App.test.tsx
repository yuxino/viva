import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceControllerMock = vi.hoisted(() => ({
  current: null as any,
}));
const documentHistoryMock = vi.hoisted(() => ({
  current: null as any,
}));
const quitHooksMock = vi.hoisted(() => ({
  cancelClose: vi.fn<() => Promise<boolean>>(),
  menuHandler: null as null | ((command: string) => void),
  requestClose: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("./hooks/useWorkspaceController", () => ({
  useWorkspaceController: () => workspaceControllerMock.current,
}));
vi.mock("./hooks/useDocumentHistory", () => ({
  useDocumentHistory: () => documentHistoryMock.current,
}));
vi.mock("./hooks/useNativeMenu", () => ({
  useNativeMenu: (handler: (command: string) => void) => {
    quitHooksMock.menuHandler = handler;
  },
}));
vi.mock("./hooks/useCloseProtection", () => ({
  useCloseProtection: () => ({
    cancelClose: quitHooksMock.cancelClose,
    requestClose: quitHooksMock.requestClose,
  }),
}));

import { App } from "./App";

const sourceDocument = {
  relativePath: "source.md",
  name: "source.md",
  content: "source",
  savedContent: "source",
  revision: { modifiedAtMs: 1, sizeBytes: 6, contentSha256: "a".repeat(64) },
};

const targetDocument = {
  relativePath: "target.md",
  name: "target.md",
  content: "one\n你🙂needle",
  savedContent: "one\n你🙂needle",
  revision: { modifiedAtMs: 2, sizeBytes: 16, contentSha256: "b".repeat(64) },
};

describe("App search navigation", () => {
  beforeEach(() => {
    document.documentElement.dataset.platform = "macos";
    HTMLElement.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    quitHooksMock.menuHandler = null;
    quitHooksMock.cancelClose.mockReset().mockResolvedValue(true);
    quitHooksMock.requestClose.mockReset().mockResolvedValue(true);

    const controller: any = {
      state: {
        workspace: {
          rootPath: "/notes",
          name: "Notes",
          children: [
            {
              relativePath: "source.md",
              name: "source.md",
              kind: "file",
              children: [],
            },
            {
              relativePath: "target.md",
              name: "target.md",
              kind: "file",
              children: [],
            },
          ],
        },
        documents: {
          "source.md": sourceDocument,
          "target.md": targetDocument,
        },
        documentOrder: ["source.md", "target.md"],
        activeDocumentId: "source.md",
        expandedPaths: [],
        activity: "search",
        sidebarVisible: true,
        focusMode: false,
        viewMode: "split",
      },
      currentDocument: sourceDocument,
      dirty: false,
      busy: false,
      status: { message: "Saved locally", tone: "neutral" },
      searchResults: [
        {
          relativePath: "target.md",
          line: 2,
          column: 3,
          preview: "你🙂needle",
        },
      ],
      searching: false,
      recentWorkspaces: [],
      openFolder: vi.fn(),
      openRecentWorkspace: vi.fn(),
      changeDocument: vi.fn(),
      saveDocument: vi.fn().mockResolvedValue(true),
      saveDocumentAs: vi.fn().mockResolvedValue(true),
      newDocument: vi.fn(),
      runSearch: vi.fn(),
      closeDocument: vi.fn(),
      activateDocument: vi.fn(),
      toggleTreePath: vi.fn(),
      selectActivity: vi.fn(),
      toggleSidebar: vi.fn(),
      toggleFocus: vi.fn(),
      selectView: vi.fn(),
      reportError: vi.fn(),
    };
    controller.openDocument = vi.fn(async () => {
      controller.state = {
        ...controller.state,
        activeDocumentId: "target.md",
      };
      controller.currentDocument = targetDocument;
      return true;
    });
    workspaceControllerMock.current = controller;
    documentHistoryMock.current = {
      entries: [],
      error: null,
      loading: false,
      previewLoading: false,
      refresh: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockResolvedValue(undefined),
      selectedEntry: null,
      selectedId: null,
    };
  });

  it("opens another file and focuses the exact Unicode line and column", async () => {
    render(<App />);
    const results = screen.getByRole("list", { name: "Search results" });

    fireEvent.click(within(results).getByRole("button"));

    const editor = await screen.findByRole("textbox", {
      name: "Editing target.md",
    });
    await waitFor(() => {
      expect(editor).toHaveFocus();
      expect(editor).toHaveProperty("selectionStart", 7);
      expect(editor).toHaveProperty("selectionEnd", 7);
      expect(screen.getByText("Ln 2, Col 3")).toBeInTheDocument();
    });
  });

  it("requires confirmation before a saved version replaces an unsaved draft", async () => {
    const controller = workspaceControllerMock.current;
    const dirtyDocument = {
      ...sourceDocument,
      content: "unsaved draft",
    };
    controller.state = {
      ...controller.state,
      documents: {
        ...controller.state.documents,
        "source.md": dirtyDocument,
      },
      activeDocumentId: "source.md",
    };
    controller.currentDocument = dirtyDocument;
    documentHistoryMock.current = {
      ...documentHistoryMock.current,
      entries: [
        {
          id: "older",
          label: "Yesterday, 18:04",
          description: "Before editing",
          content: "historical text",
        },
      ],
      selectedEntry: {
        id: "older",
        label: "Yesterday, 18:04",
        description: "Before editing",
        content: "historical text",
      },
      selectedId: "older",
    };
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "File history" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Load this version: Yesterday, 18:04",
      }),
    );

    expect(controller.changeDocument).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Load “Yesterday, 18:04”?" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Keep current draft" }));
    expect(controller.changeDocument).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Load this version: Yesterday, 18:04",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Replace unsaved draft" }),
    );

    expect(controller.changeDocument).toHaveBeenCalledWith(
      "source.md",
      "historical text",
    );
  });

  it("renders Windows title controls and Control-based command labels", () => {
    document.documentElement.dataset.platform = "windows";
    render(<App />);

    expect(screen.getByRole("group", { name: "Window controls" })).toBeVisible();
    expect(screen.getByText("Ctrl+P")).toBeVisible();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const palette = screen.getByRole("dialog", { name: "Command palette" });
    expect(within(palette).getByText("Ctrl+O")).toBeVisible();
    expect(within(palette).getByText("Ctrl+N")).toBeVisible();
    expect(within(palette).getByText("Ctrl+S")).toBeVisible();
    expect(within(palette).getByText("Shift+Ctrl+B")).toBeVisible();
    expect(within(palette).getByText("Shift+Ctrl+Enter")).toBeVisible();
    expect(within(palette).getByText("Ctrl+3")).toBeVisible();
  });

  it("opens the local command guide from the native Help menu", () => {
    render(<App />);

    act(() => quitHooksMock.menuHandler?.("help.showCommands"));

    expect(
      screen.getByRole("dialog", { name: "Command palette" }),
    ).toBeVisible();
  });

  it("keeps only the essential Windows window strip in focus mode", () => {
    document.documentElement.dataset.platform = "windows";
    const controller = workspaceControllerMock.current;
    controller.state = { ...controller.state, focusMode: true };

    render(<App />);

    expect(screen.getByLabelText("Window title")).toHaveClass(
      "title-bar--window-only",
    );
    expect(screen.getByRole("group", { name: "Window controls" })).toBeVisible();
    expect(screen.queryByText("Ctrl+P")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Editing source.md" })).toBeVisible();
  });

  it("resizes immediately from persisted wide-layout values in a narrow window", () => {
    localStorage.setItem("viva.sidebarWidth", "360");
    localStorage.setItem("viva.splitPosition", "30");
    const originalWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 900,
    });
    try {
      render(<App />);
      const shell = document.querySelector<HTMLElement>(".app-shell");
      expect(shell?.style.getPropertyValue("--sidebar-preferred-width")).toBe(
        "360px",
      );
      expect(shell?.style.getPropertyValue("--split-preferred-position")).toBe(
        "30%",
      );

      fireEvent.keyDown(
        screen.getByRole("separator", { name: "Resize sidebar" }),
        { key: "ArrowLeft" },
      );
      expect(shell?.style.getPropertyValue("--sidebar-preferred-width")).toBe(
        "200px",
      );

      const editorStage = document.querySelector<HTMLElement>(".editor-stage");
      Object.defineProperty(editorStage, "clientWidth", {
        configurable: true,
        value: 600,
      });
      fireEvent.keyDown(
        screen.getByRole("separator", { name: "Resize editor and preview" }),
        { key: "ArrowRight" },
      );
      expect(shell?.style.getPropertyValue("--split-preferred-position")).toBe(
        "42%",
      );
    } finally {
      if (originalWidth) {
        Object.defineProperty(window, "innerWidth", originalWidth);
      } else {
        Reflect.deleteProperty(window, "innerWidth");
      }
    }
  });

  it("explains when a line-heavy document falls back from Live to Source", () => {
    const controller = workspaceControllerMock.current;
    const content = Array.from({ length: 5_001 }, () => "x").join("\n");
    const lineHeavyDocument = {
      ...sourceDocument,
      content,
      savedContent: content,
    };
    controller.state = {
      ...controller.state,
      documents: { "source.md": lineHeavyDocument },
      documentOrder: ["source.md"],
      activeDocumentId: "source.md",
      viewMode: "live",
    };
    controller.currentDocument = lineHeavyDocument;

    render(<App />);

    expect(
      screen.getByRole("textbox", { name: "Editing source.md" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Live editing source.md")).toBeNull();
    expect(screen.getByRole("radio", { name: "Source" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Live" })).not.toBeChecked();
    expect(
      screen.getByText("Large document · Live switched to Source"),
    ).toBeVisible();
  });

  it("labels a bounded outline while the full Source document stays editable", () => {
    const controller = workspaceControllerMock.current;
    const content = Array.from({ length: 5_001 }, () => "x").join("\n");
    const lineHeavyDocument = {
      ...sourceDocument,
      content,
      savedContent: content,
    };
    controller.state = {
      ...controller.state,
      activity: "outline",
      documents: { "source.md": lineHeavyDocument },
      documentOrder: ["source.md"],
      activeDocumentId: "source.md",
      viewMode: "edit",
    };
    controller.currentDocument = lineHeavyDocument;

    render(<App />);

    expect(
      screen.getByRole("textbox", { name: "Editing source.md" }),
    ).toHaveValue(content);
    expect(screen.getByText("Large document · outline bounded")).toBeVisible();
  });

  it("keeps a dirty document open until the user chooses how to quit", async () => {
    const controller = workspaceControllerMock.current;
    const dirtyDocument = { ...sourceDocument, content: "unsaved draft" };
    controller.state = {
      ...controller.state,
      documents: { "source.md": dirtyDocument },
      documentOrder: ["source.md"],
    };
    controller.currentDocument = dirtyDocument;
    controller.dirty = true;
    render(<App />);

    act(() => quitHooksMock.menuHandler?.("app.quit"));

    expect(
      screen.getByRole("dialog", { name: "Save changes to “source.md”?" }),
    ).toBeVisible();
    expect(controller.closeDocument).not.toHaveBeenCalled();
    expect(quitHooksMock.requestClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(quitHooksMock.cancelClose).toHaveBeenCalledOnce();
    expect(controller.closeDocument).not.toHaveBeenCalled();
    expect(quitHooksMock.requestClose).not.toHaveBeenCalled();
  });

  it("quits only after a dirty document saves successfully", async () => {
    const controller = workspaceControllerMock.current;
    const dirtyDocument = { ...sourceDocument, content: "unsaved draft" };
    controller.state = {
      ...controller.state,
      documents: { "source.md": dirtyDocument },
      documentOrder: ["source.md"],
    };
    controller.currentDocument = dirtyDocument;
    controller.dirty = true;
    controller.saveDocument.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<App />);

    act(() => quitHooksMock.menuHandler?.("app.quit"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(controller.saveDocument).toHaveBeenCalledTimes(1));
    expect(quitHooksMock.requestClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(quitHooksMock.requestClose).toHaveBeenCalledOnce());
    expect(controller.saveDocument).toHaveBeenNthCalledWith(1, "source.md");
    expect(controller.saveDocument).toHaveBeenNthCalledWith(2, "source.md");
    expect(controller.closeDocument).not.toHaveBeenCalled();
  });

  it("walks multiple dirty documents before granting one final quit", async () => {
    const controller = workspaceControllerMock.current;
    const dirtySource = { ...sourceDocument, content: "source draft" };
    const dirtyTarget = { ...targetDocument, content: "target draft" };
    controller.state = {
      ...controller.state,
      documents: {
        "source.md": dirtySource,
        "target.md": dirtyTarget,
      },
      documentOrder: ["source.md", "target.md"],
      activeDocumentId: "source.md",
    };
    controller.currentDocument = dirtySource;
    controller.dirty = true;
    controller.closeDocument.mockImplementation((id: string) => {
      const { [id]: _closed, ...documents } = controller.state.documents;
      controller.state = {
        ...controller.state,
        documents,
        documentOrder: controller.state.documentOrder.filter(
          (candidate: string) => candidate !== id,
        ),
      };
    });
    controller.saveDocument.mockImplementation(async (id: string) => {
      const document = controller.state.documents[id];
      controller.state = {
        ...controller.state,
        documents: {
          ...controller.state.documents,
          [id]: { ...document, savedContent: document.content },
        },
      };
      return true;
    });
    render(<App />);

    act(() => quitHooksMock.menuHandler?.("app.quit"));
    fireEvent.click(screen.getByRole("button", { name: "Don’t save" }));

    expect(controller.closeDocument).toHaveBeenCalledWith("source.md");
    expect(quitHooksMock.requestClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Save changes to “target.md”?" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(quitHooksMock.requestClose).toHaveBeenCalledOnce());
    expect(controller.saveDocument).toHaveBeenCalledWith("target.md");
  });

  it("keeps the final discarded draft when native quit confirmation fails", async () => {
    const controller = workspaceControllerMock.current;
    const dirtyDocument = { ...sourceDocument, content: "discard only on exit" };
    controller.state = {
      ...controller.state,
      documents: { "source.md": dirtyDocument },
      documentOrder: ["source.md"],
    };
    controller.currentDocument = dirtyDocument;
    controller.dirty = true;
    quitHooksMock.requestClose
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    render(<App />);

    act(() => quitHooksMock.menuHandler?.("app.quit"));
    fireEvent.click(screen.getByRole("button", { name: "Don’t save" }));
    await waitFor(() => expect(quitHooksMock.requestClose).toHaveBeenCalledOnce());
    expect(controller.closeDocument).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Save changes to “source.md”?" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Don’t save" }));
    await waitFor(() =>
      expect(quitHooksMock.requestClose).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(controller.closeDocument).not.toHaveBeenCalled();
  });

  it("keeps the quit dialog after a saved document cannot complete native quit", async () => {
    const controller = workspaceControllerMock.current;
    const dirtyDocument = { ...sourceDocument, content: "save before exit" };
    controller.state = {
      ...controller.state,
      documents: { "source.md": dirtyDocument },
      documentOrder: ["source.md"],
    };
    controller.currentDocument = dirtyDocument;
    controller.dirty = true;
    quitHooksMock.requestClose.mockResolvedValueOnce(false);
    render(<App />);

    act(() => quitHooksMock.menuHandler?.("app.quit"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(controller.saveDocument).toHaveBeenCalledWith("source.md"));
    await waitFor(() => expect(quitHooksMock.requestClose).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("dialog", { name: "Save changes to “source.md”?" }),
    ).toBeVisible();
    expect(controller.closeDocument).not.toHaveBeenCalled();
  });

  it("keeps the quit dialog when cancelling a deferred native exit fails", async () => {
    const controller = workspaceControllerMock.current;
    const dirtyDocument = { ...sourceDocument, content: "keep this draft" };
    controller.state = {
      ...controller.state,
      documents: { "source.md": dirtyDocument },
      documentOrder: ["source.md"],
    };
    controller.currentDocument = dirtyDocument;
    controller.dirty = true;
    quitHooksMock.cancelClose
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    render(<App />);

    act(() => quitHooksMock.menuHandler?.("app.quit"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(quitHooksMock.cancelClose).toHaveBeenCalledOnce());
    expect(screen.getByRole("dialog")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
