import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentSnapshot, WorkspaceTree } from "../domain/workspace";
import { useWorkspaceController } from "./useWorkspaceController";

const native = vi.hoisted(() => ({
  chooseSavePath: vi.fn(),
  inspectSaveDestination: vi.fn(),
  hasNativeShell: vi.fn(),
  isFreshWindow: vi.fn(),
  openWorkspace: vi.fn(),
  readDocument: vi.fn(),
  saveDocumentAs: vi.fn(),
  writeDocument: vi.fn(),
}));

vi.mock("../lib/native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/native")>()),
  ...native,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function snapshot(content: string): DocumentSnapshot {
  return {
    content,
    relativePath: "note.md",
    name: "note.md",
    lineEnding: "lf",
    revision: {
      modifiedAtMs: content.length,
      sizeBytes: content.length,
      contentSha256: content.padEnd(64, "0"),
    },
  };
}

const workspace: WorkspaceTree = { rootPath: "/one", name: "One", children: [] };

async function openNote() {
  const hook = renderHook(() => useWorkspaceController());
  await act(async () => {
    await hook.result.current.openRecentWorkspace("/one");
  });
  await act(async () => {
    await hook.result.current.openDocument("note.md");
  });
  return hook;
}

beforeEach(() => {
  localStorage.clear();
  for (const mock of Object.values(native)) mock.mockReset();
  native.hasNativeShell.mockReturnValue(false);
  native.isFreshWindow.mockResolvedValue(false);
  native.openWorkspace.mockResolvedValue(workspace);
  native.readDocument.mockResolvedValue(snapshot("original"));
  native.writeDocument.mockImplementation(async (_root, document) =>
    snapshot(document.content),
  );
  native.chooseSavePath.mockResolvedValue("/one/copy.md");
  native.inspectSaveDestination.mockResolvedValue({ relativePath: "copy.md" });
});

