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

    fireEvent.click(screen.getByRole("button", { name: "Close one.md" }));
    expect(onClose).toHaveBeenCalledWith("one");
  });
});
