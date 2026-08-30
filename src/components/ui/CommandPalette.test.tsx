import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CommandPalette,
  type CommandPaletteDataItem,
} from "./CommandPalette";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("CommandPalette", () => {
  it("closes explicitly when Escape is pressed in the search field", async () => {
    const onOpenChange = vi.fn();

    render(
      <CommandPalette
        items={[
          {
            id: "open",
            label: "Open file",
            onSelect: vi.fn(),
          },
        ]}
        onOpenChange={onOpenChange}
        open
      />,
    );

    const input = screen.getByRole("combobox", { name: "Command palette" });
    await waitFor(() => expect(input).toHaveFocus());

    fireEvent.keyDown(input, { key: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each(["Enter", "Escape"])(
    "leaves %s to the active input method while composing",
    async (key) => {
      const onOpenChange = vi.fn();
      const onSelect = vi.fn();
      render(
        <CommandPalette
          items={[{ id: "open", label: "Open file", onSelect }]}
          onOpenChange={onOpenChange}
          open
        />,
      );
      const input = screen.getByRole("combobox", {
        name: "Command palette",
      });
      await waitFor(() => expect(input).toHaveFocus());

      const accepted = fireEvent.keyDown(input, {
        isComposing: true,
        key,
      });

      expect(accepted).toBe(true);
      expect(onSelect).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
    },
  );

  it("ignores the legacy WebKit post-composition Enter event", async () => {
    const onOpenChange = vi.fn();
    const onSelect = vi.fn();
    render(
      <CommandPalette
        items={[{ id: "open", label: "Open file", onSelect }]}
        onOpenChange={onOpenChange}
        open
      />,
    );
    const input = screen.getByRole("combobox", { name: "Command palette" });
    await waitFor(() => expect(input).toHaveFocus());

    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("does not dismiss the palette when Escape cancels an IME composition", async () => {
    const onOpenChange = vi.fn();
    render(
      <CommandPalette items={[]} onOpenChange={onOpenChange} open />,
    );
    const input = screen.getByRole("combobox", { name: "Command palette" });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { isComposing: true, key: "Escape" });
    fireEvent.compositionEnd(input);

    fireEvent(
      screen.getByRole("dialog", { name: "Command palette" }),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );

    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent(
      screen.getByRole("dialog", { name: "Command palette" }),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("searches all 50,000 lightweight entries while bounding rendered results", async () => {
    const items: CommandPaletteDataItem[] = Array.from(
      { length: 50_000 },
      (_, index) => ({
        detail: `archive/${index.toString().padStart(5, "0")}/note.md`,
        id: `file:${index}`,
        label: `Note ${index.toString().padStart(5, "0")}`,
        searchText: `archive/${index.toString().padStart(5, "0")}/note.md`,
        value: `archive/${index.toString().padStart(5, "0")}/note.md`,
      }),
    );
    const onItemSelect = vi.fn();
    render(
      <CommandPalette
        items={items}
        maxResults={9}
        onItemSelect={onItemSelect}
        onOpenChange={vi.fn()}
        open
      />,
    );
    const input = screen.getByRole("combobox", { name: "Command palette" });
    await waitFor(() => expect(input).toHaveFocus());

    expect(screen.getAllByRole("option")).toHaveLength(9);
    fireEvent.change(input, { target: { value: "archive/49999" } });

    const result = await screen.findByRole("option", { name: /Note 49999/ });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.click(result);
    expect(onItemSelect).toHaveBeenCalledWith(items[49_999]);
  });

  it("returns stable bounded top matches in exact-to-path rank order", async () => {
    const items: CommandPaletteDataItem[] = [
      {
        id: "path",
        label: "Reference",
        searchText: "notes/alpha/reference.md",
      },
      { id: "substring", label: "Read xalpha notes" },
      { id: "word", label: "Open alpha notes" },
      { id: "prefix", label: "Alphabetical notes" },
      { id: "exact-first", label: "Alpha" },
      { id: "exact-second", label: "ALPHA" },
    ];
    render(
      <CommandPalette
        items={items}
        maxResults={6}
        onItemSelect={vi.fn()}
        onOpenChange={vi.fn()}
        open
      />,
    );
    const input = screen.getByRole("combobox", { name: "Command palette" });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: "alpha" } });

    await waitFor(() =>
      expect(
        screen.getAllByRole("option").map((option) => option.textContent),
      ).toEqual([
        "Alpha",
        "ALPHA",
        "Alphabetical notes",
        "Open alpha notes",
        "Read xalpha notes",
        "Reference",
      ]),
    );
  });
});
