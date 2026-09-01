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
  type CommandPaletteDataItem,
  type CommandPaletteItem,
} from "./components/ui";
import {
  flattenFiles,
  flattenImages,
  isPathWithinEntry,
  isDocumentDirty,
  remapEntryPath,
  type FileKind,
  type FileTreeNode,
  type LineEnding,
  type ViewMode,
} from "./domain/workspace";
import {
  ActivityRail,
  AppearancePanel,
  BackgroundLayer,
  DocumentTabs,
  DuplicateEntryDialog,
  EditorPane,
  EntryNameDialog,
  FileTree,
  FindBar,
  HistoryPanel,
  ImageViewer,
  LiveEditorPane,
  MoveToTrashDialog,
  OutlinePanel,
  PreviewPane,
  SearchPanel,
  Sidebar,
  StatusBar,
  TitleBar,
  useBackgroundSettings,
  countLiteralMatches,
  createImagePasteId,
  hasImagePasteToken,
  findLiteralMatchAt,
  findLiteralMatchIndexAtOrAfter,
  findLiteralMatchIndexAtOffset,
  insertImagePasteToken,
  offsetAtPosition,
  positionAtOffset,
  removeImagePasteToken,
  replaceAllLiteralMatches,
  replaceOneMatch,
  resolveImagePasteToken,
  stepMatchIndex,
  wrapMatchIndex,
  type EditorPosition,
  type EntryNameDialogMode,
  type FileTreeFocusRequest,
  type FindBarFocusTarget,
  type ImageViewerSource,
  type HistoryEntry,
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
import { resolveLocalImagePath, workspaceImageCache } from "./lib/media";
import {
  assertWorkspaceImageSize,
  cancelWorkspaceImage,
  commitWorkspaceImage,
  createWorkspaceImage,
  hasNativeShell,
  openExternalUrl,
  openNewWindow,
  revealWorkspaceItem,
  setNativeMenuLanguage,
} from "./lib/native";
import { boundTextPrefix } from "./lib/textBounds";
import FindScanWorker from "./features/find/find.worker?worker";
import type { FindWorkerResponse } from "./features/find/findWorkerProtocol";

type PaletteMode = "files" | "commands" | null;
type FindMode = "find" | "replace" | null;
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

interface EntryNameRequest {
  entryKind: "file" | "folder";
  initialValue: string;
  mode: EntryNameDialogMode;
  parentPath: string;
  relativePath?: string;
  workspaceRoot: string;
}

interface PendingEntryOperation {
  affectedDocumentIds: string[];
  affectedDirtyDocumentIds: string[];
  kind: FileKind;
  name: string;
  relativePath: string;
  workspaceRoot: string;
}

interface PendingImagePasteOperation {
  cancel: () => Promise<void>;
  cancelled: boolean;
  promise: Promise<void>;
  referenced: boolean;
  token: string;
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

interface FindScanState {
  activeIndex: number;
  caseSensitive: boolean;
  content: string | null;
  count: number;
  documentId: string | null;
  match?: { end: number; start: number };
  query: string;
  wholeWord: boolean;
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

function imagePasteOperationKey(
  workspaceRoot: string,
  relativePath: string,
): string {
  return `${workspaceRoot}\u0000${relativePath}`;
}

function waitForStateCommit(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

function findWorkspaceEntry(
  nodes: readonly FileTreeNode[],
  relativePath: string,
): FileTreeNode | null {
  for (const node of nodes) {
    if (node.relativePath === relativePath) return node;
    if (node.kind === "directory") {
      const nested = findWorkspaceEntry(node.children, relativePath);
      if (nested) return nested;
    }
  }
  return null;
}

function parentPath(relativePath: string): string {
  const separator = relativePath.lastIndexOf("/");
  return separator < 0 ? "" : relativePath.slice(0, separator);
}

function markdownTitle(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const title = (dot > 0 ? fileName.slice(0, dot) : fileName).trim();
  return title || "Untitled";
}

function remapPathMap<T>(
  source: ReadonlyMap<string, T>,
  sourcePath: string,
  destinationPath: string,
): Map<string, T> {
  const remapped = new Map<string, T>();
  for (const [path, value] of source) {
    remapped.set(
      isPathWithinEntry(path, sourcePath)
        ? remapEntryPath(path, sourcePath, destinationPath)
        : path,
      value,
    );
  }
  return remapped;
}

function visibleWorkspacePaths(
  nodes: readonly FileTreeNode[],
  expandedPaths: ReadonlySet<string>,
): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    paths.push(node.relativePath);
    if (node.kind === "directory" && expandedPaths.has(node.relativePath)) {
      paths.push(...visibleWorkspacePaths(node.children, expandedPaths));
    }
  }
  return paths;
}

function focusPathAfterRemoval(
  nodes: readonly FileTreeNode[],
  expandedPaths: readonly string[],
  removedPath: string,
): string {
  const visible = visibleWorkspacePaths(nodes, new Set(expandedPaths));
  const removedIndex = visible.indexOf(removedPath);
  const survivors = visible.filter(
    (path) => !isPathWithinEntry(path, removedPath),
  );
  if (!survivors.length) return "";
  if (removedIndex < 0) return survivors[0] ?? "";
  const preceding = visible
    .slice(0, removedIndex)
    .filter((path) => !isPathWithinEntry(path, removedPath)).length;
  return survivors[Math.min(preceding, survivors.length - 1)] ?? "";
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
  const [imageCacheRevision, setImageCacheRevision] = useState(0);
  const [workbenchSurface, setWorkbenchSurface] =
    useState<WorkbenchSurface>("document");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResultsQuery, setSearchResultsQuery] = useState<string | null>(
    null,
  );
  const [findMode, setFindMode] = useState<FindMode>(null);
  const [findQuery, setFindQuery] = useState("");
  const [findReplacement, setFindReplacement] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findWholeWord, setFindWholeWord] = useState(false);
  const [findActiveIndex, setFindActiveIndex] = useState(-1);
  const [findFocusTarget, setFindFocusTarget] =
    useState<FindBarFocusTarget>("query");
  const [findFocusEpoch, setFindFocusEpoch] = useState(0);
  const [findRevealRequestId, setFindRevealRequestId] = useState(0);
  const [findScan, setFindScan] = useState<FindScanState>({
    activeIndex: -1,
    caseSensitive: false,
    content: null,
    count: 0,
    documentId: null,
    query: "",
    wholeWord: false,
  });
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [pendingHistoryLoad, setPendingHistoryLoad] =
    useState<PendingHistoryLoad | null>(null);
  const [entryNameRequest, setEntryNameRequest] =
    useState<EntryNameRequest | null>(null);
  const [entryNameError, setEntryNameError] = useState<string | null>(null);
  const [pendingDuplicate, setPendingDuplicate] =
    useState<PendingEntryOperation | null>(null);
  const [pendingTrash, setPendingTrash] =
    useState<PendingEntryOperation | null>(null);
  const [entryOperationBusy, setEntryOperationBusy] = useState(false);
  const [entryOperationError, setEntryOperationError] =
    useState<string | null>(null);
  const [fileTreeFocusRequest, setFileTreeFocusRequest] =
    useState<FileTreeFocusRequest | null>(null);
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
  const searchGenerationRef = useRef(0);
  const searchQueryRef = useRef(searchQuery);
  const newWindowInFlightRef = useRef<Promise<void> | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editorStageRef = useRef<HTMLDivElement>(null);
  const liveDocumentContentRef = useRef(new Map<string, string>());
  const pendingImagePastesRef = useRef(
    new Map<string, Set<PendingImagePasteOperation>>(),
  );
  const fileTreeFocusIdRef = useRef(0);
  const findReturnFocusRef = useRef<HTMLElement | null>(null);
  const findActiveIndexRef = useRef(findActiveIndex);
  const findSelectionOffsetRef = useRef<number | null>(null);
  const findWorkerGenerationRef = useRef(0);
  const findWorkerRequestRef = useRef(0);
  const findWorkerRef = useRef<Worker | null>(null);
  const controllerRef = useRef(controller);
  const workspaceStateRef = useRef(state);
  const workspaceRootRef = useRef(state.workspace?.rootPath ?? null);
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
  controllerRef.current = controller;
  workspaceStateRef.current = state;
  workspaceRootRef.current = state.workspace?.rootPath ?? null;
  findActiveIndexRef.current = findActiveIndex;
  liveDocumentContentRef.current = new Map(
    Object.entries(state.documents).map(([id, document]) => [
      id,
      document.content,
    ]),
  );
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
  const findScanIsCurrent = Boolean(
    findMode !== null &&
      currentDocument &&
      findScan.documentId === currentDocument.relativePath &&
      findScan.content === currentDocument.content &&
      findScan.query === findQuery &&
      findScan.caseSensitive === findCaseSensitive &&
      findScan.wholeWord === findWholeWord,
  );
  const findMatchCount = findScanIsCurrent ? findScan.count : 0;
  const resolvedFindIndex = findScanIsCurrent ? findScan.activeIndex : -1;
  const activeFindMatch = findScanIsCurrent ? findScan.match : undefined;
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
  const quickOpenPaletteItems = useMemo<CommandPaletteDataItem[]>(
    () =>
      workspaceQuickEntries.map((entry) => ({
        detail: entry.relativePath,
        id: `${entry.kind}:${entry.relativePath}`,
        label: entry.name,
        searchText: entry.relativePath,
        section: t("Files"),
        value: entry.relativePath,
      })),
    [t, workspaceQuickEntries],
  );
  const handleQuickOpenSelect = useCallback(
    (item: CommandPaletteDataItem) => {
      if (!item.value) return;
      if (item.id.startsWith("image:")) {
        openWorkspaceImage(item.value, item.label);
      } else {
        void controller.openDocument(item.value);
      }
    },
    [controller.openDocument, openWorkspaceImage],
  );
  const renderQuickOpenIcon = useCallback(
    (item: CommandPaletteDataItem) =>
      item.id.startsWith("image:") ? (
        <ImageIcon size={16} />
      ) : (
        <FileMarkdownIcon size={16} />
      ),
    [],
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
  const changeDocumentContent = useCallback(
    (id: string, content: string, lineEnding?: LineEnding) => {
      liveDocumentContentRef.current.set(id, content);
      if (lineEnding === undefined) {
        controller.changeDocument(id, content);
      } else {
        controller.changeDocument(id, content, lineEnding);
      }
    },
    [controller.changeDocument],
  );

  const imagePasteContextIsLive = useCallback(
    (workspaceRoot: string, relativePath: string, token: string) => {
      if (
        workspaceRootRef.current !== workspaceRoot ||
        !workspaceStateRef.current.documents[relativePath]
      ) {
        return false;
      }
      const content = liveDocumentContentRef.current.get(relativePath);
      return content !== undefined && hasImagePasteToken(content, token);
    },
    [],
  );

  const removeRegisteredImagePasteToken = useCallback(
    (workspaceRoot: string, relativePath: string, token: string) => {
      if (
        workspaceRootRef.current !== workspaceRoot ||
        !workspaceStateRef.current.documents[relativePath]
      ) {
        return;
      }
      const content = liveDocumentContentRef.current.get(relativePath);
      if (content === undefined) return;
      const selection =
        selectionsRef.current.get(relativePath) ??
        ({ direction: "none", end: content.length, start: content.length } as const);
      const settled = removeImagePasteToken(content, selection, token);
      if (!settled.applied) return;
      selectionsRef.current.set(relativePath, settled.selection);
      changeDocumentContent(relativePath, settled.value);
    },
    [changeDocumentContent],
  );

  const registerImagePaste = useCallback(
    (
      workspaceRoot: string,
      relativePath: string,
      operation: PendingImagePasteOperation,
    ) => {
      const key = imagePasteOperationKey(workspaceRoot, relativePath);
      const operations = pendingImagePastesRef.current.get(key) ?? new Set();
      operations.add(operation);
      pendingImagePastesRef.current.set(key, operations);
      void operation.promise.finally(() => {
        operations.delete(operation);
        if (operations.size === 0) pendingImagePastesRef.current.delete(key);
      });
    },
    [],
  );

  const cancelImagePastes = useCallback(
    async (workspaceRoot: string, relativePath?: string): Promise<void> => {
      const pending: Promise<void>[] = [];
      const prefix = `${workspaceRoot}\u0000`;
      for (const [key, operations] of pendingImagePastesRef.current) {
        if (
          relativePath
            ? key !== imagePasteOperationKey(workspaceRoot, relativePath)
            : !key.startsWith(prefix)
        ) {
          continue;
        }
        for (const operation of operations) {
          pending.push(operation.cancel(), operation.promise);
        }
      }
      await Promise.all(pending);
    },
    [],
  );

  const prepareDocumentForSave = useCallback(
    async (relativePath: string): Promise<boolean> => {
      const workspaceRoot = workspaceRootRef.current;
      if (!workspaceRoot || !workspaceStateRef.current.documents[relativePath]) {
        return false;
      }
      const key = imagePasteOperationKey(workspaceRoot, relativePath);

      for (;;) {
        const operations = pendingImagePastesRef.current.get(key);
        if (operations?.size) {
          await Promise.all(
            [...operations].map((operation) => operation.promise),
          );
          await waitForStateCommit();
          if (workspaceRootRef.current !== workspaceRoot) return false;
          continue;
        }

        return Boolean(
          liveDocumentContentRef.current.has(relativePath) &&
            workspaceRootRef.current === workspaceRoot &&
            workspaceStateRef.current.documents[relativePath],
        );
      }
    },
    [],
  );

  const saveDocument = useCallback(
    async (
      relativePath = workspaceStateRef.current.activeDocumentId ?? "",
    ): Promise<boolean> => {
      if (!relativePath || !(await prepareDocumentForSave(relativePath))) {
        return false;
      }
      return controllerRef.current.saveDocument(relativePath);
    },
    [prepareDocumentForSave],
  );

  const saveDocumentAs = useCallback(
    async (
      relativePath = workspaceStateRef.current.activeDocumentId ?? "",
    ): Promise<boolean> => {
      if (!relativePath || !(await prepareDocumentForSave(relativePath))) {
        return false;
      }
      return controllerRef.current.saveDocumentAs(relativePath);
    },
    [prepareDocumentForSave],
  );

  const requestFileTreeFocus = useCallback((relativePath: string) => {
    if (!relativePath) {
      setFileTreeFocusRequest({
        id: ++fileTreeFocusIdRef.current,
        path: "",
      });
      return;
    }
    const parts = relativePath.split("/");
    const ancestors = parts
      .slice(0, -1)
      .map((_, index) => parts.slice(0, index + 1).join("/"));
    const expanded = new Set(workspaceStateRef.current.expandedPaths);
    for (const ancestor of ancestors) {
      if (expanded.has(ancestor)) continue;
      controllerRef.current.toggleTreePath(ancestor);
      expanded.add(ancestor);
    }
    setFileTreeFocusRequest({
      id: ++fileTreeFocusIdRef.current,
      path: relativePath,
    });
  }, []);

  const requestNewMarkdown = useCallback(
    (parentRelativePath = "") => {
      const workspaceRoot = workspaceStateRef.current.workspace?.rootPath;
      if (!workspaceRoot) return;
      setEntryNameError(null);
      setEntryNameRequest({
        entryKind: "file",
        initialValue: `${t("Untitled")}.md`,
        mode: "new-file",
        parentPath: parentRelativePath,
        workspaceRoot,
      });
    },
    [t],
  );

  const requestNewFolder = useCallback(
    (parentRelativePath = "") => {
      const workspaceRoot = workspaceStateRef.current.workspace?.rootPath;
      if (!workspaceRoot) return;
      setEntryNameError(null);
      setEntryNameRequest({
        entryKind: "folder",
        initialValue: t("Untitled Folder"),
        mode: "new-folder",
        parentPath: parentRelativePath,
        workspaceRoot,
      });
    },
    [t],
  );

  const requestNewDocument = useCallback(() => {
    if (workspaceStateRef.current.workspace) requestNewMarkdown("");
    else void controllerRef.current.newDocument();
  }, [requestNewMarkdown]);

  const requestRename = useCallback((relativePath: string) => {
    const workspace = workspaceStateRef.current.workspace;
    if (!workspace) return;
    const entry = findWorkspaceEntry(workspace.children, relativePath);
    if (!entry) return;
    setEntryNameError(null);
    setEntryNameRequest({
      entryKind: entry.kind === "directory" ? "folder" : "file",
      initialValue: entry.name,
      mode: "rename",
      parentPath: parentPath(relativePath),
      relativePath,
      workspaceRoot: workspace.rootPath,
    });
  }, []);

  const invalidateWorkspaceImages = useCallback((workspaceRoot: string) => {
    workspaceImageCache.clear(workspaceRoot);
    setImageCacheRevision((revision) => revision + 1);
  }, []);

  const settleEntryImagePastes = useCallback(
    async (documentIds: readonly string[]): Promise<boolean> => {
      for (const id of documentIds) {
        if (!(await prepareDocumentForSave(id))) return false;
      }
      return true;
    },
    [prepareDocumentForSave],
  );

  const refreshSearchAfterEntryMutation = useCallback((workspaceRoot: string) => {
    if (workspaceRootRef.current !== workspaceRoot) return;
    const generation = searchGenerationRef.current + 1;
    searchGenerationRef.current = generation;
    setSearchResultsQuery(null);
    const query = searchQueryRef.current.trim();
    void (async () => {
      await controllerRef.current.runSearch(query);
      if (
        workspaceRootRef.current === workspaceRoot &&
        generation === searchGenerationRef.current
      ) {
        setSearchResultsQuery(query || null);
      }
    })();
  }, []);

  const entryTreeRefreshError = useCallback(
    (result: { refreshError?: string }) =>
      new Error(
        fmt(
          "The file change succeeded, but the sidebar could not refresh: %@",
          result.refreshError ?? t("Unknown error"),
        ),
      ),
    [fmt, t],
  );

  const ensureEntryTreeRefresh = useCallback(
    async (result: {
      treeRefreshed: boolean;
      refreshError?: string;
    }, workspaceRoot: string, reportFailure = true): Promise<boolean> => {
      if (workspaceRootRef.current !== workspaceRoot) return false;
      if (result.treeRefreshed) return true;
      const refreshed = await controllerRef.current.refreshCurrentWorkspace();
      if (workspaceRootRef.current !== workspaceRoot) return false;
      if (refreshed) return true;
      if (reportFailure && workspaceRootRef.current === workspaceRoot) {
        controllerRef.current.reportError(entryTreeRefreshError(result));
      }
      return false;
    },
    [entryTreeRefreshError],
  );

  const remapAppEntryState = useCallback(
    (sourcePath: string, destinationPath: string) => {
      selectionsRef.current = remapPathMap(
        selectionsRef.current,
        sourcePath,
        destinationPath,
      );
      liveDocumentContentRef.current = remapPathMap(
        liveDocumentContentRef.current,
        sourcePath,
        destinationPath,
      );
      setImageViewerSource((current) =>
        current && isPathWithinEntry(current.relativePath, sourcePath)
          ? {
              ...current,
              relativePath: remapEntryPath(
                current.relativePath,
                sourcePath,
                destinationPath,
              ),
            }
          : current,
      );
      setSearchNavigationTarget((current) =>
        current && isPathWithinEntry(current.relativePath, sourcePath)
          ? {
              ...current,
              relativePath: remapEntryPath(
                current.relativePath,
                sourcePath,
                destinationPath,
              ),
            }
          : current,
      );
      const pendingSearch = pendingSearchNavigationRef.current;
      if (pendingSearch && isPathWithinEntry(pendingSearch.relativePath, sourcePath)) {
        pendingSearchNavigationRef.current = {
          ...pendingSearch,
          relativePath: remapEntryPath(
            pendingSearch.relativePath,
            sourcePath,
            destinationPath,
          ),
        };
      }
      setPendingHistoryLoad((current) =>
        current && isPathWithinEntry(current.documentId, sourcePath)
          ? {
              ...current,
              documentId: remapEntryPath(
                current.documentId,
                sourcePath,
                destinationPath,
              ),
            }
          : current,
      );
    },
    [],
  );

  const removeAppEntryState = useCallback(
    (relativePath: string, affectedDocumentIds: readonly string[]) => {
      const workspaceRoot = workspaceRootRef.current;
      if (workspaceRoot) {
        for (const id of affectedDocumentIds) {
          void cancelImagePastes(workspaceRoot, id);
        }
      }
      for (const id of Array.from(selectionsRef.current.keys())) {
        if (isPathWithinEntry(id, relativePath)) selectionsRef.current.delete(id);
      }
      for (const id of Array.from(liveDocumentContentRef.current.keys())) {
        if (isPathWithinEntry(id, relativePath)) {
          liveDocumentContentRef.current.delete(id);
        }
      }
      setImageViewerSource((current) =>
        current && isPathWithinEntry(current.relativePath, relativePath)
          ? null
          : current,
      );
      setSearchNavigationTarget((current) =>
        current && isPathWithinEntry(current.relativePath, relativePath)
          ? null
          : current,
      );
      if (
        pendingSearchNavigationRef.current &&
        isPathWithinEntry(
          pendingSearchNavigationRef.current.relativePath,
          relativePath,
        )
      ) {
        pendingSearchNavigationRef.current = null;
      }
      setPendingHistoryLoad((current) =>
        current && isPathWithinEntry(current.documentId, relativePath)
          ? null
          : current,
      );
    },
    [cancelImagePastes],
  );

  const submitEntryName = useCallback(
    async (name: string) => {
      const request = entryNameRequest;
      if (!request || entryOperationBusy) return;
      const { workspaceRoot } = request;
      if (workspaceRootRef.current !== workspaceRoot) return;
      setEntryOperationBusy(true);
      setEntryNameError(null);
      try {
        if (request.mode === "new-file") {
          const result = await controllerRef.current.createMarkdown(
            request.parentPath,
            name,
            `# ${markdownTitle(name)}\n\n`,
          );
          if (workspaceRootRef.current !== workspaceRoot) return;
          if (!result.applied || !result.snapshot) {
            setEntryNameError(result.error ?? t("Could not create this file."));
            return;
          }
          const treeReady = await ensureEntryTreeRefresh(result, workspaceRoot);
          if (workspaceRootRef.current !== workspaceRoot) return;
          setEntryNameRequest(null);
          if (treeReady) requestFileTreeFocus(result.snapshot.relativePath);
          refreshSearchAfterEntryMutation(workspaceRoot);
          return;
        }

        if (request.mode === "new-folder") {
          const result = await controllerRef.current.createDirectory(
            request.parentPath,
            name,
          );
          if (workspaceRootRef.current !== workspaceRoot) return;
          const destination = result.mutation?.destinationRelativePath;
          if (!result.applied || !destination) {
            setEntryNameError(result.error ?? t("Could not create this folder."));
            return;
          }
          const treeReady = await ensureEntryTreeRefresh(result, workspaceRoot);
          if (workspaceRootRef.current !== workspaceRoot) return;
          setEntryNameRequest(null);
          if (treeReady) requestFileTreeFocus(destination);
          refreshSearchAfterEntryMutation(workspaceRoot);
          return;
        }

        const relativePath = request.relativePath;
        if (!relativePath) return;
        const impact = controllerRef.current.inspectEntryImpact(relativePath);
        const imagePastesSettled = await settleEntryImagePastes(
          impact.affectedDocumentIds,
        );
        if (workspaceRootRef.current !== workspaceRoot) return;
        if (!imagePastesSettled) {
          setEntryNameError(t("Could not finish the pending image paste."));
          return;
        }
        const result = await controllerRef.current.renameEntry(relativePath, name);
        if (workspaceRootRef.current !== workspaceRoot) return;
        const source = result.mutation?.sourceRelativePath ?? relativePath;
        const destination = result.mutation?.destinationRelativePath;
        if (!result.applied || !destination) {
          setEntryNameError(result.error ?? t("Could not rename this item."));
          return;
        }
        const treeReady = await ensureEntryTreeRefresh(result, workspaceRoot);
        if (workspaceRootRef.current !== workspaceRoot) return;
        remapAppEntryState(source, destination);
        invalidateWorkspaceImages(workspaceRoot);
        setEntryNameRequest(null);
        if (treeReady) requestFileTreeFocus(destination);
        refreshSearchAfterEntryMutation(workspaceRoot);
      } finally {
        setEntryOperationBusy(false);
      }
    },
    [
      entryNameRequest,
      entryOperationBusy,
      ensureEntryTreeRefresh,
      invalidateWorkspaceImages,
      refreshSearchAfterEntryMutation,
      remapAppEntryState,
      requestFileTreeFocus,
      settleEntryImagePastes,
      t,
    ],
  );

  const performDuplicate = useCallback(
    async (operation: PendingEntryOperation, saveFirst: boolean) => {
      if (entryOperationBusy) return;
      const { workspaceRoot } = operation;
      if (workspaceRootRef.current !== workspaceRoot) return;
      setEntryOperationBusy(true);
      setEntryOperationError(null);
      try {
        if (!(await settleEntryImagePastes(operation.affectedDocumentIds))) {
          setEntryOperationError(t("Could not finish the pending image paste."));
          return;
        }
        if (saveFirst) {
          for (const id of operation.affectedDirtyDocumentIds) {
            const saved = await saveDocument(id);
            if (workspaceRootRef.current !== workspaceRoot) return;
            if (!saved) {
              setEntryOperationError(
                t("Could not save the latest edits. No copy was created."),
              );
              return;
            }
          }
        }
        const result = await controllerRef.current.duplicateEntry(
          operation.relativePath,
        );
        if (workspaceRootRef.current !== workspaceRoot) return;
        const destination = result.mutation?.destinationRelativePath;
        if (!result.applied || !destination) {
          setEntryOperationError(
            result.error ?? t("Could not create this copy."),
          );
          return;
        }
        const treeReady = await ensureEntryTreeRefresh(
          result,
          workspaceRoot,
          false,
        );
        if (workspaceRootRef.current !== workspaceRoot) return;
        setPendingDuplicate(null);
        setEntryOperationError(null);
        if (treeReady) requestFileTreeFocus(destination);
        refreshSearchAfterEntryMutation(workspaceRoot);
        if (operation.kind === "file") {
          await controllerRef.current.openDocument(destination);
          if (workspaceRootRef.current !== workspaceRoot) return;
        } else if (operation.kind === "image") {
          setImageViewerSource({
            alt: operation.name,
            relativePath: destination,
            workspaceRoot,
          });
        }
        if (!treeReady) {
          controllerRef.current.reportError(entryTreeRefreshError(result));
        }
      } finally {
        setEntryOperationBusy(false);
      }
    },
    [
      entryOperationBusy,
      entryTreeRefreshError,
      ensureEntryTreeRefresh,
      refreshSearchAfterEntryMutation,
      requestFileTreeFocus,
      saveDocument,
      settleEntryImagePastes,
      t,
    ],
  );

  const requestDuplicate = useCallback(
    (relativePath: string) => {
      const workspace = workspaceStateRef.current.workspace;
      if (!workspace) return;
      const entry = findWorkspaceEntry(workspace.children, relativePath);
      if (!entry || entry.kind === "directory") return;
      const impact = controllerRef.current.inspectEntryImpact(relativePath);
      const operation: PendingEntryOperation = {
        ...impact,
        kind: entry.kind,
        name: entry.name,
        relativePath,
        workspaceRoot: workspace.rootPath,
      };
      if (impact.affectedDirtyDocumentIds.length > 0) {
        setEntryOperationError(null);
        setPendingDuplicate(operation);
      } else {
        void performDuplicate(operation, false);
      }
    },
    [performDuplicate],
  );

  const requestMoveToTrash = useCallback((relativePath: string) => {
    const workspace = workspaceStateRef.current.workspace;
    if (!workspace) return;
    const entry = findWorkspaceEntry(workspace.children, relativePath);
    if (!entry) return;
    setEntryOperationError(null);
    setPendingTrash({
      ...controllerRef.current.inspectEntryImpact(relativePath),
      kind: entry.kind,
      name: entry.name,
      relativePath,
      workspaceRoot: workspace.rootPath,
    });
  }, []);

  const performMoveToTrash = useCallback(async () => {
    const operation = pendingTrash;
    if (!operation || entryOperationBusy) return;
    const { workspaceRoot } = operation;
    if (workspaceRootRef.current !== workspaceRoot) return;
    const workspace = workspaceStateRef.current.workspace;
    const nextFocusPath = workspace
      ? focusPathAfterRemoval(
          workspace.children,
          workspaceStateRef.current.expandedPaths,
          operation.relativePath,
        )
      : "";
    setEntryOperationBusy(true);
    setEntryOperationError(null);
    try {
      if (!(await settleEntryImagePastes(operation.affectedDocumentIds))) {
        setEntryOperationError(t("Could not finish the pending image paste."));
        return;
      }
      for (const id of operation.affectedDirtyDocumentIds) {
        const saved = await saveDocument(id);
        if (workspaceRootRef.current !== workspaceRoot) return;
        if (!saved) {
          setEntryOperationError(
            t("Could not save the latest edits. Nothing was moved to Trash."),
          );
          return;
        }
      }
      const result = await controllerRef.current.trashEntry(
        operation.relativePath,
      );
      if (workspaceRootRef.current !== workspaceRoot) return;
      if (!result.applied) {
        setEntryOperationError(
          result.error ?? t("Could not move this item to Trash."),
        );
        return;
      }
      const treeReady = await ensureEntryTreeRefresh(result, workspaceRoot);
      if (workspaceRootRef.current !== workspaceRoot) return;
      const source = result.mutation?.sourceRelativePath ?? operation.relativePath;
      removeAppEntryState(source, result.affectedDocumentIds);
      invalidateWorkspaceImages(workspaceRoot);
      setPendingTrash(null);
      setEntryOperationError(null);
      if (treeReady) requestFileTreeFocus(nextFocusPath);
      refreshSearchAfterEntryMutation(workspaceRoot);
    } finally {
      setEntryOperationBusy(false);
    }
  }, [
    entryOperationBusy,
    ensureEntryTreeRefresh,
    invalidateWorkspaceImages,
    pendingTrash,
    refreshSearchAfterEntryMutation,
    removeAppEntryState,
    requestFileTreeFocus,
    saveDocument,
    settleEntryImagePastes,
    t,
  ]);

  const cancelImagePastesBeforeWorkspaceChange = useCallback(async () => {
    const currentState = workspaceStateRef.current;
    const workspaceRoot = currentState.workspace?.rootPath;
    if (
      !workspaceRoot ||
      Object.values(currentState.documents).some(isDocumentDirty)
    ) {
      return;
    }
    await cancelImagePastes(workspaceRoot);
  }, [cancelImagePastes]);

  const openFolder = useCallback(async (): Promise<boolean> => {
    await cancelImagePastesBeforeWorkspaceChange();
    return controllerRef.current.openFolder();
  }, [cancelImagePastesBeforeWorkspaceChange]);

  const openRecentWorkspace = useCallback(
    async (path: string): Promise<boolean> => {
      await cancelImagePastesBeforeWorkspaceChange();
      return controllerRef.current.openRecentWorkspace(path);
    },
    [cancelImagePastesBeforeWorkspaceChange],
  );

  const pasteWorkspaceImage = useCallback(
    (file: File, selection: Required<TextSelection>) => {
      if (!currentDocument || !state.workspace) return;
      try {
        assertWorkspaceImageSize(file.size);
      } catch (error) {
        controller.reportError(error);
        return;
      }

      const relativePath = currentDocument.relativePath;
      const workspaceRoot = state.workspace.rootPath;
      const currentContent =
        liveDocumentContentRef.current.get(relativePath) ??
        currentDocument.content;
      const pending = insertImagePasteToken(currentContent, selection);
      const leaseId = createImagePasteId();
      selectionsRef.current.set(relativePath, pending.selection);
      changeDocumentContent(relativePath, pending.value);

      let cancelPromise: Promise<void> | undefined;
      const operation: PendingImagePasteOperation = {
        cancel: () => Promise.resolve(),
        cancelled: false,
        promise: Promise.resolve(),
        referenced: false,
        token: pending.token,
      };
      operation.cancel = () => {
        operation.cancelled = true;
        if (operation.referenced) return Promise.resolve();
        cancelPromise ??= cancelWorkspaceImage(workspaceRoot, leaseId).catch(
          (error) => {
            if (workspaceRootRef.current === workspaceRoot) {
              controllerRef.current.reportError(error);
            }
          },
        );
        return cancelPromise;
      };
      operation.promise = (async () => {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (
            operation.cancelled ||
            !imagePasteContextIsLive(
              workspaceRoot,
              relativePath,
              pending.token,
            )
          ) {
            return;
          }
          const image = await createWorkspaceImage(
            workspaceRoot,
            relativePath,
            bytes,
            leaseId,
          );
          if (
            operation.cancelled ||
            !imagePasteContextIsLive(
              workspaceRoot,
              relativePath,
              pending.token,
            )
          ) {
            return;
          }
          await commitWorkspaceImage(workspaceRoot, leaseId);
          if (
            operation.cancelled ||
            !imagePasteContextIsLive(
              workspaceRoot,
              relativePath,
              pending.token,
            )
          ) {
            return;
          }
          const latestContent = liveDocumentContentRef.current.get(relativePath);
          if (latestContent === undefined) return;
          const latestSelection =
            selectionsRef.current.get(relativePath) ?? pending.selection;
          const settled = resolveImagePasteToken(
            latestContent,
            latestSelection,
            pending.token,
            `![${t("Pasted image")}](${image.markdownPath})`,
          );
          if (!settled.applied) return;
          operation.referenced = true;
          selectionsRef.current.set(relativePath, settled.selection);
          changeDocumentContent(relativePath, settled.value);
          await controllerRef.current.refreshCurrentWorkspace();
        } catch (error) {
          if (
            !operation.cancelled &&
            workspaceRootRef.current === workspaceRoot
          ) {
            controllerRef.current.reportError(error);
          }
        } finally {
          if (!operation.referenced) await operation.cancel();
          removeRegisteredImagePasteToken(
            workspaceRoot,
            relativePath,
            pending.token,
          );
        }
      })();
      registerImagePaste(workspaceRoot, relativePath, operation);
    },
    [
      changeDocumentContent,
      controller.reportError,
      currentDocument,
      imagePasteContextIsLive,
      registerImagePaste,
      removeRegisteredImagePasteToken,
      state.workspace,
      t,
    ],
  );

  useEffect(() => writeNumber("viva.sidebarWidth", sidebarWidth), [sidebarWidth]);
  useEffect(
    () => writeNumber("viva.splitPosition", splitPosition),
    [splitPosition],
  );

  useEffect(() => {
    const workspaceRoot = state.workspace?.rootPath ?? null;
    setImageViewerSource((current) =>
      current?.workspaceRoot === workspaceRoot ? current : null,
    );
  }, [state.workspace?.rootPath]);

  useEffect(() => {
    setEntryNameRequest(null);
    setEntryNameError(null);
    setPendingDuplicate(null);
    setPendingTrash(null);
    setEntryOperationError(null);
    setFileTreeFocusRequest(null);
  }, [state.workspace?.rootPath]);

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
    const generation = findWorkerGenerationRef.current + 1;
    findWorkerGenerationRef.current = generation;
    findWorkerRef.current?.terminate();
    findWorkerRef.current = null;

    const documentId = currentDocument?.relativePath ?? null;
    const content = currentDocument?.content ?? null;
    const query = findQuery;
    const options = {
      caseSensitive: findCaseSensitive,
      wholeWord: findWholeWord,
    };
    if (findMode === null || !documentId || content === null || !query) {
      findSelectionOffsetRef.current = null;
      setFindScan({
        activeIndex: -1,
        ...options,
        content,
        count: 0,
        documentId,
        query,
      });
      return;
    }

    const selectionOffset = findSelectionOffsetRef.current;
    findSelectionOffsetRef.current = null;
    const requestId = findWorkerRequestRef.current + 1;
    findWorkerRequestRef.current = requestId;
    let fallbackTimer: number | null = null;
    let disposed = false;

    const applyResult = (response: FindWorkerResponse) => {
      if (
        disposed ||
        response.generation !== findWorkerGenerationRef.current ||
        response.requestId !== findWorkerRequestRef.current
      ) {
        return;
      }
      setFindScan({
        activeIndex: response.activeIndex,
        ...options,
        content,
        count: response.count,
        documentId,
        match: response.match,
        query,
      });
      if (selectionOffset !== null && response.activeIndex >= 0) {
        setFindActiveIndex(response.activeIndex);
      }
    };

    const runFallback = () => {
      fallbackTimer = window.setTimeout(() => {
        if (disposed) return;
        const offsetResult =
          selectionOffset === null
            ? null
            : findLiteralMatchIndexAtOrAfter(
                content,
                query,
                options,
                selectionOffset,
              );
        const count =
          offsetResult?.count ?? countLiteralMatches(content, query, options);
        const activeIndex =
          count > 0
            ? offsetResult && offsetResult.index >= 0
              ? offsetResult.index
              : wrapMatchIndex(findActiveIndexRef.current, count)
            : -1;
        applyResult({
          activeIndex,
          count,
          generation,
          match:
            activeIndex >= 0
              ? findLiteralMatchAt(content, query, options, activeIndex)
              : undefined,
          requestId,
        });
      }, 0);
    };

    if (typeof Worker === "undefined") {
      runFallback();
    } else {
      const worker = new FindScanWorker();
      findWorkerRef.current = worker;
      worker.onmessage = (event: MessageEvent<FindWorkerResponse>) => {
        applyResult(event.data);
      };
      worker.onerror = () => {
        if (findWorkerRef.current === worker) findWorkerRef.current = null;
        worker.terminate();
        runFallback();
      };
      worker.postMessage({
        activeIndex: findActiveIndexRef.current,
        generation,
        options,
        query,
        requestId,
        selectionOffset: selectionOffset ?? undefined,
        source: content,
        type: "initialize",
      });
    }

    return () => {
      disposed = true;
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      const worker = findWorkerRef.current;
      if (worker) worker.terminate();
      if (findWorkerRef.current === worker) findWorkerRef.current = null;
    };
  }, [
    currentDocument?.content,
    currentDocument?.relativePath,
    findCaseSensitive,
    findMode !== null,
    findQuery,
    findWholeWord,
  ]);

  useEffect(() => {
    if (!findScanIsCurrent || findScan.count <= 0) return;
    const activeIndex = wrapMatchIndex(findActiveIndex, findScan.count);
    if (activeIndex === findScan.activeIndex) return;
    const generation = findWorkerGenerationRef.current;
    const requestId = findWorkerRequestRef.current + 1;
    findWorkerRequestRef.current = requestId;
    const worker = findWorkerRef.current;
    if (worker) {
      worker.postMessage({
        activeIndex,
        generation,
        requestId,
        type: "select",
      });
      return;
    }
    const timer = window.setTimeout(() => {
      if (
        generation !== findWorkerGenerationRef.current ||
        requestId !== findWorkerRequestRef.current
      ) {
        return;
      }
      setFindScan((current) => ({
        ...current,
        activeIndex,
        match:
          current.content === null
            ? undefined
            : findLiteralMatchAt(
                current.content,
                current.query,
                {
                  caseSensitive: current.caseSensitive,
                  wholeWord: current.wholeWord,
                },
                activeIndex,
              ),
      }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [findActiveIndex, findScan, findScanIsCurrent]);

  const runSearchForGeneration = useCallback(
    async (query: string, generation: number) => {
      await controller.runSearch(query);
      if (generation !== searchGenerationRef.current) return;
      setSearchResultsQuery(query.trim());
    },
    [controller.runSearch],
  );

  const changeSearchQuery = useCallback(
    (query: string) => {
      searchGenerationRef.current += 1;
      searchQueryRef.current = query;
      setSearchResultsQuery(null);
      setSearchQuery(query);
      void controller.runSearch("");
    },
    [controller.runSearch],
  );

  const submitSearch = useCallback(
    (query: string) => {
      const generation = searchGenerationRef.current + 1;
      searchGenerationRef.current = generation;
      setSearchResultsQuery(null);
      void runSearchForGeneration(query, generation);
    },
    [runSearchForGeneration],
  );

  useEffect(() => {
    if (state.activity !== "search") return;
    const generation = searchGenerationRef.current;
    const timer = window.setTimeout(() => {
      if (generation !== searchGenerationRef.current) return;
      void runSearchForGeneration(searchQuery, generation);
    }, searchQuery.trim() ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [runSearchForGeneration, searchQuery, state.activity]);

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
    if (!currentDocument) {
      setFindMode(null);
      return;
    }
    if (!activeFindMatch || findMode === null) return;
    const selection = {
      direction: "none",
      end: activeFindMatch.end,
      start: activeFindMatch.start,
    } as const;
    const position = positionAtOffset(
      currentDocument.content,
      activeFindMatch.start,
    );
    selectionsRef.current.set(currentDocument.relativePath, selection);
    setCursor(position);
    setScrollSync({ line: position.line, target: "both" });
    setFindRevealRequestId((requestId) => requestId + 1);
  }, [
    activeFindMatch?.end,
    activeFindMatch?.start,
    currentDocument?.content,
    currentDocument?.relativePath,
    findMode,
  ]);

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

  const openFind = useCallback(
    (mode: Exclude<FindMode, null>) => {
      if (!currentDocument) return;
      if (findMode === null) {
        findReturnFocusRef.current =
          document.activeElement instanceof HTMLElement &&
          document.activeElement !== document.body
            ? document.activeElement
            : null;
      }
      setPaletteMode(null);
      setWorkbenchSurface("document");
      if (!state.focusMode && state.viewMode === "preview") {
        controller.selectView("split");
      }

      const selection = selectionsRef.current.get(
        currentDocument.relativePath,
      );
      const selectedText = selection
        ? currentDocument.content.slice(selection.start, selection.end)
        : "";
      if (
        selection &&
        selectedText.length > 0 &&
        selectedText.length <= 256 &&
        !/[\r\n]/u.test(selectedText)
      ) {
        let selectedMatchIndex = 0;
        if (currentDocument.content.length > LIVE_MARKDOWN_MAX_CHARACTERS) {
          findSelectionOffsetRef.current = selection.start;
        } else {
          selectedMatchIndex = findLiteralMatchIndexAtOffset(
            currentDocument.content,
            selectedText,
            {
              caseSensitive: findCaseSensitive,
              wholeWord: findWholeWord,
            },
            selection.start,
          );
        }
        setFindQuery(selectedText);
        setFindActiveIndex(Math.max(0, selectedMatchIndex));
      } else {
        findSelectionOffsetRef.current = null;
        setFindActiveIndex(0);
      }
      setFindMode(mode);
      setFindFocusTarget(mode === "replace" ? "replacement" : "query");
      setFindFocusEpoch((epoch) => epoch + 1);
    },
    [
      controller.selectView,
      currentDocument,
      findCaseSensitive,
      findMode,
      findWholeWord,
      state.focusMode,
      state.viewMode,
    ],
  );

  const closeFind = useCallback(() => {
    const returnFocus = findReturnFocusRef.current;
    findReturnFocusRef.current = null;
    setFindMode(null);
    requestAnimationFrame(() => {
      if (returnFocus?.isConnected) {
        returnFocus.focus();
        return;
      }
      const fallback =
        editorRef.current ??
        editorStageRef.current?.querySelector<HTMLElement>(
          ".live-editor-pane__active textarea, .live-editor-pane__block[tabindex='0']",
        );
      fallback?.focus();
    });
  }, []);

  const stepFind = useCallback(
    (direction: -1 | 1) => {
      setFindActiveIndex((index) =>
        stepMatchIndex(index, findMatchCount, direction),
      );
    },
    [findMatchCount],
  );

  const replaceCurrentMatch = useCallback(() => {
    if (!currentDocument || !activeFindMatch) return;
    const nextContent = replaceOneMatch(
      currentDocument.content,
      activeFindMatch,
      findReplacement,
    );
    const nextThreshold = activeFindMatch.start + findReplacement.length;
    const nextMatchState = findLiteralMatchIndexAtOrAfter(
      nextContent,
      findQuery,
      {
        caseSensitive: findCaseSensitive,
        wholeWord: findWholeWord,
      },
      nextThreshold,
    );
    if (nextMatchState.count > 0) {
      setFindActiveIndex(nextMatchState.index >= 0 ? nextMatchState.index : 0);
    } else {
      const selection = {
        direction: "none",
        end: nextThreshold,
        start: activeFindMatch.start,
      } as const;
      selectionsRef.current.set(currentDocument.relativePath, selection);
      setCursor(positionAtOffset(nextContent, nextThreshold));
      setFindActiveIndex(-1);
    }
    changeDocumentContent(currentDocument.relativePath, nextContent);
  }, [
    activeFindMatch,
    changeDocumentContent,
    currentDocument,
    findCaseSensitive,
    findQuery,
    findReplacement,
    findWholeWord,
  ]);

  const replaceEveryMatch = useCallback(() => {
    if (!currentDocument || findMatchCount === 0) return;
    const nextContent = replaceAllLiteralMatches(
      currentDocument.content,
      findQuery,
      {
        caseSensitive: findCaseSensitive,
        wholeWord: findWholeWord,
      },
      findReplacement,
    );
    const nextMatchCount = countLiteralMatches(nextContent, findQuery, {
      caseSensitive: findCaseSensitive,
      wholeWord: findWholeWord,
    });
    setFindActiveIndex(nextMatchCount > 0 ? 0 : -1);
    changeDocumentContent(currentDocument.relativePath, nextContent);
  }, [
    changeDocumentContent,
    currentDocument,
    findCaseSensitive,
    findMatchCount,
    findQuery,
    findReplacement,
    findWholeWord,
  ]);

  const requestTabClose = useCallback(
    async (id: string) => {
      const document = state.documents[id];
      if (!document) return;
      if (isDocumentDirty(document)) {
        setPendingClose({ id, exitApplication: false });
      } else {
        const workspaceRoot = state.workspace?.rootPath;
        if (workspaceRoot) await cancelImagePastes(workspaceRoot, id);
        if (!workspaceStateRef.current.documents[id]) return;
        controller.closeDocument(id);
      }
    },
    [
      cancelImagePastes,
      controller.closeDocument,
      state.documents,
      state.workspace?.rootPath,
    ],
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
    else {
      void (async () => {
        const workspaceRoot = workspaceRootRef.current;
        if (workspaceRoot) await cancelImagePastes(workspaceRoot);
        await requestClose();
      })();
    }
  }, [cancelImagePastes, dirty, requestApplicationClose, requestClose]);

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
        "edit.find": () => openFind("find"),
        "edit.replace": () => openFind("replace"),
        "file.new": requestNewDocument,
        "file.newWindow": openNewEditorWindow,
        "file.open": () => void openFolder(),
        "file.save": () => void saveDocument(),
        "file.saveAs": () => void saveDocumentAs(),
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
      controller.reportError,
      controller.toggleSidebar,
      openFolder,
      openNewEditorWindow,
      openFind,
      requestNewDocument,
      saveDocument,
      saveDocumentAs,
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
      find: () => openFind("find"),
      focusMode: toggleFocusMode,
      liveView: () => selectDocumentView("live"),
      newDocument: requestNewDocument,
      newWindow: openNewEditorWindow,
      openFolder: () => void openFolder(),
      previewView: () => selectDocumentView("preview"),
      quickOpen: () => setPaletteMode("files"),
      replace: () => openFind("replace"),
      save: () => void saveDocument(),
      saveAs: () => void saveDocumentAs(),
      splitView: () => selectDocumentView("split"),
      toggleSidebar: controller.toggleSidebar,
    }),
    [
      closeCurrentTab,
      controller.reportError,
      controller.toggleSidebar,
      openFolder,
      openNewEditorWindow,
      openFind,
      requestNewDocument,
      saveDocument,
      saveDocumentAs,
      selectDocumentView,
      toggleFocusMode,
    ],
  );
  useAppShortcuts(shortcutHandlers);

  const commandPaletteItems = useMemo<CommandPaletteItem[]>(
    () => [
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
        onSelect: () => void openFolder(),
      },
      {
        id: "new-document",
        label: t("New document"),
        detail: t("Create a Markdown file in this folder"),
        disabled: !state.workspace,
        icon: <PlusIcon size={16} />,
        shortcut: shortcutLabels.newDocument,
        section: t("File"),
        onSelect: requestNewDocument,
      },
      {
        id: "save",
        label: t("Save document"),
        disabled: !currentDocument,
        icon: <FileMarkdownIcon size={16} />,
        shortcut: shortcutLabels.save,
        section: t("File"),
        onSelect: () => void saveDocument(),
      },
      {
        id: "find-document",
        label: t("Find in document"),
        disabled: !currentDocument,
        icon: <SearchIcon size={16} />,
        shortcut: shortcutLabels.find,
        section: t("Document"),
        onSelect: () => openFind("find"),
      },
      {
        id: "replace-document",
        label: t("Find and replace"),
        disabled: !currentDocument,
        icon: <EditIcon size={16} />,
        shortcut: shortcutLabels.replace,
        section: t("Document"),
        onSelect: () => openFind("replace"),
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
    ],
    [
      controller.toggleSidebar,
      currentDocument,
      documentViewOptions,
      openFolder,
      openNewEditorWindow,
      openFind,
      requestNewDocument,
      saveDocument,
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
    ],
  );
  const paletteItems =
    paletteMode === "files" ? quickOpenPaletteItems : commandPaletteItems;

  const handleDiscard = useCallback(async () => {
    if (!pendingClose) return;
    const workspaceRoot = state.workspace?.rootPath;
    if (workspaceRoot) {
      await cancelImagePastes(workspaceRoot, pendingClose.id);
    }
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
    cancelImagePastes,
    controller.closeDocument,
    pendingClose,
    requestClose,
    state.documentOrder,
    state.documents,
    state.workspace?.rootPath,
  ]);

  const handleSaveBeforeClose = useCallback(async () => {
    if (!pendingClose) return;
    setDialogSaving(true);
    const saved = await saveDocument(pendingClose.id);
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
  }, [
    controller.closeDocument,
    pendingClose,
    requestClose,
    saveDocument,
    state.documentOrder,
    state.documents,
  ]);

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
      changeDocumentContent(
        currentDocument.relativePath,
        entry.content,
        lineEnding,
      );
      setWorkbenchSurface("document");
    },
    [changeDocumentContent, currentDocument],
  );

  const confirmHistoryLoad = useCallback(() => {
    if (!pendingHistoryLoad) return;
    changeDocumentContent(
      pendingHistoryLoad.documentId,
      pendingHistoryLoad.content,
      pendingHistoryLoad.lineEnding,
    );
    controller.activateDocument(pendingHistoryLoad.documentId);
    setPendingHistoryLoad(null);
    setWorkbenchSurface("document");
  }, [changeDocumentContent, controller.activateDocument, pendingHistoryLoad]);

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
          onNewDocument={requestNewDocument}
          onOpenFolder={() => void openFolder()}
          onOpenRecent={(path) => void openRecentWorkspace(path)}
          recentWorkspaces={recentWorkspaces}
        />
        <StatusBar message={status.message} messageTone={status.tone} />
        <CommandPalette
          items={paletteItems}
          maxResults={20}
          onItemSelect={
            paletteMode === "files" ? handleQuickOpenSelect : undefined
          }
          onOpenChange={(open) => setPaletteMode(open ? paletteMode : null)}
          open={paletteMode !== null}
          renderItemIcon={
            paletteMode === "files" ? renderQuickOpenIcon : undefined
          }
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
        busy={busy || entryOperationBusy}
        expandedPaths={state.expandedPaths}
        focusRequest={fileTreeFocusRequest}
        key={state.workspace.rootPath}
        modifiedPaths={modifiedPaths}
        nodes={state.workspace.children}
        onDuplicate={requestDuplicate}
        onMoveToTrash={requestMoveToTrash}
        onNewFolder={requestNewFolder}
        onNewMarkdownFile={requestNewMarkdown}
        onOpen={(path) => {
          if (workspaceImagePaths.has(path)) openWorkspaceImage(path);
          else void controller.openDocument(path);
        }}
        onRename={requestRename}
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
        onQueryChange={changeSearchQuery}
        onSubmit={submitSearch}
        query={searchQuery}
        results={searchResults}
        resultsQuery={searchResultsQuery}
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
                    onClick={requestNewDocument}
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
                        onClick={requestNewDocument}
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
              onSave={(id) => void saveDocument(id)}
              onSaveAs={(id) => void saveDocumentAs(id)}
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
              {findMode ? (
                <FindBar
                  activeIndex={resolvedFindIndex}
                  caseSensitive={findCaseSensitive}
                  focusTarget={findFocusTarget}
                  key={`${currentDocument.relativePath}:${findFocusEpoch}`}
                  labels={{
                    close: t("Close find and replace"),
                    find: t("Find in document"),
                    hideReplace: t("Hide replace"),
                    matchCase: t("Match case"),
                    nextMatch: t("Next match"),
                    previousMatch: t("Previous match"),
                    replace: t("Replace"),
                    replaceAll: t("Replace all"),
                    replaceInput: t("Replace with"),
                    showReplace: t("Show replace"),
                    wholeWord: t("Whole word"),
                  }}
                  matchCount={findMatchCount}
                  onCaseSensitiveChange={(value) => {
                    setFindCaseSensitive(value);
                    setFindActiveIndex(0);
                  }}
                  onClose={closeFind}
                  onNext={() => stepFind(1)}
                  onPrevious={() => stepFind(-1)}
                  onQueryChange={(value) => {
                    findSelectionOffsetRef.current = null;
                    setFindQuery(value);
                    setFindActiveIndex(0);
                  }}
                  onReplace={replaceCurrentMatch}
                  onReplaceAll={replaceEveryMatch}
                  onReplaceVisibleChange={(visible) => {
                    setFindMode(visible ? "replace" : "find");
                    setFindFocusTarget(visible ? "replacement" : "query");
                  }}
                  onReplacementChange={setFindReplacement}
                  onWholeWordChange={(value) => {
                    setFindWholeWord(value);
                    setFindActiveIndex(0);
                  }}
                  query={findQuery}
                  replacement={findReplacement}
                  replaceVisible={findMode === "replace"}
                  wholeWord={findWholeWord}
                />
              ) : null}
              {!state.focusMode &&
              state.viewMode === "live" &&
              !liveDocumentTooLarge ? (
                <LiveEditorPane
                  ariaLabel={fmt("Live editing %@", currentDocument.name)}
                  documentId={currentDocument.relativePath}
                  format={documentFormat}
                  imageCacheRevision={imageCacheRevision}
                  onChange={(content) =>
                    changeDocumentContent(currentDocument.relativePath, content)
                  }
                  onLinkRequest={handleLinkRequest}
                  onImageRequest={handleImageRequest}
                  onPasteImage={pasteWorkspaceImage}
                  onPositionChange={setCursor}
                  onSelectionChange={(selection) =>
                    selectionsRef.current.set(currentDocument.relativePath, selection)
                  }
                  revealSelection={findMode ? activeFindMatch ?? null : null}
                  revealSelectionRequestId={findRevealRequestId}
                  value={currentDocument.content}
                  workspaceRoot={state.workspace.rootPath}
                />
              ) : state.focusMode || state.viewMode !== "preview" ? (
                <EditorPane
                  ariaLabel={fmt("Editing %@", currentDocument.name)}
                  autoFocus
                  ref={editorRef}
                  onChange={(content) =>
                    changeDocumentContent(currentDocument.relativePath, content)
                  }
                  onSelectionChange={(selection) =>
                    selectionsRef.current.set(currentDocument.relativePath, selection)
                  }
                  onPositionChange={largeDocument ? undefined : setCursor}
                  onPasteImage={pasteWorkspaceImage}
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
                  revealSelectionRequestId={
                    findMode ? findRevealRequestId : undefined
                  }
                  selection={activeSelection}
                  showPosition={false}
                  typewriterMode={state.focusMode}
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
                  imageCacheRevision={imageCacheRevision}
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
                  onClick={requestNewDocument}
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
        maxResults={paletteMode === "files" ? 12 : 20}
        onItemSelect={
          paletteMode === "files" ? handleQuickOpenSelect : undefined
        }
        onOpenChange={(open) => setPaletteMode(open ? paletteMode : null)}
        open={paletteMode !== null}
        placeholder={paletteMode === "files" ? t("Open a file…") : t("Type a command…")}
        renderItemIcon={
          paletteMode === "files" ? renderQuickOpenIcon : undefined
        }
      />

      <EntryNameDialog
        busy={entryOperationBusy}
        entryKind={entryNameRequest?.entryKind}
        error={entryNameError}
        initialValue={entryNameRequest?.initialValue}
        mode={entryNameRequest?.mode ?? "new-file"}
        onCancel={() => {
          if (entryOperationBusy) return;
          setEntryNameRequest(null);
          setEntryNameError(null);
        }}
        onSubmit={(name) => void submitEntryName(name)}
        onValueChange={() => setEntryNameError(null)}
        open={Boolean(entryNameRequest)}
      />

      <DuplicateEntryDialog
        busy={entryOperationBusy}
        dirty={Boolean(pendingDuplicate)}
        entryName={pendingDuplicate?.name ?? ""}
        error={entryOperationError}
        onCancel={() => {
          if (!entryOperationBusy) {
            setPendingDuplicate(null);
            setEntryOperationError(null);
          }
        }}
        onSaveAndDuplicate={() => {
          if (pendingDuplicate) void performDuplicate(pendingDuplicate, true);
        }}
        open={Boolean(pendingDuplicate)}
      />

      <MoveToTrashDialog
        busy={entryOperationBusy}
        dirty={Boolean(pendingTrash?.affectedDirtyDocumentIds.length)}
        entryName={pendingTrash?.name ?? ""}
        error={entryOperationError}
        onCancel={() => {
          if (!entryOperationBusy) {
            setPendingTrash(null);
            setEntryOperationError(null);
          }
        }}
        onMoveToTrash={() => void performMoveToTrash()}
        open={Boolean(pendingTrash)}
        openDocumentCount={pendingTrash?.affectedDocumentIds.length ?? 0}
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
