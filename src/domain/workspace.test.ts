import { describe, expect, it } from "vitest";
import {
  activeDocument,
  flattenFiles,
  initialWorkspaceState,
  isDocumentDirty,
  workspaceReducer,
  type DocumentSnapshot,
  type WorkspaceTree,
} from "./workspace";

const workspace: WorkspaceTree = {
  rootPath: "/notes",
  name: "Notes",
  children: [],
};

const first: DocumentSnapshot = {
  relativePath: "one.md",
  name: "one.md",
  content: "one",
  lineEnding: "lf",
  revision: { modifiedAtMs: 1, sizeBytes: 3, contentSha256: "a".repeat(64) },
};

const second: DocumentSnapshot = {
  relativePath: "two.md",
  name: "two.md",
  content: "two",
  lineEnding: "lf",
  revision: { modifiedAtMs: 2, sizeBytes: 3, contentSha256: "b".repeat(64) },
};

describe("workspaceReducer", () => {
  it("keeps independent contents across real tabs", () => {
    let state = workspaceReducer(initialWorkspaceState, {
      type: "workspace/opened",
      workspace,
    });
    state = workspaceReducer(state, { type: "document/opened", snapshot: first });
    state = workspaceReducer(state, {
      type: "document/changed",
      id: "one.md",
      content: "changed",
    });
    state = workspaceReducer(state, { type: "document/opened", snapshot: second });
    state = workspaceReducer(state, { type: "document/activated", id: "one.md" });

    expect(activeDocument(state)?.content).toBe("changed");
    expect(isDocumentDirty(activeDocument(state) ?? undefined)).toBe(true);
    expect(state.documentOrder).toEqual(["one.md", "two.md"]);
  });

  it("moves a tab to the saved-as path and clears dirty state", () => {
    let state = workspaceReducer(initialWorkspaceState, {
      type: "document/opened",
      snapshot: first,
    });
    state = workspaceReducer(state, {
      type: "document/changed",
      id: "one.md",
      content: "new copy",
    });
    state = workspaceReducer(state, {
      type: "document/saved",
      previousId: "one.md",
      snapshot: {
        ...first,
        relativePath: "copy.md",
        name: "copy.md",
        content: "new copy",
      },
    });

    expect(state.activeDocumentId).toBe("copy.md");
    expect(state.documents["one.md"]).toBeUndefined();
    expect(isDocumentDirty(state.documents["copy.md"])).toBe(false);
  });

  it("does not mark normalized CRLF content dirty", () => {
    const crlfSnapshot: DocumentSnapshot = {
      ...first,
      content: "first\nsecond\n",
      lineEnding: "crlf",
    };
    const state = workspaceReducer(initialWorkspaceState, {
      type: "document/opened",
      snapshot: crlfSnapshot,
    });

    expect(state.documents["one.md"]?.content).toBe("first\nsecond\n");
    expect(state.documents["one.md"]?.savedContent).toBe("first\nsecond\n");
    expect(state.documents["one.md"]?.lineEnding).toBe("crlf");
    expect(isDocumentDirty(state.documents["one.md"])).toBe(false);

    const changedLineEnding = workspaceReducer(state, {
      type: "document/changed",
      id: "one.md",
      content: "first\nsecond\n",
      lineEnding: "lf",
    });
    expect(changedLineEnding.documents["one.md"]?.savedLineEnding).toBe("crlf");
    expect(isDocumentDirty(changedLineEnding.documents["one.md"])).toBe(true);

    const saved = workspaceReducer(changedLineEnding, {
      type: "document/saved",
      previousId: "one.md",
      snapshot: { ...crlfSnapshot, lineEnding: "lf" },
    });
    expect(isDocumentDirty(saved.documents["one.md"])).toBe(false);
  });

  it("selects the next available tab when the active tab closes", () => {
    let state = workspaceReducer(initialWorkspaceState, {
      type: "document/opened",
      snapshot: first,
    });
    state = workspaceReducer(state, { type: "document/opened", snapshot: second });
    state = workspaceReducer(state, { type: "document/closed", id: "two.md" });

    expect(state.activeDocumentId).toBe("one.md");
  });

  it("does not erase edits typed while an earlier save is finishing", () => {
    let state = workspaceReducer(initialWorkspaceState, {
      type: "document/opened",
      snapshot: first,
    });
    state = workspaceReducer(state, {
      type: "document/changed",
      id: "one.md",
      content: "newer than the save",
    });
    state = workspaceReducer(state, {
      type: "document/saved",
      previousId: "one.md",
      snapshot: { ...first, content: "content sent to disk" },
    });

    expect(state.documents["one.md"]?.content).toBe("newer than the save");
    expect(state.documents["one.md"]?.savedContent).toBe("content sent to disk");
    expect(isDocumentDirty(state.documents["one.md"])).toBe(true);
  });

  it("does not erase a newer line-ending choice while a save is finishing", () => {
    let state = workspaceReducer(initialWorkspaceState, {
      type: "document/opened",
      snapshot: first,
    });
    state = workspaceReducer(state, {
      type: "document/changed",
      id: "one.md",
      content: first.content,
      lineEnding: "crlf",
    });
    state = workspaceReducer(state, {
      type: "document/saved",
      previousId: "one.md",
      snapshot: first,
    });

    expect(state.documents["one.md"]?.lineEnding).toBe("crlf");
    expect(state.documents["one.md"]?.savedLineEnding).toBe("lf");
    expect(isDocumentDirty(state.documents["one.md"])).toBe(true);
  });

  it("ignores a save result after its original tab is gone", () => {
    const state = workspaceReducer(initialWorkspaceState, {
      type: "document/saved",
      previousId: "one.md",
      snapshot: first,
    });

    expect(state).toBe(initialWorkspaceState);
  });

  it("ignores a workspace refresh intended for another root", () => {
    const state = workspaceReducer(
      workspaceReducer(initialWorkspaceState, {
        type: "workspace/opened",
        workspace,
      }),
      {
        type: "workspace/refreshed",
        expectedRootPath: "/older-notes",
        workspace: { ...workspace, rootPath: "/older-notes" },
      },
    );

    expect(state.workspace).toBe(workspace);
  });

  it("never replaces an already-open destination tab during Save As", () => {
    let state = workspaceReducer(initialWorkspaceState, {
      type: "document/opened",
      snapshot: first,
    });
    state = workspaceReducer(state, { type: "document/opened", snapshot: second });
    state = workspaceReducer(state, {
      type: "document/changed",
      id: "two.md",
      content: "unsaved destination draft",
    });
    const protectedState = workspaceReducer(state, {
      type: "document/saved",
      previousId: "one.md",
      snapshot: { ...second, content: "copy written to disk" },
    });

    expect(protectedState).toBe(state);
    expect(protectedState.documentOrder).toEqual(["one.md", "two.md"]);
    expect(protectedState.documents["two.md"]?.content).toBe(
      "unsaved destination draft",
    );
  });
});

describe("flattenFiles", () => {
  it("preserves tree order while returning only files", () => {
    expect(
      flattenFiles([
        {
          name: "Folder",
          relativePath: "Folder",
          kind: "directory",
          children: [
            {
              name: "inside.md",
              relativePath: "Folder/inside.md",
              kind: "file",
              children: [],
            },
          ],
        },
        {
          name: "README.md",
          relativePath: "README.md",
          kind: "file",
          children: [],
        },
      ]).map((node) => node.relativePath),
    ).toEqual(["Folder/inside.md", "README.md"]);
  });
});
