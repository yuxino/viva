import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  useI18n,
  type InterpolationValue,
  type TranslationKey,
} from "../i18n";
import {
  activeDocument,
  hasDirtyDocuments,
  initialWorkspaceState,
  isDocumentDirty,
  workspaceReducer,
  type Activity,
  type ViewMode,
} from "../domain/workspace";
import {
  chooseSavePath,
  chooseWorkspace,
  describeNativeError,
  hasNativeShell,
  isFreshWindow,
  inspectSaveDestination,
  openWorkspace as loadWorkspace,
  readDocument,
  saveDocumentAs as saveNativeDocumentAs,
  searchWorkspace,
  writeDocument as writeNativeDocument,
  type SearchMatch,
} from "../lib/native";
import {
  clearLastWorkspace,
  clearLastWorkspaceSnapshot,
  createSessionSnapshot,
  emptySession,
  loadSession,
  saveSession,
  type VivaSession,
} from "../lib/session";

export type StatusTone = "neutral" | "success" | "error";

export interface WorkspaceStatus {
  message: string;
  tone: StatusTone;
}

type WorkspaceStatusState =
  | {
      kind: "translation";
      key: TranslationKey;
      tone: StatusTone;
      values?: readonly InterpolationValue[];
    }
  | {
      error: unknown;
      kind: "native-error";
      prefix?: TranslationKey;
      tone: "error";
    };

const READY_STATUS: WorkspaceStatusState = {
  key: "Saved locally",
  kind: "translation",
  tone: "neutral",
};

export const WORKSPACE_OPEN_TIMEOUT_MS = 8_000;

class WorkspaceOpenTimeoutError extends Error {}

async function loadWorkspaceBeforeDeadline(path: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      loadWorkspace(path),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new WorkspaceOpenTimeoutError()),
          WORKSPACE_OPEN_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function translatedStatus(
  key: TranslationKey,
  tone: StatusTone,
  ...values: InterpolationValue[]
): WorkspaceStatusState {
  return { key, kind: "translation", tone, values };
}

function nativeErrorStatus(
  error: unknown,
  prefix?: TranslationKey,
): WorkspaceStatusState {
  return { error, kind: "native-error", prefix, tone: "error" };
}

interface WorkspaceOperationContext {
  generation: number;
  rootPath: string;
}

function statusAfterSave(
  snapshot: { historyWarningCode?: "HISTORY_UNAVAILABLE" },
  newerContent = false,
): WorkspaceStatusState {
  if (newerContent) {
    return translatedStatus(
      snapshot.historyWarningCode
        ? "New changes are not saved; local history is unavailable."
        : "New changes are not saved",
      "neutral",
    );
  }
  return translatedStatus(
    snapshot.historyWarningCode
      ? "Saved locally · local history unavailable"
      : "Saved locally",
    snapshot.historyWarningCode ? "neutral" : "success",
  );
}

