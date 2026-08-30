import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  CommandIcon,
  CheckIcon,
  EditIcon,
  FileMarkdownIcon,
  FilesIcon,
  FolderIcon,
  FolderOpenIcon,
  HistoryIcon,
  ImageIcon,
  LiveIcon,
  OutlineIcon,
  PlusIcon,
  PreviewIcon,
  SearchIcon,
  SettingsIcon,
  SidebarIcon,
  SplitIcon,
} from "./components/icons";
import { ResizeHandle } from "./components/ResizeHandle";
import { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
import { Welcome } from "./components/Welcome";
import {
  Button,
  CommandPalette,
  Dialog,
  EmptyState,
  IconButton,
  SegmentedControl,
  type CommandPaletteItem,
} from "./components/ui";
import {
  flattenFiles,
  flattenImages,
  isDocumentDirty,
  type FileTreeNode,
  type LineEnding,
  type ViewMode,
} from "./domain/workspace";
import {
  ActivityRail,
  AppearancePanel,
  BackgroundLayer,
  DocumentTabs,
  EditorPane,
  FileTree,
  HistoryPanel,
  ImageViewer,
  LiveEditorPane,
  OutlinePanel,
  PreviewPane,
  SearchPanel,
  Sidebar,
  StatusBar,
  TitleBar,
  useBackgroundSettings,
  offsetAtPosition,
  positionAtOffset,
  type EditorPosition,
  type HistoryEntry,
  type ImageViewerSource,
  type TextSelection,
} from "./features";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useCloseProtection } from "./hooks/useCloseProtection";
import { useDocumentHistory } from "./hooks/useDocumentHistory";
import {
  useNativeMenu,
  type NativeMenuCommand,
} from "./hooks/useNativeMenu";
import { useWorkspaceController } from "./hooks/useWorkspaceController";
import {
  useI18n,
  type LanguagePreference,
  type TranslationKey,
} from "./i18n";
import { getAppShortcutLabels, getVivaPlatform } from "./lib/keyboard";
import { countWords, renderMarkdown } from "./lib/markdown";
import { resolveLocalImagePath } from "./lib/media";
import {
  hasNativeShell,
  openExternalUrl,
  openNewWindow,
  revealWorkspaceItem,
  setNativeMenuLanguage,
} from "./lib/native";
import { boundTextPrefix } from "./lib/textBounds";

type PaletteMode = "files" | "commands" | null;
type ThemePreference = "system" | "light" | "dark";
type WorkbenchSurface = "document" | "history" | "appearance";

interface PendingClose {
  exitApplication: boolean;
  id: string;
}

interface PendingHistoryLoad {
  content: string;
  documentId: string;
  documentName: string;
  lineEnding: LineEnding;
  versionLabel: string;
}

interface ScrollSync {
  line: number;
  target: "editor" | "preview" | "both";
}

interface SearchNavigationTarget {
  column: number;
  line: number;
  relativePath: string;
}

const SIDEBAR_DEFAULT = 236;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 360;
const COMPACT_LAYOUT_MAX_WIDTH = 1040;
const COMPACT_SIDEBAR_MAX = 212;
const SPLIT_DEFAULT = 48;
const SPLIT_MIN = 30;
const SPLIT_MAX = 70;
const COMPACT_SPLIT_MIN = 40;
const COMPACT_SPLIT_MAX = 60;
const LIVE_MARKDOWN_MAX_CHARACTERS = 512 * 1024;
const LIVE_MARKDOWN_MAX_LINES = 5_000;
const LIVE_STATS_MAX_CHARACTERS = 512 * 1024;
const EMPTY_RENDERED_MARKDOWN = { html: "", outline: [] };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function isCompactLayout(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= COMPACT_LAYOUT_MAX_WIDTH;
}

function resizedSidebarWidth(current: number, delta: number): number {
  const maximum = isCompactLayout() ? COMPACT_SIDEBAR_MAX : SIDEBAR_MAX;
  if (delta === Number.POSITIVE_INFINITY) {
    return Math.min(SIDEBAR_DEFAULT, maximum);
  }
  return clamp(Math.min(current, maximum) + delta, SIDEBAR_MIN, maximum);
}

function resizedSplitPosition(
  current: number,
  delta: number,
  stageWidth: number,
): number {
  const compact = isCompactLayout();
  const minimum = compact ? COMPACT_SPLIT_MIN : SPLIT_MIN;
  const maximum = compact ? COMPACT_SPLIT_MAX : SPLIT_MAX;
  if (delta === Number.POSITIVE_INFINITY) return SPLIT_DEFAULT;
  const effectiveCurrent = clamp(current, minimum, maximum);
  return clamp(
    effectiveCurrent + (delta / Math.max(1, stageWidth)) * 100,
    minimum,
    maximum,
  );
}

function loadNumber(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Layout preferences are optional.
  }
}

