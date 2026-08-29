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

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "next" },
    });
    expect(onQueryChange).toHaveBeenCalledWith("next");

    fireEvent.submit(screen.getByRole("search"));
    expect(onSubmit).toHaveBeenCalledWith("match");

    fireEvent.click(screen.getByText("A matching line"));
    expect(onOpenResult).toHaveBeenCalledWith(result);
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
});
