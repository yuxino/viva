export type FileKind = "directory" | "file" | "image";

export interface FileTreeNode {
  name: string;
  relativePath: string;
  kind: FileKind;
  children: FileTreeNode[];
}

export interface WorkspaceTree {
  rootPath: string;
  name: string;
  children: FileTreeNode[];
}

export interface FileRevision {
  modifiedAtMs: number;
  sizeBytes: number;
  contentSha256: string;
}

export type LineEnding = "lf" | "crlf";

export interface DocumentSnapshot {
  relativePath: string;
  name: string;
  content: string;
  lineEnding: LineEnding;
  revision: FileRevision;
  historyWarningCode?: "HISTORY_UNAVAILABLE";
}

export interface OpenDocument extends DocumentSnapshot {
  savedContent: string;
  savedLineEnding: LineEnding;
}

export type ViewMode = "live" | "edit" | "split" | "preview";
export type Activity = "files" | "search" | "outline";

export interface WorkspaceState {
  workspace: WorkspaceTree | null;
  documents: Record<string, OpenDocument>;
  documentOrder: string[];
  activeDocumentId: string | null;
  expandedPaths: string[];
  activity: Activity;
  sidebarVisible: boolean;
  focusMode: boolean;
  viewMode: ViewMode;
}

export const initialWorkspaceState: WorkspaceState = {
  workspace: null,
  documents: {},
  documentOrder: [],
  activeDocumentId: null,
  expandedPaths: [],
  activity: "files",
  sidebarVisible: true,
  focusMode: false,
  viewMode: "live",
};

export type WorkspaceAction =
  | { type: "workspace/opened"; workspace: WorkspaceTree }
  | {
      type: "workspace/refreshed";
      expectedRootPath: string;
      workspace: WorkspaceTree;
    }
  | { type: "document/opened"; snapshot: DocumentSnapshot }
  | { type: "document/activated"; id: string }
  | {
      type: "document/changed";
      id: string;
      content: string;
      lineEnding?: LineEnding;
    }
  | {
      type: "document/saved";
      previousId: string;
      snapshot: DocumentSnapshot;
    }
  | { type: "document/closed"; id: string }
  | {
      type: "entry/renamed";
      sourcePath: string;
      destinationPath: string;
    }
  | { type: "entry/trashed"; path: string }
  | { type: "tree/toggled"; path: string }
  | { type: "activity/selected"; activity: Activity }
  | { type: "sidebar/toggled" }
  | { type: "focus/toggled" }
  | { type: "view/selected"; viewMode: ViewMode };

function openDocument(snapshot: DocumentSnapshot): OpenDocument {
  return {
    ...snapshot,
    savedContent: snapshot.content,
    savedLineEnding: snapshot.lineEnding,
  };
}

export function isPathWithinEntry(path: string, entryPath: string): boolean {
  return (
    entryPath.length > 0 &&
    (path === entryPath || path.startsWith(`${entryPath}/`))
  );
}

export function remapEntryPath(
  path: string,
  sourcePath: string,
  destinationPath: string,
): string {
  return isPathWithinEntry(path, sourcePath)
    ? `${destinationPath}${path.slice(sourcePath.length)}`
    : path;
}

