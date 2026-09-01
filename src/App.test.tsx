import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspaceControllerMock = vi.hoisted(() => ({
  current: null as any,
}));
const nativeInvokeMock = vi.hoisted(() => vi.fn());
const documentHistoryMock = vi.hoisted(() => ({
  current: null as any,
}));
const quitHooksMock = vi.hoisted(() => ({
  cancelClose: vi.fn<() => Promise<boolean>>(),
  menuHandler: null as null | ((command: string) => void),
  requestClose: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: nativeInvokeMock,
  isTauri: () => false,
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
import { workspaceImageCache } from "./lib/media";

const sourceDocument = {
  relativePath: "source.md",
  name: "source.md",
  content: "source",
  savedContent: "source",
  lineEnding: "lf" as const,
  savedLineEnding: "lf" as const,
  revision: { modifiedAtMs: 1, sizeBytes: 6, contentSha256: "a".repeat(64) },
};

const targetDocument = {
  relativePath: "target.md",
  name: "target.md",
  content: "one\n你🙂needle",
  savedContent: "one\n你🙂needle",
  lineEnding: "lf" as const,
  savedLineEnding: "lf" as const,
  revision: { modifiedAtMs: 2, sizeBytes: 16, contentSha256: "b".repeat(64) },
};

afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

describe("App search navigation", () => {
  beforeEach(() => {
    document.documentElement.dataset.platform = "macos";
    HTMLElement.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    quitHooksMock.menuHandler = null;
    quitHooksMock.cancelClose.mockReset().mockResolvedValue(true);
    quitHooksMock.requestClose.mockReset().mockResolvedValue(true);
    nativeInvokeMock.mockReset().mockImplementation((command: string) =>
      Promise.resolve(command === "get_quit_guard_session" ? 37 : undefined),
    );

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
      inspectEntryImpact: vi.fn().mockReturnValue({
        affectedDocumentIds: [],
        affectedDirtyDocumentIds: [],
      }),
      createMarkdown: vi.fn().mockResolvedValue({
        affectedDocumentIds: [],
        affectedDirtyDocumentIds: [],
        applied: false,
        succeeded: false,
        treeRefreshed: false,
      }),
      createDirectory: vi.fn().mockResolvedValue({
        affectedDocumentIds: [],
        affectedDirtyDocumentIds: [],
        applied: false,
        succeeded: false,
        treeRefreshed: false,
      }),
      renameEntry: vi.fn().mockResolvedValue({
        affectedDocumentIds: [],
        affectedDirtyDocumentIds: [],
        applied: false,
        succeeded: false,
        treeRefreshed: false,
      }),
      duplicateEntry: vi.fn().mockResolvedValue({
        affectedDocumentIds: [],
        affectedDirtyDocumentIds: [],
        applied: false,
        succeeded: false,
        treeRefreshed: false,
      }),
      trashEntry: vi.fn().mockResolvedValue({
        affectedDocumentIds: [],
        affectedDirtyDocumentIds: [],
        applied: false,
        succeeded: false,
        treeRefreshed: false,
      }),
      runSearch: vi.fn(),
      closeDocument: vi.fn(),
      activateDocument: vi.fn(),
      toggleTreePath: vi.fn(),
      selectActivity: vi.fn(),
      toggleSidebar: vi.fn(),
      toggleFocus: vi.fn(),
      selectView: vi.fn(),
      reportError: vi.fn(),
      refreshCurrentWorkspace: vi.fn().mockResolvedValue(true),
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
    const searchbox = screen.getByRole("searchbox", {
      name: "Search workspace",
    });
    fireEvent.change(searchbox, { target: { value: "needle" } });
    fireEvent.submit(
      within(
        screen.getByRole("region", { name: "Search workspace" }),
      ).getByRole("search"),
    );
    const results = screen.getByRole("listbox", { name: "Search results" });

    fireEvent.click(await within(results).findByRole("option"));

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

  it("invalidates visible search results before Enter can open a stale match", async () => {
    const controller = workspaceControllerMock.current;
    render(<App />);
    const searchbox = screen.getByRole("searchbox", {
      name: "Search workspace",
    });
    fireEvent.change(searchbox, { target: { value: "needle" } });
    fireEvent.submit(
      within(
        screen.getByRole("region", { name: "Search workspace" }),
      ).getByRole("search"),
    );
    expect(await screen.findByRole("option")).toBeVisible();
    controller.openDocument.mockClear();
    controller.runSearch.mockClear();

    fireEvent.change(searchbox, { target: { value: "different" } });
    fireEvent.keyDown(searchbox, { key: "Enter" });

    expect(controller.runSearch).toHaveBeenCalledWith("");
    expect(screen.queryByRole("option")).toBeNull();
    expect(controller.openDocument).not.toHaveBeenCalled();
  });

  it("does not let a superseded debounce overtake a submitted search", async () => {
    vi.useFakeTimers();
    try {
      const controller = workspaceControllerMock.current;
      render(<App />);
      const searchbox = screen.getByRole("searchbox", {
        name: "Search workspace",
      });
      fireEvent.change(searchbox, { target: { value: "needle" } });
      fireEvent.submit(
        within(
          screen.getByRole("region", { name: "Search workspace" }),
        ).getByRole("search"),
      );
      await act(async () => Promise.resolve());

      act(() => vi.advanceTimersByTime(220));

      expect(
        controller.runSearch.mock.calls.filter(
          (call: unknown[]) => call[0] === "needle",
        ),
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("scans large-document find queries off the UI thread and ignores stale workers", async () => {
    class ControlledWorker {
      static instances: ControlledWorker[] = [];
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent<any>) => void) | null = null;
      postMessage = vi.fn();
      terminate = vi.fn();

      constructor() {
        ControlledWorker.instances.push(this);
      }

      respond(data: any) {
        this.onmessage?.({ data } as MessageEvent<any>);
      }
    }
    vi.stubGlobal("Worker", ControlledWorker);
    try {
      const controller = workspaceControllerMock.current;
      const document = {
        ...sourceDocument,
        content: "a".repeat(600_000),
        savedContent: "a".repeat(600_000),
      };
      controller.state = {
        ...controller.state,
        activity: "files",
        documents: { "source.md": document },
        documentOrder: ["source.md"],
        activeDocumentId: "source.md",
        viewMode: "edit",
      };
      controller.currentDocument = document;
      render(<App />);
      const editor = screen.getByRole("textbox", {
        name: "Editing source.md",
      }) as HTMLTextAreaElement;
      Object.defineProperties(editor, {
        clientHeight: { configurable: true, value: 400 },
        clientWidth: { configurable: true, value: 600 },
        scrollHeight: { configurable: true, value: 1_200 },
      });
      editor.scrollTop = 0;

      fireEvent.keyDown(window, { key: "f", metaKey: true });
      const query = screen.getByRole("searchbox", {
        name: "Find in document",
      });
      fireEvent.change(query, { target: { value: "old" } });
      const oldWorker = ControlledWorker.instances.at(-1)!;
      const oldRequest = oldWorker.postMessage.mock.calls[0]![0];

      fireEvent.change(query, { target: { value: "new" } });
      const currentWorker = ControlledWorker.instances.at(-1)!;
      const currentRequest = currentWorker.postMessage.mock.calls[0]![0];
      expect(currentWorker).not.toBe(oldWorker);
      expect(oldWorker.terminate).toHaveBeenCalled();
      expect(query).toHaveValue("new");
      expect(screen.getByText("0 / 0")).toBeVisible();

      act(() => {
        oldWorker.respond({
          activeIndex: 0,
          count: 99,
          generation: oldRequest.generation,
          match: { end: 3, start: 0 },
          requestId: oldRequest.requestId,
        });
      });
      expect(screen.getByText("0 / 0")).toBeVisible();

      act(() => {
        currentWorker.respond({
          activeIndex: 0,
          count: 1,
          generation: currentRequest.generation,
          match: { end: 600_000, start: 599_999 },
          requestId: currentRequest.requestId,
        });
      });
      expect(screen.getByText("1 / 1")).toBeVisible();
      expect(editor.scrollTop).toBe(800);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("finds and replaces the exact source text without rebuilding Markdown", async () => {
    const controller = workspaceControllerMock.current;
    const document = {
      ...sourceDocument,
      content: "source source",
      savedContent: "source source",
    };
    controller.state = {
      ...controller.state,
      activity: "files",
      documents: { "source.md": document },
      documentOrder: ["source.md"],
      activeDocumentId: "source.md",
      viewMode: "edit",
    };
    controller.currentDocument = document;
    render(<App />);

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const find = screen.getByRole("search", { name: "Find in document" });
    const query = within(find).getByRole("searchbox", {
      name: "Find in document",
    });
    expect(query).toHaveFocus();
    fireEvent.change(query, { target: { value: "source" } });

    await waitFor(() =>
      expect(within(find).getByRole("status")).toHaveTextContent("1 / 2"),
    );
    fireEvent.click(within(find).getByRole("button", { name: "Next match" }));
    const editor = screen.getByRole("textbox", { name: "Editing source.md" });
    await waitFor(() => {
      expect(editor).toHaveProperty("selectionStart", 7);
      expect(editor).toHaveProperty("selectionEnd", 13);
    });

    fireEvent.click(within(find).getByRole("button", { name: "Show replace" }));
    const replacement = within(find).getByRole("textbox", {
      name: "Replace with",
    });
    fireEvent.change(replacement, { target: { value: "draft" } });
    fireEvent.click(within(find).getByRole("button", { name: "Replace" }));

    expect(controller.changeDocument).toHaveBeenCalledWith(
      "source.md",
      "source draft",
    );
  });

  it("keeps the Find query focused while Live reveals matches across blocks", async () => {
    const controller = workspaceControllerMock.current;
    const document = {
      ...sourceDocument,
      content: "Alpha target.\n\nSecond target.",
      savedContent: "Alpha target.\n\nSecond target.",
    };
    controller.state = {
      ...controller.state,
      activity: "files",
      documents: { "source.md": document },
      documentOrder: ["source.md"],
      activeDocumentId: "source.md",
      viewMode: "live",
    };
    controller.currentDocument = document;
    render(<App />);

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const find = screen.getByRole("search", { name: "Find in document" });
    const query = within(find).getByRole("searchbox", {
      name: "Find in document",
    });
    fireEvent.change(query, { target: { value: "target" } });

    await waitFor(() => {
      expect(query).toHaveFocus();
      expect(
        screen.getByRole("textbox", { name: "Editing block from line 1" }),
      ).toHaveProperty("selectionStart", 6);
    });

    fireEvent.click(within(find).getByRole("button", { name: "Next match" }));
    await waitFor(() => {
      expect(query).toHaveFocus();
      expect(
        screen.getByRole("textbox", { name: "Editing block from line 3" }),
      ).toHaveProperty("selectionStart", 7);
    });
  });

  it("returns focus to the source editor when Find closes", async () => {
    const controller = workspaceControllerMock.current;
    controller.state = {
      ...controller.state,
      activity: "files",
      viewMode: "edit",
    };
    render(<App />);
    const editor = screen.getByRole("textbox", { name: "Editing source.md" });
    editor.focus();

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const query = within(
      screen.getByRole("search", { name: "Find in document" }),
    ).getByRole("searchbox", { name: "Find in document" });
    expect(query).toHaveFocus();

    fireEvent.keyDown(query, { key: "Escape" });

    await waitFor(() => expect(editor).toHaveFocus());
  });

  it("returns focus to the exact Live block that opened Find", async () => {
    const controller = workspaceControllerMock.current;
    const document = {
      ...sourceDocument,
      content: "First paragraph.\n\nSecond paragraph.",
      savedContent: "First paragraph.\n\nSecond paragraph.",
    };
    controller.state = {
      ...controller.state,
      activity: "files",
      documents: { "source.md": document },
      documentOrder: ["source.md"],
      activeDocumentId: "source.md",
      viewMode: "live",
    };
    controller.currentDocument = document;
    render(<App />);
    const liveEditor = screen.getByRole("region", {
      name: "Live editing source.md",
    });
    const blocks = within(liveEditor).getAllByRole("group");
    const secondBlock = blocks[1];
    expect(secondBlock).toBeDefined();
    secondBlock!.focus();

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const query = within(
      screen.getByRole("search", { name: "Find in document" }),
    ).getByRole("searchbox", { name: "Find in document" });
    expect(query).toHaveFocus();

    fireEvent.keyDown(query, { key: "Escape" });

    await waitFor(() => expect(secondBlock).toHaveFocus());
  });

  it("pastes a clipboard image into a local relative asset", async () => {
    const controller = workspaceControllerMock.current;
    controller.state = {
      ...controller.state,
      activity: "files",
      viewMode: "edit",
    };
    nativeInvokeMock.mockImplementation((command: string) => {
      if (command === "get_quit_guard_session") return Promise.resolve(37);
      if (command === "create_workspace_image") {
        return Promise.resolve({
            deduplicated: false,
            format: "png",
            height: 1,
            markdownPath: "assets/pasted-a.png",
            relativePath: "assets/pasted-a.png",
            sizeBytes: 4,
            width: 1,
          });
      }
      return Promise.resolve(undefined);
    });
    const file = {
      arrayBuffer: vi
        .fn()
        .mockResolvedValue(Uint8Array.of(137, 80, 78, 71).buffer),
      size: 4,
    } as unknown as File;
    render(<App />);
    const editor = screen.getByRole("textbox", {
      name: "Editing source.md",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length);

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

    await waitFor(() =>
      expect(controller.changeDocument).toHaveBeenLastCalledWith(
        "source.md",
        "source![Pasted image](assets/pasted-a.png)",
      ),
    );
    const createRequest = nativeInvokeMock.mock.calls.find(
      ([command]) => command === "create_workspace_image",
    )?.[1]?.request;
    expect(createRequest).toEqual({
      dataBase64: "iVBORw==",
      documentRelativePath: "source.md",
      leaseId: expect.any(String),
      session: 37,
      workspaceRoot: "/notes",
    });
    expect(nativeInvokeMock).toHaveBeenCalledWith("commit_workspace_image", {
      request: {
        leaseId: createRequest.leaseId,
        session: 37,
        workspaceRoot: "/notes",
      },
    });
    expect(controller.refreshCurrentWorkspace).toHaveBeenCalledOnce();
  });

  it("removes the pending token and cancels the lease when image commit fails", async () => {
    const controller = workspaceControllerMock.current;
    controller.state = {
      ...controller.state,
      activity: "files",
      viewMode: "edit",
    };
    nativeInvokeMock.mockImplementation((command: string) => {
      if (command === "get_quit_guard_session") return Promise.resolve(37);
      if (command === "create_workspace_image") {
        return Promise.resolve({
          deduplicated: false,
          format: "png",
          height: 1,
          markdownPath: "assets/uncommitted.png",
          relativePath: "assets/uncommitted.png",
          sizeBytes: 4,
          width: 1,
        });
      }
      if (command === "commit_workspace_image") {
        return Promise.reject(new Error("commit failed"));
      }
      return Promise.resolve(undefined);
    });
    const file = {
      arrayBuffer: vi
        .fn()
        .mockResolvedValue(Uint8Array.of(137, 80, 78, 71).buffer),
      size: 4,
    } as unknown as File;
    render(<App />);
    const editor = screen.getByRole("textbox", {
      name: "Editing source.md",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length);

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

    await waitFor(() =>
      expect(nativeInvokeMock).toHaveBeenCalledWith(
        "cancel_workspace_image",
        expect.anything(),
      ),
    );
    expect(controller.changeDocument).toHaveBeenLastCalledWith(
      "source.md",
      sourceDocument.content,
    );
    expect(controller.changeDocument).not.toHaveBeenCalledWith(
      "source.md",
      "source![Pasted image](assets/uncommitted.png)",
    );
    expect(controller.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "commit failed" }),
    );
  });

  it("preserves user-authored text that resembles an internal paste token", async () => {
    const controller = workspaceControllerMock.current;
    const content =
      "Keep [](#viva-image-paste-00000000-0000-4000-8000-000000000001) exactly.";
    const document = { ...sourceDocument, content, savedContent: "source" };
    controller.state = {
      ...controller.state,
      activity: "files",
      activeDocumentId: "source.md",
      documentOrder: ["source.md"],
      documents: { "source.md": document },
      viewMode: "edit",
    };
    controller.currentDocument = document;
    render(<App />);

    act(() => quitHooksMock.menuHandler?.("file.save"));

    await waitFor(() =>
      expect(controller.saveDocument).toHaveBeenCalledWith("source.md"),
    );
    expect(controller.changeDocument).not.toHaveBeenCalled();
  });

  it("cancels an image lease when its token is deleted after native creation starts", async () => {
    const controller = workspaceControllerMock.current;
    controller.state = {
      ...controller.state,
      activity: "files",
      viewMode: "edit",
    };
    controller.changeDocument.mockImplementation((id: string, content: string) => {
      const document = controller.state.documents[id];
      if (!document) return;
      const changed = { ...document, content };
      controller.state = {
        ...controller.state,
        documents: { ...controller.state.documents, [id]: changed },
      };
      if (controller.state.activeDocumentId === id) {
        controller.currentDocument = changed;
      }
    });
    const created = deferred<any>();
    nativeInvokeMock.mockImplementation((command: string) => {
      if (command === "get_quit_guard_session") return Promise.resolve(37);
      if (command === "create_workspace_image") return created.promise;
      return Promise.resolve(undefined);
    });
    const file = {
      arrayBuffer: vi
        .fn()
        .mockResolvedValue(Uint8Array.of(137, 80, 78, 71).buffer),
      size: 4,
    } as unknown as File;
    const view = render(<App />);
    let editor = screen.getByRole("textbox", {
      name: "Editing source.md",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length);

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
    await waitFor(() =>
      expect(nativeInvokeMock).toHaveBeenCalledWith(
        "create_workspace_image",
        expect.anything(),
      ),
    );
    const createRequest = nativeInvokeMock.mock.calls.find(
      ([command]) => command === "create_workspace_image",
    )?.[1]?.request;
    const pendingContent = controller.changeDocument.mock.calls.at(-1)?.[1];
    const pendingDocument = { ...sourceDocument, content: pendingContent };
    controller.state = {
      ...controller.state,
      documents: { ...controller.state.documents, "source.md": pendingDocument },
    };
    controller.currentDocument = pendingDocument;
    view.rerender(<App />);
    editor = screen.getByRole("textbox", {
      name: "Editing source.md",
    }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: sourceDocument.content } });

    created.resolve({
      deduplicated: false,
      format: "png",
      height: 1,
      markdownPath: "assets/cancelled.png",
      relativePath: "assets/cancelled.png",
      sizeBytes: 4,
      width: 1,
    });

    await waitFor(() =>
      expect(nativeInvokeMock).toHaveBeenCalledWith("cancel_workspace_image", {
        request: {
          leaseId: createRequest.leaseId,
          session: 37,
          workspaceRoot: "/notes",
        },
      }),
    );
    expect(nativeInvokeMock).not.toHaveBeenCalledWith(
      "commit_workspace_image",
      expect.anything(),
    );
    expect(controller.changeDocument).toHaveBeenLastCalledWith(
      "source.md",
      sourceDocument.content,
    );
  });

  it("settles concurrent image tokens independently when one paste fails", async () => {
    const controller = workspaceControllerMock.current;
    controller.state = {
      ...controller.state,
      activity: "files",
      viewMode: "edit",
    };
    const firstCreate = deferred<any>();
    const secondCreate = deferred<any>();
    let createCount = 0;
    nativeInvokeMock.mockImplementation((command: string) => {
      if (command === "get_quit_guard_session") return Promise.resolve(37);
      if (command === "create_workspace_image") {
        createCount += 1;
        return createCount === 1 ? firstCreate.promise : secondCreate.promise;
      }
      return Promise.resolve(undefined);
    });
    const imageFile = () =>
      ({
        arrayBuffer: vi
          .fn()
          .mockResolvedValue(Uint8Array.of(137, 80, 78, 71).buffer),
        size: 4,
      }) as unknown as File;
    const view = render(<App />);
    let editor = screen.getByRole("textbox", {
      name: "Editing source.md",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length);

    for (const file of [imageFile(), imageFile()]) {
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
      const content = controller.changeDocument.mock.calls.at(-1)?.[1];
      const document = { ...sourceDocument, content };
      controller.state = {
        ...controller.state,
        documents: { ...controller.state.documents, "source.md": document },
      };
      controller.currentDocument = document;
      view.rerender(<App />);
      editor = screen.getByRole("textbox", {
        name: "Editing source.md",
      }) as HTMLTextAreaElement;
      editor.setSelectionRange(editor.value.length, editor.value.length);
    }
    await waitFor(() => expect(createCount).toBe(2));
    const createRequests = nativeInvokeMock.mock.calls
      .filter(([command]) => command === "create_workspace_image")
      .map(([, payload]) => payload.request);
    expect(createRequests[0].leaseId).not.toBe(createRequests[1].leaseId);

    await act(async () => {
      firstCreate.reject(new Error("first paste failed"));
      secondCreate.resolve({
        deduplicated: false,
        format: "png",
        height: 1,
        markdownPath: "assets/second.png",
        relativePath: "assets/second.png",
        sizeBytes: 4,
        width: 1,
      });
      await Promise.allSettled([firstCreate.promise, secondCreate.promise]);
    });

    await waitFor(() =>
      expect(controller.changeDocument).toHaveBeenLastCalledWith(
        "source.md",
        "source![Pasted image](assets/second.png)",
      ),
    );
    expect(nativeInvokeMock).toHaveBeenCalledWith("cancel_workspace_image", {
      request: {
        leaseId: createRequests[0].leaseId,
        session: 37,
        workspaceRoot: "/notes",
      },
    });
    expect(nativeInvokeMock).toHaveBeenCalledWith("commit_workspace_image", {
      request: {
        leaseId: createRequests[1].leaseId,
        session: 37,
        workspaceRoot: "/notes",
      },
    });
  });

  it("waits for a pasted image before an immediate save and close", async () => {
    const controller = workspaceControllerMock.current;
    controller.state = {
      ...controller.state,
      activity: "files",
      documentOrder: ["source.md"],
      documents: { "source.md": sourceDocument },
      viewMode: "edit",
    };
    const bytes = deferred<ArrayBuffer>();
    const committed = deferred<void>();
    const savedContents: string[] = [];
    controller.changeDocument.mockImplementation((id: string, content: string) => {
      const document = controller.state.documents[id];
      if (!document) return;
      const changed = { ...document, content };
      controller.state = {
        ...controller.state,
        documents: { ...controller.state.documents, [id]: changed },
      };
      if (controller.state.activeDocumentId === id) {
        controller.currentDocument = changed;
      }
    });
    controller.saveDocument.mockImplementation(async () => {
      const latest = controller.changeDocument.mock.calls.at(-1)?.[1];
      savedContents.push(latest ?? sourceDocument.content);
      return true;
    });
    nativeInvokeMock.mockImplementation((command: string) => {
      if (command === "get_quit_guard_session") return Promise.resolve(37);
      if (command === "create_workspace_image") {
        return Promise.resolve({
            deduplicated: false,
            format: "png",
            height: 1,
            markdownPath: "assets/saved-paste.png",
            relativePath: "assets/saved-paste.png",
            sizeBytes: 4,
            width: 1,
          });
      }
      if (command === "commit_workspace_image") return committed.promise;
      return Promise.resolve(undefined);
    });
    const file = {
      arrayBuffer: vi.fn().mockReturnValue(bytes.promise),
      size: 4,
    } as unknown as File;
    const view = render(<App />);
    const editor = screen.getByRole("textbox", {
      name: "Editing source.md",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length);

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
    const pendingContent = controller.changeDocument.mock.calls.at(-1)?.[1];
    expect(pendingContent).toContain("#viva-image-paste-");
    const pendingDocument = { ...sourceDocument, content: pendingContent };
    controller.state = {
      ...controller.state,
      documents: { "source.md": pendingDocument },
    };
    controller.currentDocument = pendingDocument;
    controller.dirty = true;
    view.rerender(<App />);

    act(() => quitHooksMock.menuHandler?.("file.save"));
    fireEvent.click(screen.getByRole("button", { name: "Close source.md" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(controller.saveDocument).not.toHaveBeenCalled();
    expect(controller.closeDocument).not.toHaveBeenCalled();

    await act(async () => {
      bytes.resolve(Uint8Array.of(137, 80, 78, 71).buffer);
      await bytes.promise;
    });

    await waitFor(() =>
      expect(nativeInvokeMock).toHaveBeenCalledWith(
        "commit_workspace_image",
        expect.anything(),
      ),
    );
    expect(controller.saveDocument).not.toHaveBeenCalled();
    expect(controller.changeDocument).not.toHaveBeenCalledWith(
      "source.md",
      "source![Pasted image](assets/saved-paste.png)",
    );
    await act(async () => committed.resolve());

    await waitFor(() => expect(controller.closeDocument).toHaveBeenCalledWith("source.md"));
    expect(controller.changeDocument).toHaveBeenCalledWith(
      "source.md",
      "source![Pasted image](assets/saved-paste.png)",
    );
    expect(savedContents.length).toBeGreaterThan(0);
    expect(savedContents.every((content) => !content.includes("#viva-image-paste-"))).toBe(
      true,
    );
    expect(savedContents.at(-1)).toBe(
      "source![Pasted image](assets/saved-paste.png)",
    );
  });

  it("cancels native image creation when the token is deleted before closing", async () => {
    const controller = workspaceControllerMock.current;
    controller.state = {
      ...controller.state,
      activity: "files",
      documentOrder: ["source.md"],
      documents: { "source.md": sourceDocument },
      viewMode: "edit",
    };
    const bytes = deferred<ArrayBuffer>();
    const file = {
      arrayBuffer: vi.fn().mockReturnValue(bytes.promise),
      size: 4,
    } as unknown as File;
    render(<App />);
    const editor = screen.getByRole("textbox", {
      name: "Editing source.md",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length);

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
    fireEvent.change(editor, { target: { value: sourceDocument.content } });
    fireEvent.click(screen.getByRole("button", { name: "Close source.md" }));
    expect(controller.closeDocument).not.toHaveBeenCalled();

    await act(async () => {
      bytes.resolve(Uint8Array.of(137, 80, 78, 71).buffer);
      await bytes.promise;
    });

    expect(nativeInvokeMock).not.toHaveBeenCalledWith(
      "create_workspace_image",
      expect.anything(),
    );
    await waitFor(() =>
      expect(nativeInvokeMock).toHaveBeenCalledWith("cancel_workspace_image", {
        request: {
          leaseId: expect.any(String),
          session: 37,
          workspaceRoot: "/notes",
        },
      }),
    );
    await waitFor(() =>
      expect(controller.closeDocument).toHaveBeenCalledWith("source.md"),
    );
  });

  it("cancels a deleted image token before switching workspaces", async () => {
    const controller = workspaceControllerMock.current;
    controller.state = {
      ...controller.state,
      activity: "files",
      documentOrder: ["source.md"],
      documents: { "source.md": sourceDocument },
      viewMode: "edit",
    };
    controller.dirty = false;
    const bytes = deferred<ArrayBuffer>();
    const file = {
      arrayBuffer: vi.fn().mockReturnValue(bytes.promise),
      size: 4,
    } as unknown as File;
    render(<App />);
    const editor = screen.getByRole("textbox", {
      name: "Editing source.md",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length);

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
    fireEvent.change(editor, { target: { value: sourceDocument.content } });
    act(() => quitHooksMock.menuHandler?.("file.open"));
    expect(controller.openFolder).not.toHaveBeenCalled();

    await act(async () => {
      bytes.resolve(Uint8Array.of(137, 80, 78, 71).buffer);
      await bytes.promise;
    });

    expect(nativeInvokeMock).not.toHaveBeenCalledWith(
      "create_workspace_image",
      expect.anything(),
    );
    await waitFor(() =>
      expect(nativeInvokeMock).toHaveBeenCalledWith("cancel_workspace_image", {
        request: {
          leaseId: expect.any(String),
          session: 37,
          workspaceRoot: "/notes",
        },
      }),
    );
    await waitFor(() => expect(controller.openFolder).toHaveBeenCalledOnce());
  });

  it("closes the image viewer when the workspace root changes", async () => {
    const controller = workspaceControllerMock.current;
    controller.state = {
      ...controller.state,
      activity: "files",
      workspace: {
        ...controller.state.workspace,
        children: [
          ...controller.state.workspace.children,
          {
            children: [],
            kind: "image",
            name: "workspace-a.png",
            relativePath: "assets/workspace-a.png",
          },
        ],
      },
    };
    const view = render(<App />);

    fireEvent.click(
      screen.getByRole("treeitem", { name: "workspace-a.png" }),
    );
    expect(screen.getByRole("dialog", { name: "Image viewer" })).toBeVisible();

    controller.state = {
      ...controller.state,
      workspace: {
        ...controller.state.workspace,
        name: "Other",
        rootPath: "/other-notes",
      },
    };
    view.rerender(<App />);

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Image viewer" }),
      ).toBeNull(),
    );
  });

  it("resets a virtual file tree when the workspace root changes", async () => {
    const controller = workspaceControllerMock.current;
    const largeTree = (prefix: string) =>
      Array.from({ length: 300 }, (_, index) => ({
        children: [],
        kind: "file",
        name: `${prefix}-${index.toString().padStart(5, "0")}.md`,
        relativePath: `${prefix}-${index.toString().padStart(5, "0")}.md`,
      }));
    controller.state = {
      ...controller.state,
      activity: "files",
      workspace: {
        ...controller.state.workspace,
        children: largeTree("alpha"),
      },
    };
    const view = render(<App />);
    const firstTree = screen.getByRole("navigation", {
      name: "Workspace files",
    });
    Object.defineProperty(firstTree, "clientHeight", {
      configurable: true,
      value: 280,
    });
    firstTree.scrollTop = 250 * 28;
    fireEvent.scroll(firstTree);
    expect(
      await screen.findByRole("treeitem", { name: "alpha-00250.md" }),
    ).toBeVisible();

    controller.state = {
      ...controller.state,
      workspace: {
        children: largeTree("beta"),
        name: "Other",
        rootPath: "/other-notes",
      },
    };
    view.rerender(<App />);

    const secondTree = screen.getByRole("navigation", {
      name: "Workspace files",
    });
    expect(secondTree).not.toBe(firstTree);
    expect(secondTree.scrollTop).toBe(0);
    expect(
      await screen.findByRole("treeitem", { name: "beta-00000.md" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("treeitem", { name: "beta-00250.md" }),
    ).toBeNull();
  });

  it("creates a Markdown file from the file-tree context menu", async () => {
    const controller = workspaceControllerMock.current;
    controller.state = {
      ...controller.state,
      activity: "files",
      viewMode: "edit",
    };
    controller.createMarkdown.mockResolvedValueOnce({
      affectedDocumentIds: [],
      affectedDirtyDocumentIds: [],
      applied: true,
      succeeded: true,
      treeRefreshed: true,
      snapshot: {
        ...sourceDocument,
        content: "# Daily\n\n",
        name: "Daily.md",
        relativePath: "Daily.md",
        savedContent: undefined,
      },
    });
    render(<App />);

    fireEvent.contextMenu(
      screen.getByRole("treeitem", { name: "source.md" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "New Markdown File" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "New Markdown File",
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "File name" }), {
      target: { value: "Daily.md" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create File" }));

    await waitFor(() =>
      expect(controller.createMarkdown).toHaveBeenCalledWith(
        "",
        "Daily.md",
        "# Daily\n\n",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "New Markdown File" }),
      ).toBeNull(),
    );
  });

  it("retries the sidebar refresh after a successful file creation", async () => {
    const controller = workspaceControllerMock.current;
    controller.state = {
      ...controller.state,
      activity: "files",
      viewMode: "edit",
    };
    controller.createMarkdown.mockResolvedValueOnce({
      affectedDocumentIds: [],
      affectedDirtyDocumentIds: [],
      applied: true,
      succeeded: true,
      treeRefreshed: false,
      refreshError: "Tree changed while refreshing",
      snapshot: {
        ...sourceDocument,
        content: "# Daily\n\n",
        name: "Daily.md",
        relativePath: "Daily.md",
        savedContent: undefined,
      },
    });
    controller.refreshCurrentWorkspace.mockResolvedValueOnce(true);
    render(<App />);

    fireEvent.contextMenu(
      screen.getByRole("treeitem", { name: "source.md" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "New Markdown File" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "New Markdown File",
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "File name" }), {
      target: { value: "Daily.md" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create File" }));

    await waitFor(() =>
      expect(controller.refreshCurrentWorkspace).toHaveBeenCalledOnce(),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "New Markdown File" }),
      ).toBeNull(),
    );
    expect(controller.reportError).not.toHaveBeenCalled();
  });

  it("renames an open dirty document without saving away its draft", async () => {
    const clearImageCache = vi
      .spyOn(workspaceImageCache, "clear")
      .mockImplementation(() => undefined);
    const controller = workspaceControllerMock.current;
    const dirtyDocument = { ...sourceDocument, content: "unsaved draft" };
    controller.state = {
      ...controller.state,
      activity: "files",
      documents: { "source.md": dirtyDocument },
      documentOrder: ["source.md"],
      activeDocumentId: "source.md",
      viewMode: "edit",
    };
    controller.currentDocument = dirtyDocument;
    controller.dirty = true;
    controller.inspectEntryImpact.mockReturnValue({
      affectedDocumentIds: ["source.md"],
      affectedDirtyDocumentIds: ["source.md"],
    });
    controller.renameEntry.mockResolvedValueOnce({
      affectedDocumentIds: ["source.md"],
      affectedDirtyDocumentIds: ["source.md"],
      applied: true,
      succeeded: true,
      treeRefreshed: true,
      mutation: {
        destinationRelativePath: "renamed.md",
        kind: "file",
        recoverable: false,
        sourceRelativePath: "source.md",
      },
    });
    render(<App />);

    fireEvent.contextMenu(
      screen.getByRole("treeitem", { name: /source\.md/ }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const dialog = screen.getByRole("dialog", {
      name: "Rename “source.md”",
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), {
      target: { value: "renamed.md" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));

    await waitFor(() =>
      expect(controller.renameEntry).toHaveBeenCalledWith(
        "source.md",
        "renamed.md",
      ),
    );
    expect(controller.saveDocument).not.toHaveBeenCalled();
    expect(clearImageCache).toHaveBeenCalledWith("/notes");
  });

  it("saves a dirty document before duplicating it", async () => {
    const controller = workspaceControllerMock.current;
    const dirtyDocument = { ...sourceDocument, content: "unsaved draft" };
    controller.state = {
      ...controller.state,
      activity: "files",
      documents: { "source.md": dirtyDocument },
      documentOrder: ["source.md"],
      activeDocumentId: "source.md",
      viewMode: "edit",
    };
    controller.currentDocument = dirtyDocument;
    controller.dirty = true;
    controller.inspectEntryImpact.mockReturnValue({
      affectedDocumentIds: ["source.md"],
      affectedDirtyDocumentIds: ["source.md"],
    });
    controller.duplicateEntry.mockResolvedValueOnce({
      affectedDocumentIds: ["source.md"],
      affectedDirtyDocumentIds: [],
      applied: true,
      succeeded: true,
      treeRefreshed: true,
      mutation: {
        destinationRelativePath: "source copy.md",
        kind: "file",
        recoverable: false,
        sourceRelativePath: "source.md",
      },
    });
    render(<App />);

    fireEvent.contextMenu(
      screen.getByRole("treeitem", { name: /source\.md/ }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    const dialog = screen.getByRole("dialog", {
      name: "Save “source.md” before duplicating?",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save & Duplicate" }),
    );

    await waitFor(() =>
      expect(controller.duplicateEntry).toHaveBeenCalledWith("source.md"),
    );
    expect(controller.saveDocument).toHaveBeenCalledWith("source.md");
    expect(controller.saveDocument.mock.invocationCallOrder[0]).toBeLessThan(
      controller.duplicateEntry.mock.invocationCallOrder[0],
    );
  });

  it("keeps a duplicate confirmation open when the copy fails", async () => {
    const controller = workspaceControllerMock.current;
    const dirtyDocument = { ...sourceDocument, content: "unsaved draft" };
    controller.state = {
      ...controller.state,
      activity: "files",
      documents: { "source.md": dirtyDocument },
      documentOrder: ["source.md"],
      activeDocumentId: "source.md",
      viewMode: "edit",
    };
    controller.currentDocument = dirtyDocument;
    controller.dirty = true;
    controller.inspectEntryImpact.mockReturnValue({
      affectedDocumentIds: ["source.md"],
      affectedDirtyDocumentIds: ["source.md"],
    });
    controller.duplicateEntry.mockResolvedValueOnce({
      affectedDocumentIds: ["source.md"],
      affectedDirtyDocumentIds: [],
      applied: false,
      succeeded: false,
      treeRefreshed: true,
      error: "The destination already exists.",
    });
    render(<App />);

    fireEvent.contextMenu(
      screen.getByRole("treeitem", { name: /source\.md/ }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    const dialog = screen.getByRole("dialog", {
      name: "Save “source.md” before duplicating?",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save & Duplicate" }),
    );

    expect(
      await within(dialog).findByRole("alert"),
    ).toHaveTextContent("The destination already exists.");
    expect(dialog).toBeVisible();
  });

  it("refreshes search with the latest query after a deferred duplicate", async () => {
    const controller = workspaceControllerMock.current;
    const duplicate = deferred<any>();
    const view = render(<App />);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search workspace" }),
      { target: { value: "old query" } },
    );

    controller.state = {
      ...controller.state,
      activity: "files",
      viewMode: "edit",
    };
    controller.duplicateEntry.mockReturnValueOnce(duplicate.promise);
    view.rerender(<App />);
    fireEvent.contextMenu(
      screen.getByRole("treeitem", { name: "source.md" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() =>
      expect(controller.duplicateEntry).toHaveBeenCalledWith("source.md"),
    );

    controller.state = { ...controller.state, activity: "search" };
    view.rerender(<App />);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search workspace" }),
      { target: { value: "latest query" } },
    );
    controller.runSearch.mockClear();

    await act(async () => {
      duplicate.resolve({
        affectedDocumentIds: ["source.md"],
        affectedDirtyDocumentIds: [],
        applied: true,
        succeeded: true,
        treeRefreshed: true,
        mutation: {
          destinationRelativePath: "source copy.md",
          kind: "file",
          recoverable: false,
          sourceRelativePath: "source.md",
        },
      });
      await duplicate.promise;
    });

    expect(controller.runSearch).toHaveBeenCalledWith("latest query");
    expect(controller.runSearch).not.toHaveBeenCalledWith("old query");
  });

  it("does not finish a duplicate inside a different workspace", async () => {
    const controller = workspaceControllerMock.current;
    const refresh = deferred<boolean>();
    controller.state = {
      ...controller.state,
      activity: "files",
      viewMode: "edit",
    };
    controller.duplicateEntry.mockResolvedValueOnce({
      affectedDocumentIds: ["source.md"],
      affectedDirtyDocumentIds: [],
      applied: true,
      succeeded: true,
      treeRefreshed: false,
      refreshError: "Tree changed while refreshing",
      mutation: {
        destinationRelativePath: "source copy.md",
        kind: "file",
        recoverable: false,
        sourceRelativePath: "source.md",
      },
    });
    controller.refreshCurrentWorkspace.mockReturnValueOnce(refresh.promise);
    const view = render(<App />);

    fireEvent.contextMenu(
      screen.getByRole("treeitem", { name: "source.md" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() =>
      expect(controller.refreshCurrentWorkspace).toHaveBeenCalledOnce(),
    );

    controller.state = {
      ...controller.state,
      workspace: {
        rootPath: "/other-notes",
        name: "Other Notes",
        children: [],
      },
      documents: {},
      documentOrder: [],
      activeDocumentId: null,
    };
    controller.currentDocument = null;
    view.rerender(<App />);
    await act(async () => {
      refresh.resolve(false);
      await refresh.promise;
    });

    expect(controller.openDocument).not.toHaveBeenCalledWith("source copy.md");
    expect(controller.reportError).not.toHaveBeenCalled();
    expect(controller.runSearch).not.toHaveBeenCalledWith("old query");
  });

  it("reports a sidebar refresh warning after opening a duplicate", async () => {
    const controller = workspaceControllerMock.current;
    controller.state = {
      ...controller.state,
      activity: "files",
      viewMode: "edit",
    };
    controller.duplicateEntry.mockResolvedValueOnce({
      affectedDocumentIds: ["source.md"],
      affectedDirtyDocumentIds: [],
      applied: true,
      succeeded: true,
      treeRefreshed: false,
      refreshError: "Tree changed while refreshing",
      mutation: {
        destinationRelativePath: "source copy.md",
        kind: "file",
        recoverable: false,
        sourceRelativePath: "source.md",
      },
    });
    controller.refreshCurrentWorkspace.mockResolvedValueOnce(false);
    render(<App />);

    fireEvent.contextMenu(
      screen.getByRole("treeitem", { name: "source.md" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    await waitFor(() =>
      expect(controller.reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("sidebar could not refresh"),
        }),
      ),
    );
    expect(controller.openDocument).toHaveBeenCalledWith("source copy.md");
    expect(controller.openDocument.mock.invocationCallOrder[0]).toBeLessThan(
      controller.reportError.mock.invocationCallOrder[0],
    );
  });

  it("saves dirty descendants before moving a folder to system Trash", async () => {
    const controller = workspaceControllerMock.current;
    const dirtyDocument = {
      ...sourceDocument,
      content: "unsaved draft",
      name: "draft.md",
      relativePath: "Notes/draft.md",
    };
    controller.state = {
      ...controller.state,
      activity: "files",
      workspace: {
        ...controller.state.workspace,
        children: [
          {
            children: [
              {
                children: [],
                kind: "file",
                name: "draft.md",
                relativePath: "Notes/draft.md",
              },
            ],
            kind: "directory",
            name: "Notes",
            relativePath: "Notes",
          },
        ],
      },
      documents: { "Notes/draft.md": dirtyDocument },
      documentOrder: ["Notes/draft.md"],
      activeDocumentId: "Notes/draft.md",
      expandedPaths: ["Notes"],
      viewMode: "edit",
    };
    controller.currentDocument = dirtyDocument;
    controller.dirty = true;
    controller.inspectEntryImpact.mockReturnValue({
      affectedDocumentIds: ["Notes/draft.md"],
      affectedDirtyDocumentIds: ["Notes/draft.md"],
    });
    controller.trashEntry.mockResolvedValueOnce({
      affectedDocumentIds: ["Notes/draft.md"],
      affectedDirtyDocumentIds: [],
      applied: true,
      succeeded: true,
      treeRefreshed: true,
      mutation: {
        kind: "directory",
        recoverable: true,
        sourceRelativePath: "Notes",
      },
    });
    render(<App />);

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Notes" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Move to Trash" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Move “Notes” to Trash?",
    });
    expect(dialog).toHaveTextContent("system Trash");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Save & Move to Trash",
      }),
    );

    await waitFor(() =>
      expect(controller.trashEntry).toHaveBeenCalledWith("Notes"),
    );
    expect(controller.saveDocument).toHaveBeenCalledWith("Notes/draft.md");
    expect(controller.saveDocument.mock.invocationCallOrder[0]).toBeLessThan(
      controller.trashEntry.mock.invocationCallOrder[0],
    );
  });

  it("moves focus to the adjacent file after using system Trash", async () => {
    const clearImageCache = vi
      .spyOn(workspaceImageCache, "clear")
      .mockImplementation(() => undefined);
    const controller = workspaceControllerMock.current;
    controller.state = {
      ...controller.state,
      activity: "files",
      viewMode: "edit",
    };
    controller.inspectEntryImpact.mockReturnValue({
      affectedDocumentIds: ["source.md"],
      affectedDirtyDocumentIds: [],
    });
    controller.trashEntry.mockImplementationOnce(async () => {
      controller.state = {
        ...controller.state,
        workspace: {
          ...controller.state.workspace,
          children: controller.state.workspace.children.filter(
            (entry: { relativePath: string }) =>
              entry.relativePath !== "source.md",
          ),
        },
        documents: { "target.md": targetDocument },
        documentOrder: ["target.md"],
        activeDocumentId: "target.md",
      };
      controller.currentDocument = targetDocument;
      return {
        affectedDocumentIds: ["source.md"],
        affectedDirtyDocumentIds: [],
        applied: true,
        succeeded: true,
        treeRefreshed: true,
        mutation: {
          kind: "file",
          recoverable: true,
          sourceRelativePath: "source.md",
        },
      };
    });
    render(<App />);

    fireEvent.contextMenu(
      screen.getByRole("treeitem", { name: "source.md" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    const dialog = screen.getByRole("dialog", {
      name: "Move “source.md” to Trash?",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Move to Trash" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("treeitem", { name: "target.md" })).toHaveFocus(),
    );
    expect(clearImageCache).toHaveBeenCalledWith("/notes");
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
          lineEnding: "crlf",
        },
      ],
      selectedEntry: {
        id: "older",
        label: "Yesterday, 18:04",
        description: "Before editing",
        content: "historical text",
        lineEnding: "crlf",
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
      "crlf",
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

    await waitFor(() =>
      expect(controller.closeDocument).toHaveBeenCalledWith("source.md"),
    );
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
