import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";

const { isTauriMock, nativeMenuNewMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(),
  nativeMenuNewMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: isTauriMock,
}));

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: nativeMenuNewMock },
}));

beforeEach(() => {
  isTauriMock.mockReset();
  isTauriMock.mockReturnValue(true);
  nativeMenuNewMock.mockReset();
});

function renderTextMenu({
  onSelect = vi.fn(),
  preferCustomTextMenu = false,
}: {
  onSelect?: () => void;
  preferCustomTextMenu?: boolean;
} = {}) {
  render(
    <ContextMenu
      items={[{ id: "copy", label: "Copy clean text", onSelect }]}
      label="Text actions"
      preferCustomTextMenu={preferCustomTextMenu}
    >
      <textarea aria-label="Document source" />
    </ContextMenu>,
  );

  return {
    onSelect,
    textarea: screen.getByRole("textbox", { name: "Document source" }),
  };
}

describe("ContextMenu custom text handling", () => {
  it("leaves Tauri text context-menu events native by default", () => {
    const { textarea } = renderTextMenu();
    const pointerEvent = createEvent.contextMenu(textarea, {
      clientX: 24,
      clientY: 32,
    });
    const keyboardEvent = createEvent.keyDown(textarea, {
      key: "F10",
      shiftKey: true,
    });

    fireEvent(textarea, pointerEvent);
    fireEvent(textarea, keyboardEvent);

    expect(pointerEvent.defaultPrevented).toBe(false);
    expect(keyboardEvent.defaultPrevented).toBe(false);
    expect(nativeMenuNewMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "Text actions" })).toBeNull();
  });

  it("opens an actionable native menu for an opted-in text target", async () => {
    const popup = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    nativeMenuNewMock.mockResolvedValue({ close, popup });
    const { onSelect, textarea } = renderTextMenu({
      preferCustomTextMenu: true,
    });
    const event = createEvent.contextMenu(textarea, {
      clientX: 24,
      clientY: 32,
    });

    fireEvent(textarea, event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(nativeMenuNewMock).toHaveBeenCalledOnce());
    const options = nativeMenuNewMock.mock.calls[0]?.[0] as {
      items: Array<{ action?: () => void; id?: string; text?: string }>;
    };
    expect(options.items[0]).toMatchObject({
      id: "copy",
      text: "Copy clean text",
    });
    options.items[0]?.action?.();
    expect(onSelect).toHaveBeenCalledOnce();
    await waitFor(() => expect(popup).toHaveBeenCalledOnce());
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it.each([
    { key: "ContextMenu", shiftKey: false },
    { key: "F10", shiftKey: true },
  ])("uses the opted-in native path for $key", async ({ key, shiftKey }) => {
    const popup = vi.fn().mockResolvedValue(undefined);
    nativeMenuNewMock.mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
      popup,
    });
    const { textarea } = renderTextMenu({ preferCustomTextMenu: true });
    const event = createEvent.keyDown(textarea, { key, shiftKey });

    fireEvent(textarea, event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(popup).toHaveBeenCalledOnce());
  });

  it("opens a keyboard-requested native menu beside its trigger", async () => {
    const popup = vi.fn().mockResolvedValue(undefined);
    nativeMenuNewMock.mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
      popup,
    });
    const { textarea } = renderTextMenu({ preferCustomTextMenu: true });
    vi.spyOn(textarea, "getBoundingClientRect").mockReturnValue({
      bottom: 90,
      height: 30,
      left: 40,
      right: 140,
      top: 60,
      width: 100,
      x: 40,
      y: 60,
      toJSON: () => ({}),
    });

    fireEvent.keyDown(textarea, { key: "F10", shiftKey: true });

    await waitFor(() => expect(popup).toHaveBeenCalledOnce());
    expect(popup.mock.calls[0]?.[0]).toMatchObject({ x: 52, y: 72 });
  });

  it("falls back to the Web menu when the opted-in native menu fails", async () => {
    nativeMenuNewMock.mockRejectedValue(new Error("native menu unavailable"));
    const { onSelect, textarea } = renderTextMenu({
      preferCustomTextMenu: true,
    });

    fireEvent.contextMenu(textarea, { clientX: 18, clientY: 26 });

    const action = await screen.findByRole("menuitem", {
      name: "Copy clean text",
    });
    expect(screen.getByRole("menu", { name: "Text actions" })).toBeVisible();
    fireEvent.click(action);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("falls back to the Web menu when a keyboard native popup fails", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    nativeMenuNewMock.mockResolvedValue({
      close,
      popup: vi.fn().mockRejectedValue(new Error("native popup unavailable")),
    });
    const { textarea } = renderTextMenu({ preferCustomTextMenu: true });

    fireEvent.keyDown(textarea, { key: "ContextMenu" });

    expect(
      await screen.findByRole("menu", { name: "Text actions" }),
    ).toBeVisible();
    expect(close).toHaveBeenCalledOnce();
  });

  it("restores the keyboard trigger before running a Web menu action", async () => {
    isTauriMock.mockReturnValue(false);
    let activeElement: Element | null = null;
    render(
      <ContextMenu
        items={[
          {
            id: "rename",
            label: "Rename",
            onSelect: () => {
              activeElement = document.activeElement;
            },
          },
        ]}
        label="File actions"
      >
        <button type="button">Draft.md</button>
      </ContextMenu>,
    );
    const trigger = screen.getByRole("button", { name: "Draft.md" });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "F10", shiftKey: true });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Rename" }),
    );

    expect(activeElement).toBe(trigger);
    expect(trigger).toHaveFocus();
  });

  it("focuses an all-disabled Web menu and restores its trigger on Escape", async () => {
    isTauriMock.mockReturnValue(false);
    render(
      <ContextMenu
        items={[
          {
            disabled: true,
            id: "rename",
            label: "Rename",
            onSelect: vi.fn(),
          },
        ]}
        label="Unavailable actions"
      >
        <button type="button">Locked.md</button>
      </ContextMenu>,
    );
    const trigger = screen.getByRole("button", { name: "Locked.md" });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "ContextMenu" });
    const menu = await screen.findByRole("menu", {
      name: "Unavailable actions",
    });
    await waitFor(() => expect(menu).toHaveFocus());

    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("menu", { name: "Unavailable actions" })).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
