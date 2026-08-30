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
  type RenderedMarkdownBlock,
} from "../../lib/markdown";
import {
  resolveLocalImagePath,
  workspaceImageCache,
  type RenderedWorkspaceImageReference,
  type WorkspaceImageCacheLike,
  type WorkspaceImageLease,
} from "../../lib/media";
import { getVivaPlatform, isImeKeyEvent } from "../../lib/keyboard";
import {
  EditorPane,
  normalizeSelection,
  type EditorPosition,
  type TextSelection,
} from "../editor";
import { replaceLiveMarkdownBlock } from "./liveBlocks";

interface ActiveBlock {
  after: string;
  before: string;
  block: RenderedMarkdownBlock;
  blocks: RenderedMarkdownBlock[];
  documentId: string;
  draft: string;
  focusEditor: boolean;
  index: number;
  revealRequestId: number | null;
  selection: Required<TextSelection>;
}

const EMPTY_RENDERED_MARKUP = { __html: "" } as const;

export interface LiveEditorPaneProps {
  ariaLabel?: string;
  documentId: string;
  format?: "markdown" | "mdx";
  imageCache?: WorkspaceImageCacheLike;
  imageCacheRevision?: number;
  onChange: (value: string) => void;
  onImageRequest?: (source: string, alt: string) => void;
  onLinkRequest?: (href: string) => void;
  onPasteImage?: (
    file: File,
    selection: Required<TextSelection>,
  ) => void;
  onPositionChange?: (position: EditorPosition) => void;
  onSelectionChange?: (selection: Required<TextSelection>) => void;
  revealSelection?: TextSelection | null;
  revealSelectionRequestId?: number;
  value: string;
  workspaceRoot?: string | null;
}

function beginEditing(
  documentId: string,
  value: string,
  blocks: RenderedMarkdownBlock[],
  block: RenderedMarkdownBlock,
  index: number,
  selection: TextSelection | number = 0,
  options: { focusEditor?: boolean; revealRequestId?: number | null } = {},
): ActiveBlock {
  const normalizedSelection = normalizeSelection(
    block.raw,
    typeof selection === "number"
      ? { end: selection, start: selection }
      : selection,
  );
  return {
    after: value.slice(block.end),
    before: value.slice(0, block.start),
    block,
    blocks,
    documentId,
    draft: block.raw,
    focusEditor: options.focusEditor ?? true,
    index,
    revealRequestId: options.revealRequestId ?? null,
    selection: normalizedSelection,
  };
}

