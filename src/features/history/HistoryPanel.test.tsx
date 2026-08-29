import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryPanel, type HistoryEntry } from "./HistoryPanel";
import { createHistoryLineDiff } from "./diff";

afterEach(cleanup);

const metadataEntries: HistoryEntry[] = [
  {
    id: "newer",
    label: "Today, 14:32",
    createdAt: "2026-08-29T14:32:00+08:00",
    description: "Autosaved",
  },
  {
    id: "older",
    label: "Yesterday, 18:04",
    createdAt: "2026-08-28T18:04:00+08:00",
    description: "Before editing",
  },
];

const entries: HistoryEntry[] = metadataEntries.map((entry, index) => ({
  ...entry,
  content: index === 0 ? "Title\nFirst draft" : "Title\nEarlier draft",
}));

describe("createHistoryLineDiff", () => {
  it("aligns inserted and removed lines without a dependency", () => {
    const result = createHistoryLineDiff(
      "alpha\nbeta\ngamma",
      "alpha\nnew\nbeta",
    );

    expect(result.rows.map(({ kind, text }) => [kind, text])).toEqual([
      ["unchanged", "alpha"],
      ["added", "new"],
      ["unchanged", "beta"],
      ["removed", "gamma"],
    ]);
    expect(result.summary).toEqual({ additions: 1, removals: 1, unchanged: 2 });
  });
});

describe("HistoryPanel", () => {
  it("navigates versions by keyboard and loads the selected snapshot", () => {
    const onSelect = vi.fn();
    const onLoadVersion = vi.fn();
    render(
      <HistoryPanel
        currentContent="Title\nCurrent draft"
        entries={entries}
        fileName="notes/start.md"
        onLoadVersion={onLoadVersion}
        onSelect={onSelect}
        selectedId="newer"
      />,
    );

    const selected = screen.getByRole("option", {
      name: "Today, 14:32, Autosaved",
    });
    expect(selected).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(selected, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith("older");
    expect(screen.getByRole("option", { name: /Yesterday/ })).toHaveFocus();

    fireEvent.click(
      screen.getByRole("button", { name: "Load this version: Today, 14:32" }),
    );
    expect(onLoadVersion).toHaveBeenCalledWith(entries[0]);
    expect(screen.getByRole("list", { name: "Version content" })).toHaveTextContent(
      "First draft",
    );
    expect(
      screen.getByLabelText("Changes from this version to the current document"),
    ).toHaveTextContent("+1Added");
  });

  it("renders loading, empty, and error states", () => {
    const props = {
      currentContent: "",
      entries: [] as HistoryEntry[],
      onLoadVersion: vi.fn(),
      onSelect: vi.fn(),
      selectedId: null,
    };
    const { rerender } = render(<HistoryPanel {...props} loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading file history");

    rerender(<HistoryPanel {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent("No saved versions yet");

    rerender(<HistoryPanel {...props} error="The history file could not be read" />);
    expect(screen.getByRole("alert")).toHaveTextContent("History unavailable");
  });

  it("keeps metadata visible while the selected version loads lazily", () => {
    const props = {
      currentContent: "Title\nCurrent draft",
      entries: metadataEntries,
      onLoadVersion: vi.fn(),
      onSelect: vi.fn(),
      selectedId: "newer",
    };
    const { rerender } = render(<HistoryPanel {...props} previewLoading />);

    expect(screen.getByRole("listbox", { name: "Saved versions" })).toBeVisible();
    expect(screen.getByRole("option", { name: /Yesterday/ })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading version content",
    );
    expect(
      screen.getByRole("button", { name: "Load this version: Today, 14:32" }),
    ).toBeDisabled();

    rerender(<HistoryPanel {...props} entries={entries} />);
    expect(screen.getByRole("list", { name: "Version content" })).toHaveTextContent(
      "First draft",
    );
    expect(
      screen.getByRole("button", { name: "Load this version: Today, 14:32" }),
    ).toBeEnabled();
  });

  it("bounds snapshot and diff DOM for very large documents", () => {
    const largeContent = Array.from(
      { length: 3_000 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    render(
      <HistoryPanel
        currentContent={largeContent}
        entries={[{ ...entries[0]!, content: largeContent }]}
        onLoadVersion={vi.fn()}
        onSelect={vi.fn()}
        selectedId="newer"
      />,
    );

    const snapshot = screen.getByRole("list", { name: "Version content" });
    expect(snapshot.children.length).toBe(2_000);
    expect(
      screen.getByText(/Snapshot display is limited to the first 2,000 lines/),
    ).toBeVisible();
    expect(
      screen.getByText(/Difference display is limited to the first 800 lines/),
    ).toBeVisible();
  });
});
