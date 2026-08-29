import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentTabs } from "./DocumentTabs";

describe("DocumentTabs", () => {
  it("exposes dirty state and supports keyboard activation and closing", () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    render(
      <DocumentTabs
        activeId="one"
        onActivate={onActivate}
        onClose={onClose}
        tabs={[
          { id: "one", label: "one.md", dirty: true },
          { id: "two", label: "two.md" },
        ]}
      />,
    );

    const first = screen.getByRole("tab", { name: /one.md/i });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(onActivate).toHaveBeenCalledWith("two");
    expect(screen.getByRole("tab", { name: "two.md" })).toHaveFocus();
    expect(screen.getByLabelText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByLabelText("Unsaved changes")).toHaveTextContent(
      "Modified",
    );

    fireEvent.click(screen.getByRole("button", { name: "Close one.md" }));
    expect(onClose).toHaveBeenCalledWith("one");
  });

  it("offers save and close actions from a tab context menu", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    render(
      <DocumentTabs
        activeId="one"
        onActivate={vi.fn()}
        onClose={onClose}
        onSave={onSave}
        tabs={[{ id: "one", label: "one.md", dirty: true }]}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("tab", { name: /one\.md/i }));
    expect(screen.getByRole("menu", { name: "Tab menu" })).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("one");

    fireEvent.contextMenu(screen.getByRole("tab", { name: /one\.md/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Close" }));
    expect(onClose).toHaveBeenCalledWith("one");
  });
});