function blocksWithActiveDraft(active: ActiveBlock): RenderedMarkdownBlock[] {
  const delta = active.draft.length - active.block.raw.length;
  return active.blocks.map((candidate, candidateIndex) =>
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
  imageCacheRevision = 0,
  onChange,
  onImageRequest,
  onLinkRequest,
  onPasteImage,
  onPositionChange,
  onSelectionChange,
  revealSelection = null,
  revealSelectionRequestId = 0,
  value,
  workspaceRoot = null,
}: LiveEditorPaneProps) {
  const { fmt, t } = useI18n();
  const editBlockHint =
    getVivaPlatform() === "macos"
      ? t("Click to edit this block · Command-click links to open")
      : t("Click to edit this block · Ctrl-click links to open");
  const [active, setActive] = useState<ActiveBlock | null>(null);
  const [focusedBlockIndex, setFocusedBlockIndex] = useState(0);
  const currentActive = active?.documentId === documentId ? active : null;
  const activeRef = useRef(currentActive);
  activeRef.current = currentActive;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLElement>(null);
  const imageReferencesRef = useRef(
    new WeakMap<HTMLElement, RenderedWorkspaceImageReference>(),
  );
  const blockRefs = useRef(new Map<number, HTMLDivElement>());
  const restoreFocusIndexRef = useRef<number | null>(null);
  const pendingRevealScrollRef = useRef(false);
  const shouldRenderDocument = currentActive === null;
  const renderedDocument = useMemo(
    () =>
      shouldRenderDocument
        ? renderMarkdownDocument(value, { format })
        : null,
    [format, shouldRenderDocument, value],
  );
  const blocks = currentActive?.blocks ?? renderedDocument?.blocks ?? [];
  const renderedBlockMarkup = useMemo(
    () =>
      blocks.map((block) => ({
        __html:
          block.html ||
          `<pre>${block.raw
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")}</pre>`,
      })),
    [blocks],
  );
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

  useEffect(() => {
    setActive((current) =>
      current?.documentId === documentId ? current : null,
    );
    setFocusedBlockIndex(0);
  }, [documentId]);

  useEffect(() => {
    setActive((current) => {
      if (current?.documentId !== documentId) return current;
      return `${current.before}${current.draft}${current.after}` === value
        ? current
        : null;
    });
  }, [documentId, value]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !currentActive) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.max(38, textarea.scrollHeight)}px`;
  }, [currentActive?.draft]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !currentActive || currentActive.revealRequestId === null) {
      return;
    }
    textarea.setSelectionRange(
      currentActive.selection.start,
      currentActive.selection.end,
      currentActive.selection.direction,
    );
  }, [
    currentActive?.documentId,
    currentActive?.index,
    currentActive?.revealRequestId,
  ]);

  useLayoutEffect(() => {
    if (currentActive !== null) return;
    const restoreIndex = restoreFocusIndexRef.current;
    if (restoreIndex == null) return;
    restoreFocusIndexRef.current = null;
    setFocusedBlockIndex(restoreIndex);
    blockRefs.current.get(restoreIndex)?.focus();
  }, [blocks, currentActive]);

  useEffect(() => {
    if (blocks.length === 0) {
      setFocusedBlockIndex(0);
      return;
    }
    setFocusedBlockIndex((current) =>
      Math.min(Math.max(0, current), blocks.length - 1),
    );
  }, [blocks.length]);

  useLayoutEffect(() => {
    if (!revealSelection) return;
    const start = Math.min(revealSelection.start, revealSelection.end);
    const end = Math.max(revealSelection.start, revealSelection.end);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end > value.length
    ) {
      return;
    }

    const activeValueMatches =
      currentActive !== null &&
      `${currentActive.before}${currentActive.draft}${currentActive.after}` ===
        value;
    const effectiveBlocks = activeValueMatches
      ? blocksWithActiveDraft(currentActive)
      : renderMarkdownDocument(value, { format }).blocks;
    const index = effectiveBlocks.findIndex(
      (block) =>
        start >= block.start &&
        end <= block.end &&
        (start < block.end || block.start === block.end),
    );
    const block = effectiveBlocks[index];
    if (!block) return;

    pendingRevealScrollRef.current = true;
    setActive(
      beginEditing(
        documentId,
        value,
        effectiveBlocks,
        block,
        index,
        {
          direction: revealSelection.direction,
          end: end - block.start,
          start: start - block.start,
        },
        { focusEditor: false, revealRequestId: revealSelectionRequestId },
      ),
    );
  }, [
    documentId,
    format,
    revealSelection?.direction,
    revealSelection?.end,
    revealSelection?.start,
    revealSelectionRequestId,
  ]);

  useLayoutEffect(() => {
    if (!pendingRevealScrollRef.current || !currentActive) return;
    pendingRevealScrollRef.current = false;
    textareaRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [
    currentActive?.documentId,
    currentActive?.index,
    currentActive?.selection.end,
    currentActive?.selection.start,
  ]);

  useEffect(() => {
    const article = documentRef.current;
    if (!article) return;
    const leases = new Set<WorkspaceImageLease>();
    const imageReferences = new WeakMap<
      HTMLElement,
      RenderedWorkspaceImageReference
    >();
    imageReferencesRef.current = imageReferences;
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
      reference: RenderedWorkspaceImageReference,
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
      reference: RenderedWorkspaceImageReference;
    }> = [];
    const references = blocks.flatMap((block, index) =>
      currentActive?.index === index ? [] : block.images,
    );
    const elements = article.querySelectorAll<HTMLElement>(
      ".markdown-image-placeholder",
    );
    for (const [index, element] of Array.from(elements).entries()) {
      const reference = references[index];
      if (!reference) continue;
      imageReferences.set(element, reference);
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
      if (imageReferencesRef.current === imageReferences) {
        imageReferencesRef.current = new WeakMap();
      }
    };
  }, [
    blocks,
    currentActive?.index,
    documentId,
    fmt,
    imageCache,
    imageCacheRevision,
    onImageRequest,
    workspaceRoot,
  ]);

  function activate(
    block: RenderedMarkdownBlock,
    index: number,
    selection: TextSelection | number = 0,
  ): void {
    setFocusedBlockIndex(index);
    if (currentActive?.index === index) {
      const nextSelection = normalizeSelection(
        currentActive.draft,
        typeof selection === "number"
          ? { end: selection, start: selection }
          : selection,
      );
      if (
        nextSelection.start === currentActive.selection.start &&
        nextSelection.end === currentActive.selection.end &&
        nextSelection.direction === currentActive.selection.direction
      ) {
        return;
      }
      setActive((current) =>
        current?.documentId === documentId && current.index === index
          ? { ...current, selection: nextSelection }
          : current,
      );
      return;
    }
    if (!currentActive) {
      setActive(
        beginEditing(documentId, value, blocks, block, index, selection),
      );
      return;
    }

    const nextBlocks = blocksWithActiveDraft(currentActive);
    const adjusted = nextBlocks[index];
    if (!adjusted) return;
    setActive(
      beginEditing(
        documentId,
        value,
        nextBlocks,
        adjusted,
        index,
        selection,
      ),
    );
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
    setActive(beginEditing(documentId, value, [], block, 0));
  }

  function updateDraft(draft: string): void {
    if (!currentActive) return;
    const baseline = `${currentActive.before}${currentActive.block.raw}${currentActive.after}`;
    const nextValue = replaceLiveMarkdownBlock(
      baseline,
      currentActive.block,
      draft,
    );
    const normalizedDraft = nextValue.slice(
      currentActive.before.length,
      nextValue.length - currentActive.after.length,
    );
    setActive((current) =>
      current?.documentId === documentId
        ? { ...current, draft: normalizedDraft }
        : current,
    );
    onChange(nextValue);
  }

  function handleRenderedClick(
    event: MouseEvent<HTMLDivElement>,
    block: RenderedMarkdownBlock,
    index: number,
  ): void {
    const target = event.target instanceof Element ? event.target : null;
    const image = target?.closest<HTMLElement>(
      ".markdown-image-placeholder.is-loaded",
    );
    if (image && onImageRequest) {
      const reference = imageReferencesRef.current.get(image);
      if (!reference) return;
      event.preventDefault();
      onImageRequest(reference.source, reference.alt || t("Image"));
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
    const target = event.target instanceof Element ? event.target : null;
    if (event.target === event.currentTarget) {
      const destination =
        event.key === "ArrowDown"
          ? Math.min(index + 1, blocks.length - 1)
          : event.key === "ArrowUp"
            ? Math.max(index - 1, 0)
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? blocks.length - 1
                : null;
      if (destination !== null) {
        event.preventDefault();
        setFocusedBlockIndex(destination);
        const element = blockRefs.current.get(destination);
        element?.focus();
        element?.scrollIntoView?.({ block: "nearest" });
        return;
      }
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const image = target?.closest<HTMLElement>(
      ".markdown-image-placeholder.is-loaded",
    );
    if (image && onImageRequest) {
      const reference = imageReferencesRef.current.get(image);
      if (!reference) return;
      event.preventDefault();
      onImageRequest(reference.source, reference.alt || t("Image"));
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
              currentActive?.index === index ? (
                <div
                  className="live-editor-pane__active"
                  key={`${block.start}:${index}`}
                  onKeyDownCapture={(event) => {
                    if (
                      event.key === "Escape" &&
                      !isImeKeyEvent(event.nativeEvent)
                    ) {
                      event.preventDefault();
                      restoreFocusIndexRef.current = index;
                      textareaRef.current?.blur();
                    }
                  }}
                >
                  <span className="live-editor-pane__mode">{t("Markdown")}</span>
                  <EditorPane
                    ariaLabel={fmt("Editing block from line %d", block.sourceLine)}
                    autoFocus={currentActive.focusEditor}
                    className="live-editor-pane__source"
                    onBlur={closeActiveBlock}
                    onChange={updateDraft}
                    onPositionChange={publishEditorPosition}
                    onPasteImage={
                      onPasteImage
                        ? (file, selection) =>
                            onPasteImage(file, {
                              direction: selection.direction,
                              end: currentActive.before.length + selection.end,
                              start: currentActive.before.length + selection.start,
                            })
                        : undefined
                    }
                    onSelectionChange={(selection) => {
                      setActive((current) =>
                        current?.documentId === documentId
                          ? { ...current, selection }
                          : current,
                      );
                      onSelectionChange?.({
                        direction: selection.direction,
                        end: currentActive.before.length + selection.end,
                        start: currentActive.before.length + selection.start,
                      });
                    }}
                    ref={textareaRef}
                    selection={currentActive.selection}
                    showPosition={false}
                    value={currentActive.draft}
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
                    aria-description={editBlockHint}
                    aria-label={`${block.sourceLine}. ${
                      block.raw.trim().replace(/\s+/gu, " ").slice(0, 160) ||
                      t("Start writing…")
                    }`}
                    className={`live-editor-pane__block markdown-body${block.html ? "" : " is-source-only"}`}
                    dangerouslySetInnerHTML={
                      renderedBlockMarkup[index] ?? EMPTY_RENDERED_MARKUP
                    }
                    onClick={(event) => handleRenderedClick(event, block, index)}
                    onFocus={() => setFocusedBlockIndex(index)}
                    onKeyDown={(event) => handleBlockKeyDown(event, block, index)}
                    ref={(element) => {
                      if (element) blockRefs.current.set(index, element);
                      else blockRefs.current.delete(index);
                    }}
                    role="group"
                    tabIndex={focusedBlockIndex === index ? 0 : -1}
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
