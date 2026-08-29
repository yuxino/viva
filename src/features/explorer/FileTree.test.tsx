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
];

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
    await waitFor(() => expect(child).toHaveFocus());
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
});
