import {
  useEffect,
  useId,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { isImeKeyEvent } from "../../lib/keyboard";
import { wrapMatchIndex } from "./find";
import "./find.css";

export interface FindBarLabels {
  close: string;
  find: string;
  hideReplace: string;
  matchCase: string;
  nextMatch: string;
  previousMatch: string;
  replace: string;
  replaceAll: string;
  replaceInput: string;
  showReplace: string;
  wholeWord: string;
}

export type FindBarFocusTarget = "query" | "replacement";

export interface FindBarProps {
  activeIndex: number;
  autoFocus?: boolean;
  caseSensitive: boolean;
  focusTarget?: FindBarFocusTarget;
  labels: FindBarLabels;
  matchCount: number;
  onCaseSensitiveChange: (value: boolean) => void;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onQueryChange: (value: string) => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onReplaceVisibleChange: (value: boolean) => void;
  onReplacementChange: (value: string) => void;
  onWholeWordChange: (value: boolean) => void;
  query: string;
  replacement: string;
  replaceVisible: boolean;
  wholeWord: boolean;
}

export function FindBar({
  activeIndex,
  autoFocus = true,
  caseSensitive,
  focusTarget = "query",
  labels,
  matchCount,
  onCaseSensitiveChange,
  onClose,
  onNext,
  onPrevious,
  onQueryChange,
  onReplace,
  onReplaceAll,
  onReplaceVisibleChange,
  onReplacementChange,
  onWholeWordChange,
  query,
  replacement,
  replaceVisible,
  wholeWord,
}: FindBarProps) {
  const queryRef = useRef<HTMLInputElement>(null);
  const replacementRef = useRef<HTMLInputElement>(null);
  const replacementRowId = useId();
  const hasMatches = matchCount > 0;
  const currentMatch =
    hasMatches && activeIndex >= 0
      ? wrapMatchIndex(activeIndex, matchCount) + 1
      : 0;

  useEffect(() => {
    if (!autoFocus) return;
    const target =
      focusTarget === "replacement" && replaceVisible
        ? replacementRef.current
        : queryRef.current;
    target?.focus();
    target?.select();
  }, [autoFocus, focusTarget, replaceVisible]);

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    onQueryChange(event.currentTarget.value);
  };

  const handleReplacementChange = (event: ChangeEvent<HTMLInputElement>) => {
    onReplacementChange(event.currentTarget.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (isImeKeyEvent(event.nativeEvent)) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (
      event.key !== "Enter" ||
      (event.target as HTMLElement).tagName !== "INPUT"
    ) {
      return;
    }

    event.preventDefault();
    if (event.shiftKey) onPrevious();
    else onNext();
  };

  return (
    <form
      aria-label={labels.find}
      className="find-bar viva-no-drag"
      onKeyDown={handleKeyDown}
      onSubmit={(event) => event.preventDefault()}
      role="search"
    >
      <div className="find-bar__row find-bar__row--query">
        <button
          aria-controls={replacementRowId}
          aria-expanded={replaceVisible}
          aria-label={replaceVisible ? labels.hideReplace : labels.showReplace}
          className="find-bar__icon-button find-bar__disclosure"
          onClick={() => onReplaceVisibleChange(!replaceVisible)}
          title={replaceVisible ? labels.hideReplace : labels.showReplace}
          type="button"
        >
          <span aria-hidden="true">{replaceVisible ? "▾" : "▸"}</span>
        </button>
        <input
          aria-keyshortcuts="Enter Shift+Enter"
          aria-label={labels.find}
          autoCapitalize="none"
          autoComplete="off"
          className="find-bar__input"
          onChange={handleQueryChange}
          placeholder={labels.find}
          ref={queryRef}
          spellCheck={false}
          type="search"
          value={query}
        />
        <output aria-atomic="true" aria-live="polite" className="find-bar__count">
          {currentMatch} / {Math.max(0, matchCount)}
        </output>
        <button
          aria-label={labels.matchCase}
          aria-pressed={caseSensitive}
          className="find-bar__icon-button find-bar__toggle"
          onClick={() => onCaseSensitiveChange(!caseSensitive)}
          title={labels.matchCase}
          type="button"
        >
          <span aria-hidden="true">Aa</span>
        </button>
        <button
          aria-label={labels.wholeWord}
          aria-pressed={wholeWord}
          className="find-bar__icon-button find-bar__toggle"
          onClick={() => onWholeWordChange(!wholeWord)}
          title={labels.wholeWord}
          type="button"
        >
          <span aria-hidden="true">W</span>
        </button>
        <span aria-hidden="true" className="find-bar__separator" />
        <button
          aria-label={labels.previousMatch}
          className="find-bar__icon-button"
          disabled={!hasMatches}
          onClick={onPrevious}
          title={labels.previousMatch}
          type="button"
        >
          <span aria-hidden="true">↑</span>
        </button>
        <button
          aria-label={labels.nextMatch}
          className="find-bar__icon-button"
          disabled={!hasMatches}
          onClick={onNext}
          title={labels.nextMatch}
          type="button"
        >
          <span aria-hidden="true">↓</span>
        </button>
        <button
          aria-label={labels.close}
          className="find-bar__icon-button"
          onClick={onClose}
          title={labels.close}
          type="button"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      {replaceVisible ? (
        <div
          className="find-bar__row find-bar__row--replace"
          id={replacementRowId}
        >
          <span aria-hidden="true" className="find-bar__replace-indent" />
          <input
            aria-keyshortcuts="Enter Shift+Enter"
            aria-label={labels.replaceInput}
            autoComplete="off"
            className="find-bar__input"
            onChange={handleReplacementChange}
            placeholder={labels.replaceInput}
            ref={replacementRef}
            spellCheck={false}
            type="text"
            value={replacement}
          />
          <button
            className="find-bar__action"
            disabled={!hasMatches}
            onClick={onReplace}
            type="button"
          >
            {labels.replace}
          </button>
          <button
            className="find-bar__action"
            disabled={!hasMatches}
            onClick={onReplaceAll}
            type="button"
          >
            {labels.replaceAll}
          </button>
        </div>
      ) : null}
    </form>
  );
}
