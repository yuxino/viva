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
  revision: { modifiedAtMs: 1, sizeBytes: 3, contentSha256: "a".repeat(64) },
};

const second: DocumentSnapshot = {
  relativePath: "two.md",
  name: "two.md",
  content: "two",
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

  it("remaps an entry and its open dirty drafts with path-segment boundaries", () => {
    const nested = {
      ...first,
      relativePath: "notes/drafts/one.md",
      name: "one.md",
    };
    const similarlyNamed = {
      ...second,
      relativePath: "notes-old/two.md",
      name: "two.md",
    };
    let state = workspaceReducer(initialWorkspaceState, {
      type: "document/opened",
      snapshot: nested,
    });
    state = workspaceReducer(state, {
      type: "document/changed",
      id: nested.relativePath,
      content: "unsaved nested draft",
    });
    state = workspaceReducer(state, {
      type: "document/opened",
      snapshot: similarlyNamed,
    });
    state = {
      ...state,
      expandedPaths: ["notes", "notes/drafts", "notes-old"],
    };

    const renamed = workspaceReducer(state, {
      type: "entry/renamed",
      sourcePath: "notes",
      destinationPath: "archive",
    });

    expect(renamed.documentOrder).toEqual([
      "archive/drafts/one.md",
      "notes-old/two.md",
    ]);
    expect(renamed.activeDocumentId).toBe("notes-old/two.md");
    expect(renamed.documents["archive/drafts/one.md"]).toMatchObject({
      content: "unsaved nested draft",
      savedContent: "one",
      relativePath: "archive/drafts/one.md",
      name: "one.md",
    });
    expect(renamed.documents["notes-old/two.md"]).toBe(
      state.documents["notes-old/two.md"],
    );
    expect(renamed.expandedPaths).toEqual([
      "archive",
      "archive/drafts",
      "notes-old",
    ]);
  });

  it("keeps every draft unchanged when an entry rename destination collides", () => {
    const source = {
      ...first,
      relativePath: "notes/one.md",
      name: "one.md",
    };
    const destination = {
      ...second,
      relativePath: "archive/one.md",
      name: "one.md",
    };
    let state = workspaceReducer(initialWorkspaceState, {
      type: "document/opened",
      snapshot: source,
    });
    state = workspaceReducer(state, {
      type: "document/opened",
      snapshot: destination,
    });
    state = workspaceReducer(state, {
      type: "document/changed",
      id: destination.relativePath,
      content: "protected destination draft",
    });

    const protectedState = workspaceReducer(state, {
      type: "entry/renamed",
      sourcePath: "notes",
      destinationPath: "archive",
    });

    expect(protectedState).toBe(state);
    expect(protectedState.documents["archive/one.md"]?.content).toBe(
      "protected destination draft",
    );
  });

  it("removes trashed descendants and selects the adjacent surviving tab", () => {
    const before = {
      ...first,
      relativePath: "before.md",
      name: "before.md",
    };
    const nested = {
      ...second,
      relativePath: "notes/two.md",
      name: "two.md",
    };
    const similarlyNamed = {
      ...first,
      relativePath: "notes-old/one.md",
      name: "one.md",
    };
    let state = workspaceReducer(initialWorkspaceState, {
      type: "document/opened",
      snapshot: before,
    });
    state = workspaceReducer(state, {
      type: "document/opened",
      snapshot: nested,
    });
    state = workspaceReducer(state, {
      type: "document/opened",
      snapshot: similarlyNamed,
    });
    state = workspaceReducer(state, {
      type: "document/activated",
      id: nested.relativePath,
    });
    state = {
      ...state,
      expandedPaths: ["notes", "notes/subfolder", "notes-old"],
    };

    const trashed = workspaceReducer(state, {
      type: "entry/trashed",
      path: "notes",
    });

    expect(trashed.documentOrder).toEqual(["before.md", "notes-old/one.md"]);
    expect(trashed.activeDocumentId).toBe("notes-old/one.md");
    expect(trashed.documents["notes/two.md"]).toBeUndefined();
    expect(trashed.documents["notes-old/one.md"]).toBeDefined();
    expect(trashed.expandedPaths).toEqual(["notes-old"]);
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