function documentName(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf("/") + 1);
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "workspace/opened":
      return {
        ...initialWorkspaceState,
        workspace: action.workspace,
        expandedPaths: action.workspace.children
          .filter((node) => node.kind === "directory")
          .map((node) => node.relativePath),
      };
    case "workspace/refreshed":
      return state.workspace?.rootPath === action.expectedRootPath &&
        action.workspace.rootPath === action.expectedRootPath
        ? { ...state, workspace: action.workspace }
        : state;
    case "document/opened": {
      const id = action.snapshot.relativePath;
      const existing = state.documents[id];
      return {
        ...state,
        documents: existing
          ? state.documents
          : { ...state.documents, [id]: openDocument(action.snapshot) },
        documentOrder: existing
          ? state.documentOrder
          : [...state.documentOrder, id],
        activeDocumentId: id,
      };
    }
    case "document/activated":
      return state.documents[action.id]
        ? { ...state, activeDocumentId: action.id }
        : state;
    case "document/changed": {
      const document = state.documents[action.id];
      if (!document) return state;
      const lineEnding = action.lineEnding ?? document.lineEnding;
      if (
        document.content === action.content &&
        document.lineEnding === lineEnding
      ) {
        return state;
      }
      return {
        ...state,
        documents: {
          ...state.documents,
          [action.id]: { ...document, content: action.content, lineEnding },
        },
      };
    }
    case "document/saved": {
      const nextId = action.snapshot.relativePath;
      const currentDocument = state.documents[action.previousId];
      if (!currentDocument) return state;
      if (nextId !== action.previousId && state.documents[nextId]) return state;
      const nextDocument: OpenDocument = {
        ...action.snapshot,
        content: currentDocument.content,
        lineEnding: currentDocument.lineEnding,
        savedContent: action.snapshot.content,
        savedLineEnding: action.snapshot.lineEnding,
      };
      const documents = { ...state.documents };
      delete documents[action.previousId];
      documents[nextId] = nextDocument;
      const documentOrder = state.documentOrder.map((id) =>
        id === action.previousId ? nextId : id,
      );
      return {
        ...state,
        documents,
        documentOrder,
        activeDocumentId:
          state.activeDocumentId === action.previousId
            ? nextId
            : state.activeDocumentId,
      };
    }
    case "document/closed": {
      const index = state.documentOrder.indexOf(action.id);
      if (index < 0) return state;
      const documents = { ...state.documents };
      delete documents[action.id];
      const documentOrder = state.documentOrder.filter((id) => id !== action.id);
      let activeDocumentId = state.activeDocumentId;
      if (activeDocumentId === action.id) {
        activeDocumentId =
          documentOrder[Math.min(index, documentOrder.length - 1)] ?? null;
      }
      return { ...state, documents, documentOrder, activeDocumentId };
    }
    case "entry/renamed": {
      if (
        action.sourcePath.length === 0 ||
        action.destinationPath.length === 0 ||
        action.sourcePath === action.destinationPath
      ) {
        return state;
      }
      const affectedDocumentIds = Object.keys(state.documents).filter((id) =>
        isPathWithinEntry(id, action.sourcePath),
      );
      const affectedDocumentIdSet = new Set(affectedDocumentIds);
      const destinationCollides = affectedDocumentIds.some((id) => {
        const destinationId = remapEntryPath(
          id,
          action.sourcePath,
          action.destinationPath,
        );
        return (
          destinationId !== id &&
          Boolean(state.documents[destinationId]) &&
          !affectedDocumentIdSet.has(destinationId)
        );
      });
      if (destinationCollides) return state;

      const documents = { ...state.documents };
      for (const id of affectedDocumentIds) delete documents[id];
      for (const id of affectedDocumentIds) {
        const document = state.documents[id];
        if (!document) continue;
        const destinationId = remapEntryPath(
          id,
          action.sourcePath,
          action.destinationPath,
        );
        documents[destinationId] = {
          ...document,
          relativePath: destinationId,
          name: documentName(destinationId),
        };
      }
      const expandedPaths = Array.from(
        new Set(
          state.expandedPaths.map((path) =>
            remapEntryPath(
              path,
              action.sourcePath,
              action.destinationPath,
            ),
          ),
        ),
      );
      return {
        ...state,
        documents,
        documentOrder: state.documentOrder.map((id) =>
          remapEntryPath(id, action.sourcePath, action.destinationPath),
        ),
        activeDocumentId: state.activeDocumentId
          ? remapEntryPath(
              state.activeDocumentId,
              action.sourcePath,
              action.destinationPath,
            )
          : null,
        expandedPaths,
      };
    }
    case "entry/trashed": {
      if (action.path.length === 0) return state;
      const removedIds = new Set(
        Object.keys(state.documents).filter((id) =>
          isPathWithinEntry(id, action.path),
        ),
      );
      const expandedPaths = state.expandedPaths.filter(
        (path) => !isPathWithinEntry(path, action.path),
      );
      if (
        removedIds.size === 0 &&
        expandedPaths.length === state.expandedPaths.length
      ) {
        return state;
      }
      const documents = { ...state.documents };
      for (const id of removedIds) delete documents[id];
      const activeIndex = state.activeDocumentId
        ? state.documentOrder.indexOf(state.activeDocumentId)
        : -1;
      const documentOrder = state.documentOrder.filter(
        (id) => !removedIds.has(id),
      );
      const activeDocumentId =
        state.activeDocumentId && removedIds.has(state.activeDocumentId)
          ? (documentOrder[
              Math.min(Math.max(activeIndex, 0), documentOrder.length - 1)
            ] ?? null)
          : state.activeDocumentId;
      return {
        ...state,
        documents,
        documentOrder,
        activeDocumentId,
        expandedPaths,
      };
    }
    case "tree/toggled": {
      const expanded = state.expandedPaths.includes(action.path);
      return {
        ...state,
        expandedPaths: expanded
          ? state.expandedPaths.filter((path) => path !== action.path)
          : [...state.expandedPaths, action.path],
      };
    }
    case "activity/selected":
      return {
        ...state,
        activity: action.activity,
        sidebarVisible: true,
        focusMode: false,
      };
    case "sidebar/toggled":
      return { ...state, sidebarVisible: !state.sidebarVisible, focusMode: false };
    case "focus/toggled":
      return { ...state, focusMode: !state.focusMode };
    case "view/selected":
      return { ...state, viewMode: action.viewMode };
  }
}

export function isDocumentDirty(document: OpenDocument | undefined): boolean {
  return Boolean(
    document &&
      (document.content !== document.savedContent ||
        document.lineEnding !== document.savedLineEnding),
  );
}

export function hasDirtyDocuments(state: WorkspaceState): boolean {
  return state.documentOrder.some((id) => isDocumentDirty(state.documents[id]));
}

export function activeDocument(state: WorkspaceState): OpenDocument | null {
  return state.activeDocumentId
    ? (state.documents[state.activeDocumentId] ?? null)
    : null;
}

export function flattenFiles(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap((node) =>
    node.kind === "file"
      ? [node]
      : node.kind === "directory"
        ? flattenFiles(node.children)
        : [],
  );
}

export function flattenImages(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap((node) =>
    node.kind === "image"
      ? [node]
      : node.kind === "directory"
        ? flattenImages(node.children)
        : [],
  );
}

export function isWorkspaceImage(node: FileTreeNode): boolean {
  return node.kind === "image";
}
