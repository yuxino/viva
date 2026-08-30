import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useI18n } from "../../i18n";
import { isImeKeyEvent } from "../../lib/keyboard";

export interface SearchResultItem {
  relativePath: string;
  line: number;
  column: number;
  preview: string;
}

export interface SearchPanelProps {
  query: string;
  onQueryChange: (query: string) => void;
  onOpenResult: (result: SearchResultItem) => void;
  onSubmit?: (query: string) => void;
  loading?: boolean;
  results?: readonly SearchResultItem[];
  resultsQuery?: string | null;
  error?: ReactNode;
  searchIcon?: ReactNode;
  clearIcon?: ReactNode;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  initialState?: ReactNode;
  emptyState?: ReactNode;
}

function joinClassNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function SearchPanel({
  query,
  onQueryChange,
  onOpenResult,
  onSubmit,
  loading = false,
  results = [],
  resultsQuery,
  error,
  searchIcon = "⌕",
  clearIcon = "×",
  placeholder,
  ariaLabel,
  className,
  initialState,
  emptyState,
}: SearchPanelProps) {
  const { fmt, t } = useI18n();
  const resolvedAriaLabel = ariaLabel ?? t("Search workspace");
  const resolvedPlaceholder = placeholder ?? t("Search files");
  const resolvedInitialState =
    initialState === undefined
      ? t("Search across Markdown files")
      : initialState;
  const resolvedEmptyState =
    emptyState === undefined ? t("No matches") : emptyState;
  const resultsId = useId();
  const optionIdPrefix = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(results.length ? 0 : -1);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const normalizedQuery = query.trim();
  const resultsAreCurrent =
    pendingQuery === null &&
    (resultsQuery === undefined || resultsQuery === normalizedQuery);
  const visibleResults = resultsAreCurrent && normalizedQuery ? results : [];
  const searchPending =
    loading || Boolean(normalizedQuery && !resultsAreCurrent);
  const selectedIndex = visibleResults.length
    ? Math.max(0, Math.min(activeIndex, visibleResults.length - 1))
    : -1;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (pendingQuery === query) setPendingQuery(null);
  }, [pendingQuery, query]);

  useEffect(() => {
    setActiveIndex(visibleResults.length ? 0 : -1);
    optionRefs.current.length = visibleResults.length;
  }, [query, results, resultsAreCurrent, visibleResults.length]);

  useEffect(() => {
    if (selectedIndex < 0) return;
    optionRefs.current[selectedIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  function optionId(index: number): string {
    return `${optionIdPrefix}-${index}`;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit?.(normalizedQuery);
  }

  function clearQuery(): void {
    setPendingQuery("");
    onQueryChange("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (isImeKeyEvent(event.nativeEvent)) return;

    if (event.key === "Escape" && query) {
      event.preventDefault();
      clearQuery();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!visibleResults.length) return;
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        if (current < 0 || current >= visibleResults.length) {
          return direction > 0 ? 0 : visibleResults.length - 1;
        }
        return (
          (current + direction + visibleResults.length) % visibleResults.length
        );
      });
      return;
    }

    if (event.key === "Enter" && selectedIndex >= 0) {
      event.preventDefault();
      const result = visibleResults[selectedIndex];
      if (result) onOpenResult(result);
    }
  }

  let status: ReactNode;
  if (searchPending) status = t("Searching…");
  else if (error) status = error;
  else if (!normalizedQuery) status = resolvedInitialState;
  else if (visibleResults.length === 0) status = resolvedEmptyState;
  else {
    status = fmt(
      visibleResults.length === 1 ? "%d match" : "%d matches",
      visibleResults.length,
    );
  }

  return (
    <section
      aria-label={resolvedAriaLabel}
      className={joinClassNames(
        "search-panel",
        searchPending && "is-loading",
        error !== undefined && "has-error",
        className,
      )}
    >
      <form className="search-panel__form" onSubmit={handleSubmit} role="search">
        <div className="search-panel__input-wrap">
          <span aria-hidden="true" className="search-panel__icon">
            {searchIcon}
          </span>
          <input
            aria-activedescendant={
              selectedIndex >= 0 ? optionId(selectedIndex) : undefined
            }
            aria-autocomplete="list"
            aria-controls={resultsId}
            aria-label={resolvedAriaLabel}
            className="search-panel__input"
            onChange={(event) => {
              setPendingQuery(event.currentTarget.value);
              onQueryChange(event.currentTarget.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder={resolvedPlaceholder}
            ref={inputRef}
            type="search"
            value={query}
          />
          {query ? (
            <button
              aria-label={t("Clear search")}
              className="search-panel__clear"
              onClick={clearQuery}
              type="button"
            >
              <span aria-hidden="true">{clearIcon}</span>
            </button>
          ) : null}
        </div>
      </form>

      <div
        aria-live="polite"
        className={joinClassNames(
          "search-panel__status",
          error !== undefined && "search-panel__error",
        )}
        role={error !== undefined ? "alert" : "status"}
      >
        {status}
      </div>

      <ol
        aria-label={t("Search results")}
        aria-busy={searchPending || undefined}
        className="search-panel__results viva-scroll-region"
        id={resultsId}
        role="listbox"
      >
        {visibleResults.map((result, index) => (
          <li
            className="search-panel__result"
            key={`${result.relativePath}:${result.line}:${result.column}`}
            role="presentation"
          >
            <button
              aria-selected={index === selectedIndex}
              className={joinClassNames(
                "search-panel__result-target",
                index === selectedIndex && "is-active",
              )}
              id={optionId(index)}
              onClick={() => onOpenResult(result)}
              onMouseMove={() => setActiveIndex(index)}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span className="search-panel__result-path">
                {result.relativePath}
              </span>
              <span className="search-panel__result-location">
                {result.line}:{result.column}
              </span>
              <span className="search-panel__result-preview">
                {result.preview}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
