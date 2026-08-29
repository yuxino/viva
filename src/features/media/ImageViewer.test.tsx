import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceImageCacheLike } from "../../lib/media";
import { constrainImagePan } from "./imagePan";
import { ImageViewer } from "./ImageViewer";

const source = {
  alt: "Quiet room",
  relativePath: "art/quiet-room.png",
  workspaceRoot: "/workspace",
};

describe("ImageViewer", () => {
  it("keeps a zoomed image inside the visible stage", () => {
    expect(
      constrainImagePan(
        { x: 2_000, y: -2_000 },
        2,
        { height: 600, width: 800 },
        { height: 500, width: 1_000 },
      ),
    ).toEqual({ x: 600, y: -200 });

    expect(
      constrainImagePan(
        { x: 240, y: -120 },
        1.25,
        { height: 800, width: 1_200 },
        { height: 480, width: 720 },
      ),
    ).toEqual({ x: 0, y: 0 });

    expect(
      constrainImagePan(
        { x: 80, y: 40 },
        1,
        { height: 600, width: 800 },
        { height: 500, width: 1_000 },
      ),
    ).toEqual({ x: 0, y: 0 });
  });

  it("loads one scoped image, zooms, closes, and releases its lease", async () => {
    const release = vi.fn();
    const cache: WorkspaceImageCacheLike = {
      acquire: vi.fn().mockResolvedValue({
        height: 720,
        mediaType: "image/png",
        relativePath: source.relativePath,
        release,
        sizeBytes: 2048,
        url: "blob:quiet-room",
        width: 1280,
      }),
    };
    const onClose = vi.fn();
    const { rerender } = render(
      <ImageViewer cache={cache} onClose={onClose} source={source} />,
    );

    expect(await screen.findByRole("img", { name: "Quiet room" })).toHaveAttribute(
      "src",
      "blob:quiet-room",
    );
    expect(screen.getByText("1280 × 720 · 2 KiB")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("125%");
    expect(
      screen.getByRole("img", { name: "Quiet room" }).getAttribute("style"),
    ).toContain("scale(1.25)");
    fireEvent.click(screen.getByRole("button", { name: "Close image viewer" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<ImageViewer cache={cache} onClose={onClose} source={null} />);
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });

  it("shows a contained error when native image loading fails", async () => {
    const cache: WorkspaceImageCacheLike = {
      acquire: vi.fn().mockRejectedValue(new Error("bad image")),
    };
    render(<ImageViewer cache={cache} onClose={vi.fn()} source={source} />);

    expect(await screen.findByText("This image could not be displayed.")).toHaveTextContent(
      "This image could not be displayed.",
    );
  });

  it("closes when the visible stage background is clicked", () => {
    const onClose = vi.fn();
    const cache: WorkspaceImageCacheLike = {
      acquire: vi.fn(() => new Promise<never>(() => undefined)),
    };
    const { container } = render(
      <ImageViewer cache={cache} onClose={onClose} source={source} />,
    );

    const stage = container.querySelector(".image-viewer__stage");
    expect(stage).not.toBeNull();
    fireEvent.mouseDown(stage!);

    expect(onClose).toHaveBeenCalledOnce();
  });
});
