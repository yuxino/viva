import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OutlinePanel } from "./OutlinePanel";

describe("OutlinePanel", () => {
  it("tracks the source line and selects an outline item", () => {
    const onSelect = vi.fn();
    const items = [
      { id: "intro", level: 1, text: "Intro", sourceLine: 1 },
      { id: "details", level: 2, text: "Details", sourceLine: 8 },
    ];

    render(
      <OutlinePanel
        activeSourceLine={10}
        items={items}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole("button", { name: /Details/ })).toHaveAttribute(
      "aria-current",
      "location",
    );
    fireEvent.click(screen.getByRole("button", { name: /Intro/ }));
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });
});
