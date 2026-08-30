import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchPanel } from "./SearchPanel";

afterEach(cleanup);

describe("SearchPanel", () => {
  it("reports query edits, submits trimmed text, and opens a result", () => {
    const onQueryChange = vi.fn();
    const onSubmit = vi.fn();
    const onOpenResult = vi.fn();
    const result = {
      relativePath: "notes/start.md",
      line: 4,
      column: 2,
      preview: "A matching line",
    };

    render(
      <SearchPanel
        onOpenResult={onOpenResult}
        onQueryChange={onQueryChange}
        onSubmit={onSubmit}
        query="  match  "
        results={[result]}
      />,
    );

    const searchbox = screen.getByRole("searchbox");
    expect(searchbox).toHaveFocus();
    fireEvent.click(screen.getByText("A matching line"));
    expect(onOpenResult).toHaveBeenCalledWith(result);

    fireEvent.change(searchbox, {
      target: { value: "next" },
    });
    expect(onQueryChange).toHaveBeenCalledWith("next");

    fireEvent.submit(screen.getByRole("search"));
    expect(onSubmit).toHaveBeenCalledWith("match");
  });

  it("clears the query with Escape", () => {
    const onQueryChange = vi.fn();
    render(
      <SearchPanel
        onOpenResult={vi.fn()}
        onQueryChange={onQueryChange}
        query="needle"
      />,
    );

    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(onQueryChange).toHaveBeenCalledWith("");
  });

  it("keeps focus in the searchbox while navigating and opening results", () => {
    const onOpenResult = vi.fn();
    const results = [
      {
        relativePath: "notes/first.md",
        line: 2,
        column: 4,
        preview: "First match",
      },
      {
        relativePath: "notes/second.md",
        line: 8,
        column: 1,
        preview: "Second match",
      },
    ];
    render(
      <SearchPanel
        onOpenResult={onOpenResult}
        onQueryChange={vi.fn()}
        query="match"
        results={results}
      />,
    );

    const searchbox = screen.getByRole("searchbox");
    const options = screen.getAllByRole("option");
    expect(searchbox).toHaveFocus();
    expect(screen.getByRole("listbox", { name: "Search results" })).toContainElement(
      options[0]!,
    );
    expect(searchbox).toHaveAttribute("aria-activedescendant", options[0]?.id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(searchbox, { key: "ArrowDown" });
    expect(searchbox).toHaveFocus();
    expect(searchbox).toHaveAttribute("aria-activedescendant", options[1]?.id);
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(searchbox, { key: "Enter" });
    expect(onOpenResult).toHaveBeenCalledWith(results[1]);

    fireEvent.keyDown(searchbox, { key: "ArrowDown" });
    expect(searchbox).toHaveAttribute("aria-activedescendant", options[0]?.id);
    fireEvent.keyDown(searchbox, { key: "ArrowUp" });
    expect(searchbox).toHaveAttribute("aria-activedescendant", options[1]?.id);
  });

  it.each([
    { isComposing: true, keyCode: 13 },
    { isComposing: false, keyCode: 229 },
  ])("does not open a result for an IME key event %#", (native) => {
    const onOpenResult = vi.fn();
    render(
      <SearchPanel
        onOpenResult={onOpenResult}
        onQueryChange={vi.fn()}
        query="输入"
        results={[
          {
            relativePath: "notes/input.md",
            line: 1,
            column: 1,
            preview: "输入中",
          },
        ]}
      />,
    );

    fireEvent.keyDown(screen.getByRole("searchbox"), {
      ...native,
      key: "Enter",
    });
    expect(onOpenResult).not.toHaveBeenCalled();
  });

  it("hides stale results immediately and blocks Enter until the new query lands", () => {
    const onOpenResult = vi.fn();
    const onQueryChange = vi.fn();
    const staleResult = {
      relativePath: "notes/old.md",
      line: 1,
      column: 1,
      preview: "Old result",
    };
    const freshResult = {
      relativePath: "notes/new.md",
      line: 2,
      column: 3,
      preview: "New result",
    };
    const { rerender } = render(
      <SearchPanel
        onOpenResult={onOpenResult}
        onQueryChange={onQueryChange}
        query="old"
        results={[staleResult]}
        resultsQuery="old"
      />,
    );
    const searchbox = screen.getByRole("searchbox");

    fireEvent.change(searchbox, { target: { value: "new" } });
    fireEvent.keyDown(searchbox, { key: "Enter" });

    expect(onQueryChange).toHaveBeenCalledWith("new");
    expect(onOpenResult).not.toHaveBeenCalled();
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");

    rerender(
      <SearchPanel
        onOpenResult={onOpenResult}
        onQueryChange={onQueryChange}
        query="new"
        results={[staleResult]}
        resultsQuery="old"
      />,
    );
    expect(screen.queryByRole("option")).toBeNull();

    rerender(
      <SearchPanel
        onOpenResult={onOpenResult}
        onQueryChange={onQueryChange}
        query="new"
        results={[freshResult]}
        resultsQuery="new"
      />,
    );
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    expect(onOpenResult).toHaveBeenCalledWith(freshResult);
  });
});
