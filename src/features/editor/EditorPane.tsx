import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FocusEventHandler,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import {
  continueMarkdownLine,
  formatMarkdownSelection,
  indentText,
  normalizeSelection,
  positionAtOffset,
  scrollTopForSourceLine,
  sourceLineFromScroll,
  typewriterScrollTop,
  type EditorPosition,
  type MarkdownFormat,
  type TextSelection,
} from "./editing";
import { ContextMenu, type MenuItem } from "../../components/ui";
import { useI18n } from "../../i18n";
import {
  readClipboardImage,
  readClipboardText,
  writeClipboardText,
} from "../../lib/clipboard";
import {
  getVivaPlatform,
  hasPrimaryShortcutModifier,
  isImeKeyEvent,
} from "../../lib/keyboard";

export interface EditorPaneProps {
  value: string;
  onChange: (value: string) => void;
  selection?: TextSelection | null;
  onSelectionChange?: (selection: Required<TextSelection>) => void;
  onPositionChange?: (position: EditorPosition) => void;
  onSourceLineChange?: (sourceLine: number) => void;
  onPasteImage?: (
    file: File,
    selection: Required<TextSelection>,
  ) => void;
  revealSourceLine?: number | null;
  revealSelectionRequestId?: number;
  typewriterMode?: boolean;
  tabSize?: number;
  wrap?: "hard" | "off" | "soft";
  readOnly?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  spellCheck?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  showPosition?: boolean;
  emptyOverlay?: ReactNode;
  onBlur?: FocusEventHandler<HTMLTextAreaElement>;
}

interface PendingSelection {
  expectedValue: string;
  selection: Required<TextSelection>;
}

interface TypewriterMeasurementCache {
  caretOffset: number;
  clientHeight: number;
  clientWidth: number;
  exactValue: string | null;
  height: number;
  scrollHeight: number;
  top: number;
  valueLength: number;
  wrap: string;
}

const MAX_TRACKED_POSITION_CHARACTERS = 512 * 1024;
const MAX_EXACT_TYPEWRITER_CHARACTERS = 32 * 1024;

function joinClassNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export const EditorPane = forwardRef<HTMLTextAreaElement, EditorPaneProps>(
  function EditorPane(
    {
      value,
      onChange,
      selection = null,
      onSelectionChange,
      onPositionChange,
      onSourceLineChange,
      onPasteImage,
      revealSourceLine = null,
      revealSelectionRequestId,
      typewriterMode = false,
      tabSize = 2,
      wrap = "soft",
      readOnly = false,
      disabled = false,
      autoFocus = false,
      spellCheck = true,
      placeholder,
      ariaLabel,
      className,
      showPosition = true,
      emptyOverlay,
      onBlur,
    },
    forwardedRef,
  ) {
    const { fmt, t } = useI18n();
    const resolvedAriaLabel = ariaLabel ?? t("Markdown editor");
    const resolvedPlaceholder = placeholder ?? t("Start writing…");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const allowFocusExitOnNextTabRef = useRef(false);
    const pendingSelectionRef = useRef<PendingSelection | null>(null);
    const typewriterMeasurementRef = useRef<TypewriterMeasurementCache | null>(
      null,
    );
    const suppressScrollRef = useRef(false);
    const composingRef = useRef(false);
    const initialOffset = selection?.end ?? 0;
    const tracksPosition = value.length <= MAX_TRACKED_POSITION_CHARACTERS;
    const [position, setPosition] = useState(() =>
      value.length <= MAX_TRACKED_POSITION_CHARACTERS
        ? positionAtOffset(value, initialOffset)
        : { line: 1, column: 1 },
    );

    useImperativeHandle(
      forwardedRef,
      () => textareaRef.current as HTMLTextAreaElement,
      [],
    );

    function publishSelection(nextSelection: TextSelection): void {
      const normalized = normalizeSelection(value, nextSelection);
      onSelectionChange?.(normalized);
      if (tracksPosition) {
        const nextPosition = positionAtOffset(value, normalized.end);
        setPosition(nextPosition);
        onPositionChange?.(nextPosition);
      }
    }

    function measureCaretPosition(
      textarea: HTMLTextAreaElement,
    ): { height: number; top: number } | null {
      if (typeof document === "undefined" || !document.body) return null;

      const caretOffset =
        textarea.selectionDirection === "backward"
          ? textarea.selectionStart
          : textarea.selectionEnd;
      const exact = textarea.value.length <= MAX_EXACT_TYPEWRITER_CHARACTERS;
      const cached = typewriterMeasurementRef.current;
      if (
        cached?.caretOffset === caretOffset &&
        cached.clientHeight === textarea.clientHeight &&
        cached.clientWidth === textarea.clientWidth &&
        cached.scrollHeight === textarea.scrollHeight &&
        cached.valueLength === textarea.value.length &&
        cached.wrap === textarea.wrap &&
        cached.exactValue === (exact ? textarea.value : null)
      ) {
        return { height: cached.height, top: cached.top };
      }

      const computed = window.getComputedStyle(textarea);
      const parsedLineHeight = Number.parseFloat(computed.lineHeight);
      const height =
        Number.isFinite(parsedLineHeight) && parsedLineHeight > 0
          ? parsedLineHeight
          : 24;
      if (!exact) {
        const progress =
          textarea.value.length > 0
            ? Math.max(0, Math.min(1, caretOffset / textarea.value.length))
            : 0;
        const top = progress * Math.max(0, textarea.scrollHeight - height);
        typewriterMeasurementRef.current = {
          caretOffset,
          clientHeight: textarea.clientHeight,
          clientWidth: textarea.clientWidth,
          exactValue: null,
          height,
          scrollHeight: textarea.scrollHeight,
          top,
          valueLength: textarea.value.length,
          wrap: textarea.wrap,
        };
        return { height, top };
      }

      const mirror = document.createElement("div");
      const caret = document.createElement("span");
      const layoutProperties = [
        "direction",
        "fontFamily",
        "fontFeatureSettings",
        "fontKerning",
        "fontSize",
        "fontStretch",
        "fontStyle",
        "fontVariant",
        "fontVariantLigatures",
        "fontWeight",
        "letterSpacing",
        "lineHeight",
        "paddingBottom",
        "paddingLeft",
        "paddingRight",
        "paddingTop",
        "tabSize",
        "textAlign",
        "textIndent",
        "textTransform",
        "wordBreak",
        "wordSpacing",
      ] as const;

      for (const property of layoutProperties) {
        mirror.style[property] = computed[property];
      }
      Object.assign(mirror.style, {
        border: "0",
        boxSizing: "border-box",
        height: "auto",
        left: "0",
        overflow: "hidden",
        overflowWrap: computed.overflowWrap,
        pointerEvents: "none",
        position: "fixed",
        top: "0",
        visibility: "hidden",
        whiteSpace: textarea.wrap === "off" ? "pre" : "pre-wrap",
        width: `${textarea.clientWidth}px`,
        zIndex: "-1",
      });
      caret.dataset.vivaTypewriterCaret = "true";
      caret.style.display = "inline-block";
      caret.style.height = `${height}px`;
      caret.style.verticalAlign = "top";
      caret.style.width = "0";
      mirror.append(
        document.createTextNode(textarea.value.slice(0, caretOffset)),
        caret,
      );
      document.body.append(mirror);

      const top = caret.offsetTop;
      mirror.remove();
      typewriterMeasurementRef.current = {
        caretOffset,
        clientHeight: textarea.clientHeight,
        clientWidth: textarea.clientWidth,
        exactValue: textarea.value,
        height,
        scrollHeight: textarea.scrollHeight,
        top,
        valueLength: textarea.value.length,
        wrap: textarea.wrap,
      };
      return { height, top };
    }

    function applyTypewriterPosition(textarea: HTMLTextAreaElement): void {
      if (
        !typewriterMode ||
        !tracksPosition ||
        composingRef.current ||
        textarea.clientHeight <= 0
      ) {
        return;
      }
      const caret = measureCaretPosition(textarea);
      if (!caret) return;
      const nextScrollTop = typewriterScrollTop(
        caret.top,
        caret.height,
        textarea.scrollHeight,
        textarea.clientHeight,
      );
      if (Math.abs(textarea.scrollTop - nextScrollTop) < 1) return;

      suppressScrollRef.current = true;
      textarea.scrollTop = nextScrollTop;
      queueMicrotask(() => {
        suppressScrollRef.current = false;
      });
    }

    function applyMarkdownFormat(format: MarkdownFormat): void {
      if (readOnly || disabled) return;
      const textarea = textareaRef.current;
      if (!textarea) return;
      const edit = formatMarkdownSelection(
        value,
        {
          start: textarea.selectionStart,
          end: textarea.selectionEnd,
          direction: textarea.selectionDirection,
        },
        format,
      );
      pendingSelectionRef.current = {
        expectedValue: edit.value,
        selection: normalizeSelection(edit.value, edit.selection),
      };
      textarea.focus();
      onChange(edit.value);
    }

    useLayoutEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const pending = pendingSelectionRef.current;
      const requested =
        pending?.expectedValue === value ? pending.selection : selection;
      if (!requested) return;

      const normalized = normalizeSelection(value, requested);
      textarea.setSelectionRange(
        normalized.start,
        normalized.end,
        normalized.direction,
      );
      if (tracksPosition) {
        const nextPosition = positionAtOffset(value, normalized.end);
        setPosition(nextPosition);
        onPositionChange?.(nextPosition);
      }
      applyTypewriterPosition(textarea);
      if (revealSelectionRequestId !== undefined) {
        const caret = measureCaretPosition(textarea);
        if (caret) {
          const nextScrollTop = typewriterScrollTop(
            caret.top,
            caret.height,
            textarea.scrollHeight,
            textarea.clientHeight,
          );
          if (Math.abs(textarea.scrollTop - nextScrollTop) >= 1) {
            suppressScrollRef.current = true;
            textarea.scrollTop = nextScrollTop;
            queueMicrotask(() => {
              suppressScrollRef.current = false;
            });
          }
        }
      }
      if (pending?.expectedValue === value) pendingSelectionRef.current = null;
    }, [
      onPositionChange,
      selection?.direction,
      selection?.end,
      selection?.start,
      tracksPosition,
      typewriterMode,
      revealSelectionRequestId,
      value,
    ]);

    useLayoutEffect(() => {
      if (!typewriterMode) return;
      const textarea = textareaRef.current;
      if (textarea) applyTypewriterPosition(textarea);
    }, [typewriterMode]);

    useLayoutEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea || revealSourceLine == null) return;
      const nextScrollTop = scrollTopForSourceLine(
        value,
        revealSourceLine,
        textarea.scrollHeight,
        textarea.clientHeight,
      );
      if (Math.abs(textarea.scrollTop - nextScrollTop) < 1) return;
      suppressScrollRef.current = true;
      textarea.scrollTop = nextScrollTop;
      queueMicrotask(() => {
        suppressScrollRef.current = false;
      });
    }, [revealSourceLine, value]);

    function handleChange(event: ChangeEvent<HTMLTextAreaElement>): void {
      const textarea = event.currentTarget;
      onChange(textarea.value);
      const normalized = normalizeSelection(textarea.value, {
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
        direction: textarea.selectionDirection,
      });
      onSelectionChange?.(normalized);
      if (tracksPosition) {
        const nextPosition = positionAtOffset(textarea.value, normalized.end);
        setPosition(nextPosition);
        onPositionChange?.(nextPosition);
      }
      applyTypewriterPosition(textarea);
    }

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
      if (readOnly || disabled) return;

      if (
        event.key === "Escape" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !isImeKeyEvent(event.nativeEvent)
      ) {
        allowFocusExitOnNextTabRef.current = true;
        return;
      }
      if (event.key !== "Tab") allowFocusExitOnNextTabRef.current = false;

      const textarea = event.currentTarget;
      const selection = {
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
        direction: textarea.selectionDirection,
      };

      const commandModifier = hasPrimaryShortcutModifier(event);
      const format =
        commandModifier && !event.altKey && !event.shiftKey
          ? event.key.toLocaleLowerCase() === "b"
            ? "bold"
            : event.key.toLocaleLowerCase() === "i"
              ? "italic"
              : event.key.toLocaleLowerCase() === "e"
                ? "inlineCode"
                : null
          : null;
      if (format) {
        event.preventDefault();
        applyMarkdownFormat(format);
        return;
      }

      if (
        event.key === "Enter" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !isImeKeyEvent(event.nativeEvent)
      ) {
        const edit = continueMarkdownLine(value, selection);
        if (edit) {
          event.preventDefault();
          pendingSelectionRef.current = {
            expectedValue: edit.value,
            selection: normalizeSelection(edit.value, edit.selection),
          };
          onChange(edit.value);
        }
        return;
      }

      if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) {
        if (event.key === "Tab") allowFocusExitOnNextTabRef.current = false;
        return;
      }
      if (allowFocusExitOnNextTabRef.current) {
        allowFocusExitOnNextTabRef.current = false;
        return;
      }
      event.preventDefault();
      const edit = indentText(
        value,
        selection,
        tabSize,
        event.shiftKey,
      );
      pendingSelectionRef.current = {
        expectedValue: edit.value,
        selection: normalizeSelection(edit.value, edit.selection),
      };
      onChange(edit.value);
    }

    function handleScroll(event: UIEvent<HTMLTextAreaElement>): void {
      if (suppressScrollRef.current) return;
      const textarea = event.currentTarget;
      onSourceLineChange?.(
        sourceLineFromScroll(
          value,
          textarea.scrollTop,
          textarea.scrollHeight,
          textarea.clientHeight,
        ),
      );
    }

    function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
      if (readOnly || disabled || !onPasteImage) return;
      const imageItem = Array.from(event.clipboardData.items).find(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      );
      const file = imageItem?.getAsFile();
      if (!file) return;

      event.preventDefault();
      const textarea = event.currentTarget;
      onPasteImage(
        file,
        normalizeSelection(value, {
          direction: textarea.selectionDirection,
          end: textarea.selectionEnd,
          start: textarea.selectionStart,
        }),
      );
    }

    function replaceSelection(replacement: string): void {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const nextValue = `${value.slice(0, textarea.selectionStart)}${replacement}${value.slice(textarea.selectionEnd)}`;
      const caret = textarea.selectionStart + replacement.length;
      pendingSelectionRef.current = {
        expectedValue: nextValue,
        selection: { direction: "none", end: caret, start: caret },
      };
      onChange(nextValue);
    }

    async function copySelection(cut = false): Promise<void> {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const selected = value.slice(textarea.selectionStart, textarea.selectionEnd);
      if (!selected || !(await writeClipboardText(selected))) return;
      if (cut && !readOnly && !disabled) replaceSelection("");
      else textarea.focus();
    }

    async function pasteSelection(): Promise<void> {
      if (readOnly || disabled) return;
      const textarea = textareaRef.current;
      if (!textarea) return;
      if (onPasteImage) {
        const selection = normalizeSelection(value, {
          direction: textarea.selectionDirection,
          end: textarea.selectionEnd,
          start: textarea.selectionStart,
        });
        const image = await readClipboardImage();
        if (image) {
          onPasteImage(image, selection);
          return;
        }
      }
      const clipboard = await readClipboardText();
      if (clipboard !== null) replaceSelection(clipboard);
    }

    function selectAll(): void {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(0, value.length);
      publishSelection({ direction: "none", end: value.length, start: 0 });
    }

    const primary = getVivaPlatform() === "macos" ? "⌘" : "Ctrl+";
    const contextItems: MenuItem[] = [
      {
        disabled: readOnly || disabled,
        id: "cut",
        label: t("Cut"),
        onSelect: () => void copySelection(true),
        shortcut: `${primary}X`,
      },
      {
        id: "copy",
        label: t("Copy"),
        onSelect: () => void copySelection(false),
        shortcut: `${primary}C`,
      },
      {
        disabled: readOnly || disabled,
        id: "paste",
        label: t("Paste"),
        onSelect: () => void pasteSelection(),
        shortcut: `${primary}V`,
      },
      {
        disabled: readOnly || disabled,
        id: "bold",
        label: t("Bold"),
        onSelect: () => applyMarkdownFormat("bold"),
        separatorBefore: true,
        shortcut: `${primary}B`,
      },
      {
        disabled: readOnly || disabled,
        id: "italic",
        label: t("Italic"),
        onSelect: () => applyMarkdownFormat("italic"),
        shortcut: `${primary}I`,
      },
      {
        disabled: readOnly || disabled,
        id: "inline-code",
        label: t("Inline Code"),
        onSelect: () => applyMarkdownFormat("inlineCode"),
        shortcut: `${primary}E`,
      },
      {
        id: "select-all",
        label: t("Select all"),
        onSelect: selectAll,
        separatorBefore: true,
        shortcut: `${primary}A`,
      },
    ];

    return (
      <section
        className={joinClassNames("editor-pane", className)}
        data-source-line={tracksPosition ? position.line : undefined}
      >
        <ContextMenu
          items={contextItems}
          label={t("Text editing menu")}
        >
          <textarea
            aria-label={resolvedAriaLabel}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus={autoFocus}
            className="editor-pane__input viva-scroll-region"
            disabled={disabled}
            onBlur={onBlur}
            onChange={handleChange}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              applyTypewriterPosition(event.currentTarget);
            }}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onScroll={handleScroll}
            onSelect={(event) => {
              publishSelection({
                start: event.currentTarget.selectionStart,
                end: event.currentTarget.selectionEnd,
                direction: event.currentTarget.selectionDirection,
              });
              applyTypewriterPosition(event.currentTarget);
            }}
            placeholder={resolvedPlaceholder}
            readOnly={readOnly}
            ref={textareaRef}
            spellCheck={spellCheck}
            value={value}
            wrap={wrap}
          />
        </ContextMenu>
        {!value && emptyOverlay ? (
          <div className="editor-pane__empty">{emptyOverlay}</div>
        ) : null}
        {showPosition && tracksPosition ? (
          <output
            aria-label={t("Cursor position")}
            className="editor-pane__position"
          >
            {fmt("Ln %d, Col %d", position.line, position.column)}
          </output>
        ) : null}
      </section>
    );
  },
);
