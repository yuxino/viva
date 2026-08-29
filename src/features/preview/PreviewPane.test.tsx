import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceImageCacheLike } from "../../lib/media";
import { PreviewPane } from "./PreviewPane";

describe("PreviewPane", () => {
  it("renders sanitized Markdown and delegates links without navigating", () => {
    const onLinkRequest = vi.fn();
    const onSourceLineSelect = vi.fn();
    render(
      <PreviewPane
        onLinkRequest={onLinkRequest}
        onSourceLineSelect={onSourceLineSelect}
        source={
          '# Hello\n\n[Open](https://example.com)\n\n<script>alert("no")</script>'
        }
      />,
    );

    expect(document.querySelector("script")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Open" }));
    expect(onLinkRequest).toHaveBeenCalledWith("https://example.com");

    fireEvent.click(screen.getByRole("heading", { name: "Hello" }));
    expect(onSourceLineSelect).toHaveBeenCalledWith(1);
  });

  it("offers selection and Markdown copy actions on right click", () => {
    render(<PreviewPane source="# Preview" />);

    fireEvent.contextMenu(screen.getByRole("heading", { name: "Preview" }));
    expect(screen.getByRole("menu", { name: "Preview menu" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Copy" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Copy Markdown" })).toBeVisible();
  });

  it("labels a bounded live preview without hiding the editor source", () => {
    render(
      <PreviewPane
        rendered={{ html: "<p>Bounded preview</p>", outline: [] }}
        source="Bounded preview"
        truncated
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Live preview is limited for this large document",
    );
    expect(screen.getByText("Bounded preview")).toBeVisible();
  });

  it("loads only workspace-relative images and delegates full-size viewing", async () => {
    const release = vi.fn();
    const cache: WorkspaceImageCacheLike = {
      acquire: vi.fn().mockResolvedValue({
        height: 360,
        mediaType: "image/png",
        relativePath: "art/cover one.png",
        release,
        sizeBytes: 3,
        url: "blob:viva-cover",
        width: 640,
      }),
    };
    const onImageRequest = vi.fn();
    const { unmount } = render(
      <PreviewPane
        documentPath="notes/day.md"
        imageCache={cache}
        onImageRequest={onImageRequest}
        source="![Cover](../art/cover%20one.png)"
        workspaceRoot="/workspace"
      />,
    );

    const image = await screen.findByRole("img", { name: "Cover" });
    expect(image).toHaveAttribute("src", "blob:viva-cover");
    expect(cache.acquire).toHaveBeenCalledWith("/workspace", "art/cover one.png");
    fireEvent.click(image);
    expect(onImageRequest).toHaveBeenCalledWith(
      "../art/cover%20one.png",
      "Cover",
    );

    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("never asks the media bridge to load a remote image", async () => {
    const cache: WorkspaceImageCacheLike = { acquire: vi.fn() };
    const onImageRequest = vi.fn();
    render(
      <PreviewPane
        documentPath="notes/day.md"
        imageCache={cache}
        onImageRequest={onImageRequest}
        source="![Tracker](https://example.com/pixel.png)"
        workspaceRoot="/workspace"
      />,
    );

    const placeholder = screen.getByRole("img", {
      name: "Remote image blocked · Tracker",
    });
    expect(placeholder).toBeVisible();
    expect(placeholder.querySelector("img")).toBeNull();
    fireEvent.click(placeholder);
    expect(onImageRequest).not.toHaveBeenCalled();
    await waitFor(() => expect(cache.acquire).not.toHaveBeenCalled());
  });

  it("labels MDX as static and leaves executable constructs inert", () => {
    render(
      <PreviewPane
        format="mdx"
        source={'import Widget from "./Widget"\n\n<Widget>{run()}</Widget>\n\n**Prose**'}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "imports, exports, JSX, and expressions",
    );
    expect(screen.getByText("Prose")).toBeVisible();
    expect(document.querySelector("Widget")).not.toBeInTheDocument();
  });
});
