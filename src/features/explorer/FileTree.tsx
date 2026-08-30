import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import { ContextMenu, type MenuItem } from "../../components/ui";
import type { FileTreeNode } from "../../domain/workspace";
import { useI18n } from "../../i18n";
import { writeClipboardText } from "../../lib/clipboard";

interface VisibleTreeItem {
  node: FileTreeNode;
  level: number;
  parentPath: string | null;
  positionInSet: number;
  setSize: number;
}

interface PendingFocus {
  path: string;
  requestKey?: string;
}

interface TreeViewport {
  height: number;
  scrollTop: number;
}

export interface FileTreeIconState {
  active: boolean;
  expanded: boolean;
}

export interface FileTreeFocusRequest {
  id: number;
  path: string;
}

export interface FileTreeProps {
  nodes: readonly FileTreeNode[];
  expandedPaths: readonly string[];
  activePath?: string | null;
  busy?: boolean;
  focusRequest?: FileTreeFocusRequest | null;
  modifiedPaths?: ReadonlySet<string>;
  onDuplicate?: (path: string) => void;
  onMoveToTrash?: (path: string) => void;
  onNewFolder?: (parentPath: string) => void;
  onNewMarkdownFile?: (parentPath: string) => void;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onRename?: (path: string) => void;
  onReveal?: (path: string) => void;
  renderIcon?: (node: FileTreeNode, state: FileTreeIconState) => ReactNode;
  ariaLabel?: string;
  className?: string;
  emptyState?: ReactNode;
}

const FILE_TREE_ROW_HEIGHT = 28;
const FILE_TREE_OVERSCAN_ROWS = 6;
const FILE_TREE_FALLBACK_VIEWPORT_ROWS = 16;
const FILE_TREE_VIRTUALIZE_AFTER = 200;

function joinClassNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function getParentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function appendMenuGroup(target: MenuItem[], group: MenuItem[]): void {
  if (!group.length) return;
  target.push(
    ...group.map((item, index) =>
      index === 0 && target.length ? { ...item, separatorBefore: true } : item,
    ),
  );
}

function flattenVisibleTree(
  nodes: readonly FileTreeNode[],
  expandedPaths: ReadonlySet<string>,
): VisibleTreeItem[] {
  const items: VisibleTreeItem[] = [];

  function appendBranch(
    branch: readonly FileTreeNode[],
    level: number,
    parentPath: string | null,
  ): void {
    const setSize = branch.length;
    for (let index = 0; index < setSize; index += 1) {
      const node = branch[index];
      if (!node) continue;
      items.push({
        level,
        node,
        parentPath,
        positionInSet: index + 1,
        setSize,
      });
      if (node.kind === "directory" && expandedPaths.has(node.relativePath)) {
        appendBranch(node.children, level + 1, node.relativePath);
      }
    }
  }

  appendBranch(nodes, 1, null);
  return items;
}

function treeItemStyle(
  level: number,
  virtualIndex?: number,
): CSSProperties {
  const indentRem = level === 1 ? 0.5 : 1.15 + (level - 2) * 0.85;
  return {
    "--file-tree-indent": `${indentRem}rem`,
    ...(virtualIndex === undefined
      ? undefined
      : {
          height: FILE_TREE_ROW_HEIGHT,
          position: "absolute",
          top: virtualIndex * FILE_TREE_ROW_HEIGHT,
          width: "100%",
        }),
  } as CSSProperties;
}

