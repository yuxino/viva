import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ContextMenu, type MenuItem } from "../../components/ui";
import type { FileTreeNode } from "../../domain/workspace";
import { useI18n } from "../../i18n";
import { writeClipboardText } from "../../lib/clipboard";

interface VisibleTreeItem {
  node: FileTreeNode;
  level: number;
  parentPath: string | null;
}

export interface FileTreeIconState {
  active: boolean;
  expanded: boolean;
}

export interface FileTreeProps {
  nodes: readonly FileTreeNode[];
  expandedPaths: readonly string[];
  activePath?: string | null;
  modifiedPaths?: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onReveal?: (path: string) => void;
  renderIcon?: (node: FileTreeNode, state: FileTreeIconState) => ReactNode;
  ariaLabel?: string;
  className?: string;
  emptyState?: ReactNode;
}

function joinClassNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function flattenVisibleTree(
  nodes: readonly FileTreeNode[],
  expandedPaths: ReadonlySet<string>,
  level = 1,
  parentPath: string | null = null,
): VisibleTreeItem[] {
  const items: VisibleTreeItem[] = [];

  for (const node of nodes) {
    items.push({ node, level, parentPath });
    if (node.kind === "directory" && expandedPaths.has(node.relativePath)) {
      items.push(
        ...flattenVisibleTree(
          node.children,
          expandedPaths,
          level + 1,
          node.relativePath,
        ),
      );
    }
  }

  return items;
}

export function FileTree({
  nodes,
  expandedPaths,
  activePath = null,
  modifiedPaths = new Set<string>(),
  onToggle,
  onOpen,
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
  const visiblePaths = useMemo(
    () => new Set(visibleItems.map(({ node }) => node.relativePath)),
    [visibleItems],
  );
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusPath = useRef<string | null>(null);
  const treeRef = useRef<HTMLUListElement>(null);

  const fallbackFocusPath =
    (activePath && visiblePaths.has(activePath) ? activePath : null) ??
    visibleItems[0]?.node.relativePath ??
    null;
  const rovingFocusPath =
    focusedPath && visiblePaths.has(focusedPath)
      ? focusedPath
      : fallbackFocusPath;

  useEffect(() => {
    const pendingPath = pendingFocusPath.current;
    if (!pendingPath || !visiblePaths.has(pendingPath)) return;
    pendingFocusPath.current = null;
    setFocusedPath(pendingPath);
    itemRefs.current.get(pendingPath)?.focus();
  }, [visiblePaths]);

  useEffect(() => {
    if (!activePath || !visiblePaths.has(activePath)) return;
    if (treeRef.current?.contains(document.activeElement)) return;
    setFocusedPath(activePath);
  }, [activePath, visiblePaths]);

  function focusItem(path: string | null): void {
    if (!path) return;
    setFocusedPath(path);
    itemRefs.current.get(path)?.focus();
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
  ): void {
    const index = visibleItems.findIndex(
      ({ node }) => node.relativePath === item.node.relativePath,
    );
    if (index < 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(
          visibleItems[Math.min(index + 1, visibleItems.length - 1)]?.node
            .relativePath ?? null,
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(visibleItems[Math.max(index - 1, 0)]?.node.relativePath ?? null);
        break;
      case "Home":
        event.preventDefault();
        focusItem(visibleItems[0]?.node.relativePath ?? null);
        break;
      case "End":
        event.preventDefault();
        focusItem(visibleItems.at(-1)?.node.relativePath ?? null);
        break;
      case "ArrowRight":
        if (item.node.kind !== "directory") return;
        event.preventDefault();
        if (!expandedSet.has(item.node.relativePath)) {
          pendingFocusPath.current = item.node.children[0]?.relativePath ?? null;
          onToggle(item.node.relativePath);
        } else {
          focusItem(item.node.children[0]?.relativePath ?? null);
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (
          item.node.kind === "directory" &&
          expandedSet.has(item.node.relativePath)
        ) {
          onToggle(item.node.relativePath);
        } else {
          focusItem(item.parentPath);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        activateItem(item);
        break;
    }
  }

  function renderNodes(
    branch: readonly FileTreeNode[],
    level: number,
    parentPath: string | null,
  ): ReactNode {
    return branch.map((node) => {
      const expanded =
        node.kind === "directory" && expandedSet.has(node.relativePath);
      const active = node.kind !== "directory" && activePath === node.relativePath;
      const modified = node.kind === "file" && modifiedPaths.has(node.relativePath);
      const item: VisibleTreeItem = { node, level, parentPath };
      const contextItems: MenuItem[] = [
        {
          id: "open",
          label: t("Open"),
          onSelect: () => activateItem(item),
        },
        {
          id: "copy-path",
          label: t("Copy relative path"),
          onSelect: () => void writeClipboardText(node.relativePath),
          separatorBefore: true,
        },
        {
          disabled: !onReveal,
          id: "reveal",
          label: t("Show in folder"),
          onSelect: () => onReveal?.(node.relativePath),
        },
      ];

      return (
        <li className="file-tree__node" key={node.relativePath} role="none">
          <ContextMenu items={contextItems} label={t("File menu")}>
            <button
            aria-expanded={node.kind === "directory" ? expanded : undefined}
            aria-level={level}
            aria-selected={active}
            className={joinClassNames(
              "file-tree__item",
              `file-tree__item--${node.kind}`,
              active && "is-active",
              modified && "is-modified",
              expanded && "is-expanded",
            )}
            onClick={() => activateItem(item)}
            onFocus={() => setFocusedPath(node.relativePath)}
            onKeyDown={(event) => handleKeyDown(event, item)}
            ref={(element) => {
              if (element) itemRefs.current.set(node.relativePath, element);
              else itemRefs.current.delete(node.relativePath);
            }}
            role="treeitem"
            tabIndex={rovingFocusPath === node.relativePath ? 0 : -1}
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
                <span
                  aria-label={t("Modified")}
                  className="file-tree__modified"
                >
                  {t("Modified")}
                </span>
              ) : null}
            </button>
          </ContextMenu>
          {node.kind === "directory" && expanded ? (
            <ul className="file-tree__group" role="group">
              {renderNodes(node.children, level + 1, node.relativePath)}
            </ul>
          ) : null}
        </li>
      );
    });
  }

  if (nodes.length === 0) {
    return (
      <div className={joinClassNames("file-tree", className)}>
        <div className="file-tree__empty" role="status">
          {resolvedEmptyState}
        </div>
      </div>
    );
  }

  return (
    <nav
      aria-label={resolvedAriaLabel}
      className={joinClassNames("file-tree", className)}
    >
      <ul className="file-tree__list" ref={treeRef} role="tree">
        {renderNodes(nodes, 1, null)}
      </ul>
    </nav>
  );
}
