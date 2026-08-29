import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { ContextMenu } from "../../components/ui";
import { useI18n } from "../../i18n";
import { writeClipboardText } from "../../lib/clipboard";
import {
  renderMarkdownDocument,
  type MarkdownImageReference,
  type RenderedMarkdownBlock,
} from "../../lib/markdown";
import {
  resolveLocalImagePath,
  workspaceImageCache,
  type WorkspaceImageCacheLike,
  type WorkspaceImageLease,
} from "../../lib/media";
import { getVivaPlatform } from "../../lib/keyboard";
import {
  EditorPane,
  type EditorPosition,
  type TextSelection,
} from "../editor";
import { replaceLiveMarkdownBlock } from "./liveBlocks";

interface ActiveBlock {
  after: string;
  before: string;
  block: RenderedMarkdownBlock;
  blocks: RenderedMarkdownBlock[];
  draft: string;
  index: number;
  selection: Required<TextSelection>;
}

export interface LiveEditorPaneProps {
  ariaLabel?: string;
  documentId: string;
  format?: "markdown" | "mdx";
  imageCache?: WorkspaceImageCacheLike;
  onChange: (value: string) => void;
  onImageRequest?: (source: string, alt: string) => void;
  onLinkRequest?: (href: string) => void;
  onPositionChange?: (position: EditorPosition) => void;
  value: string;
  workspaceRoot?: string | null;
}

function beginEditing(
  value: string,
  blocks: RenderedMarkdownBlock[],
  block: RenderedMarkdownBlock,
  index: number,
  offset = 0,
): ActiveBlock {
  const caret = Math.max(0, Math.min(block.raw.length, offset));
  return {
    after: value.slice(block.end),
    before: value.slice(0, block.start),
    block,
    blocks,
    draft: block.raw,
    index,
    selection: { direction: "none", end: caret, start: caret },
  };
}

function hiddenInlineDestinationRanges(raw: string): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  for (let index = 0; index < raw.length - 1; index += 1) {
    if (raw[index] === "\\") {
      index += 1;
      continue;
    }
    if (raw[index] !== "]") continue;
    const opening = raw[index + 1];
    if (opening !== "(" && opening !== "[") continue;
    const closing = opening === "(" ? ")" : "]";
    const start = index + 2;
    let depth = 1;
    let angleDestination = false;
    let quotedTitle: '"' | "'" | null = null;
    let cursor = start;
    for (; cursor < raw.length; cursor += 1) {
      if (raw[cursor] === "\\") {
        cursor += 1;
        continue;
      }
      if (opening === "(" && angleDestination) {
        if (raw[cursor] === ">") angleDestination = false;
        continue;
      }
      if (opening === "(" && quotedTitle) {
        if (raw[cursor] === quotedTitle) quotedTitle = null;
        continue;
      }
      const followsWhitespace = cursor > start && /\s/.test(raw[cursor - 1] ?? "");
      if (
        opening === "(" &&
        raw[cursor] === "<" &&
        (cursor === start || followsWhitespace)
      ) {
        angleDestination = true;
        continue;
      }
      if (
        opening === "(" &&
        (raw[cursor] === '"' || raw[cursor] === "'") &&
        followsWhitespace
      ) {
        quotedTitle = raw[cursor] as '"' | "'";
        continue;
      }
      if (opening === "(" && raw[cursor] === opening) depth += 1;
      if (raw[cursor] !== closing) continue;
      depth -= 1;
      if (depth === 0) break;
    }
    ranges.push([start, cursor]);
    index = cursor;
  }
  return ranges;
}

function sourceTextOccurrences(raw: string, text: string): number[] {
  const hidden = hiddenInlineDestinationRanges(raw);
  const occurrences: number[] = [];
  let offset = raw.indexOf(text);
  while (offset >= 0) {
    if (!hidden.some(([start, end]) => offset >= start && offset < end)) {
      occurrences.push(offset);
    }
    offset = raw.indexOf(text, offset + 1);
  }
  return occurrences;
}

function textOccurrenceIndex(
  visibleText: string,
  nodeText: string,
  nodeStart: number,
): number {
  const offsets: number[] = [];
  let offset = visibleText.indexOf(nodeText);
  while (offset >= 0) {
    offsets.push(offset);
    offset = visibleText.indexOf(nodeText, offset + 1);
  }
  if (offsets.length === 0) return 0;
  let nearestIndex = 0;
  for (let index = 1; index < offsets.length; index += 1) {
    if (
      Math.abs((offsets[index] ?? 0) - nodeStart) <
      Math.abs((offsets[nearestIndex] ?? 0) - nodeStart)
    ) {
      nearestIndex = index;
    }
  }
  return nearestIndex;
}

