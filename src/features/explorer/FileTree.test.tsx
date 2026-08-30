import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FileTreeNode } from "../../domain/workspace";
import { FileTree } from "./FileTree";

const nodes: FileTreeNode[] = [
  {
    name: "Notes",
    relativePath: "Notes",
    kind: "directory",
    children: [
      {
        name: "today.md",
        relativePath: "Notes/today.md",
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
  {
    name: "cover.png",
    relativePath: "cover.png",
    kind: "image",
    children: [],
  },
];

function lifecycleCallbacks() {
  return {
    onDuplicate: vi.fn(),
    onMoveToTrash: vi.fn(),
    onNewFolder: vi.fn(),
    onNewMarkdownFile: vi.fn(),
    onRename: vi.fn(),
  };
}

function createLargeWorkspace(size: number): FileTreeNode[] {
  return Array.from({ length: size }, (_, index) => ({
    children: [],
    kind: "file" as const,
    name: `note-${index.toString().padStart(5, "0")}.md`,
    relativePath: `note-${index.toString().padStart(5, "0")}.md`,
  }));
}

describe("FileTree", () => {
  it("expands folders and follows the ARIA tree keyboard pattern", async () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    const view = render(
      <FileTree
        expandedPaths={[]}
        nodes={nodes}
        onOpen={onOpen}
        onToggle={onToggle}
      />,
    );
    const folder = screen.getByRole("treeitem", { name: "Notes" });

    folder.focus();
    fireEvent.keyDown(folder, { key: "ArrowRight" });
    expect(onToggle).toHaveBeenCalledWith("Notes");

    view.rerender(
      <FileTree
        expandedPaths={["Notes"]}
        nodes={nodes}
        onOpen={onOpen}
        onToggle={onToggle}
      />,
    );

    const child = await screen.findByRole("treeitem", { name: "today.md" });
    expect(folder).toHaveAttribute("aria-level", "1");
    expect(folder).toHaveAttribute("aria-posinset", "1");
    expect(folder).toHaveAttribute("aria-setsize", "3");
    expect(child).toHaveAttribute("aria-level", "2");
    expect(child).toHaveAttribute("aria-posinset", "1");
    expect(child).toHaveAttribute("aria-setsize", "1");
    expect(folder).toHaveFocus();
    expect(child).not.toHaveFocus();

    fireEvent.keyDown(folder, { key: "ArrowRight" });
    expect(child).toHaveFocus();
    fireEvent.keyDown(child, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("Notes/today.md");

    fireEvent.keyDown(child, { key: "ArrowLeft" });
    expect(screen.getByRole("treeitem", { name: "Notes" })).toHaveFocus();
  });

  it("makes modified documents visible in the file tree", () => {
    render(
      <FileTree
        expandedPaths={[]}
        modifiedPaths={new Set(["README.md"])}
        nodes={nodes}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Modified")).toBeVisible();
    expect(screen.getByRole("treeitem", { name: /README\.md.*Modified/i }))
      .toBeVisible();
  });

  it("opens file actions from right click", () => {
    const onReveal = vi.fn();
    render(
      <FileTree
        expandedPaths={[]}
        nodes={nodes}
        onOpen={vi.fn()}
        onReveal={onReveal}
        onToggle={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "README.md" }));
    expect(screen.getByRole("menu", { name: "File menu" })).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "Show in folder" }));

    expect(onReveal).toHaveBeenCalledWith("README.md");
  });

  it("targets a directory for creation, rename, and trash without offering duplicate", () => {
    const actions = lifecycleCallbacks();
    render(
      <FileTree
        {...actions}
        expandedPaths={[]}
        nodes={nodes}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    const folder = screen.getByRole("treeitem", { name: "Notes" });

    fireEvent.contextMenu(folder);
    expect(screen.queryByRole("menuitem", { name: "Duplicate" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "New Markdown File" }));
    expect(actions.onNewMarkdownFile).toHaveBeenCalledWith("Notes");

    fireEvent.contextMenu(folder);
    fireEvent.click(screen.getByRole("menuitem", { name: "New Folder" }));
    expect(actions.onNewFolder).toHaveBeenCalledWith("Notes");

    fireEvent.contextMenu(folder);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(actions.onRename).toHaveBeenCalledWith("Notes");

    fireEvent.contextMenu(folder);
    const trash = screen.getByRole("menuitem", { name: "Move to Trash" });
    expect(trash).toHaveClass("is-danger");
    fireEvent.click(trash);
    expect(actions.onMoveToTrash).toHaveBeenCalledWith("Notes");
  });

  it("creates beside a file and exposes rename, duplicate, and trash paths", () => {
    const actions = lifecycleCallbacks();
    render(
      <FileTree
        {...actions}
        expandedPaths={["Notes"]}
        nodes={nodes}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    const file = screen.getByRole("treeitem", { name: "today.md" });

    fireEvent.contextMenu(file);
    fireEvent.click(screen.getByRole("menuitem", { name: "New Markdown File" }));
    expect(actions.onNewMarkdownFile).toHaveBeenCalledWith("Notes");

    fireEvent.contextMenu(file);
    fireEvent.click(screen.getByRole("menuitem", { name: "New Folder" }));
    expect(actions.onNewFolder).toHaveBeenCalledWith("Notes");

    fireEvent.contextMenu(file);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(actions.onRename).toHaveBeenCalledWith("Notes/today.md");

    fireEvent.contextMenu(file);
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(actions.onDuplicate).toHaveBeenCalledWith("Notes/today.md");

    fireEvent.contextMenu(file);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    expect(actions.onMoveToTrash).toHaveBeenCalledWith("Notes/today.md");
  });

  it("treats an image like a file for duplicate and parent creation", () => {
    const actions = lifecycleCallbacks();
    render(
      <FileTree
        {...actions}
        expandedPaths={[]}
        nodes={nodes}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    const image = screen.getByRole("treeitem", { name: "cover.png" });

    fireEvent.contextMenu(image);
    fireEvent.click(screen.getByRole("menuitem", { name: "New Folder" }));
    expect(actions.onNewFolder).toHaveBeenCalledWith("");

    fireEvent.contextMenu(image);
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(actions.onDuplicate).toHaveBeenCalledWith("cover.png");
  });

  it("creates at workspace root from the root menu and supports keyboard invocation", () => {
    const actions = lifecycleCallbacks();
    render(
      <FileTree
        {...actions}
        expandedPaths={[]}
        nodes={nodes}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    const root = screen.getByRole("navigation", { name: "Workspace files" });

    expect(root).toHaveClass("file-tree", "viva-scroll-region");

    fireEvent.contextMenu(root);
    fireEvent.click(screen.getByRole("menuitem", { name: "New Markdown File" }));
    expect(actions.onNewMarkdownFile).toHaveBeenCalledWith("");

    root.focus();
    expect(root).toHaveFocus();
    fireEvent.keyDown(root, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu", { name: "Workspace menu" })).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "New Folder" }));
    expect(actions.onNewFolder).toHaveBeenCalledWith("");
  });

  it("provides root creation actions when the tree is empty", () => {
    const actions = lifecycleCallbacks();
    render(
      <FileTree
        {...actions}
        expandedPaths={[]}
        nodes={[]}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    const root = screen.getByRole("navigation", { name: "Workspace files" });
    expect(screen.getByRole("status")).toHaveTextContent("No Markdown files");

    root.focus();
    expect(root).toHaveFocus();
    fireEvent.keyDown(root, { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("menuitem", { name: "New Markdown File" }));
    expect(actions.onNewMarkdownFile).toHaveBeenCalledWith("");
  });

  it("disables lifecycle actions while busy but keeps read-only actions available", () => {
    const actions = lifecycleCallbacks();
    render(
      <FileTree
        {...actions}
        busy
        expandedPaths={[]}
        nodes={nodes}
        onOpen={vi.fn()}
        onReveal={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    const root = screen.getByRole("navigation", { name: "Workspace files" });
    expect(root).toHaveAttribute("aria-busy", "true");

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "README.md" }));
    expect(screen.getByRole("menuitem", { name: "Open" })).toBeEnabled();
    expect(
      screen.getByRole("menuitem", { name: "Copy relative path" }),
    ).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Show in folder" })).toBeEnabled();
    expect(
      screen.getByRole("menuitem", { name: "New Markdown File" }),
    ).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "New Folder" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Move to Trash" })).toBeDisabled();
  });

  it("focuses a newly visible requested path once per request without expanding", async () => {
    const onToggle = vi.fn();
    const request = { id: 1, path: "Created.md" };
    const view = render(
      <FileTree
        expandedPaths={[]}
        focusRequest={request}
        nodes={nodes}
        onOpen={vi.fn()}
        onToggle={onToggle}
      />,
    );
    expect(onToggle).not.toHaveBeenCalled();

    const refreshedNodes: FileTreeNode[] = [
      ...nodes,
      {
        children: [],
        kind: "file",
        name: "Created.md",
        relativePath: "Created.md",
      },
    ];
    view.rerender(
      <FileTree
        expandedPaths={[]}
        focusRequest={request}
        nodes={refreshedNodes}
        onOpen={vi.fn()}
        onToggle={onToggle}
      />,
    );
    const created = await screen.findByRole("treeitem", { name: "Created.md" });
    await waitFor(() => expect(created).toHaveFocus());
    expect(onToggle).not.toHaveBeenCalled();

    const readme = screen.getByRole("treeitem", { name: "README.md" });
    readme.focus();
    view.rerender(
      <FileTree
        expandedPaths={[]}
        focusRequest={request}
        nodes={refreshedNodes}
        onOpen={vi.fn()}
        onToggle={onToggle}
      />,
    );
    expect(readme).toHaveFocus();

    view.rerender(
      <FileTree
        expandedPaths={[]}
        focusRequest={{ id: 2, path: "Created.md" }}
        nodes={refreshedNodes}
        onOpen={vi.fn()}
        onToggle={onToggle}
      />,
    );
    await waitFor(() => expect(created).toHaveFocus());
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("focuses the workspace root after removing the last visible entry", async () => {
    render(
      <FileTree
        {...lifecycleCallbacks()}
        expandedPaths={[]}
        focusRequest={{ id: 1, path: "" }}
        nodes={[]}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("navigation", { name: "Workspace files" }),
      ).toHaveFocus(),
    );
  });

  it("windows a 12,000-entry workspace and keeps overscan bounded while scrolling", async () => {
    const onNewFolder = vi.fn();
    render(
      <FileTree
        expandedPaths={[]}
        nodes={createLargeWorkspace(12_000)}
        onNewFolder={onNewFolder}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    const root = screen.getByRole("navigation", { name: "Workspace files" });
    Object.defineProperty(root, "clientHeight", {
      configurable: true,
      value: 280,
    });
    const tree = screen.getByRole("tree");

    expect(tree).toHaveAttribute("data-total-count", "12000");
    expect(screen.getAllByRole("treeitem")).toHaveLength(22);

    root.scrollTop = 6_000 * 28;
    fireEvent.scroll(root);

    const middle = await screen.findByRole("treeitem", {
      name: "note-06000.md",
    });
    expect(middle).toHaveAttribute("aria-level", "1");
    expect(middle).toHaveAttribute("aria-posinset", "6001");
    expect(middle).toHaveAttribute("aria-setsize", "12000");
    expect(screen.getAllByRole("treeitem").length).toBeLessThanOrEqual(24);

    fireEvent.contextMenu(root, { clientX: 20, clientY: 260 });
    fireEvent.click(screen.getByRole("menuitem", { name: "New Folder" }));
    expect(onNewFolder).toHaveBeenCalledWith("");
  });

  it("scrolls keyboard and external focus requests to arbitrary virtual rows", async () => {
    const largeWorkspace = createLargeWorkspace(12_000);
    const view = render(
      <FileTree
        expandedPaths={[]}
        nodes={largeWorkspace}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    const root = screen.getByRole("navigation", { name: "Workspace files" });
    Object.defineProperty(root, "clientHeight", {
      configurable: true,
      value: 280,
    });
    const first = screen.getByRole("treeitem", { name: "note-00000.md" });

    first.focus();
    fireEvent.keyDown(first, { key: "End" });

    const last = await screen.findByRole("treeitem", {
      name: "note-11999.md",
    });
    await waitFor(() => expect(last).toHaveFocus());
    expect(root.scrollTop).toBeGreaterThan(300_000);
    expect(screen.getAllByRole("treeitem").length).toBeLessThanOrEqual(24);

    view.rerender(
      <FileTree
        expandedPaths={[]}
        focusRequest={{ id: 7, path: "note-07777.md" }}
        nodes={largeWorkspace}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    const requested = await screen.findByRole("treeitem", {
      name: "note-07777.md",
    });
    await waitFor(() => expect(requested).toHaveFocus());
    expect(root.scrollTop).toBeGreaterThan(200_000);
    expect(screen.getAllByRole("treeitem").length).toBeLessThanOrEqual(24);

    fireEvent.keyDown(requested, { key: "Home" });
    const returnedFirst = await screen.findByRole("treeitem", {
      name: "note-00000.md",
    });
    await waitFor(() => expect(returnedFirst).toHaveFocus());
    expect(root.scrollTop).toBe(0);
  });
});
