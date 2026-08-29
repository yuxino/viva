import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import { useI18n } from "../../i18n";
import {
  renderMarkdown,
  type RenderedMarkdown,
} from "../../lib/markdown";
import {
  resolveLocalImagePath,
  workspaceImageCache,
  type WorkspaceImageCacheLike,
  type WorkspaceImageLease,
} from "../../lib/media";

export interface PreviewPaneProps {
  source: string;
  revealSourceLine?: number | null;
  onSourceLineChange?: (sourceLine: number) => void;
  onSourceLineSelect?: (sourceLine: number) => void;
  onLinkRequest?: (href: string) => void;
  onImageRequest?: (source: string, alt: string) => void;
  workspaceRoot?: string | null;
  documentPath?: string | null;
  imageCache?: WorkspaceImageCacheLike;
  format?: "markdown" | "mdx";
  ariaLabel?: string;
  className?: string;
  emptyState?: ReactNode;
  rendered?: RenderedMarkdown;
  truncated?: boolean;
}

interface SourceMappedElement {
  element: HTMLElement;
  sourceLine: number;
}

function joinClassNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function sourceMappedElements(container: HTMLElement): SourceMappedElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-source-line]"),
  ).flatMap((element) => {
    const sourceLine = Number(element.dataset.sourceLine);
    return Number.isFinite(sourceLine) && sourceLine > 0
      ? [{ element, sourceLine }]
      : [];
  });
}

function closestSourceElement(
  elements: readonly SourceMappedElement[],
  sourceLine: number,
): SourceMappedElement | null {
  let closest: SourceMappedElement | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of elements) {
    const nextDistance = Math.abs(candidate.sourceLine - sourceLine);
    if (nextDistance < distance) {
      closest = candidate;
      distance = nextDistance;
    }
  }
  return closest;
}