function clickedSourceOffset(
  container: HTMLElement,
  block: RenderedMarkdownBlock,
  event: MouseEvent<HTMLElement>,
): number {
  const ownerDocument = container.ownerDocument as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offset: number; offsetNode: Node } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = ownerDocument.caretPositionFromPoint?.(
    event.clientX,
    event.clientY,
  );
  const fallbackRange = ownerDocument.caretRangeFromPoint?.(
    event.clientX,
    event.clientY,
  );
  const node = position?.offsetNode ?? fallbackRange?.startContainer;
  const nodeOffset = position?.offset ?? fallbackRange?.startOffset ?? 0;
  if (node && container.contains(node)) {
    try {
      const range = ownerDocument.createRange();
      range.selectNodeContents(container);
      range.setEnd(node, nodeOffset);
      const visibleLength = Math.max(1, container.textContent?.length ?? 0);
      const estimatedRawOffset = Math.round(
        (range.toString().length / visibleLength) * block.raw.length,
      );
      const nodeText = node.nodeType === 3 ? node.textContent ?? "" : "";
      if (nodeText) {
        const caretInNode = Math.min(nodeOffset, nodeText.length);
        const candidates = sourceTextOccurrences(block.raw, nodeText);
        if (candidates.length > 0) {
          const nodeStart = range.toString().length - caretInNode;
          const occurrenceIndex = textOccurrenceIndex(
            container.textContent ?? "",
            nodeText,
            nodeStart,
          );
          const candidate = candidates[occurrenceIndex];
          if (candidate !== undefined) return candidate + caretInNode;
          return candidates.reduce((nearest, candidateOffset) =>
            Math.abs(candidateOffset + caretInNode - estimatedRawOffset) <
            Math.abs(nearest + caretInNode - estimatedRawOffset)
              ? candidateOffset
              : nearest,
          ) + caretInNode;
        }
      }
      return estimatedRawOffset;
    } catch {
      // A stale browser caret node should simply place the cursor at block start.
    }
  }
  return 0;
}

