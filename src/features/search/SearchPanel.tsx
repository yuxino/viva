import {
  useId,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useI18n } from "../../i18n";

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
  const normalizedQuery = query.trim();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit?.(normalizedQuery);
  }

  function clearQuery(): void {
    onQueryChange("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Escape" || !query) return;
    event.preventDefault();
    clearQuery();
  }

  let status: ReactNode;
  if (loading) status = t("Searching…");
  else if (error) status = error;
  else if (!normalizedQuery) status = resolvedInitialState;
  else if (results.length === 0) status = resolvedEmptyState;
  else {
    status = fmt(
      results.length === 1 ? "%d match" : "%d matches",
      results.length,
    );
  }

  return (
    <section
      aria-label={resolvedAriaLabel}
      className={joinClassNames(
        "search-panel",
        loading && "is-loading",
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
            aria-controls={resultsId}
            aria-label={resolvedAriaLabel}
            className="search-panel__input"
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder={resolvedPlaceholder}
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
        className="search-panel__results viva-scroll-region"
        id={resultsId}
      >
        {results.map((result) => (
          <li
            className="search-panel__result"
            key={`${result.relativePath}:${result.line}:${result.column}`}
          >
            <button
              className="search-panel__result-target"
              onClick={() => onOpenResult(result)}
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