export function useWorkspaceController() {
  const { fmt, t } = useI18n();
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState);
  const [statusState, setStatus] = useState<WorkspaceStatusState>(READY_STATUS);
  const status = useMemo<WorkspaceStatus>(() => {
    if (statusState.kind === "native-error") {
      const detail = describeNativeError(statusState.error, t);
      return {
        message: statusState.prefix ? fmt(statusState.prefix, detail) : detail,
        tone: statusState.tone,
      };
    }
    return {
      message: statusState.values?.length
        ? fmt(statusState.key, ...statusState.values)
        : t(statusState.key),
      tone: statusState.tone,
    };
  }, [fmt, statusState, t]);
  const [busy, setBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const liveStateRef = useRef(state);
  const nativeShell = useMemo(hasNativeShell, []);
  const initialSessionRef = useRef<VivaSession>(
    nativeShell ? emptySession : loadSession(),
  );
  const sessionRef = useRef<VivaSession>(initialSessionRef.current);
  const [recentWorkspaces, setRecentWorkspaces] = useState(
    initialSessionRef.current.recentWorkspaces,
  );
  const restoredRef = useRef(false);
  const sessionModeRef = useRef<"ephemeral" | "pending" | "persistent">(
    nativeShell ? "pending" : "persistent",
  );
  const savesInFlightRef = useRef(new Map<string, Promise<boolean>>());
  const fileMutationInFlightRef = useRef<Promise<boolean> | null>(null);
  const searchRequestIdRef = useRef(0);
  const workspaceGenerationRef = useRef(0);
  const workspaceRootRef = useRef<string | null>(null);
  const nextDocumentTokenRef = useRef(0);
  const documentTokensRef = useRef(new Map<string, number>());

  const currentDocument = useMemo(() => activeDocument(state), [state]);
  const dirty = useMemo(() => hasDirtyDocuments(state), [state]);
  liveStateRef.current = state;

  const isWorkspaceContextCurrent = useCallback(
    (context: WorkspaceOperationContext) =>
      workspaceGenerationRef.current === context.generation &&
      workspaceRootRef.current === context.rootPath,
    [],
  );

  const markDocumentCurrent = useCallback((id: string) => {
    const token = ++nextDocumentTokenRef.current;
    documentTokensRef.current.set(id, token);
    return token;
  }, []);

  const isDocumentContextCurrent = useCallback(
    (context: WorkspaceOperationContext, id: string, token: number) =>
      isWorkspaceContextCurrent(context) &&
      documentTokensRef.current.get(id) === token &&
      Boolean(liveStateRef.current.documents[id]),
    [isWorkspaceContextCurrent],
  );

  const refreshWorkspace = useCallback(
    async (context: WorkspaceOperationContext): Promise<boolean> => {
      const workspace = await loadWorkspace(context.rootPath);
      if (!isWorkspaceContextCurrent(context)) return false;
      dispatch({
        type: "workspace/refreshed",
        expectedRootPath: context.rootPath,
        workspace,
      });
      return true;
    },
    [isWorkspaceContextCurrent],
  );

  const openWorkspacePath = useCallback(
    async (path: string, restoreSession?: VivaSession): Promise<boolean> => {
      const generation = ++workspaceGenerationRef.current;
      searchRequestIdRef.current += 1;
      setSearchResults([]);
      setSearching(false);
      setBusy(true);
      setStatus(translatedStatus("Opening workspace…", "neutral"));
      try {
        const workspace = await loadWorkspaceBeforeDeadline(path);
        if (workspaceGenerationRef.current !== generation) return false;
        const context = { generation, rootPath: workspace.rootPath };
        workspaceRootRef.current = workspace.rootPath;
        documentTokensRef.current.clear();
        dispatch({ type: "workspace/opened", workspace });

        if (restoreSession) {
          dispatch({ type: "view/selected", viewMode: restoreSession.viewMode });
          if (!restoreSession.sidebarVisible) {
            dispatch({ type: "sidebar/toggled" });
          }
        }

        if (restoreSession?.openDocuments.length) {
          for (const relativePath of restoreSession.openDocuments) {
            try {
              const snapshot = await readDocument(workspace.rootPath, relativePath);
              if (!isWorkspaceContextCurrent(context)) return false;
              markDocumentCurrent(snapshot.relativePath);
              dispatch({ type: "document/opened", snapshot });
            } catch {
              if (!isWorkspaceContextCurrent(context)) return false;
              // A restored file may have moved while Viva was closed.
            }
          }
          if (restoreSession.activeDocumentPath) {
            if (!isWorkspaceContextCurrent(context)) return false;
            dispatch({
              type: "document/activated",
              id: restoreSession.activeDocumentPath,
            });
          }
        }

        if (!isWorkspaceContextCurrent(context)) return false;
        setStatus(READY_STATUS);
        return true;
      } catch (error) {
        if (workspaceGenerationRef.current === generation) {
          sessionRef.current =
            sessionModeRef.current === "persistent"
              ? clearLastWorkspace(sessionRef.current)
              : clearLastWorkspaceSnapshot(sessionRef.current);
          setStatus(
            error instanceof WorkspaceOpenTimeoutError
              ? translatedStatus(
                  "This folder took too long to open. Try a smaller local folder.",
                  "error",
                )
              : nativeErrorStatus(error),
          );
        }
        return false;
      } finally {
        if (workspaceGenerationRef.current === generation) setBusy(false);
      }
    },
    [isWorkspaceContextCurrent, markDocumentCurrent],
  );

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (!nativeShell) return;
    void (async () => {
      let freshWindow: boolean;
      try {
        freshWindow = await isFreshWindow();
      } catch (error) {
        setStatus(nativeErrorStatus(error));
        return;
      }
      if (freshWindow) {
        sessionModeRef.current = "ephemeral";
        const sharedSession = loadSession();
        sessionRef.current = {
          ...emptySession,
          recentWorkspaces: sharedSession.recentWorkspaces,
        };
        setRecentWorkspaces(sharedSession.recentWorkspaces);
        const selected = await chooseWorkspace(t("Open a Markdown folder"));
        if (selected) await openWorkspacePath(selected);
        return;
      }
      sessionModeRef.current = "persistent";
      const session = loadSession();
      sessionRef.current = session;
      setRecentWorkspaces(session.recentWorkspaces);
      if (session.lastWorkspacePath) {
        await openWorkspacePath(session.lastWorkspacePath, session);
      }
    })();
  }, [nativeShell, openWorkspacePath, t]);

  useEffect(() => {
    if (!state.workspace) return;
    if (sessionModeRef.current === "pending") return;
    sessionRef.current =
      sessionModeRef.current === "persistent"
        ? saveSession(state, sessionRef.current)
        : createSessionSnapshot(state, sessionRef.current);
    setRecentWorkspaces(sessionRef.current.recentWorkspaces);
  }, [
    state.workspace,
    state.documentOrder,
    state.activeDocumentId,
    state.viewMode,
    state.sidebarVisible,
  ]);

  const openFolder = useCallback(async (): Promise<boolean> => {
    if (!hasNativeShell()) {
      setStatus(
        translatedStatus(
          "Folder access is available in the Viva desktop app.",
          "error",
        ),
      );
      return false;
    }
    if (dirty) {
      setStatus(
        translatedStatus(
          "Save or close changed files before opening another folder.",
          "error",
        ),
      );
      return false;
    }
    const selected = await chooseWorkspace(t("Open a Markdown folder"));
    return selected ? openWorkspacePath(selected) : false;
  }, [dirty, openWorkspacePath, t]);

  const openRecentWorkspace = useCallback(
    async (path: string): Promise<boolean> => {
      if (dirty) {
        setStatus(
          translatedStatus(
            "Save or close changed files before switching folders.",
            "error",
          ),
        );
        return false;
      }
      return openWorkspacePath(path);
    },
    [dirty, openWorkspacePath, t],
  );

  const openDocument = useCallback(
    async (relativePath: string): Promise<boolean> => {
      const workspace = state.workspace;
      if (!workspace) return false;
      if (state.documents[relativePath]) {
        if (!documentTokensRef.current.has(relativePath)) {
          markDocumentCurrent(relativePath);
        }
        dispatch({ type: "document/activated", id: relativePath });
        return true;
      }
      const context = {
        generation: workspaceGenerationRef.current,
        rootPath: workspace.rootPath,
      };
      setStatus(translatedStatus("Opening %@…", "neutral", relativePath));
      try {
        const snapshot = await readDocument(workspace.rootPath, relativePath);
        if (!isWorkspaceContextCurrent(context)) return false;
        markDocumentCurrent(snapshot.relativePath);
        dispatch({ type: "document/opened", snapshot });
        setStatus(READY_STATUS);
        return true;
      } catch (error) {
        if (!isWorkspaceContextCurrent(context)) return false;
        setStatus(nativeErrorStatus(error));
        return false;
      }
    },
    [
      isWorkspaceContextCurrent,
      markDocumentCurrent,
      state.documents,
      state.workspace,
    ],
  );

  const changeDocument = useCallback((id: string, content: string) => {
    dispatch({ type: "document/changed", id, content });
    setStatus(translatedStatus("Not saved", "neutral"));
  }, []);

  const saveDocument = useCallback(
    (id = state.activeDocumentId ?? ""): Promise<boolean> => {
      const workspace = state.workspace;
      const document = state.documents[id];
      if (!workspace || !document) return Promise.resolve(false);
      if (!isDocumentDirty(document)) return Promise.resolve(true);
      const context = {
        generation: workspaceGenerationRef.current,
        rootPath: workspace.rootPath,
      };
      const documentToken =
        documentTokensRef.current.get(id) ?? markDocumentCurrent(id);
      const operationKey = `${context.generation}\u0000${context.rootPath}\u0000${id}\u0000${documentToken}`;
      const inFlight = savesInFlightRef.current.get(operationKey);
      if (inFlight) return inFlight;
      setStatus(translatedStatus("Saving…", "neutral"));
      const operation = (async () => {
        try {
          const snapshot = await writeNativeDocument(workspace.rootPath, document);
          if (!isDocumentContextCurrent(context, id, documentToken)) {
            return false;
          }
          const newerContent =
            liveStateRef.current.documents[id]?.content !== snapshot.content;
          dispatch({ type: "document/saved", previousId: id, snapshot });
          setStatus(statusAfterSave(snapshot, newerContent));
          return !newerContent;
        } catch (error) {
          if (!isDocumentContextCurrent(context, id, documentToken)) {
            return false;
          }
          setStatus(nativeErrorStatus(error, "Not saved — %@"));
          return false;
        } finally {
          savesInFlightRef.current.delete(operationKey);
        }
      })();
      savesInFlightRef.current.set(operationKey, operation);
      return operation;
    },
    [
      isDocumentContextCurrent,
      markDocumentCurrent,
      state.activeDocumentId,
      state.documents,
      state.workspace,
    ],
  );

  const saveDocumentAs = useCallback(
    (id = state.activeDocumentId ?? ""): Promise<boolean> => {
      if (fileMutationInFlightRef.current) {
        return fileMutationInFlightRef.current;
      }
      const workspace = state.workspace;
      const document = state.documents[id];
      if (!workspace || !document) return Promise.resolve(false);
      const context = {
        generation: workspaceGenerationRef.current,
        rootPath: workspace.rootPath,
      };
      const documentToken =
        documentTokensRef.current.get(id) ?? markDocumentCurrent(id);
      const dot = document.name.lastIndexOf(".");
      const stem = dot > 0 ? document.name.slice(0, dot) : document.name;
      const operation = (async () => {
        const destination = await chooseSavePath(
          workspace.rootPath,
          `${stem} copy.md`,
          t("Save Markdown as"),
          t("Markdown"),
        );
        if (!destination) return false;
        if (!isDocumentContextCurrent(context, id, documentToken)) return false;
        try {
          const destinationState = await inspectSaveDestination(
            workspace.rootPath,
            destination,
          );
          if (!isDocumentContextCurrent(context, id, documentToken)) {
            return false;
          }
          if (
            destinationState.relativePath !== id &&
            liveStateRef.current.documents[destinationState.relativePath]
          ) {
            setStatus(
              translatedStatus(
                "Close the destination tab before replacing that document.",
                "error",
              ),
            );
            return false;
          }
          const snapshot = await saveNativeDocumentAs(
            workspace.rootPath,
            destination,
            document.content,
            destinationState.revision,
          );
          if (!isDocumentContextCurrent(context, id, documentToken)) {
            return false;
          }
          if (
            snapshot.relativePath !== id &&
            liveStateRef.current.documents[snapshot.relativePath]
          ) {
            await refreshWorkspace(context);
            if (!isWorkspaceContextCurrent(context)) return false;
            setStatus(
              translatedStatus(
                "Copy saved. The destination opened meanwhile, so both drafts were kept.",
                "neutral",
              ),
            );
            return true;
          }
          markDocumentCurrent(id);
          markDocumentCurrent(snapshot.relativePath);
          dispatch({ type: "document/saved", previousId: id, snapshot });
          await refreshWorkspace(context);
          if (!isWorkspaceContextCurrent(context)) return false;
          setStatus(statusAfterSave(snapshot));
          return true;
        } catch (error) {
          if (!isDocumentContextCurrent(context, id, documentToken)) {
            return false;
          }
          setStatus(nativeErrorStatus(error, "Not saved — %@"));
          return false;
        }
      })();
      fileMutationInFlightRef.current = operation;
      void operation.finally(() => {
        if (fileMutationInFlightRef.current === operation) {
          fileMutationInFlightRef.current = null;
        }
      });
      return operation;
    },
    [
      isDocumentContextCurrent,
      isWorkspaceContextCurrent,
      markDocumentCurrent,
      refreshWorkspace,
      state.activeDocumentId,
      state.documents,
      state.workspace,
      t,
    ],
  );

  const newDocument = useCallback((): Promise<boolean> => {
    if (fileMutationInFlightRef.current) {
      return fileMutationInFlightRef.current;
    }
    const workspace = state.workspace;
    if (!workspace) {
      setStatus(
        translatedStatus("Open a folder before creating a note", "error"),
      );
      return Promise.resolve(false);
    }
    const context = {
      generation: workspaceGenerationRef.current,
      rootPath: workspace.rootPath,
    };
    const operation = (async () => {
      const untitled = t("Untitled");
      const destination = await chooseSavePath(
        workspace.rootPath,
        `${untitled}.md`,
        t("Save Markdown as"),
        t("Markdown"),
      );
      if (!destination || !isWorkspaceContextCurrent(context)) return false;
      try {
        const snapshot = await saveNativeDocumentAs(
          workspace.rootPath,
          destination,
          `# ${untitled}\n\n`,
        );
        if (!isWorkspaceContextCurrent(context)) return false;
        markDocumentCurrent(snapshot.relativePath);
        dispatch({ type: "document/opened", snapshot });
        await refreshWorkspace(context);
        if (!isWorkspaceContextCurrent(context)) return false;
        setStatus(statusAfterSave(snapshot));
        return true;
      } catch (error) {
        if (!isWorkspaceContextCurrent(context)) return false;
        setStatus(nativeErrorStatus(error));
        return false;
      }
    })();
    fileMutationInFlightRef.current = operation;
    void operation.finally(() => {
      if (fileMutationInFlightRef.current === operation) {
        fileMutationInFlightRef.current = null;
      }
    });
    return operation;
  }, [
    isWorkspaceContextCurrent,
    markDocumentCurrent,
    refreshWorkspace,
    state.workspace,
    t,
  ]);

  const runSearch = useCallback(
    async (query: string): Promise<void> => {
      const workspace = state.workspace;
      const normalized = query.trim();
      const requestId = ++searchRequestIdRef.current;
      if (!workspace || !normalized) {
        setSearchResults([]);
        setSearching(false);
        return;
      }
      const context = {
        generation: workspaceGenerationRef.current,
        rootPath: workspace.rootPath,
      };
      setSearching(true);
      try {
        const results = await searchWorkspace(
          workspace.rootPath,
          normalized,
          100,
        );
        if (
          requestId !== searchRequestIdRef.current ||
          !isWorkspaceContextCurrent(context)
        ) {
          return;
        }
        setSearchResults(results);
      } catch (error) {
        if (
          requestId !== searchRequestIdRef.current ||
          !isWorkspaceContextCurrent(context)
        ) {
          return;
        }
        setSearchResults([]);
        setStatus(nativeErrorStatus(error));
      } finally {
        if (
          requestId === searchRequestIdRef.current &&
          isWorkspaceContextCurrent(context)
        ) {
          setSearching(false);
        }
      }
    },
    [isWorkspaceContextCurrent, state.workspace],
  );

  const closeDocument = useCallback(
    (id: string) => {
      markDocumentCurrent(id);
      dispatch({ type: "document/closed", id });
      const hasOtherDirtyDocument = Object.entries(
        liveStateRef.current.documents,
      ).some(
        ([documentId, document]) =>
          documentId !== id && isDocumentDirty(document),
      );
      if (!hasOtherDirtyDocument) setStatus(READY_STATUS);
    },
    [markDocumentCurrent],
  );

  const activateDocument = useCallback((id: string) => {
    dispatch({ type: "document/activated", id });
  }, []);

  const toggleTreePath = useCallback((path: string) => {
    dispatch({ type: "tree/toggled", path });
  }, []);

  const selectActivity = useCallback((activity: Activity) => {
    dispatch({ type: "activity/selected", activity });
  }, []);

  const toggleSidebar = useCallback(() => {
    dispatch({ type: "sidebar/toggled" });
  }, []);

  const toggleFocus = useCallback(() => {
    dispatch({ type: "focus/toggled" });
  }, []);

  const selectView = useCallback((viewMode: ViewMode) => {
    dispatch({ type: "view/selected", viewMode });
  }, []);

  const reportError = useCallback((error: unknown) => {
    setStatus(nativeErrorStatus(error));
  }, []);

  return {
    state,
    currentDocument,
    dirty,
    busy,
    status,
    searchResults,
    searching,
    recentWorkspaces,
    openFolder,
    openRecentWorkspace,
    openDocument,
    changeDocument,
    saveDocument,
    saveDocumentAs,
    newDocument,
    runSearch,
    closeDocument,
    activateDocument,
    toggleTreePath,
    selectActivity,
    toggleSidebar,
    toggleFocus,
    selectView,
    reportError,
  };
}