export function LiveEditorPane({
  ariaLabel,
  documentId,
  format = "markdown",
  imageCache = workspaceImageCache,
  onChange,
  onImageRequest,
  onLinkRequest,
  onPositionChange,
  value,
  workspaceRoot = null,
}: LiveEditorPaneProps) {
  const { fmt, t } = useI18n();
  const editBlockHint =
    getVivaPlatform() === "macos"
      ? t("Click to edit this block · Command-click links to open")
      : t("Click to edit this block · Ctrl-click links to open");
  const [active, setActive] = useState<ActiveBlock | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLElement>(null);
  const blockRefs = useRef(new Map<number, HTMLDivElement>());
  const restoreFocusIndexRef = useRef<number | null>(null);
  const shouldRenderDocument = active === null;
  const renderedDocument = useMemo(
    () =>
      shouldRenderDocument
        ? renderMarkdownDocument(value, { format })
        : null,
    [format, shouldRenderDocument, value],
  );
  const blocks = active?.blocks ?? renderedDocument?.blocks ?? [];
  const publishEditorPosition = useMemo(
    () => (position: EditorPosition) => {
      const block = activeRef.current?.block;
      if (!block) return;
      onPositionChange?.({
        column: position.column,
        line: block.sourceLine + position.line - 1,
      });
    },
    [onPositionChange],
  );

  useEffect(() => setActive(null), [documentId]);

  useEffect(() => {
    if (!active) return;
    if (`${active.before}${active.draft}${active.after}` !== value) {
      setActive(null);
    }
  }, [active, value]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !active) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.max(38, textarea.scrollHeight)}px`;
  }, [active?.draft]);

  useLayoutEffect(() => {
    if (active !== null) return;
    const restoreIndex = restoreFocusIndexRef.current;
    if (restoreIndex == null) return;
    restoreFocusIndexRef.current = null;
    blockRefs.current.get(restoreIndex)?.focus();
  }, [active, blocks]);

  useEffect(() => {
    const article = documentRef.current;
    if (!article) return;
    const references = new Map(
      blocks
        .flatMap((block) => block.images)
        .map((reference) => [reference.id, reference]),
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
      reference: MarkdownImageReference,
    ): Promise<void> {
      const imageAlt = reference.alt || t("Image");
      if (!workspaceRoot) {
        showPlaceholder(element, fmt("Local image unavailable · %@", imageAlt));
        return;
      }
      const relativePath = resolveLocalImagePath(documentId, reference.source);
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
        if (onImageRequest) {
          element.setAttribute("role", "button");
          element.tabIndex = 0;
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
      reference: MarkdownImageReference;
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
      const byElement = new Map(
        pending.map((item) => [item.element, item.reference]),
      );
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
  }, [blocks, documentId, fmt, imageCache, onImageRequest, workspaceRoot]);

  function activate(
    block: RenderedMarkdownBlock,
    index: number,
    offset = 0,
  ): void {
    if (active?.index === index) return;
    if (!active) {
      setActive(beginEditing(value, blocks, block, index, offset));
      return;
    }
    const delta = active.draft.length - active.block.raw.length;
    const adjustedStart = block.start + (index > active.index ? delta : 0);
    const adjustedEnd = block.end + (index > active.index ? delta : 0);
    const adjusted = {
      ...block,
      end: adjustedEnd,
      raw: value.slice(adjustedStart, adjustedEnd),
      start: adjustedStart,
    };
    const nextBlocks = active.blocks.map((candidate, candidateIndex) =>
      candidateIndex > active.index
        ? {
            ...candidate,
            end: candidate.end + delta,
            start: candidate.start + delta,
          }
        : candidateIndex === active.index
          ? {
              ...candidate,
              end: candidate.end + delta,
              raw: active.draft,
            }
          : candidate,
    );
    setActive(beginEditing(value, nextBlocks, adjusted, index, offset));
  }

  function activateEmpty(): void {
    const block: RenderedMarkdownBlock = {
      end: value.length,
      html: "",
      images: [],
      raw: value,
      sourceLine: 1,
      start: 0,
    };
    setActive(beginEditing(value, [], block, 0));
  }

  function updateDraft(draft: string): void {
    if (!active) return;
    const baseline = `${active.before}${active.block.raw}${active.after}`;
    const nextValue = replaceLiveMarkdownBlock(baseline, active.block, draft);
    const normalizedDraft = nextValue.slice(
      active.before.length,
      nextValue.length - active.after.length,
    );
    setActive((current) =>
      current ? { ...current, draft: normalizedDraft } : current,
    );
    onChange(nextValue);
  }

  function handleRenderedClick(
    event: MouseEvent<HTMLDivElement>,
    block: RenderedMarkdownBlock,
    index: number,
  ): void {
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
    if (anchor && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onLinkRequest?.(anchor.getAttribute("href") ?? "");
      return;
    }
    event.preventDefault();
    activate(block, index, clickedSourceOffset(event.currentTarget, block, event));
  }

  function handleBlockKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    block: RenderedMarkdownBlock,
    index: number,
  ): void {
    if (event.key !== "Enter" && event.key !== " ") return;
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
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    activate(block, index);
  }

  function closeActiveBlock(): void {
    setActive(null);
  }

  return (
    <section
      aria-label={ariaLabel ?? t("Live Markdown editor")}
      className="live-editor-pane"
    >
      <div
        className="live-editor-pane__scroller viva-scroll-region"
        ref={scrollerRef}
      >
        {renderedDocument?.safeMdx ? (
          <div className="live-editor-pane__notice" role="status">
            {t(
              "Safe MDX preview · imports, exports, JSX, and expressions are shown as text and never run.",
            )}
          </div>
        ) : null}
        <article className="live-editor-pane__document" ref={documentRef}>
          {blocks.length ? (
            blocks.map((block, index) =>
              active?.index === index ? (
                <div
                  className="live-editor-pane__active"
                  key={`${block.start}:${index}`}
                  onKeyDownCapture={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      restoreFocusIndexRef.current = index;
                      textareaRef.current?.blur();
                    }
                  }}
                >
                  <span className="live-editor-pane__mode">{t("Markdown")}</span>
                  <EditorPane
                    ariaLabel={fmt("Editing block from line %d", block.sourceLine)}
                    autoFocus
                    className="live-editor-pane__source"
                    onBlur={closeActiveBlock}
                    onChange={updateDraft}
                    onPositionChange={publishEditorPosition}
                    onSelectionChange={(selection) =>
                      setActive((current) =>
                        current ? { ...current, selection } : current,
                      )
                    }
                    ref={textareaRef}
                    selection={active.selection}
                    showPosition={false}
                    value={active.draft}
                  />
                </div>
              ) : (
                <ContextMenu
                  items={[
                    {
                      id: "edit-block",
                      label: t("Edit block"),
                      onSelect: () => activate(block, index),
                    },
                    {
                      id: "copy-markdown",
                      label: t("Copy Markdown"),
                      onSelect: () => void writeClipboardText(block.raw),
                    },
                  ]}
                  key={`${block.start}:${index}`}
                  label={t("Live block menu")}
                >
                  <div
                    aria-label={editBlockHint}
                    className={`live-editor-pane__block markdown-body${block.html ? "" : " is-source-only"}`}
                    dangerouslySetInnerHTML={{
                      __html:
                        block.html ||
                        `<pre>${block.raw
                          .replaceAll("&", "&amp;")
                          .replaceAll("<", "&lt;")
                          .replaceAll(">", "&gt;")}</pre>`,
                    }}
                    onClick={(event) => handleRenderedClick(event, block, index)}
                    onKeyDown={(event) => handleBlockKeyDown(event, block, index)}
                    ref={(element) => {
                      if (element) blockRefs.current.set(index, element);
                      else blockRefs.current.delete(index);
                    }}
                    role="group"
                    tabIndex={0}
                    title={editBlockHint}
                  />
                </ContextMenu>
              ),
            )
          ) : (
            <button
              className="live-editor-pane__empty"
              onClick={activateEmpty}
              type="button"
            >
              {t("Start writing…")}
            </button>
          )}
        </article>
      </div>
    </section>
  );
}