export function FileTree({
  nodes,
  expandedPaths,
  activePath = null,
  busy = false,
  focusRequest = null,
  modifiedPaths = new Set<string>(),
  onDuplicate,
  onMoveToTrash,
  onNewFolder,
  onNewMarkdownFile,
  onToggle,
  onOpen,
  onRename,
  onReveal,
  renderIcon,
  ariaLabel,
  className,
  emptyState,
}: FileTreeProps) {
  const { t } = useI18n();
  const resolvedAriaLabel = ariaLabel ?? t("Workspace files");
  const resolvedEmptyState =
    emptyState === undefined ? t("No Markdown files") : emptyState;
  const expandedSet = useMemo(
    () => new Set(expandedPaths),
    [expandedPaths],
  );
  const visibleItems = useMemo(
    () => flattenVisibleTree(nodes, expandedSet),
    [expandedSet, nodes],
  );
  const pathIndexes = useMemo(() => {
    const indexes = new Map<string, number>();
    visibleItems.forEach(({ node }, index) => {
      indexes.set(node.relativePath, index);
    });
    return indexes;
  }, [visibleItems]);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null);
  const [treeHasFocus, setTreeHasFocus] = useState(false);
  const [viewport, setViewport] = useState<TreeViewport>({
    height: 0,
    scrollTop: 0,
  });
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const handledFocusRequest = useRef<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const virtualized = visibleItems.length > FILE_TREE_VIRTUALIZE_AFTER;
  const rootItems: MenuItem[] = [];

  if (onNewMarkdownFile) {
    rootItems.push({
      disabled: busy,
      id: "new-markdown-file",
      label: t("New Markdown File"),
      onSelect: () => onNewMarkdownFile(""),
    });
  }
  if (onNewFolder) {
    rootItems.push({
      disabled: busy,
      id: "new-folder",
      label: t("New Folder"),
      onSelect: () => onNewFolder(""),
    });
  }

  const fallbackFocusPath =
    (activePath && pathIndexes.has(activePath) ? activePath : null) ??
    visibleItems[0]?.node.relativePath ??
    null;
  const rovingFocusPath =
    focusedPath && pathIndexes.has(focusedPath)
      ? focusedPath
      : fallbackFocusPath;
  const viewportHeight =
    viewport.height ||
    FILE_TREE_ROW_HEIGHT * FILE_TREE_FALLBACK_VIEWPORT_ROWS;
  const firstVisibleIndex = Math.min(
    Math.max(visibleItems.length - 1, 0),
    Math.max(0, Math.floor(viewport.scrollTop / FILE_TREE_ROW_HEIGHT)),
  );
  const renderedStart = virtualized
    ? Math.max(0, firstVisibleIndex - FILE_TREE_OVERSCAN_ROWS)
    : 0;
  const renderedEnd = virtualized
    ? Math.min(
        visibleItems.length,
        firstVisibleIndex +
          Math.ceil(viewportHeight / FILE_TREE_ROW_HEIGHT) +
          FILE_TREE_OVERSCAN_ROWS,
      )
    : visibleItems.length;
  const renderedIndexes = useMemo(() => {
    const indexes = Array.from(
      { length: Math.max(0, renderedEnd - renderedStart) },
      (_, offset) => renderedStart + offset,
    );
    if (!virtualized || !treeHasFocus || !focusedPath) return indexes;
    const focusedIndex = pathIndexes.get(focusedPath);
    if (
      focusedIndex === undefined ||
      (focusedIndex >= renderedStart && focusedIndex < renderedEnd)
    ) {
      return indexes;
    }
    indexes.push(focusedIndex);
    return indexes;
  }, [
    focusedPath,
    pathIndexes,
    renderedEnd,
    renderedStart,
    treeHasFocus,
    virtualized,
  ]);
  const renderedPathSet = useMemo(
    () =>
      new Set(
        renderedIndexes.flatMap((index) => {
          const item = visibleItems[index];
          return item ? [item.node.relativePath] : [];
        }),
      ),
    [renderedIndexes, visibleItems],
  );
  const renderedRovingFocusPath =
    rovingFocusPath && renderedPathSet.has(rovingFocusPath)
      ? rovingFocusPath
      : visibleItems[renderedStart]?.node.relativePath ?? null;

  const scrollIndexIntoView = useCallback(
    (index: number) => {
      if (!virtualized) return;
      const root = rootRef.current;
      if (!root) return;
      const height = root.clientHeight || viewportHeight;
      const currentTop = root.scrollTop;
      const itemTop = index * FILE_TREE_ROW_HEIGHT;
      const itemBottom = itemTop + FILE_TREE_ROW_HEIGHT;
      let nextTop = currentTop;
      if (itemTop < currentTop) nextTop = itemTop;
      else if (itemBottom > currentTop + height) {
        nextTop = itemBottom - height;
      }
      if (nextTop !== currentTop) root.scrollTop = nextTop;
      setViewport({ height, scrollTop: nextTop });
    },
    [viewportHeight, virtualized],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !virtualized) return;

    const measure = () => {
      setViewport((current) => {
        const height = root.clientHeight;
        const scrollTop = root.scrollTop;
        return current.height === height && current.scrollTop === scrollTop
          ? current
          : { height, scrollTop };
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [virtualized]);

  useEffect(() => {
    if (!activePath || !pathIndexes.has(activePath)) return;
    if (rootRef.current?.contains(document.activeElement)) return;
    setFocusedPath(activePath);
  }, [activePath, pathIndexes]);

  useEffect(() => {
    if (!focusRequest) return;
    const requestKey = `${focusRequest.id}\u0000${focusRequest.path}`;
    if (handledFocusRequest.current === requestKey) return;
    if (focusRequest.path === "") {
      const root = rootRef.current;
      if (!root) return;
      handledFocusRequest.current = requestKey;
      setFocusedPath(null);
      setPendingFocus(null);
      root.focus();
      return;
    }
    const index = pathIndexes.get(focusRequest.path);
    if (index === undefined) return;
    setFocusedPath(focusRequest.path);
    setPendingFocus({ path: focusRequest.path, requestKey });
    scrollIndexIntoView(index);
  }, [focusRequest, pathIndexes, scrollIndexIntoView]);

  useLayoutEffect(() => {
    if (!pendingFocus) return;
    const target = itemRefs.current.get(pendingFocus.path);
    if (!target) return;
    target.focus();
    if (pendingFocus.requestKey) {
      handledFocusRequest.current = pendingFocus.requestKey;
    }
    setPendingFocus(null);
  }, [pendingFocus, renderedIndexes]);

  function focusIndex(index: number): void {
    const boundedIndex = Math.min(
      Math.max(index, 0),
      Math.max(visibleItems.length - 1, 0),
    );
    const path = visibleItems[boundedIndex]?.node.relativePath;
    if (!path) return;
    setFocusedPath(path);
    setPendingFocus({ path });
    scrollIndexIntoView(boundedIndex);
  }

  function activateItem(item: VisibleTreeItem): void {
    if (item.node.kind === "directory") {
      onToggle(item.node.relativePath);
      return;
    }
    onOpen(item.node.relativePath);
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    item: VisibleTreeItem,
    index: number,
  ): void {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusIndex(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusIndex(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusIndex(0);
        break;
      case "End":
        event.preventDefault();
        focusIndex(visibleItems.length - 1);
        break;
      case "ArrowRight":
        if (item.node.kind !== "directory") return;
        event.preventDefault();
        if (!expandedSet.has(item.node.relativePath)) {
          onToggle(item.node.relativePath);
        } else if (visibleItems[index + 1]?.parentPath === item.node.relativePath) {
          focusIndex(index + 1);
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (
          item.node.kind === "directory" &&
          expandedSet.has(item.node.relativePath)
        ) {
          onToggle(item.node.relativePath);
        } else if (item.parentPath) {
          const parentIndex = pathIndexes.get(item.parentPath);
          if (parentIndex !== undefined) focusIndex(parentIndex);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        activateItem(item);
        break;
    }
  }

  function renderItem(item: VisibleTreeItem, index: number): ReactNode {
    const { node } = item;
    const expanded =
      node.kind === "directory" && expandedSet.has(node.relativePath);
    const active = node.kind !== "directory" && activePath === node.relativePath;
    const modified = node.kind === "file" && modifiedPaths.has(node.relativePath);
    const creationParentPath =
      node.kind === "directory"
        ? node.relativePath
        : getParentPath(node.relativePath);
    const contextItems: MenuItem[] = [
      {
        id: "open",
        label: t("Open"),
        onSelect: () => activateItem(item),
      },
    ];
    const creationItems: MenuItem[] = [];
    if (onNewMarkdownFile) {
      creationItems.push({
        disabled: busy,
        id: "new-markdown-file",
        label: t("New Markdown File"),
        onSelect: () => onNewMarkdownFile(creationParentPath),
      });
    }
    if (onNewFolder) {
      creationItems.push({
        disabled: busy,
        id: "new-folder",
        label: t("New Folder"),
        onSelect: () => onNewFolder(creationParentPath),
      });
    }
    appendMenuGroup(contextItems, creationItems);

    const nodeMutationItems: MenuItem[] = [];
    if (onRename) {
      nodeMutationItems.push({
        disabled: busy,
        id: "rename",
        label: t("Rename"),
        onSelect: () => onRename(node.relativePath),
      });
    }
    if (node.kind !== "directory" && onDuplicate) {
      nodeMutationItems.push({
        disabled: busy,
        id: "duplicate",
        label: t("Duplicate"),
        onSelect: () => onDuplicate(node.relativePath),
      });
    }
    appendMenuGroup(contextItems, nodeMutationItems);

    appendMenuGroup(contextItems, [
      {
        id: "copy-path",
        label: t("Copy relative path"),
        onSelect: () => void writeClipboardText(node.relativePath),
      },
      {
        disabled: !onReveal,
        id: "reveal",
        label: t("Show in folder"),
        onSelect: () => onReveal?.(node.relativePath),
      },
    ]);
    if (onMoveToTrash) {
      appendMenuGroup(contextItems, [
        {
          danger: true,
          disabled: busy,
          id: "move-to-trash",
          label: t("Move to Trash"),
          onSelect: () => onMoveToTrash(node.relativePath),
        },
      ]);
    }

    return (
      <li
        className="file-tree__node"
        data-visible-index={index}
        key={node.relativePath}
        role="none"
        style={treeItemStyle(item.level, virtualized ? index : undefined)}
      >
        <ContextMenu items={contextItems} label={t("File menu")}>
          <button
            aria-expanded={node.kind === "directory" ? expanded : undefined}
            aria-level={item.level}
            aria-posinset={item.positionInSet}
            aria-selected={active}
            aria-setsize={item.setSize}
            className={joinClassNames(
              "file-tree__item",
              `file-tree__item--${node.kind}`,
              active && "is-active",
              modified && "is-modified",
              expanded && "is-expanded",
            )}
            onClick={() => activateItem(item)}
            onFocus={() => setFocusedPath(node.relativePath)}
            onKeyDown={(event) => handleKeyDown(event, item, index)}
            ref={(element) => {
              if (element) itemRefs.current.set(node.relativePath, element);
              else itemRefs.current.delete(node.relativePath);
            }}
            role="treeitem"
            tabIndex={renderedRovingFocusPath === node.relativePath ? 0 : -1}
            title={node.relativePath}
            type="button"
          >
            <span aria-hidden="true" className="file-tree__twistie">
              {node.kind === "directory" ? (expanded ? "▾" : "▸") : ""}
            </span>
            {renderIcon ? (
              <span aria-hidden="true" className="file-tree__icon">
                {renderIcon(node, { active, expanded })}
              </span>
            ) : null}
            <span className="file-tree__label">{node.name}</span>
            {modified ? (
              <span aria-label={t("Modified")} className="file-tree__modified">
                {t("Modified")}
              </span>
            ) : null}
          </button>
        </ContextMenu>
      </li>
    );
  }

  const tree = nodes.length === 0 ? (
    <nav
      aria-busy={busy || undefined}
      aria-label={resolvedAriaLabel}
      className={joinClassNames("file-tree", "viva-scroll-region", className)}
      ref={rootRef}
      tabIndex={rootItems.length ? 0 : undefined}
    >
      <div className="file-tree__empty" role="status">
        {resolvedEmptyState}
      </div>
    </nav>
  ) : (
    <nav
      aria-busy={busy || undefined}
      aria-label={resolvedAriaLabel}
      className={joinClassNames("file-tree", "viva-scroll-region", className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setTreeHasFocus(false);
        }
      }}
      onFocus={() => setTreeHasFocus(true)}
      onScroll={(event: UIEvent<HTMLElement>) => {
        if (!virtualized) return;
        setViewport({
          height: event.currentTarget.clientHeight,
          scrollTop: event.currentTarget.scrollTop,
        });
      }}
      ref={rootRef}
      tabIndex={rootItems.length ? 0 : undefined}
    >
      <ul
        className={joinClassNames(
          "file-tree__list",
          virtualized && "is-virtualized",
        )}
        data-rendered-count={renderedIndexes.length}
        data-total-count={visibleItems.length}
        role="tree"
        style={
          virtualized
            ? { height: visibleItems.length * FILE_TREE_ROW_HEIGHT }
            : undefined
        }
      >
        {renderedIndexes.map((index) => {
          const item = visibleItems[index];
          return item ? renderItem(item, index) : null;
        })}
      </ul>
    </nav>
  );

  return rootItems.length ? (
    <ContextMenu items={rootItems} label={t("Workspace menu")}>
      {tree}
    </ContextMenu>
  ) : (
    tree
  );
}
