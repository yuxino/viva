import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentSnapshot, WorkspaceTree } from "../domain/workspace";
import { I18nProvider, useI18n } from "../i18n";
import type { SearchMatch } from "../lib/native";
import {
  useWorkspaceController,
  WORKSPACE_OPEN_TIMEOUT_MS,
} from "./useWorkspaceController";

const nativeMocks = vi.hoisted(() => ({
  chooseSavePath: vi.fn(),
  createDocument: vi.fn(),
  createWorkspaceDirectory: vi.fn(),
  duplicateWorkspaceEntry: vi.fn(),
  inspectSaveDestination: vi.fn(),
  openWorkspace: vi.fn(),
  readDocument: vi.fn(),
  renameWorkspaceEntry: vi.fn(),
  saveDocumentAs: vi.fn(),
  searchWorkspace: vi.fn(),
  trashWorkspaceEntry: vi.fn(),
  writeDocument: vi.fn(),
}));

vi.mock("../lib/native", () => ({
  chooseSavePath: nativeMocks.chooseSavePath,
  chooseWorkspace: vi.fn(),
  createDocument: nativeMocks.createDocument,
  createWorkspaceDirectory: nativeMocks.createWorkspaceDirectory,
  describeNativeError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  duplicateWorkspaceEntry: nativeMocks.duplicateWorkspaceEntry,
  hasNativeShell: () => false,
  inspectSaveDestination: nativeMocks.inspectSaveDestination,
  openWorkspace: nativeMocks.openWorkspace,
  readDocument: nativeMocks.readDocument,
  renameWorkspaceEntry: nativeMocks.renameWorkspaceEntry,
  saveDocumentAs: nativeMocks.saveDocumentAs,
  searchWorkspace: nativeMocks.searchWorkspace,
  trashWorkspaceEntry: nativeMocks.trashWorkspaceEntry,
  writeDocument: nativeMocks.writeDocument,
}));

const noteSnapshot = (
  content: string,
  hashCharacter: string,
): DocumentSnapshot => ({
  relativePath: "note.md",
  name: "note.md",
  content,
  revision: {
    modifiedAtMs: content.length,
    sizeBytes: content.length,
    contentSha256: hashCharacter.repeat(64),
  },
});

