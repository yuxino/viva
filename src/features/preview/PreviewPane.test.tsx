import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceImageCacheLike } from "../../lib/media";
import { PreviewPane } from "./PreviewPane";

function installIntersectionObserver() {
  let callback: IntersectionObserverCallback | null = null;
  let observer: TestIntersectionObserver | null = null;
  const observed = new Set<Element>();

  class TestIntersectionObserver {
    constructor(nextCallback: IntersectionObserverCallback) {
      callback = nextCallback;
      observer = this;
    }

    disconnect() {
      observed.clear();
    }

    observe(target: Element) {
      observed.add(target);
    }

    takeRecords() {
      return [];
    }

    unobserve(target: Element) {
      observed.delete(target);
    }
  }

  vi.stubGlobal(
    "IntersectionObserver",
    TestIntersectionObserver as unknown as typeof IntersectionObserver,
  );

  return {
    enter(target: Element) {
      if (!callback || !observer || !observed.has(target)) {
        throw new Error("Expected the image placeholder to be observed.");
      }
      callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      );
    },
  };
}

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
    const intersections = installIntersectionObserver();
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
    const { rerender, unmount } = render(
      <PreviewPane
        documentPath="notes/day.md"
        imageCache={cache}
        imageCacheRevision={0}
        onImageRequest={onImageRequest}
        source="![Cover](../art/cover%20one.png)"
        workspaceRoot="/workspace"
      />,
    );

    try {
      const placeholder = screen.getByRole("img", {
        name: "Loading image · Cover",
      });
      expect(cache.acquire).not.toHaveBeenCalled();
      intersections.enter(placeholder);

      const image = await screen.findByRole("img", { name: "Cover" });
      expect(image).toHaveAttribute("src", "blob:viva-cover");
      expect(image).not.toHaveAttribute("loading");
      expect(cache.acquire).toHaveBeenCalledWith(
        "/workspace",
        "art/cover one.png",
      );
      fireEvent.click(image);
      expect(onImageRequest).toHaveBeenCalledWith(
        "../art/cover%20one.png",
        "Cover",
      );

      rerender(
        <PreviewPane
          documentPath="notes/day.md"
          imageCache={cache}
          imageCacheRevision={0}
          onImageRequest={onImageRequest}
          source="![Cover](../art/cover%20one.png)"
          workspaceRoot="/workspace"
        />,
      );
      expect(document.querySelector("img.markdown-local-image")).toHaveAttribute(
        "src",
        "blob:viva-cover",
      );
      expect(cache.acquire).toHaveBeenCalledTimes(1);

      rerender(
        <PreviewPane
          documentPath="notes/day.md"
          imageCache={cache}
          imageCacheRevision={1}
          onImageRequest={onImageRequest}
          source="![Cover](../art/cover%20one.png)"
          workspaceRoot="/workspace"
        />,
      );
      intersections.enter(
        screen.getByRole("img", { name: "Loading image · Cover" }),
      );
      await waitFor(() => expect(cache.acquire).toHaveBeenCalledTimes(2));

      unmount();
      expect(release).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("pairs a metadata-free placeholder with its trusted image reference", async () => {
    const intersections = installIntersectionObserver();
    const cache: WorkspaceImageCacheLike = {
      acquire: vi.fn().mockResolvedValue({
        height: 360,
        mediaType: "image/webp",
        relativePath: "assets/viva-round.webp",
        release: vi.fn(),
        sizeBytes: 20_386,
        url: "blob:viva-round",
        width: 360,
      }),
    };

    render(
      <PreviewPane
        documentPath="source.md"
        imageCache={cache}
        rendered={{
          html: [
            '<span class="markdown-image-placeholder"',
            ' role="img" aria-label="Viva round character">',
            '<span class="markdown-image-placeholder__label">Viva round character</span>',
            "</span>",
          ].join(""),
          images: [
            {
              alt: "Viva round character",
              id: "viva-image-1",
              remote: false,
              source: "assets/viva-round.webp",
              title: undefined,
            },
          ],
          outline: [],
        }}
        source="![Viva round character](assets/viva-round.webp)"
        workspaceRoot="/workspace"
      />,
    );

    try {
      const placeholder = screen.getByRole("img", {
        name: "Loading image · Viva round character",
      });
      expect(placeholder).not.toHaveAttribute("data-viva-image");
      expect(placeholder).not.toHaveAttribute("data-image-src");
      expect(placeholder).not.toHaveAttribute("data-image-alt");
      intersections.enter(placeholder);

      await waitFor(() =>
        expect(document.querySelector("img.markdown-local-image")).toHaveAttribute(
          "src",
          "blob:viva-round",
        ),
      );
      expect(cache.acquire).toHaveBeenCalledWith(
        "/workspace",
        "assets/viva-round.webp",
      );
    } finally {
      vi.unstubAllGlobals();
    }
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