export function PreviewPane({
  source,
  revealSourceLine = null,
  onSourceLineChange,
  onSourceLineSelect,
  onLinkRequest,
  onImageRequest,
  workspaceRoot = null,
  documentPath = null,
  imageCache = workspaceImageCache,
  format = "markdown",
  ariaLabel,
  className,
  emptyState,
  rendered: providedRendered,
  truncated = false,
}: PreviewPaneProps) {
  const { fmt, t } = useI18n();
  const rendered = useMemo(
    () => providedRendered ?? renderMarkdown(source, { format }),
    [format, providedRendered, source],
  );
  const scrollerRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const suppressScrollRef = useRef(false);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;

    const references = new Map(
      (rendered.images ?? []).map((reference) => [reference.id, reference]),
    );
    const leases = new Set<WorkspaceImageLease>();
    let disposed = false;

    function showPlaceholder(element: HTMLElement, label: string): void {
      element.classList.remove("is-loading", "is-loaded");
      element.classList.add("is-unavailable");
      element.removeAttribute("tabindex");
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", label);
      const copy = document.createElement("span");
      copy.className = "markdown-image-placeholder__label";
      copy.textContent = label;
      element.replaceChildren(copy);
    }

    function showLoadingPlaceholder(element: HTMLElement, label: string): void {
      element.classList.remove("is-unavailable", "is-loaded");
      element.classList.add("is-loading");
      element.removeAttribute("tabindex");
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", label);
      const copy = document.createElement("span");
      copy.className = "markdown-image-placeholder__label";
      copy.textContent = label;
      element.replaceChildren(copy);
    }

    async function loadImage(
      element: HTMLElement,
      reference: NonNullable<RenderedMarkdown["images"]>[number],
    ): Promise<void> {
      const imageAlt = reference.alt || t("Image");
      if (!workspaceRoot || !documentPath) {
        showPlaceholder(element, fmt("Local image unavailable · %@", imageAlt));
        return;
      }
      const relativePath = resolveLocalImagePath(documentPath, reference.source);
      if (!relativePath) {
        showPlaceholder(element, fmt("Image unavailable · %@", imageAlt));
        return;
      }

      element.classList.add("is-loading");
      try {
        const lease = await imageCache.acquire(workspaceRoot, relativePath);
        if (disposed || !element.isConnected) {
          lease.release();
          return;
        }
        leases.add(lease);
        const image = document.createElement("img");
        image.alt = imageAlt;
        image.className = "markdown-local-image";
        image.decoding = "async";
        image.draggable = false;
        image.loading = "lazy";
        if (reference.title) image.title = reference.title;
        image.addEventListener(
          "error",
          () => {
            leases.delete(lease);
            lease.release();
            showPlaceholder(
              element,
              fmt("Image could not be decoded · %@", imageAlt),
            );
          },
          { once: true },
        );
        image.src = lease.url;
        element.classList.remove("is-loading", "is-unavailable");
        element.classList.add("is-loaded");
        element.dataset.imagePath = relativePath;
        element.setAttribute(
          "aria-label",
          onImageRequest
            ? fmt("Open full-size image · %@", imageAlt)
            : imageAlt,
        );
        element.setAttribute("role", onImageRequest ? "button" : "img");
        if (onImageRequest) {
          element.tabIndex = 0;
        } else {
          element.removeAttribute("tabindex");
        }
        element.replaceChildren(image);
      } catch {
        if (!disposed) {
          showPlaceholder(
            element,
            fmt("Image could not be loaded · %@", imageAlt),
          );
        }
      }
    }

    const pending: Array<{
      element: HTMLElement;
      reference: NonNullable<RenderedMarkdown["images"]>[number];
    }> = [];
    for (const element of article.querySelectorAll<HTMLElement>("[data-viva-image]")) {
      const reference = references.get(element.dataset.vivaImage ?? "");
      if (!reference) continue;
      const imageAlt = reference.alt || t("Image");
      if (reference.remote) {
        showPlaceholder(element, fmt("Remote image blocked · %@", imageAlt));
      } else {
        showLoadingPlaceholder(element, fmt("Loading image · %@", imageAlt));
        pending.push({ element, reference });
      }
    }

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "function") {
      const byElement = new Map(pending.map((item) => [item.element, item.reference]));
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const element = entry.target as HTMLElement;
            const reference = byElement.get(element);
            if (!reference) continue;
            observer?.unobserve(element);
            byElement.delete(element);
            void loadImage(element, reference);
          }
        },
        { root: scrollerRef.current, rootMargin: "640px 0px" },
      );
      for (const { element } of pending) observer.observe(element);
    } else {
      for (const { element, reference } of pending) {
        void loadImage(element, reference);
      }
    }

    return () => {
      disposed = true;
      observer?.disconnect();
      for (const lease of leases) lease.release();
      leases.clear();
    };
  }, [
    documentPath,
    fmt,
    imageCache,
    onImageRequest,
    rendered.html,
    rendered.images,
    workspaceRoot,
  ]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const article = articleRef.current;
    if (!scroller || !article || revealSourceLine == null) return;
    const target = closestSourceElement(
      sourceMappedElements(article),
      revealSourceLine,
    );
    if (!target) return;
    const nextTop = target.element.offsetTop;
    if (Math.abs(scroller.scrollTop - nextTop) < 1) return;
    suppressScrollRef.current = true;
    scroller.scrollTop = nextTop;
    queueMicrotask(() => {
      suppressScrollRef.current = false;
    });
  }, [rendered.html, revealSourceLine]);

  function handleClick(event: MouseEvent<HTMLDivElement>): void {
    const target = event.target instanceof Element ? event.target : null;
    const image = target?.closest<HTMLElement>("[data-viva-image].is-loaded");
    if (image && onImageRequest) {
      event.preventDefault();
      onImageRequest(
        image.dataset.imageSrc ?? "",
        image.dataset.imageAlt || t("Image"),
      );
      return;
    }
    const anchor = target?.closest<HTMLAnchorElement>("a[href]");
    if (anchor) {
      event.preventDefault();
      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        let id: string;
        try {
          id = decodeURIComponent(href.slice(1));
        } catch {
          return;
        }
        const heading = Array.from(
          articleRef.current?.querySelectorAll<HTMLElement>("[id]") ?? [],
        ).find((element) => element.id === id);
        if (heading && scrollerRef.current) {
          scrollerRef.current.scrollTop = heading.offsetTop;
        }
      }
      onLinkRequest?.(href);
      return;
    }

    const sourceBlock = target?.closest<HTMLElement>("[data-source-line]");
    const sourceLine = Number(sourceBlock?.dataset.sourceLine);
    if (Number.isFinite(sourceLine) && sourceLine > 0) {
      onSourceLineSelect?.(sourceLine);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target instanceof Element ? event.target : null;
    const image = target?.closest<HTMLElement>("[data-viva-image].is-loaded");
    if (!image || !onImageRequest) return;
    event.preventDefault();
    onImageRequest(
      image.dataset.imageSrc ?? "",
      image.dataset.imageAlt || t("Image"),
    );
  }

  function handleScroll(event: UIEvent<HTMLDivElement>): void {
    if (suppressScrollRef.current) return;
    const article = articleRef.current;
    if (!article) return;
    const scrollerRect = event.currentTarget.getBoundingClientRect();
    const threshold = scrollerRect.top + 12;
    const elements = sourceMappedElements(article);
    const current =
      [...elements]
        .reverse()
        .find(({ element }) => element.getBoundingClientRect().top <= threshold) ??
      elements[0];
    if (current) onSourceLineChange?.(current.sourceLine);
  }

  return (
    <section
      aria-label={ariaLabel ?? t("Markdown preview")}
      className={joinClassNames("preview-pane", className)}
    >
      <div
        className="preview-pane__scroller viva-scroll-region"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
        ref={scrollerRef}
      >
        {rendered.safeMdx ? (
          <div className="preview-pane__mdx-notice" role="status">
            {t(
              "Safe MDX preview · imports, exports, JSX, and expressions are shown as text and never run.",
            )}
          </div>
        ) : null}
        {truncated ? (
          <div className="preview-pane__limit" role="status">
            {t(
              "Live preview is limited for this large document. The complete file remains available in Source view.",
            )}
          </div>
        ) : null}
        {source.trim() ? (
          <article
            className="preview-pane__document markdown-body"
            dangerouslySetInnerHTML={{ __html: rendered.html }}
            ref={articleRef}
          />
        ) : (
          <div className="preview-pane__empty" role="status">
            {emptyState ?? t("Nothing to preview")}
          </div>
        )}
      </div>
    </section>
  );
}