const workspace = (rootPath: string, name: string): WorkspaceTree => ({
  rootPath,
  name,
  children: [],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function openWorkspace(
  result: ReturnType<typeof renderHook<ReturnType<typeof useWorkspaceController>, unknown>>,
) {
  await act(async () => {
    await result.result.current.openRecentWorkspace("/notes");
  });
}

describe("useWorkspaceController search", () => {
  beforeEach(() => {
    localStorage.clear();
    nativeMocks.openWorkspace.mockReset().mockResolvedValue({
      rootPath: "/notes",
      name: "Notes",
      children: [],
    });
    nativeMocks.readDocument.mockReset();
    nativeMocks.searchWorkspace.mockReset();
    nativeMocks.writeDocument.mockReset();
  });

  it("keeps the newest results when an older query finishes last", async () => {
    const older = deferred<SearchMatch[]>();
    const newer = deferred<SearchMatch[]>();
    nativeMocks.searchWorkspace
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const result = renderHook(() => useWorkspaceController());
    await openWorkspace(result);

    let olderSearch!: Promise<void>;
    let newerSearch!: Promise<void>;
    act(() => {
      olderSearch = result.result.current.runSearch("old");
      newerSearch = result.result.current.runSearch("new");
    });

    const newestResult = {
      relativePath: "new.md",
      line: 2,
      column: 4,
      preview: "new result",
    };
    await act(async () => {
      newer.resolve([newestResult]);
      await newerSearch;
    });
    expect(result.result.current.searchResults).toEqual([newestResult]);
    expect(result.result.current.searching).toBe(false);

    await act(async () => {
      older.resolve([
        {
          relativePath: "old.md",
          line: 1,
          column: 1,
          preview: "stale result",
        },
      ]);
      await olderSearch;
    });
    expect(result.result.current.searchResults).toEqual([newestResult]);
    expect(result.result.current.status.tone).not.toBe("error");
  });

  it("invalidates an in-flight query immediately when search is cleared", async () => {
    const inFlight = deferred<SearchMatch[]>();
    nativeMocks.searchWorkspace.mockReturnValueOnce(inFlight.promise);
    const result = renderHook(() => useWorkspaceController());
    await openWorkspace(result);

    let staleSearch!: Promise<void>;
    act(() => {
      staleSearch = result.result.current.runSearch("old");
    });
    await act(async () => {
      await result.result.current.runSearch("");
    });
    expect(result.result.current.searchResults).toEqual([]);
    expect(result.result.current.searching).toBe(false);

    await act(async () => {
      inFlight.resolve([
        {
          relativePath: "old.md",
          line: 1,
          column: 1,
          preview: "stale result",
        },
      ]);
      await staleSearch;
    });
    expect(result.result.current.searchResults).toEqual([]);
    expect(result.result.current.searching).toBe(false);
  });

  it("ignores an older query error after the newest query succeeds", async () => {
    const older = deferred<SearchMatch[]>();
    nativeMocks.searchWorkspace
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce([
        {
          relativePath: "latest.md",
          line: 1,
          column: 1,
          preview: "latest result",
        },
      ]);
    const result = renderHook(() => useWorkspaceController());
    await openWorkspace(result);

    let olderSearch!: Promise<void>;
    await act(async () => {
      olderSearch = result.result.current.runSearch("old");
      await result.result.current.runSearch("latest");
    });
    await act(async () => {
      older.reject(new Error("stale failure"));
      await olderSearch;
    });

    expect(result.result.current.searchResults).toEqual([
      expect.objectContaining({ relativePath: "latest.md" }),
    ]);
    expect(result.result.current.status).toEqual({
      message: "Saved locally",
      tone: "neutral",
    });
  });

  it("reports a history warning without treating the document save as failed", async () => {
    const saved = {
      relativePath: "note.md",
      name: "note.md",
      content: "changed",
      revision: { modifiedAtMs: 2, sizeBytes: 7, contentSha256: "b".repeat(64) },
      historyWarningCode: "HISTORY_UNAVAILABLE" as const,
    };
    nativeMocks.readDocument.mockResolvedValue({
      ...saved,
      content: "original",
      savedContent: undefined,
      historyWarningCode: undefined,
      revision: { modifiedAtMs: 1, sizeBytes: 8, contentSha256: "a".repeat(64) },
    });
    nativeMocks.writeDocument.mockResolvedValue(saved);
    const result = renderHook(() => useWorkspaceController());
    await openWorkspace(result);

    await act(async () => {
      await result.result.current.openDocument("note.md");
    });
    act(() => result.result.current.changeDocument("note.md", "changed"));

    let didSave = false;
    await act(async () => {
      didSave = await result.result.current.saveDocument("note.md");
    });

    expect(didSave).toBe(true);
    expect(result.result.current.status).toEqual({
      message: "Saved locally · local history unavailable",
      tone: "neutral",
    });
  });
});

describe("useWorkspaceController localization", () => {
  function EnglishI18n({ children }: { children: ReactNode }) {
    return (
      <I18nProvider initialPreference="en" storage={null}>
        {children}
      </I18nProvider>
    );
  }

  it("retranslates the current status when the application language changes", () => {
    const result = renderHook(
      () => ({ controller: useWorkspaceController(), i18n: useI18n() }),
      { wrapper: EnglishI18n },
    );

    act(() => result.result.current.controller.changeDocument("note.md", "draft"));
    expect(result.result.current.controller.status.message).toBe("Not saved");

    act(() => result.result.current.i18n.setPreference("zh-Hans"));
    expect(result.result.current.controller.status.message).toBe("尚未保存");
  });
});

describe("useWorkspaceController workspace isolation", () => {
  beforeEach(() => {
    localStorage.clear();
    nativeMocks.chooseSavePath.mockReset();
    nativeMocks.inspectSaveDestination.mockReset();
    nativeMocks.openWorkspace.mockReset();
    nativeMocks.readDocument.mockReset();
    nativeMocks.saveDocumentAs.mockReset();
    nativeMocks.searchWorkspace.mockReset();
    nativeMocks.writeDocument.mockReset();
  });

  it("returns false when there is no current workspace to refresh", async () => {
    const result = renderHook(() => useWorkspaceController());

    let refreshed = true;
    await act(async () => {
      refreshed = await result.result.current.refreshCurrentWorkspace();
    });

    expect(refreshed).toBe(false);
    expect(nativeMocks.openWorkspace).not.toHaveBeenCalled();
  });

  it("refreshes the current workspace tree without replacing open documents", async () => {
    const refreshedWorkspace: WorkspaceTree = {
      ...workspace("/one", "One"),
      children: [
        {
          name: "new.md",
          relativePath: "new.md",
          kind: "file",
          children: [],
        },
      ],
    };
    nativeMocks.openWorkspace
      .mockResolvedValueOnce(workspace("/one", "One"))
      .mockResolvedValueOnce(refreshedWorkspace);
    nativeMocks.readDocument.mockResolvedValue(noteSnapshot("draft", "a"));
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });
    await act(async () => {
      await result.result.current.openDocument("note.md");
    });

    let refreshed = false;
    await act(async () => {
      refreshed = await result.result.current.refreshCurrentWorkspace();
    });

    expect(refreshed).toBe(true);
    expect(nativeMocks.openWorkspace).toHaveBeenNthCalledWith(2, "/one");
    expect(result.result.current.state.workspace).toEqual(refreshedWorkspace);
    expect(result.result.current.state.documents["note.md"]?.content).toBe(
      "draft",
    );
  });

  it("ignores a public refresh that finishes after switching workspaces", async () => {
    const pendingRefresh = deferred<WorkspaceTree>();
    nativeMocks.openWorkspace.mockImplementation((path: string) => {
      if (path === "/two") return Promise.resolve(workspace("/two", "Two"));
      if (nativeMocks.openWorkspace.mock.calls.length === 1) {
        return Promise.resolve(workspace("/one", "One"));
      }
      return pendingRefresh.promise;
    });
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });

    let refreshPromise!: Promise<boolean>;
    act(() => {
      refreshPromise = result.result.current.refreshCurrentWorkspace();
    });
    await waitFor(() => expect(nativeMocks.openWorkspace).toHaveBeenCalledTimes(2));
    await act(async () => {
      await result.result.current.openRecentWorkspace("/two");
    });

    let refreshed = true;
    await act(async () => {
      pendingRefresh.resolve(workspace("/one", "Stale One"));
      refreshed = await refreshPromise;
    });

    expect(refreshed).toBe(false);
    expect(result.result.current.state.workspace).toEqual(
      workspace("/two", "Two"),
    );
  });

  it("rejects a refresh response for a different workspace root", async () => {
    nativeMocks.openWorkspace
      .mockResolvedValueOnce(workspace("/one", "One"))
      .mockResolvedValueOnce(workspace("/other", "Other"));
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });

    let refreshed = true;
    await act(async () => {
      refreshed = await result.result.current.refreshCurrentWorkspace();
    });

    expect(refreshed).toBe(false);
    expect(result.result.current.state.workspace).toEqual(
      workspace("/one", "One"),
    );
  });

  it("reports a current refresh failure and returns false", async () => {
    nativeMocks.openWorkspace
      .mockResolvedValueOnce(workspace("/one", "One"))
      .mockRejectedValueOnce(new Error("refresh failed"));
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });

    let refreshed = true;
    await act(async () => {
      refreshed = await result.result.current.refreshCurrentWorkspace();
    });

    expect(refreshed).toBe(false);
    expect(result.result.current.status).toEqual({
      message: "refresh failed",
      tone: "error",
    });
  });

  it("does not recreate a tab when a save finishes after that tab closed", async () => {
    const pendingSave = deferred<DocumentSnapshot>();
    nativeMocks.openWorkspace.mockResolvedValue(workspace("/one", "One"));
    nativeMocks.readDocument.mockResolvedValue(noteSnapshot("original", "a"));
    nativeMocks.writeDocument.mockReturnValue(pendingSave.promise);
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });
    await act(async () => {
      await result.result.current.openDocument("note.md");
    });
    act(() => result.result.current.changeDocument("note.md", "changed"));

    let savePromise!: Promise<boolean>;
    act(() => {
      savePromise = result.result.current.saveDocument("note.md");
      result.result.current.closeDocument("note.md");
    });
    await act(async () => {
      pendingSave.resolve(noteSnapshot("changed", "b"));
      await savePromise;
    });

    expect(result.result.current.state.documents).toEqual({});
    expect(result.result.current.state.documentOrder).toEqual([]);
    expect(result.result.current.status).toEqual({
      message: "Saved locally",
      tone: "neutral",
    });
  });

  it("returns control when a workspace scan does not finish", async () => {
    vi.useFakeTimers();
    try {
      nativeMocks.openWorkspace.mockReturnValue(new Promise(() => undefined));
      const result = renderHook(() => useWorkspaceController());

      let opening!: Promise<boolean>;
      act(() => {
        opening = result.result.current.openRecentWorkspace("/blocked");
      });
      expect(result.result.current.busy).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(WORKSPACE_OPEN_TIMEOUT_MS);
        expect(await opening).toBe(false);
      });

      expect(result.result.current.busy).toBe(false);
      expect(result.result.current.state.workspace).toBeNull();
      expect(result.result.current.status).toEqual({
        message: "This folder took too long to open. Try a smaller local folder.",
        tone: "error",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a save from an earlier workspace even when the path matches", async () => {
    const pendingSave = deferred<DocumentSnapshot>();
    nativeMocks.openWorkspace.mockImplementation(async (path: string) =>
      path === "/one"
        ? workspace("/one", "One")
        : workspace("/two", "Two"),
    );
    nativeMocks.readDocument
      .mockResolvedValueOnce(noteSnapshot("workspace one", "a"))
      .mockResolvedValueOnce(noteSnapshot("workspace two", "c"));
    nativeMocks.writeDocument.mockReturnValue(pendingSave.promise);
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });
    await act(async () => {
      await result.result.current.openDocument("note.md");
    });
    act(() => result.result.current.changeDocument("note.md", "changed one"));

    let savePromise!: Promise<boolean>;
    act(() => {
      savePromise = result.result.current.saveDocument("note.md");
      result.result.current.closeDocument("note.md");
    });
    expect(result.result.current.state.documents).toEqual({});
    await act(async () => {
      await result.result.current.openRecentWorkspace("/two");
    });
    expect(result.result.current.state.documents).toEqual({});
    await act(async () => {
      await result.result.current.openDocument("note.md");
    });
    expect(nativeMocks.readDocument).toHaveBeenCalledTimes(2);
    await act(async () => {
      pendingSave.resolve(noteSnapshot("changed one", "b"));
      await savePromise;
    });

    expect(result.result.current.state.workspace?.rootPath).toBe("/two");
    expect(result.result.current.state.documents["note.md"]?.content).toBe(
      "workspace two",
    );
  });

  it("ignores a document read that resolves after switching workspaces", async () => {
    const pendingRead = deferred<DocumentSnapshot>();
    nativeMocks.openWorkspace.mockImplementation(async (path: string) =>
      path === "/one"
        ? workspace("/one", "One")
        : workspace("/two", "Two"),
    );
    nativeMocks.readDocument.mockReturnValue(pendingRead.promise);
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });

    let readPromise!: Promise<boolean>;
    act(() => {
      readPromise = result.result.current.openDocument("note.md");
    });
    await act(async () => {
      await result.result.current.openRecentWorkspace("/two");
    });
    await act(async () => {
      pendingRead.resolve(noteSnapshot("stale", "a"));
      await readPromise;
    });

    expect(result.result.current.state.workspace?.rootPath).toBe("/two");
    expect(result.result.current.state.documents).toEqual({});
  });

  it("ignores a stale refresh after a newly created document", async () => {
    const pendingRefresh = deferred<WorkspaceTree>();
    let oneLoads = 0;
    nativeMocks.openWorkspace.mockImplementation((path: string) => {
      if (path === "/two") return Promise.resolve(workspace("/two", "Two"));
      oneLoads += 1;
      return oneLoads === 1
        ? Promise.resolve(workspace("/one", "One"))
        : pendingRefresh.promise;
    });
    nativeMocks.chooseSavePath.mockResolvedValue("/one/note.md");
    nativeMocks.saveDocumentAs.mockResolvedValue(noteSnapshot("# Untitled\n\n", "d"));
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });

    let createPromise!: Promise<boolean>;
    act(() => {
      createPromise = result.result.current.newDocument();
    });
    await waitFor(() => expect(nativeMocks.openWorkspace).toHaveBeenCalledTimes(2));
    await act(async () => {
      await result.result.current.openRecentWorkspace("/two");
    });
    await act(async () => {
      pendingRefresh.resolve(workspace("/one", "Stale One"));
      await createPromise;
    });

    expect(result.result.current.state.workspace).toEqual(
      workspace("/two", "Two"),
    );
  });

  it("passes the inspected destination revision when replacing via Save As", async () => {
    const source = noteSnapshot("source", "a");
    const destinationRevision = {
      modifiedAtMs: 9,
      sizeBytes: 8,
      contentSha256: "b".repeat(64),
    };
    const savedCopy = {
      ...source,
      relativePath: "copy.md",
      name: "copy.md",
      revision: { ...destinationRevision, contentSha256: "c".repeat(64) },
    };
    nativeMocks.openWorkspace.mockResolvedValue(workspace("/one", "One"));
    nativeMocks.readDocument.mockResolvedValue(source);
    nativeMocks.chooseSavePath.mockResolvedValue("/one/copy.md");
    nativeMocks.inspectSaveDestination.mockResolvedValue({
      relativePath: "copy.md",
      revision: destinationRevision,
    });
    nativeMocks.saveDocumentAs.mockResolvedValue(savedCopy);
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });
    await act(async () => {
      await result.result.current.openDocument("note.md");
    });

    await act(async () => {
      await result.result.current.saveDocumentAs("note.md");
    });

    expect(nativeMocks.saveDocumentAs).toHaveBeenCalledWith(
      "/one",
      "/one/copy.md",
      "source",
      destinationRevision,
    );
    expect(result.result.current.state.documents["note.md"]).toBeUndefined();
    expect(result.result.current.state.documents["copy.md"]?.content).toBe(
      "source",
    );
  });

  it("keeps both drafts when the Save As destination opens during the write", async () => {
    const pendingSaveAs = deferred<DocumentSnapshot>();
    const source = noteSnapshot("source draft", "a");
    const target = {
      ...noteSnapshot("target on disk", "b"),
      relativePath: "target.md",
      name: "target.md",
    };
    nativeMocks.openWorkspace.mockResolvedValue(workspace("/one", "One"));
    nativeMocks.readDocument
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(target);
    nativeMocks.chooseSavePath.mockResolvedValue("/one/target.md");
    nativeMocks.inspectSaveDestination.mockResolvedValue({
      relativePath: "target.md",
      revision: target.revision,
    });
    nativeMocks.saveDocumentAs.mockReturnValue(pendingSaveAs.promise);
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });
    await act(async () => {
      await result.result.current.openDocument("note.md");
    });

    let savePromise!: Promise<boolean>;
    act(() => {
      savePromise = result.result.current.saveDocumentAs("note.md");
    });
    await waitFor(() => expect(nativeMocks.saveDocumentAs).toHaveBeenCalledOnce());
    await act(async () => {
      await result.result.current.openDocument("target.md");
    });
    act(() =>
      result.result.current.changeDocument("target.md", "unsaved target draft"),
    );
    await act(async () => {
      pendingSaveAs.resolve({
        ...target,
        content: "source draft",
        revision: { ...target.revision, contentSha256: "d".repeat(64) },
      });
      await savePromise;
    });

    expect(result.result.current.state.documentOrder).toEqual([
      "note.md",
      "target.md",
    ]);
    expect(result.result.current.state.documents["note.md"]?.content).toBe(
      "source draft",
    );
    expect(result.result.current.state.documents["target.md"]?.content).toBe(
      "unsaved target draft",
    );
    expect(result.result.current.status.message).toContain("both drafts were kept");
  });
});

