import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
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
  type EditorPosition,
  type TextSelection,
} from "./editing";
import { ContextMenu, type MenuItem } from "../../components/ui";
import { useI18n } from "../../i18n";
import { readClipboardText, writeClipboardText } from "../../lib/clipboard";
import {
  getVivaPlatform,
  hasPrimaryShortcutModifier,
} from "../../lib/keyboard";

export interface EditorPaneProps {
  value: string;
  onChange: (value: string) => void;
  selection?: TextSelection | null;
  onSelectionChange?: (selection: Required<TextSelection>) => void;
  onPositionChange?: (position: EditorPosition) => void;
  onSourceLineChange?: (sourceLine: number) => void;
  revealSourceLine?: number | null;
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

const MAX_TRACKED_POSITION_CHARACTERS = 512 * 1024;

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
      revealSourceLine = null,
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
    const pendingSelectionRef = useRef<PendingSelection | null>(null);
    const suppressScrollRef = useRef(false);
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
      if (pending?.expectedValue === value) pendingSelectionRef.current = null;
    }, [
      onPositionChange,
      selection?.direction,
      selection?.end,
      selection?.start,
      tracksPosition,
      value,
    ]);

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
      // Chromium normalizes textarea values to LF. Keep disk newline policy in
      // the native document contract; jsdom is not evidence for that behavior.
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
    }

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
      if (readOnly || disabled) return;

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
        const edit = formatMarkdownSelection(value, selection, format);
        pendingSelectionRef.current = {
          expectedValue: edit.value,
          selection: normalizeSelection(edit.value, edit.selection),
        };
        onChange(edit.value);
        return;
      }

      if (
        event.key === "Enter" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
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
        <ContextMenu items={contextItems} label={t("Text editing menu")}>
          <textarea
          aria-label={resolvedAriaLabel}
          autoCapitalize="off"
          autoCorrect="off"
          autoFocus={autoFocus}
          className="editor-pane__input viva-scroll-region"
          disabled={disabled}
          onBlur={onBlur}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          onSelect={(event) =>
            publishSelection({
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
              direction: event.currentTarget.selectionDirection,
            })
          }
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