describe("document operation races", () => {
  it("preserves edits made while another workspace is still opening", async () => {
    const hook = await openNote();
    const scan = deferred<WorkspaceTree>();
    native.openWorkspace.mockReturnValueOnce(scan.promise);
    let opening!: Promise<boolean>;
    act(() => {
      opening = hook.result.current.openRecentWorkspace("/two");
    });
    act(() => hook.result.current.changeDocument("note.md", "new draft"));

    await act(async () => {
      scan.resolve({ rootPath: "/two", name: "Two", children: [] });
      expect(await opening).toBe(false);
    });

    expect(hook.result.current.state.workspace).toEqual(workspace);
    expect(hook.result.current.currentDocument?.content).toBe("new draft");
    expect(hook.result.current.dirty).toBe(true);
    expect(hook.result.current.busy).toBe(false);
  });

  it("checks edits from the same event before switching workspaces", async () => {
    const hook = await openNote();
    await act(async () => {
      hook.result.current.changeDocument("note.md", "new draft");
      expect(await hook.result.current.openRecentWorkspace("/two")).toBe(false);
    });
    expect(native.openWorkspace).toHaveBeenCalledTimes(1);
    expect(hook.result.current.currentDocument?.content).toBe("new draft");
  });

  it("saves the edit just dispatched before React commits a render", async () => {
    const hook = await openNote();
    await act(async () => {
      hook.result.current.changeDocument("note.md", "latest draft");
      expect(await hook.result.current.saveDocument("note.md")).toBe(true);
    });
    expect(native.writeDocument).toHaveBeenCalledWith(
      "/one",
      expect.objectContaining({ content: "latest draft" }),
    );
    expect(hook.result.current.dirty).toBe(false);
  });

  it("keeps an undo protected while an older save can still replace the file", async () => {
    const hook = await openNote();
    const save = deferred<DocumentSnapshot>();
    native.writeDocument.mockReturnValueOnce(save.promise);
    act(() => hook.result.current.changeDocument("note.md", "older save"));
    let saving!: Promise<boolean>;
    act(() => {
      saving = hook.result.current.saveDocument("note.md");
    });
    await waitFor(() => expect(native.writeDocument).toHaveBeenCalledOnce());
    act(() => hook.result.current.changeDocument("note.md", "original"));
    expect(hook.result.current.dirty).toBe(true);
    await act(async () => {
      expect(await hook.result.current.openRecentWorkspace("/two")).toBe(false);
    });
    expect(native.openWorkspace).toHaveBeenCalledTimes(1);
    let saveAgain!: Promise<boolean>;
    act(() => {
      saveAgain = hook.result.current.saveDocument("note.md");
    });
    await act(async () => {
      save.resolve(snapshot("older save"));
      expect(await saving).toBe(false);
      expect(await saveAgain).toBe(false);
    });
    expect(hook.result.current.currentDocument).toMatchObject({
      content: "original",
      savedContent: "older save",
    });
    await act(async () => {
      expect(await hook.result.current.saveDocument("note.md")).toBe(true);
    });
    expect(hook.result.current.dirty).toBe(false);
  });

  it("releases undo protection when the pending save fails without changing disk", async () => {
    const hook = await openNote();
    const save = deferred<DocumentSnapshot>();
    native.writeDocument.mockReturnValueOnce(save.promise);
    act(() => hook.result.current.changeDocument("note.md", "older save"));
    let saving!: Promise<boolean>;
    act(() => {
      saving = hook.result.current.saveDocument("note.md");
    });
    await waitFor(() => expect(native.writeDocument).toHaveBeenCalledOnce());
    act(() => hook.result.current.changeDocument("note.md", "original"));
    expect(hook.result.current.dirty).toBe(true);
    await act(async () => {
      save.reject(new Error("write failed"));
      expect(await saving).toBe(false);
    });
    expect(hook.result.current.dirty).toBe(false);
    expect(hook.result.current.currentDocument?.savedContent).toBe("original");
  });

  it("ignores an older tree scan after a newer refresh completes", async () => {
    const hook = await openNote();
    const oldScan = deferred<WorkspaceTree>();
    const latest = {
      ...workspace,
      children: [{
        name: "new.md", relativePath: "new.md", kind: "file" as const, children: [],
      }],
    };
    native.openWorkspace
      .mockReturnValueOnce(oldScan.promise)
      .mockResolvedValueOnce(latest);
    let oldRefresh!: Promise<boolean>;
    act(() => {
      oldRefresh = hook.result.current.refreshCurrentWorkspace();
    });
    await act(async () => {
      expect(await hook.result.current.refreshCurrentWorkspace()).toBe(true);
    });
    await act(async () => {
      oldScan.resolve(workspace);
      expect(await oldRefresh).toBe(false);
    });
    expect(hook.result.current.state.workspace).toEqual(latest);
  });

  it("does not invalidate a save when a duplicate document read finishes", async () => {
    const firstRead = deferred<DocumentSnapshot>();
    const duplicateRead = deferred<DocumentSnapshot>();
    const save = deferred<DocumentSnapshot>();
    native.readDocument
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(duplicateRead.promise);
    native.writeDocument.mockReturnValueOnce(save.promise);
    const hook = renderHook(() => useWorkspaceController());
    await act(async () => {
      await hook.result.current.openRecentWorkspace("/one");
    });
    let firstOpen!: Promise<boolean>;
    let secondOpen!: Promise<boolean>;
    act(() => {
      firstOpen = hook.result.current.openDocument("note.md");
      secondOpen = hook.result.current.openDocument("note.md");
    });
    await act(async () => {
      firstRead.resolve(snapshot("original"));
      await firstOpen;
    });
    act(() => hook.result.current.changeDocument("note.md", "latest draft"));
    let saving!: Promise<boolean>;
    act(() => {
      saving = hook.result.current.saveDocument("note.md");
    });
    await waitFor(() => expect(native.writeDocument).toHaveBeenCalledOnce());
    await act(async () => {
      duplicateRead.resolve(snapshot("original"));
      await secondOpen;
    });
    await act(async () => {
      save.resolve(snapshot("latest draft"));
      expect(await saving).toBe(true);
    });
    expect(hook.result.current.currentDocument?.savedContent).toBe("latest draft");
    expect(hook.result.current.dirty).toBe(false);
  });

  it("does not reopen a closed tab when a duplicate read returns", async () => {
    const firstRead = deferred<DocumentSnapshot>();
    const duplicateRead = deferred<DocumentSnapshot>();
    native.readDocument
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(duplicateRead.promise);
    const hook = renderHook(() => useWorkspaceController());
    await act(async () => {
      await hook.result.current.openRecentWorkspace("/one");
    });
    let firstOpen!: Promise<boolean>;
    let secondOpen!: Promise<boolean>;
    act(() => {
      firstOpen = hook.result.current.openDocument("note.md");
      secondOpen = hook.result.current.openDocument("note.md");
    });
    await act(async () => {
      firstRead.resolve(snapshot("original"));
      await firstOpen;
    });
    act(() => hook.result.current.closeDocument("note.md"));
    await act(async () => {
      duplicateRead.resolve(snapshot("original"));
      expect(await secondOpen).toBe(false);
    });
    expect(hook.result.current.state.documentOrder).toEqual([]);
  });

  it("does not invalidate a save when session restoration finishes a duplicate read", async () => {
    native.hasNativeShell.mockReturnValue(true);
    localStorage.setItem("viva.session.v2", JSON.stringify({
      lastWorkspacePath: "/one",
      openDocuments: ["note.md"],
      activeDocumentPath: "note.md",
      recentWorkspaces: [],
      viewMode: "edit",
      sidebarVisible: true,
    }));
    const restore = deferred<DocumentSnapshot>();
    const save = deferred<DocumentSnapshot>();
    native.readDocument
      .mockReturnValueOnce(restore.promise)
      .mockResolvedValueOnce(snapshot("original"));
    native.writeDocument.mockReturnValueOnce(save.promise);
    const hook = renderHook(() => useWorkspaceController());
    await waitFor(() => expect(native.readDocument).toHaveBeenCalledOnce());
    await act(async () => {
      await hook.result.current.openDocument("note.md");
    });
    act(() => hook.result.current.changeDocument("note.md", "latest draft"));
    let saving!: Promise<boolean>;
    act(() => {
      saving = hook.result.current.saveDocument("note.md");
    });
    await waitFor(() => expect(native.writeDocument).toHaveBeenCalledOnce());
    await act(async () => {
      restore.resolve(snapshot("original"));
    });
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    await act(async () => {
      save.resolve(snapshot("latest draft"));
      expect(await saving).toBe(true);
    });
    expect(hook.result.current.currentDocument?.savedContent).toBe("latest draft");
  });

  it.each(["write", "refresh"])("keeps newer Save As edits visibly unsaved during %s", async (stage) => {
    const hook = await openNote();
    const save = deferred<DocumentSnapshot>();
    const refresh = deferred<WorkspaceTree>();
    const copy = { ...snapshot("original"), name: "copy.md", relativePath: "copy.md" };
    native.saveDocumentAs.mockReturnValueOnce(save.promise);
    if (stage === "refresh") {
      native.openWorkspace.mockReturnValueOnce(refresh.promise);
    }
    let saving!: Promise<boolean>;
    act(() => {
      saving = hook.result.current.saveDocumentAs("note.md");
    });
    await waitFor(() => expect(native.saveDocumentAs).toHaveBeenCalledOnce());
    if (stage === "refresh") {
      await act(async () => {
        save.resolve(copy);
      });
      await waitFor(() => expect(native.openWorkspace).toHaveBeenCalledTimes(2));
    }
    act(() => hook.result.current.changeDocument(
      stage === "write" ? "note.md" : "copy.md", "new draft", "crlf",
    ));
    await act(async () => {
      save.resolve(copy);
      refresh.resolve(workspace);
      expect(await saving).toBe(false);
    });
    expect(hook.result.current.currentDocument).toMatchObject({
      content: "new draft",
      savedContent: "original",
      lineEnding: "crlf",
      savedLineEnding: "lf",
    });
    expect(hook.result.current.status.message).toBe("New changes are not saved");
  });
});