function loadTheme(): ThemePreference {
  try {
    const value = localStorage.getItem("viva.theme");
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function resolveMarkdownLink(currentPath: string, href: string): string | null {
  const cleanHref = href.split(/[?#]/, 1)[0];
  if (!cleanHref || cleanHref.startsWith("/") || cleanHref.includes(":")) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(cleanHref).replaceAll("\\", "/");
  } catch {
    return null;
  }
  const parts = currentPath.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  const result = parts.join("/");
  return /\.(?:md|markdown|mdx|txt)$/i.test(result) ? result : null;
}

function viewOptions(t: (key: TranslationKey) => string) {
  return [
    { value: "live" as const, label: t("Live"), icon: <LiveIcon size={16} /> },
    { value: "edit" as const, label: t("Source"), icon: <EditIcon size={16} /> },
    { value: "split" as const, label: t("Split"), icon: <SplitIcon size={16} /> },
    {
      value: "preview" as const,
      label: t("Preview"),
      icon: <PreviewIcon size={16} />,
    },
  ];
}

export function App() {
  const { fmt, language, preference, setPreference, t } = useI18n();
  const controller = useWorkspaceController();
  const platform = useMemo(getVivaPlatform, []);
  const shortcutLabels = useMemo(getAppShortcutLabels, []);
  const documentViewOptions = useMemo(() => viewOptions(t), [t]);
  const {
    state,
    currentDocument,
    dirty,
    busy,
    status,
    searchResults,
    searching,
    recentWorkspaces,
  } = controller;
  const [paletteMode, setPaletteMode] = useState<PaletteMode>(null);
  const [theme, setTheme] = useState<ThemePreference>(loadTheme);
  const [imageViewerSource, setImageViewerSource] =
    useState<ImageViewerSource | null>(null);
  const [workbenchSurface, setWorkbenchSurface] =
    useState<WorkbenchSurface>("document");
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [pendingHistoryLoad, setPendingHistoryLoad] =
    useState<PendingHistoryLoad | null>(null);
  const [dialogSaving, setDialogSaving] = useState(false);
  const [cursor, setCursor] = useState<EditorPosition>({ line: 1, column: 1 });
  const [scrollSync, setScrollSync] = useState<ScrollSync>({
    line: 1,
    target: "preview",
  });
  const [searchNavigationTarget, setSearchNavigationTarget] =
    useState<SearchNavigationTarget | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clamp(loadNumber("viva.sidebarWidth", SIDEBAR_DEFAULT), SIDEBAR_MIN, SIDEBAR_MAX),
  );
  const [splitPosition, setSplitPosition] = useState(() =>
    clamp(loadNumber("viva.splitPosition", SPLIT_DEFAULT), SPLIT_MIN, SPLIT_MAX),
  );
  const selectionsRef = useRef(new Map<string, Required<TextSelection>>());
  const pendingSearchNavigationRef = useRef<SearchNavigationTarget | null>(null);
  const newWindowInFlightRef = useRef<Promise<void> | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editorStageRef = useRef<HTMLDivElement>(null);
  const background = useBackgroundSettings();
  const historyScope = useMemo(
    () =>
      state.workspace && currentDocument
        ? {
            workspaceRoot: state.workspace.rootPath,
            relativePath: currentDocument.relativePath,
          }
        : null,
    [currentDocument?.relativePath, state.workspace?.rootPath],
  );
  const history = useDocumentHistory(historyScope);
  const activeContent = useMemo(
    () => ({
      relativePath: currentDocument?.relativePath ?? "",
      value: currentDocument?.content ?? "",
    }),
    [currentDocument?.content, currentDocument?.relativePath],
  );
  const deferredContent = useDeferredValue(activeContent);
  const liveContent =
    deferredContent.relativePath === activeContent.relativePath
      ? deferredContent.value
      : activeContent.value;
  const documentFormat = currentDocument?.relativePath
    .toLocaleLowerCase()
    .endsWith(".mdx")
    ? "mdx"
    : "markdown";
  const needsRenderedMarkdown = Boolean(
    currentDocument &&
      (state.activity === "outline" ||
        (!state.focusMode &&
          (state.viewMode === "split" || state.viewMode === "preview"))),
  );
  const liveMarkdown = useMemo(() => {
    if (!needsRenderedMarkdown) {
      return {
        rendered: EMPTY_RENDERED_MARKDOWN,
        source: "",
        truncated: activeContent.value.length > LIVE_MARKDOWN_MAX_CHARACTERS,
      };
    }
    const bounded = boundTextPrefix(
      liveContent,
      LIVE_MARKDOWN_MAX_CHARACTERS,
      LIVE_MARKDOWN_MAX_LINES,
    );
    return {
      rendered: renderMarkdown(bounded.text, { format: documentFormat }),
      source: bounded.text,
      truncated: bounded.truncated,
    };
  }, [
    activeContent.value.length,
    documentFormat,
    liveContent,
    needsRenderedMarkdown,
  ]);
  const documentStats = useMemo(() => {
    if (!currentDocument || liveContent.length > LIVE_STATS_MAX_CHARACTERS) {
      return null;
    }
    const words = countWords(liveContent);
    return { words, minutes: Math.max(1, Math.ceil(words / 220)) };
  }, [currentDocument, liveContent]);
  const largeDocument = Boolean(
    currentDocument &&
      currentDocument.content.length > LIVE_MARKDOWN_MAX_CHARACTERS,
  );
  const liveDocumentTooLarge = useMemo(
    () =>
      Boolean(
        currentDocument &&
          boundTextPrefix(
            currentDocument.content,
            LIVE_MARKDOWN_MAX_CHARACTERS,
            LIVE_MARKDOWN_MAX_LINES,
          ).truncated,
      ),
    [currentDocument?.content],
  );
  const tabs = useMemo(
    () =>
      state.documentOrder.flatMap((id) => {
        const document = state.documents[id];
        return document
          ? [
              {
                id,
                label: document.name,
                dirty: isDocumentDirty(document),
                title: document.relativePath,
              },
            ]
          : [];
      }),
    [state.documentOrder, state.documents],
  );
  const modifiedPaths = useMemo(
    () =>
      new Set(
        state.documentOrder.filter((id) =>
          isDocumentDirty(state.documents[id]),
        ),
      ),
    [state.documentOrder, state.documents],
  );
  const workspaceFiles = useMemo(
    () => flattenFiles(state.workspace?.children ?? []),
    [state.workspace?.children],
  );
  const workspaceImages = useMemo(
    () => flattenImages(state.workspace?.children ?? []),
    [state.workspace?.children],
  );
  const workspaceImagePaths = useMemo(
    () => new Set(workspaceImages.map((image) => image.relativePath)),
    [workspaceImages],
  );
  const workspaceQuickEntries = useMemo(
    () =>
      [...workspaceFiles, ...workspaceImages].sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath),
      ),
    [workspaceFiles, workspaceImages],
  );
  const openWorkspaceImage = useCallback(
    (relativePath: string, alt?: string) => {
      const workspaceRoot = state.workspace?.rootPath;
      if (!workspaceRoot) return;
      setImageViewerSource({ alt, relativePath, workspaceRoot });
    },
    [state.workspace?.rootPath],
  );
  const handleImageRequest = useCallback(
    (source: string, alt: string) => {
      if (!currentDocument) return;
      const relativePath = resolveLocalImagePath(
        currentDocument.relativePath,
        source,
      );
      if (!relativePath) {
        controller.reportError(
          new Error(t("Only supported images inside this workspace can be opened.")),
        );
        return;
      }
      openWorkspaceImage(relativePath, alt);
    },
    [controller.reportError, currentDocument, openWorkspaceImage, t],
  );

  useEffect(() => writeNumber("viva.sidebarWidth", sidebarWidth), [sidebarWidth]);
  useEffect(
    () => writeNumber("viva.splitPosition", splitPosition),
    [splitPosition],
  );

  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("viva.theme", theme);
    } catch {
      // Appearance still applies for this session.
    }
  }, [theme]);

  useEffect(() => {
    if (!hasNativeShell()) return;
    void setNativeMenuLanguage(language).catch(controller.reportError);
  }, [controller.reportError, language]);

  useEffect(() => {
    if (state.activity !== "search") return;
    const timer = window.setTimeout(() => {
      void controller.runSearch(searchQuery);
    }, searchQuery.trim() ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [controller.runSearch, searchQuery, state.activity]);

  useEffect(() => {
    if (
      pendingSearchNavigationRef.current?.relativePath ===
      state.activeDocumentId
    ) {
      return;
    }
    setCursor({ line: 1, column: 1 });
    setScrollSync({ line: 1, target: "preview" });
  }, [state.activeDocumentId]);

  useEffect(() => {
    if (
      !searchNavigationTarget ||
      currentDocument?.relativePath !== searchNavigationTarget.relativePath
    ) {
      return;
    }

    const offset = offsetAtPosition(
      currentDocument.content,
      searchNavigationTarget.line,
      searchNavigationTarget.column,
    );
    const selection = { start: offset, end: offset, direction: "none" } as const;
    const position = positionAtOffset(currentDocument.content, offset);
    selectionsRef.current.set(currentDocument.relativePath, selection);
    setCursor(position);
    setScrollSync({ line: position.line, target: "both" });
    pendingSearchNavigationRef.current = null;
    setSearchNavigationTarget(null);

    queueMicrotask(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      editor.setSelectionRange(offset, offset, "none");
    });
  }, [currentDocument, searchNavigationTarget]);

  useEffect(() => {
    if (workbenchSurface === "history" && currentDocument) {
      void history.refresh();
    } else if (workbenchSurface === "history") {
      setWorkbenchSurface("document");
    }
  }, [
    currentDocument?.relativePath,
    currentDocument?.revision.modifiedAtMs,
    currentDocument?.revision.sizeBytes,
    currentDocument?.savedContent,
    history.refresh,
    workbenchSurface,
  ]);

  const selectDocumentView = useCallback(
    (viewMode: ViewMode) => {
      setWorkbenchSurface("document");
      controller.selectView(viewMode);
    },
    [controller.selectView],
  );

  const toggleFocusMode = useCallback(() => {
    setWorkbenchSurface("document");
    controller.toggleFocus();
  }, [controller.toggleFocus]);

  const toggleHistory = useCallback(() => {
    if (!currentDocument) return;
    if (state.focusMode) controller.toggleFocus();
    setWorkbenchSurface((current) =>
      current === "history" ? "document" : "history",
    );
  }, [controller.toggleFocus, currentDocument, state.focusMode]);

  const toggleAppearance = useCallback(() => {
    if (state.focusMode) controller.toggleFocus();
    setWorkbenchSurface((current) =>
      current === "appearance" ? "document" : "appearance",
    );
  }, [controller.toggleFocus, state.focusMode]);

  const requestTabClose = useCallback(
    (id: string) => {
      const document = state.documents[id];
      if (!document) return;
      if (isDocumentDirty(document)) {
        setPendingClose({ id, exitApplication: false });
      } else {
        controller.closeDocument(id);
      }
    },
    [controller.closeDocument, state.documents],
  );

  const requestApplicationClose = useCallback(() => {
    const id = state.documentOrder.find((candidate) =>
      isDocumentDirty(state.documents[candidate]),
    );
    if (id) setPendingClose({ id, exitApplication: true });
  }, [state.documentOrder, state.documents]);

  const { cancelClose, requestClose } = useCloseProtection(
    dirty,
    controller.reportError,
  );

  const closeApplication = useCallback(() => {
    if (dirty) requestApplicationClose();
    else void requestClose();
  }, [dirty, requestApplicationClose, requestClose]);

  const closeCurrentTab = useCallback(() => {
    if (state.activeDocumentId) requestTabClose(state.activeDocumentId);
  }, [requestTabClose, state.activeDocumentId]);

  const openNewEditorWindow = useCallback(() => {
    if (newWindowInFlightRef.current) return;
    const operation = openNewWindow()
      .catch(controller.reportError)
      .finally(() => {
        if (newWindowInFlightRef.current === operation) {
          newWindowInFlightRef.current = null;
        }
      });
    newWindowInFlightRef.current = operation;
  }, [controller.reportError]);

  const handleNativeMenu = useCallback(
    (command: NativeMenuCommand) => {
      const actions: Partial<Record<NativeMenuCommand, () => void>> = {
        "app.quit": closeApplication,
        "file.new": () => void controller.newDocument(),
        "file.newWindow": openNewEditorWindow,
        "file.open": () => void controller.openFolder(),
        "file.save": () => void controller.saveDocument(),
        "file.saveAs": () => void controller.saveDocumentAs(),
        "file.closeTab": closeCurrentTab,
        "help.showCommands": () => setPaletteMode("commands"),
        "view.toggleSidebar": controller.toggleSidebar,
        "view.toggleFocus": toggleFocusMode,
        "view.live": () => selectDocumentView("live"),
        "view.edit": () => selectDocumentView("edit"),
        "view.split": () => selectDocumentView("split"),
        "view.preview": () => selectDocumentView("preview"),
      };
      actions[command]?.();
    },
    [
      closeApplication,
      closeCurrentTab,
      controller.newDocument,
      controller.openFolder,
      controller.reportError,
      controller.saveDocument,
      controller.saveDocumentAs,
      controller.toggleSidebar,
      openNewEditorWindow,
      selectDocumentView,
      toggleFocusMode,
    ],
  );
  useNativeMenu(handleNativeMenu, controller.reportError);

  const shortcutHandlers = useMemo(
    () => ({
      closeTab: closeCurrentTab,
      commandPalette: () => setPaletteMode("commands"),
      editView: () => selectDocumentView("edit"),
      focusMode: toggleFocusMode,
      liveView: () => selectDocumentView("live"),
      newDocument: () => void controller.newDocument(),
      newWindow: openNewEditorWindow,
      openFolder: () => void controller.openFolder(),
      previewView: () => selectDocumentView("preview"),
      quickOpen: () => setPaletteMode("files"),
      save: () => void controller.saveDocument(),
      saveAs: () => void controller.saveDocumentAs(),
      splitView: () => selectDocumentView("split"),
      toggleSidebar: controller.toggleSidebar,
    }),
    [
      closeCurrentTab,
      controller.newDocument,
      controller.openFolder,
      controller.reportError,
      controller.saveDocument,
      controller.saveDocumentAs,
      controller.toggleSidebar,
      openNewEditorWindow,
      selectDocumentView,
      toggleFocusMode,
    ],
  );
  useAppShortcuts(shortcutHandlers);

  const paletteItems = useMemo<CommandPaletteItem[]>(() => {
    if (paletteMode === "files") {
      return workspaceQuickEntries.map((entry) => ({
        id: `${entry.kind}:${entry.relativePath}`,
        label: entry.name,
        detail: entry.relativePath,
        icon:
          entry.kind === "image" ? (
            <ImageIcon size={16} />
          ) : (
            <FileMarkdownIcon size={16} />
          ),
        keywords: [entry.relativePath],
        section: t("Files"),
        onSelect: () =>
          entry.kind === "image"
            ? openWorkspaceImage(entry.relativePath, entry.name)
            : void controller.openDocument(entry.relativePath),
      }));
    }
    return [
      {
        id: "new-window",
        label: t("New window"),
        detail: t("Open another folder without closing this workspace"),
        icon: <PlusIcon size={16} />,
        shortcut: shortcutLabels.newWindow,
        section: t("File"),
        onSelect: openNewEditorWindow,
      },
      {
        id: "open-folder",
        label: t("Open folder"),
        detail: t("Choose a local Markdown workspace"),
        icon: <FolderOpenIcon size={16} />,
        shortcut: shortcutLabels.openFolder,
        section: t("File"),
        onSelect: () => void controller.openFolder(),
      },
      {
        id: "new-document",
        label: t("New document"),
        detail: t("Create a Markdown file in this folder"),
        disabled: !state.workspace,
        icon: <PlusIcon size={16} />,
        shortcut: shortcutLabels.newDocument,
        section: t("File"),
        onSelect: () => void controller.newDocument(),
      },
      {
        id: "save",
        label: t("Save document"),
        disabled: !currentDocument,
        icon: <FileMarkdownIcon size={16} />,
        shortcut: shortcutLabels.save,
        section: t("File"),
        onSelect: () => void controller.saveDocument(),
      },
      {
        id: "file-history",
        label:
          workbenchSurface === "history"
            ? t("Return to document")
            : t("File history"),
        detail: t("Inspect and load local saved versions"),
        disabled: !currentDocument,
        icon: <HistoryIcon size={16} />,
        section: t("Document"),
        onSelect: toggleHistory,
      },
      {
        id: "appearance",
        label:
          workbenchSurface === "appearance"
            ? t("Return to document")
            : t("Appearance and background"),
        detail: t("Theme, illustration, and local background image"),
        icon: <SettingsIcon size={16} />,
        section: t("Appearance"),
        onSelect: toggleAppearance,
      },
      {
        id: "toggle-sidebar",
        label: state.sidebarVisible ? t("Hide sidebar") : t("Show sidebar"),
        disabled: !state.workspace,
        icon: <SidebarIcon size={16} />,
        shortcut: shortcutLabels.toggleSidebar,
        section: t("View"),
        onSelect: controller.toggleSidebar,
      },
      {
        id: "focus-mode",
        label: state.focusMode ? t("Leave focus mode") : t("Enter focus mode"),
        disabled: !currentDocument,
        icon: <EditIcon size={16} />,
        shortcut: shortcutLabels.focusMode,
        section: t("View"),
        onSelect: toggleFocusMode,
      },
      ...documentViewOptions.map((option, index) => ({
        id: `view-${option.value}`,
        label: fmt("%@ view", option.label),
        disabled: !currentDocument,
        icon: option.icon,
        shortcut: shortcutLabels.view(index + 1),
        section: t("View"),
        onSelect: () => selectDocumentView(option.value),
      })),
      ...([
        ["system", t("System appearance")],
        ["light", t("Light appearance")],
        ["dark", t("Dark appearance")],
      ] as const).map(([appearance, label]) => ({
        id: `theme-${appearance}`,
        label,
        icon: theme === appearance ? <CheckIcon size={16} /> : undefined,
        section: t("Appearance"),
        onSelect: () => setTheme(appearance),
      })),
    ];
  }, [
    controller.newDocument,
    controller.openDocument,
    controller.openFolder,
    controller.reportError,
    controller.saveDocument,
    controller.toggleSidebar,
    currentDocument,
    documentViewOptions,
    openWorkspaceImage,
    openNewEditorWindow,
    paletteMode,
    state.focusMode,
    state.sidebarVisible,
    state.workspace,
    theme,
    fmt,
    t,
    toggleAppearance,
    toggleFocusMode,
    toggleHistory,
    selectDocumentView,
    shortcutLabels,
    workbenchSurface,
    workspaceQuickEntries,
  ]);

  const handleDiscard = useCallback(async () => {
    if (!pendingClose) return;
    const nextDirty = state.documentOrder.find(
      (id) => id !== pendingClose.id && isDocumentDirty(state.documents[id]),
    );
    if (pendingClose.exitApplication && !nextDirty) {
      if (await requestClose()) setPendingClose(null);
      return;
    }
    controller.closeDocument(pendingClose.id);
    if (pendingClose.exitApplication && nextDirty) {
      setPendingClose({ id: nextDirty, exitApplication: true });
    } else {
      setPendingClose(null);
    }
  }, [
    controller.closeDocument,
    pendingClose,
    requestClose,
    state.documentOrder,
    state.documents,
  ]);

  const handleSaveBeforeClose = useCallback(async () => {
    if (!pendingClose) return;
    setDialogSaving(true);
    const saved = await controller.saveDocument(pendingClose.id);
    setDialogSaving(false);
    if (!saved) return;

    const nextDirty = state.documentOrder.find(
      (id) => id !== pendingClose.id && isDocumentDirty(state.documents[id]),
    );
    if (pendingClose.exitApplication && nextDirty) {
      setPendingClose({ id: nextDirty, exitApplication: true });
    } else if (pendingClose.exitApplication) {
      if (await requestClose()) setPendingClose(null);
    } else {
      controller.closeDocument(pendingClose.id);
      setPendingClose(null);
    }
  }, [controller, pendingClose, requestClose, state.documentOrder, state.documents]);

  const handleCloseCancel = useCallback(async () => {
    if (!pendingClose) return;
    if (pendingClose.exitApplication && !(await cancelClose())) return;
    setPendingClose(null);
  }, [cancelClose, pendingClose]);

  const handleLinkRequest = useCallback(
    (href: string) => {
      if (!href || href.startsWith("#")) return;
      if (/^(?:https?:|mailto:)/i.test(href)) {
        void openExternalUrl(href).catch(controller.reportError);
        return;
      }
      if (!currentDocument) return;
      const relativePath = resolveMarkdownLink(currentDocument.relativePath, href);
      if (relativePath) void controller.openDocument(relativePath);
    },
    [controller.openDocument, controller.reportError, currentDocument],
  );

  const openSearchResult = useCallback(
    async (result: (typeof searchResults)[number]) => {
      const target = {
        relativePath: result.relativePath,
        line: result.line,
        column: result.column,
      };
      pendingSearchNavigationRef.current = target;
      setSearchNavigationTarget(target);
      selectDocumentView("edit");
      if (!(await controller.openDocument(result.relativePath))) {
        if (pendingSearchNavigationRef.current === target) {
          pendingSearchNavigationRef.current = null;
          setSearchNavigationTarget(null);
        }
      }
    },
    [controller.openDocument, selectDocumentView],
  );

  const requestHistoryLoad = useCallback(
    (entry: HistoryEntry) => {
      if (!currentDocument || entry.content === undefined) return;
      const lineEnding = entry.lineEnding ?? currentDocument.lineEnding;
      if (
        entry.content === currentDocument.content &&
        lineEnding === currentDocument.lineEnding
      ) {
        setWorkbenchSurface("document");
        return;
      }
      if (isDocumentDirty(currentDocument)) {
        setPendingHistoryLoad({
          content: entry.content,
          documentId: currentDocument.relativePath,
          documentName: currentDocument.name,
          lineEnding,
          versionLabel: entry.label,
        });
        return;
      }
      controller.changeDocument(
        currentDocument.relativePath,
        entry.content,
        lineEnding,
      );
      setWorkbenchSurface("document");
    },
    [controller.changeDocument, currentDocument],
  );

  const confirmHistoryLoad = useCallback(() => {
    if (!pendingHistoryLoad) return;
    controller.changeDocument(
      pendingHistoryLoad.documentId,
      pendingHistoryLoad.content,
      pendingHistoryLoad.lineEnding,
    );
    controller.activateDocument(pendingHistoryLoad.documentId);
    setPendingHistoryLoad(null);
    setWorkbenchSurface("document");
  }, [controller.activateDocument, controller.changeDocument, pendingHistoryLoad]);

  const appStyle = {
    "--sidebar-preferred-width": `${sidebarWidth}px`,
    "--split-preferred-position": `${splitPosition}%`,
  } as CSSProperties;

  const titleBar = (
    <TitleBar
      actions={
        <>
          <SegmentedControl<ViewMode>
            disabled={!currentDocument}
            iconOnly
            label={t("Document view")}
            onChange={selectDocumentView}
            options={documentViewOptions}
            size="small"
            value={
              state.viewMode === "live" && liveDocumentTooLarge
                ? "edit"
                : state.viewMode
            }
          />
          <IconButton
            disabled={!currentDocument}
            label={
              workbenchSurface === "history"
                ? t("Return to document")
                : t("File history")
            }
            onClick={toggleHistory}
            selected={workbenchSurface === "history"}
            size="small"
          >
            <HistoryIcon size={16} />
          </IconButton>
          <IconButton
            disabled={!currentDocument}
            label={state.focusMode ? t("Leave focus mode") : t("Focus mode")}
            onClick={toggleFocusMode}
            shortcut={shortcutLabels.focusMode}
            size="small"
          >
            <CommandIcon size={16} />
          </IconButton>
        </>
      }
      dirty={Boolean(currentDocument && isDocumentDirty(currentDocument))}
      leading={
        <IconButton
          disabled={!state.workspace}
          label={state.sidebarVisible ? t("Hide sidebar") : t("Show sidebar")}
          onClick={controller.toggleSidebar}
          shortcut={shortcutLabels.toggleSidebar}
          size="small"
        >
          <SidebarIcon size={16} />
        </IconButton>
      }
      subtitle={state.workspace?.name}
      title={
        <button
          className="title-bar__command"
          onClick={() => setPaletteMode(state.workspace ? "files" : "commands")}
          type="button"
        >
          <span>{currentDocument?.name ?? "Viva"}</span>
          <kbd>
            {state.workspace
              ? shortcutLabels.quickOpen
              : shortcutLabels.commandPalette}
          </kbd>
        </button>
      }
    />
  );

  if (!state.workspace) {
    return (
      <div className="app-shell app-shell--welcome" style={appStyle}>
        {titleBar}
        <Welcome
          busy={busy}
          onNewDocument={() => void controller.newDocument()}
          onOpenFolder={() => void controller.openFolder()}
          onOpenRecent={(path) => void controller.openRecentWorkspace(path)}
          recentWorkspaces={recentWorkspaces}
        />
        <StatusBar message={status.message} messageTone={status.tone} />
        <CommandPalette
          items={paletteItems}
          onOpenChange={(open) => setPaletteMode(open ? paletteMode : null)}
          open={paletteMode !== null}
        />
      </div>
    );
  }

  const activeSelection = currentDocument
    ? (selectionsRef.current.get(currentDocument.relativePath) ?? null)
    : null;
  const pendingDocument = pendingClose
    ? state.documents[pendingClose.id]
    : undefined;

  const sidebarContent =
    state.activity === "files" ? (
      <FileTree
        activePath={imageViewerSource?.relativePath ?? state.activeDocumentId}
        expandedPaths={state.expandedPaths}
        modifiedPaths={modifiedPaths}
        nodes={state.workspace.children}
        onOpen={(path) => {
          if (workspaceImagePaths.has(path)) openWorkspaceImage(path);
          else void controller.openDocument(path);
        }}
        onReveal={(path) => {
          const workspaceRoot = state.workspace?.rootPath;
          if (!workspaceRoot) return;
          void revealWorkspaceItem(workspaceRoot, path).catch(
            controller.reportError,
          );
        }}
        onToggle={controller.toggleTreePath}
        renderIcon={(node: FileTreeNode, iconState) =>
          node.kind === "directory" ? (
            iconState.expanded ? (
              <FolderOpenIcon size={15} />
            ) : (
              <FolderIcon size={15} />
            )
          ) : node.kind === "image" ? (
            <ImageIcon size={15} />
          ) : (
            <FileMarkdownIcon size={15} />
          )
        }
      />
    ) : state.activity === "search" ? (
      <SearchPanel
        clearIcon="×"
        loading={searching}
        onOpenResult={(result) => void openSearchResult(result)}
        onQueryChange={setSearchQuery}
        onSubmit={(query) => void controller.runSearch(query)}
        query={searchQuery}
        results={searchResults}
        searchIcon={<SearchIcon size={15} />}
      />
    ) : (
      <OutlinePanel
        activeSourceLine={cursor.line}
        heading={null}
        items={liveMarkdown.rendered.outline}
        onSelect={(item) => setScrollSync({ line: item.sourceLine, target: "both" })}
      />
    );

  return (
    <div
      className="app-shell"
      data-focus={state.focusMode || undefined}
      style={appStyle}
    >
      {!state.focusMode ? (
        titleBar
      ) : platform === "windows" ? (
        <TitleBar className="title-bar--window-only" title={null} />
      ) : null}
      <div className="app-body">
        {!state.focusMode ? (
          <>
            <ActivityRail
              activeId={state.activity}
              footer={
                <>
                  <IconButton
                    label={t("New document")}
                    onClick={() => void controller.newDocument()}
                    shortcut={shortcutLabels.newDocument}
                    size="medium"
                    tooltipPlacement="right"
                  >
                    <PlusIcon size={17} />
                  </IconButton>
                  <IconButton
                    label={
                      workbenchSurface === "appearance"
                        ? t("Return to document")
                        : t("Appearance and background")
                    }
                    onClick={toggleAppearance}
                    selected={workbenchSurface === "appearance"}
                    size="medium"
                    tooltipPlacement="right"
                  >
                    <SettingsIcon size={17} />
                  </IconButton>
                </>
              }
              items={[
                { id: "files", label: t("Files"), icon: <FilesIcon size={18} /> },
                {
                  id: "search",
                  label: t("Search"),
                  icon: <SearchIcon size={18} />,
                },
                {
                  id: "outline",
                  label: t("Outline"),
                  icon: <OutlineIcon size={18} />,
                },
              ]}
              onSelect={(activity) => {
                setWorkbenchSurface("document");
                controller.selectActivity(activity);
              }}
            />
            {state.sidebarVisible ? (
              <>
                <Sidebar
                  headerActions={
                    state.activity === "files" ? (
                      <IconButton
                        label={t("New document")}
                        onClick={() => void controller.newDocument()}
                        size="small"
                      >
                        <PlusIcon size={15} />
                      </IconButton>
                    ) : undefined
                  }
                  title={
                    state.activity === "files"
                      ? state.workspace.name
                      : state.activity === "search"
                        ? t("Search")
                        : t("Outline")
                  }
                >
                  {sidebarContent}
                </Sidebar>
                <div className="sidebar-divider">
                  <ResizeHandle
                    label={t("Resize sidebar")}
                    onDelta={(delta) =>
                      setSidebarWidth((current) =>
                        resizedSidebarWidth(current, delta),
                      )
                    }
                  />
                </div>
              </>
            ) : null}
          </>
        ) : null}

        <main className="workbench">
          {!state.focusMode ? (
            <DocumentTabs
              activeId={state.activeDocumentId}
              closeIcon="×"
              onActivate={controller.activateDocument}
              onClose={requestTabClose}
              onSave={(id) => void controller.saveDocument(id)}
              onSaveAs={(id) => void controller.saveDocumentAs(id)}
              tabs={tabs}
            />
          ) : null}

          {workbenchSurface === "history" && currentDocument ? (
            <HistoryPanel
              currentContent={currentDocument.content}
              entries={history.entries}
              error={history.error}
              fileName={currentDocument.relativePath}
              loading={history.loading}
              onLoadVersion={requestHistoryLoad}
              onRetry={() => void history.refresh()}
              onSelect={(versionId) => void history.select(versionId)}
              previewLoading={history.previewLoading}
              selectedId={history.selectedId}
            />
          ) : workbenchSurface === "appearance" ? (
            <div className="appearance-workspace viva-scroll-region">
              <div className="appearance-workspace__inner">
                <section
                  aria-labelledby="appearance-theme-title"
                  className="appearance-workspace__theme"
                >
                  <div>
                    <h2 id="appearance-theme-title">{t("Theme")}</h2>
                    <p>{t("Follow the system or keep Viva consistently light or dark.")}</p>
                  </div>
                  <SegmentedControl<ThemePreference>
                    label={t("Application theme")}
                    onChange={setTheme}
                    options={[
                      { label: t("System"), value: "system" },
                      { label: t("Light"), value: "light" },
                      { label: t("Dark"), value: "dark" },
                    ]}
                    size="small"
                    value={theme}
                  />
                </section>
                <section
                  aria-labelledby="appearance-language-title"
                  className="appearance-workspace__theme"
                >
                  <div>
                    <h2 id="appearance-language-title">{t("Language")}</h2>
                    <p>{t("Follow the system language or choose one for Viva.")}</p>
                  </div>
                  <SegmentedControl<LanguagePreference>
                    label={t("Application language")}
                    onChange={setPreference}
                    options={[
                      { label: t("System"), value: "system" },
                      { label: t("English"), value: "en" },
                      { label: t("简体中文"), value: "zh-Hans" },
                    ]}
                    size="small"
                    value={preference}
                  />
                </section>
                <AppearancePanel controller={background} />
              </div>
            </div>
          ) : currentDocument ? (
            <div
              className="editor-stage"
              data-background={
                background.settings.source !== "none" &&
                (background.settings.source === "viva" || background.assetUrl)
                  ? "true"
                  : undefined
              }
              data-view={state.focusMode ? "edit" : state.viewMode}
              ref={editorStageRef}
            >
              <BackgroundLayer
                assetUrl={background.assetUrl}
                settings={background.settings}
              />
              {state.viewMode === "live" && !liveDocumentTooLarge ? (
                <LiveEditorPane
                  ariaLabel={fmt("Live editing %@", currentDocument.name)}
                  documentId={currentDocument.relativePath}
                  format={documentFormat}
                  onChange={(content) =>
                    controller.changeDocument(currentDocument.relativePath, content)
                  }
                  onLinkRequest={handleLinkRequest}
                  onImageRequest={handleImageRequest}
                  onPositionChange={setCursor}
                  value={currentDocument.content}
                  workspaceRoot={state.workspace.rootPath}
                />
              ) : state.focusMode || state.viewMode !== "preview" ? (
                <EditorPane
                  ariaLabel={fmt("Editing %@", currentDocument.name)}
                  autoFocus
                  ref={editorRef}
                  onChange={(content) =>
                    controller.changeDocument(currentDocument.relativePath, content)
                  }
                  onSelectionChange={(selection) =>
                    selectionsRef.current.set(currentDocument.relativePath, selection)
                  }
                  onPositionChange={largeDocument ? undefined : setCursor}
                  onSourceLineChange={
                    largeDocument
                      ? undefined
                      : (line) => setScrollSync({ line, target: "preview" })
                  }
                  revealSourceLine={
                    !largeDocument &&
                    (scrollSync.target === "editor" || scrollSync.target === "both")
                      ? scrollSync.line
                      : null
                  }
                  selection={activeSelection}
                  showPosition={false}
                  value={currentDocument.content}
                />
              ) : null}

              {!state.focusMode && state.viewMode === "split" ? (
                <div className="editor-stage__divider">
                  <ResizeHandle
                    label={t("Resize editor and preview")}
                    onDelta={(delta) => {
                      const width = editorStageRef.current?.clientWidth ?? 1;
                      setSplitPosition((current) =>
                        resizedSplitPosition(current, delta, width),
                      );
                    }}
                  />
                </div>
              ) : null}

              {!state.focusMode &&
              (state.viewMode === "split" || state.viewMode === "preview") ? (
                <PreviewPane
                  ariaLabel={fmt("Previewing %@", currentDocument.name)}
                  documentPath={currentDocument.relativePath}
                  format={documentFormat}
                  onImageRequest={handleImageRequest}
                  onLinkRequest={handleLinkRequest}
                  onSourceLineChange={
                    largeDocument
                      ? undefined
                      : (line) => setScrollSync({ line, target: "editor" })
                  }
                  onSourceLineSelect={
                    largeDocument
                      ? undefined
                      : (line) => setScrollSync({ line, target: "editor" })
                  }
                  revealSourceLine={
                    !largeDocument &&
                    (scrollSync.target === "preview" || scrollSync.target === "both")
                      ? scrollSync.line
                      : null
                  }
                  rendered={liveMarkdown.rendered}
                  source={liveMarkdown.source}
                  truncated={liveMarkdown.truncated}
                  workspaceRoot={state.workspace.rootPath}
                />
              ) : null}
            </div>
          ) : (
            <EmptyState
              actions={
                <Button
                  onClick={() => void controller.newDocument()}
                  startIcon={<PlusIcon size={16} />}
                  variant="primary"
                >
                  {t("New document")}
                </Button>
              }
              description={t("Choose a Markdown file from the sidebar or create a new one.")}
              icon={<FileMarkdownIcon size={18} />}
              title={t("The workspace is ready")}
            />
          )}
        </main>
      </div>

      {!state.focusMode ? (
        <StatusBar
          column={currentDocument && !largeDocument ? cursor.column : undefined}
          encoding={currentDocument ? "UTF-8" : undefined}
          line={currentDocument && !largeDocument ? cursor.line : undefined}
          message={status.message}
          messageTone={status.tone}
          readingMinutes={
            currentDocument ? documentStats?.minutes : undefined
          }
          trailing={
            state.viewMode === "live" && liveDocumentTooLarge ? (
              <span className="status-bar__item">
                {t("Large document · Live switched to Source")}
              </span>
            ) : (state.viewMode === "split" || state.viewMode === "preview") &&
              liveMarkdown.truncated ? (
              <span className="status-bar__item">
                {t("Large document · preview bounded")}
              </span>
            ) : state.activity === "outline" && liveMarkdown.truncated ? (
              <span className="status-bar__item">
                {t("Large document · outline bounded")}
              </span>
            ) : undefined
          }
          wordCount={currentDocument ? documentStats?.words : undefined}
        />
      ) : null}

      <CommandPalette
        emptyMessage={paletteMode === "files" ? t("No matching files") : undefined}
        footer={
          <span className="command-palette-hint">
            <kbd>↑↓</kbd> {t("Navigate")} <kbd>↵</kbd> {t("Open")} <kbd>esc</kbd> {t("Close")}
          </span>
        }
        items={paletteItems}
        label={paletteMode === "files" ? t("Quick open") : t("Command palette")}
        onOpenChange={(open) => setPaletteMode(open ? paletteMode : null)}
        open={paletteMode !== null}
        placeholder={paletteMode === "files" ? t("Open a file…") : t("Type a command…")}
      />

      <UnsavedChangesDialog
        documentName={pendingDocument?.name ?? t("this document")}
        onCancel={() => void handleCloseCancel()}
        onDiscard={() => void handleDiscard()}
        onSave={() => void handleSaveBeforeClose()}
        open={Boolean(pendingClose)}
        saving={dialogSaving}
        scope={pendingClose?.exitApplication ? "application" : "document"}
      />

      <Dialog
        description={t("The current draft has changes that are not in local history.")}
        footer={
          <>
            <span className="viva-dialog__footer-spacer" />
            <Button
              autoFocus
              onClick={() => setPendingHistoryLoad(null)}
              variant="ghost"
            >
              {t("Keep current draft")}
            </Button>
            <Button onClick={confirmHistoryLoad} variant="danger">
              {t("Replace unsaved draft")}
            </Button>
          </>
        }
        onClose={() => setPendingHistoryLoad(null)}
        open={Boolean(pendingHistoryLoad)}
        size="small"
        title={fmt(
          "Load “%@”?",
          pendingHistoryLoad?.versionLabel ?? t("saved version"),
        )}
      >
        {fmt(
          "Replacing “%@” will discard its current unsaved text. This cannot be recovered from Viva’s saved history.",
          pendingHistoryLoad?.documentName ?? t("this document"),
        )}
      </Dialog>

      <ImageViewer
        labels={{
          close: t("Close image viewer"),
          decodeError: t("This image could not be displayed."),
          loading: t("Loading image…"),
          resetZoom: t("Fit image"),
          title: t("Image viewer"),
          zoomIn: t("Zoom in"),
          zoomOut: t("Zoom out"),
        }}
        onClose={() => setImageViewerSource(null)}
        source={imageViewerSource}
      />
    </div>
  );
}
