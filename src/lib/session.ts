import type { ViewMode, WorkspaceState } from "../domain/workspace";

const STORAGE_KEY = "viva.session.v2";
const MAX_RECENT_WORKSPACES = 8;

export interface RecentWorkspace {
  path: string;
  name: string;
  lastOpenedAt: number;
}

export interface VivaSession {
  lastWorkspacePath: string | null;
  openDocuments: string[];
  activeDocumentPath: string | null;
  recentWorkspaces: RecentWorkspace[];
  viewMode: ViewMode;
  sidebarVisible: boolean;
}

export const emptySession: VivaSession = {
  lastWorkspacePath: null,
  openDocuments: [],
  activeDocumentPath: null,
  recentWorkspaces: [],
  viewMode: "live",
  sidebarVisible: true,
};

function isViewMode(value: unknown): value is ViewMode {
  return (
    value === "live" ||
    value === "edit" ||
    value === "split" ||
    value === "preview"
  );
}

function parseSession(value: unknown): VivaSession {
  if (!value || typeof value !== "object") return emptySession;
  const candidate = value as Partial<VivaSession>;
  const recentWorkspaces = Array.isArray(candidate.recentWorkspaces)
    ? candidate.recentWorkspaces
        .filter(
          (item): item is RecentWorkspace =>
            Boolean(
              item &&
                typeof item.path === "string" &&
                typeof item.name === "string" &&
                typeof item.lastOpenedAt === "number",
            ),
        )
        .slice(0, MAX_RECENT_WORKSPACES)
    : [];
  return {
    lastWorkspacePath:
      typeof candidate.lastWorkspacePath === "string"
        ? candidate.lastWorkspacePath
        : null,
    openDocuments: Array.isArray(candidate.openDocuments)
      ? candidate.openDocuments.filter(
          (path): path is string => typeof path === "string",
        )
      : [],
    activeDocumentPath:
      typeof candidate.activeDocumentPath === "string"
        ? candidate.activeDocumentPath
        : null,
    recentWorkspaces,
    viewMode: isViewMode(candidate.viewMode) ? candidate.viewMode : "live",
    sidebarVisible:
      typeof candidate.sidebarVisible === "boolean"
        ? candidate.sidebarVisible
        : true,
  };
}

export function loadSession(storage: Storage = localStorage): VivaSession {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? parseSession(JSON.parse(raw) as unknown) : emptySession;
  } catch {
    return emptySession;
  }
}

export function saveSession(
  state: WorkspaceState,
  previous: VivaSession,
  storage: Storage = localStorage,
): VivaSession {
  const next = createSessionSnapshot(state, previous);
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function createSessionSnapshot(
  state: WorkspaceState,
  previous: VivaSession,
): VivaSession {
  const workspace = state.workspace;
  const recentWorkspaces = workspace
    ? [
        {
          path: workspace.rootPath,
          name: workspace.name,
          lastOpenedAt: Date.now(),
        },
        ...previous.recentWorkspaces.filter(
          (recent) => recent.path !== workspace.rootPath,
        ),
      ].slice(0, MAX_RECENT_WORKSPACES)
    : previous.recentWorkspaces;
  const next: VivaSession = {
    lastWorkspacePath: workspace?.rootPath ?? null,
    openDocuments: state.documentOrder,
    activeDocumentPath: state.activeDocumentId,
    recentWorkspaces,
    viewMode: state.viewMode,
    sidebarVisible: state.sidebarVisible,
  };
  return next;
}

export function clearLastWorkspace(
  session: VivaSession,
  storage: Storage = localStorage,
): VivaSession {
  const next = clearLastWorkspaceSnapshot(session);
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearLastWorkspaceSnapshot(session: VivaSession): VivaSession {
  return {
    ...session,
    lastWorkspacePath: null,
    openDocuments: [],
    activeDocumentPath: null,
  };
}
