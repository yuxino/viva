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
  inspectSaveDestination: vi.fn(),
  openWorkspace: vi.fn(),
  readDocument: vi.fn(),
  saveDocumentAs: vi.fn(),
  searchWorkspace: vi.fn(),
  writeDocument: vi.fn(),
}));

vi.mock("../lib/native", () => ({
  chooseSavePath: nativeMocks.chooseSavePath,
  chooseWorkspace: vi.fn(),
  describeNativeError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  hasNativeShell: () => false,
  inspectSaveDestination: nativeMocks.inspectSaveDestination,
  openWorkspace: nativeMocks.openWorkspace,
  readDocument: nativeMocks.readDocument,
  saveDocumentAs: nativeMocks.saveDocumentAs,
  searchWorkspace: nativeMocks.searchWorkspace,
  writeDocument: nativeMocks.writeDocument,
}));

const noteSnapshot = (
  content: string,
  hashCharacter: string,
): DocumentSnapshot => ({
  relativePath: "note.md",
  name: "note.md",
  content,
  lineEnding: "lf",
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
      lineEnding: "lf",
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

  it("keeps a newer line-ending choice dirty when an earlier save finishes", async () => {
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
    });
    act(() => {
      result.result.current.changeDocument("note.md", "changed", "crlf");
    });

    let didSave = true;
    await act(async () => {
      pendingSave.resolve(noteSnapshot("changed", "b"));
      didSave = await savePromise;
    });

    expect(didSave).toBe(false);
    expect(result.result.current.currentDocument?.lineEnding).toBe("crlf");
    expect(result.result.current.currentDocument?.savedLineEnding).toBe("lf");
    expect(result.result.current.dirty).toBe(true);
    expect(result.result.current.status.message).toBe("New changes are not saved");
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
    const source = {
      ...noteSnapshot("source", "a"),
      lineEnding: "crlf" as const,
    };
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
      "crlf",
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
