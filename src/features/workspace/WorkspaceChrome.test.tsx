import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const windowMocks = vi.hoisted(() => ({
  close: vi.fn(),
  getCurrentWindow: vi.fn(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: windowMocks.getCurrentWindow,
}));
import { ActivityRail } from "./ActivityRail";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";

beforeEach(() => {
  document.documentElement.dataset.platform = "macos";
  windowMocks.close.mockReset().mockResolvedValue(undefined);
  windowMocks.minimize.mockReset().mockResolvedValue(undefined);
  windowMocks.toggleMaximize.mockReset().mockResolvedValue(undefined);
  windowMocks.getCurrentWindow.mockReset().mockReturnValue({
    close: windowMocks.close,
    minimize: windowMocks.minimize,
    toggleMaximize: windowMocks.toggleMaximize,
  });
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.platform;
});

describe("workspace chrome", () => {
  it("selects activities and exposes the active item", () => {
    const onSelect = vi.fn();
    render(
      <ActivityRail
        activeId="files"
        items={[
          { id: "files", label: "Files" },
          { id: "search", label: "Search" },
        ]}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole("button", { name: "Files" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onSelect).toHaveBeenCalledWith("search");
  });

  it("renders sidebar, title, and compact document status", () => {
    render(
      <>
        <Sidebar title="Files">Tree</Sidebar>
        <TitleBar dirty subtitle="Notebook" title="start.md" />
        <StatusBar column={5} line={3} wordCount={42} />
      </>,
    );

    expect(screen.getByRole("complementary", { name: "Workspace sidebar" }))
      .toHaveTextContent("Tree");
    expect(screen.getByLabelText("Window title")).toHaveAttribute(
      "data-tauri-drag-region",
    );
    expect(screen.getByLabelText("Document status")).toHaveTextContent(
      "Ln 3, Col 5",
    );
    expect(screen.getByLabelText("Document status")).toHaveTextContent(
      "42 words",
    );
    expect(screen.queryByRole("group", { name: "Window controls" })).toBeNull();
  });

  it("renders working custom window controls only on Windows", () => {
    document.documentElement.dataset.platform = "windows";
    render(<TitleBar title="Viva" />);

    expect(screen.getByRole("group", { name: "Window controls" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Minimize window" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Maximize or restore window" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close window" }));

    expect(windowMocks.minimize).toHaveBeenCalledOnce();
    expect(windowMocks.toggleMaximize).toHaveBeenCalledOnce();
    expect(windowMocks.close).toHaveBeenCalledOnce();
  });
});