describe("useWorkspaceController entry lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    for (const mock of Object.values(nativeMocks)) mock.mockReset();
    nativeMocks.openWorkspace.mockResolvedValue(workspace("/one", "One"));
  });

  it("creates an exact Markdown name, opens it, and returns its path", async () => {
    const created = {
      ...noteSnapshot("", "c"),
      relativePath: "drafts/Read Me.markdown",
      name: "Read Me.markdown",
    };
    nativeMocks.createDocument.mockResolvedValue(created);
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });

    let creation!: Awaited<
      ReturnType<typeof result.result.current.createMarkdown>
    >;
    await act(async () => {
      creation = await result.result.current.createMarkdown(
        "drafts",
        "Read Me.markdown",
        "",
      );
    });

    expect(nativeMocks.createDocument).toHaveBeenCalledWith(
      "/one",
      "drafts/Read Me.markdown",
      "",
    );
    expect(creation).toMatchObject({
      succeeded: true,
      applied: true,
      treeRefreshed: true,
      snapshot: { relativePath: "drafts/Read Me.markdown" },
    });
    expect(result.result.current.state.activeDocumentId).toBe(
      "drafts/Read Me.markdown",
    );
  });

  it("preserves dirty drafts during rename and derives current revisions", async () => {
    const nested = {
      ...noteSnapshot("saved", "a"),
      relativePath: "notes/nested.md",
      name: "nested.md",
    };
    nativeMocks.readDocument.mockResolvedValue(nested);
    nativeMocks.renameWorkspaceEntry.mockResolvedValue({
      kind: "directory",
      sourceRelativePath: "notes",
      destinationRelativePath: "archive",
      recoverable: false,
    });
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });
    await act(async () => {
      await result.result.current.openDocument("notes/nested.md");
    });
    act(() => {
      result.result.current.changeDocument("notes/nested.md", "dirty draft");
    });

    expect(result.result.current.inspectEntryImpact("notes")).toEqual({
      affectedDocumentIds: ["notes/nested.md"],
      affectedDirtyDocumentIds: ["notes/nested.md"],
    });
    let mutation!: Awaited<ReturnType<typeof result.result.current.renameEntry>>;
    await act(async () => {
      mutation = await result.result.current.renameEntry("notes", "archive");
    });

    expect(nativeMocks.renameWorkspaceEntry).toHaveBeenCalledWith(
      "/one",
      "notes",
      "archive",
      [{ relativePath: "notes/nested.md", revision: nested.revision }],
    );
    expect(mutation).toMatchObject({
      succeeded: true,
      applied: true,
      affectedDirtyDocumentIds: ["notes/nested.md"],
      mutation: { destinationRelativePath: "archive" },
    });
    expect(result.result.current.state.documents["notes/nested.md"]).toBeUndefined();
    expect(
      result.result.current.state.documents["archive/nested.md"],
    ).toMatchObject({ content: "dirty draft", savedContent: "saved" });
  });

  it("returns a stable error and leaves state intact when a mutation fails", async () => {
    const source = noteSnapshot("saved", "a");
    nativeMocks.readDocument.mockResolvedValue(source);
    nativeMocks.renameWorkspaceEntry.mockRejectedValue(
      new Error("rename failed safely"),
    );
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });
    await act(async () => {
      await result.result.current.openDocument("note.md");
    });

    let mutation!: Awaited<ReturnType<typeof result.result.current.renameEntry>>;
    await act(async () => {
      mutation = await result.result.current.renameEntry("note.md", "next.md");
    });

    expect(mutation).toMatchObject({
      succeeded: false,
      applied: false,
      treeRefreshed: false,
      error: "rename failed safely",
    });
    expect(result.result.current.state.documents["note.md"]).toBeDefined();
    expect(result.result.current.status).toEqual({
      message: "rename failed safely",
      tone: "error",
    });
  });

  it("blocks an open-document destination collision before native rename", async () => {
    const source = {
      ...noteSnapshot("source", "a"),
      relativePath: "notes/note.md",
      name: "note.md",
    };
    const destination = {
      ...noteSnapshot("protected", "b"),
      relativePath: "archive/note.md",
      name: "note.md",
    };
    nativeMocks.readDocument
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(destination);
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });
    await act(async () => {
      await result.result.current.openDocument(source.relativePath);
    });
    await act(async () => {
      await result.result.current.openDocument(destination.relativePath);
    });
    act(() =>
      result.result.current.changeDocument(
        destination.relativePath,
        "protected dirty draft",
      ),
    );

    let mutation!: Awaited<ReturnType<typeof result.result.current.renameEntry>>;
    await act(async () => {
      mutation = await result.result.current.renameEntry("notes", "archive");
    });

    expect(mutation).toMatchObject({
      succeeded: false,
      applied: false,
      error: "Close the destination tab before replacing that document.",
    });
    expect(nativeMocks.renameWorkspaceEntry).not.toHaveBeenCalled();
    expect(
      result.result.current.state.documents[destination.relativePath]?.content,
    ).toBe("protected dirty draft");
  });

  it("keeps an authoritative mutation successful when its tree refresh fails", async () => {
    nativeMocks.openWorkspace
      .mockResolvedValueOnce(workspace("/one", "One"))
      .mockRejectedValueOnce(new Error("refresh failed after create"));
    nativeMocks.createWorkspaceDirectory.mockResolvedValue({
      kind: "directory",
      destinationRelativePath: "drafts",
      recoverable: false,
    });
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });

    let mutation!: Awaited<
      ReturnType<typeof result.result.current.createDirectory>
    >;
    await act(async () => {
      mutation = await result.result.current.createDirectory("", "drafts");
    });

    expect(mutation).toMatchObject({
      succeeded: true,
      applied: true,
      treeRefreshed: false,
      refreshError: "refresh failed after create",
      mutation: { destinationRelativePath: "drafts" },
    });
    expect(mutation.error).toBeUndefined();
    expect(result.result.current.status.tone).toBe("success");
  });

  it("does not apply a completed mutation to a newer workspace generation", async () => {
    const pendingRename = deferred<{
      kind: "file";
      sourceRelativePath: string;
      destinationRelativePath: string;
      recoverable: boolean;
    }>();
    nativeMocks.openWorkspace.mockImplementation(async (path: string) =>
      path === "/one"
        ? workspace("/one", "One")
        : workspace("/two", "Two"),
    );
    nativeMocks.readDocument.mockResolvedValue(noteSnapshot("saved", "a"));
    nativeMocks.renameWorkspaceEntry.mockReturnValue(pendingRename.promise);
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });
    await act(async () => {
      await result.result.current.openDocument("note.md");
    });

    let renamePromise!: ReturnType<typeof result.result.current.renameEntry>;
    act(() => {
      renamePromise = result.result.current.renameEntry("note.md", "next.md");
    });
    await waitFor(() =>
      expect(nativeMocks.renameWorkspaceEntry).toHaveBeenCalledOnce(),
    );
    await act(async () => {
      await result.result.current.openRecentWorkspace("/two");
    });
    let mutation!: Awaited<typeof renamePromise>;
    await act(async () => {
      pendingRename.resolve({
        kind: "file",
        sourceRelativePath: "note.md",
        destinationRelativePath: "next.md",
        recoverable: false,
      });
      mutation = await renamePromise;
    });

    expect(mutation).toMatchObject({ succeeded: true, applied: false });
    expect(result.result.current.state.workspace?.rootPath).toBe("/two");
    expect(result.result.current.state.documents).toEqual({});
  });

  it("serializes save before rename and uses the saved revision", async () => {
    const original = noteSnapshot("original", "a");
    const saved = noteSnapshot("changed", "b");
    const pendingSave = deferred<DocumentSnapshot>();
    nativeMocks.readDocument.mockResolvedValue(original);
    nativeMocks.writeDocument.mockReturnValue(pendingSave.promise);
    nativeMocks.renameWorkspaceEntry.mockResolvedValue({
      kind: "file",
      sourceRelativePath: "note.md",
      destinationRelativePath: "renamed.md",
      recoverable: false,
    });
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });
    await act(async () => {
      await result.result.current.openDocument("note.md");
    });
    act(() => result.result.current.changeDocument("note.md", "changed"));

    let savePromise!: Promise<boolean>;
    let renamePromise!: ReturnType<typeof result.result.current.renameEntry>;
    act(() => {
      savePromise = result.result.current.saveDocument("note.md");
      renamePromise = result.result.current.renameEntry("note.md", "renamed.md");
    });
    await waitFor(() => expect(nativeMocks.writeDocument).toHaveBeenCalledOnce());
    expect(nativeMocks.renameWorkspaceEntry).not.toHaveBeenCalled();
    await act(async () => {
      pendingSave.resolve(saved);
      expect(await savePromise).toBe(true);
      await renamePromise;
    });

    expect(nativeMocks.renameWorkspaceEntry).toHaveBeenCalledWith(
      "/one",
      "note.md",
      "renamed.md",
      [{ relativePath: "note.md", revision: saved.revision }],
    );
    expect(result.result.current.state.documents["renamed.md"]).toBeDefined();
  });

  it("invalidates an old-path save queued behind a rename", async () => {
    const pendingRename = deferred<{
      kind: "file";
      sourceRelativePath: string;
      destinationRelativePath: string;
      recoverable: boolean;
    }>();
    nativeMocks.readDocument.mockResolvedValue(noteSnapshot("saved", "a"));
    nativeMocks.renameWorkspaceEntry.mockReturnValue(pendingRename.promise);
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });
    await act(async () => {
      await result.result.current.openDocument("note.md");
    });
    act(() => result.result.current.changeDocument("note.md", "dirty"));

    let renamePromise!: ReturnType<typeof result.result.current.renameEntry>;
    let savePromise!: Promise<boolean>;
    act(() => {
      renamePromise = result.result.current.renameEntry("note.md", "next.md");
      savePromise = result.result.current.saveDocument("note.md");
    });
    await waitFor(() =>
      expect(nativeMocks.renameWorkspaceEntry).toHaveBeenCalledOnce(),
    );
    expect(nativeMocks.writeDocument).not.toHaveBeenCalled();
    await act(async () => {
      pendingRename.resolve({
        kind: "file",
        sourceRelativePath: "note.md",
        destinationRelativePath: "next.md",
        recoverable: false,
      });
      await renamePromise;
      expect(await savePromise).toBe(false);
    });

    expect(nativeMocks.writeDocument).not.toHaveBeenCalled();
    expect(result.result.current.state.documents["next.md"]?.content).toBe(
      "dirty",
    );
  });

  it("reports local-history warning status for a successful entry mutation", async () => {
    nativeMocks.duplicateWorkspaceEntry.mockResolvedValue({
      kind: "image",
      sourceRelativePath: "image.png",
      destinationRelativePath: "image copy.png",
      recoverable: false,
      historyWarningCode: "HISTORY_UNAVAILABLE",
    });
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });

    let mutation!: Awaited<
      ReturnType<typeof result.result.current.duplicateEntry>
    >;
    await act(async () => {
      mutation = await result.result.current.duplicateEntry("image.png");
    });

    expect(mutation.succeeded).toBe(true);
    expect(result.result.current.status).toEqual({
      message: "Saved locally · local history unavailable",
      tone: "neutral",
    });
  });

  it("removes trashed dirty documents only after the explicit trash call", async () => {
    const nested = {
      ...noteSnapshot("saved", "a"),
      relativePath: "notes/nested.md",
      name: "nested.md",
    };
    nativeMocks.readDocument.mockResolvedValue(nested);
    const pendingTrash = deferred<{
      kind: "directory";
      sourceRelativePath: string;
      recoverable: boolean;
    }>();
    nativeMocks.trashWorkspaceEntry.mockReturnValue(pendingTrash.promise);
    const result = renderHook(() => useWorkspaceController());
    await act(async () => {
      await result.result.current.openRecentWorkspace("/one");
    });
    await act(async () => {
      await result.result.current.openDocument("notes/nested.md");
    });
    act(() =>
      result.result.current.changeDocument("notes/nested.md", "dirty draft"),
    );

    expect(result.result.current.inspectEntryImpact("notes")).toEqual({
      affectedDocumentIds: ["notes/nested.md"],
      affectedDirtyDocumentIds: ["notes/nested.md"],
    });
    expect(nativeMocks.trashWorkspaceEntry).not.toHaveBeenCalled();
    let trashPromise!: ReturnType<typeof result.result.current.trashEntry>;
    let savePromise!: Promise<boolean>;
    act(() => {
      trashPromise = result.result.current.trashEntry("notes");
      savePromise = result.result.current.saveDocument("notes/nested.md");
    });
    await waitFor(() =>
      expect(nativeMocks.trashWorkspaceEntry).toHaveBeenCalledOnce(),
    );
    expect(nativeMocks.writeDocument).not.toHaveBeenCalled();
    expect(nativeMocks.trashWorkspaceEntry).toHaveBeenCalledWith("/one", "notes", [
      { relativePath: "notes/nested.md", revision: nested.revision },
    ]);
    let mutation!: Awaited<typeof trashPromise>;
    await act(async () => {
      pendingTrash.resolve({
        kind: "directory",
        sourceRelativePath: "notes",
        recoverable: true,
      });
      mutation = await trashPromise;
      expect(await savePromise).toBe(false);
    });
    expect(mutation.affectedDirtyDocumentIds).toEqual(["notes/nested.md"]);
    expect(result.result.current.state.documents).toEqual({});
    expect(nativeMocks.writeDocument).not.toHaveBeenCalled();
  });
});
