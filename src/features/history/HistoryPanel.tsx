import {
  useId,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useI18n } from "../../i18n";
import type { LineEnding } from "../../domain/workspace";
import { boundTextPrefix } from "../../lib/textBounds";
import {
  createHistoryLineDiff,
  type HistoryLineDiffResult,
  type HistoryLineDiffRow,
} from "./diff";
import "./history.css";

export interface HistoryEntry {
  id: string;
  label: string;
  createdAt?: string;
  description?: string;
  content?: string;
  lineEnding?: LineEnding;
}

export interface HistoryListProps {
  entries: readonly HistoryEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  ariaLabel?: string;
}

export interface HistoryVersionPreviewProps {
  entry: HistoryEntry | null;
  currentContent: string;
  onLoadVersion: (entry: HistoryEntry) => void;
  loading?: boolean;
  loadingState?: ReactNode;
  loadLabel?: string;
  loadIcon?: ReactNode;
  emptyState?: ReactNode;
}

export interface HistoryLineDiffProps {
  result: HistoryLineDiffResult;
  ariaLabel?: string;
  emptyState?: ReactNode;
}

export interface HistoryPanelProps {
  entries: readonly HistoryEntry[];
  selectedId: string | null;
  currentContent: string;
  onSelect: (id: string) => void;
  onLoadVersion: (entry: HistoryEntry) => void;
  loading?: boolean;
  previewLoading?: boolean;
  error?: ReactNode;
  onRetry?: () => void;
  heading?: ReactNode;
  fileName?: ReactNode;
  emptyState?: ReactNode;
  loadingState?: ReactNode;
  previewLoadingState?: ReactNode;
  previewEmptyState?: ReactNode;
  retryLabel?: string;
  loadLabel?: string;
  loadIcon?: ReactNode;
  ariaLabel?: string;
  className?: string;
}

function joinClassNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

const HISTORY_PREVIEW_MAX_CHARACTERS = 256 * 1024;
const HISTORY_PREVIEW_MAX_LINES = 2_000;
const HISTORY_DIFF_MAX_CHARACTERS = 128 * 1024;
const HISTORY_DIFF_MAX_LINES = 800;

function splitPreviewLines(content: string): string[] {
  return content ? content.split(/\r\n|\n|\r/) : [];
}

function optionLabel(entry: HistoryEntry): string {
  return entry.description
    ? `${entry.label}, ${entry.description}`
    : entry.label;
}

export function HistoryList({
  entries,
  selectedId,
  onSelect,
  ariaLabel,
}: HistoryListProps) {
  const { formatNumber, t } = useI18n();
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedIndex = entries.findIndex(({ id }) => id === selectedId);
  const rovingIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function focusAndSelect(index: number): void {
    const entry = entries[index];
    if (!entry) return;
    onSelect(entry.id);
    optionRefs.current.get(entry.id)?.focus();
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = Math.min(index + 1, entries.length - 1);
        break;
      case "ArrowUp":
        nextIndex = Math.max(index - 1, 0);
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = entries.length - 1;
        break;
      case "PageDown":
        nextIndex = Math.min(index + 5, entries.length - 1);
        break;
      case "PageUp":
        nextIndex = Math.max(index - 5, 0);
        break;
    }
    if (nextIndex == null) return;
    event.preventDefault();
    focusAndSelect(nextIndex);
  }

  return (
    <aside className="history-list">
      <header className="history-list__header">
        <h3 className="history-list__title">{t("Saved versions")}</h3>
        <span className="history-list__count">
          {formatNumber(entries.length)}
        </span>
      </header>
      <ul
        aria-label={ariaLabel ?? t("Saved versions")}
        className="history-list__items viva-scroll-region"
        role="listbox"
      >
        {entries.map((entry, index) => {
          const selected = entry.id === selectedId;
          return (
            <li className="history-list__item" key={entry.id} role="none">
              <button
                aria-label={optionLabel(entry)}
                aria-posinset={index + 1}
                aria-selected={selected}
                aria-setsize={entries.length}
                className={joinClassNames(
                  "history-list__option",
                  selected && "is-selected",
                )}
                onClick={() => onSelect(entry.id)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                ref={(element) => {
                  if (element) optionRefs.current.set(entry.id, element);
                  else optionRefs.current.delete(entry.id);
                }}
                role="option"
                tabIndex={index === rovingIndex ? 0 : -1}
                type="button"
              >
                <span aria-hidden="true" className="history-list__marker" />
                <span className="history-list__copy">
                  <time
                    className="history-list__label"
                    dateTime={entry.createdAt}
                  >
                    {entry.label}
                  </time>
                  {entry.description ? (
                    <span className="history-list__description">
                      {entry.description}
                    </span>
                  ) : null}
                </span>
                <span aria-hidden="true" className="history-list__index">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function SourceLine({ line, index }: { line: string; index: number }) {
  return (
    <li className="history-source__line">
      <span aria-hidden="true" className="history-source__number">
        {index + 1}
      </span>
      <code className="history-source__code">{line || "\u00a0"}</code>
    </li>
  );
}

function DiffLine({ row }: { row: HistoryLineDiffRow }) {
  const { fmt, t } = useI18n();
  const marker = row.kind === "added" ? "+" : row.kind === "removed" ? "−" : "";
  const spokenLine = fmt(
    row.kind === "added"
      ? "Added line: %@"
      : row.kind === "removed"
        ? "Removed line: %@"
        : "Unchanged line: %@",
    row.text || t("blank"),
  );

  return (
    <li
      aria-label={spokenLine}
      className={joinClassNames(
        "history-diff__line",
        `history-diff__line--${row.kind}`,
      )}
    >
      <span aria-hidden="true" className="history-diff__number">
        {row.historicalLine ?? ""}
      </span>
      <span aria-hidden="true" className="history-diff__number">
        {row.currentLine ?? ""}
      </span>
      <span aria-hidden="true" className="history-diff__marker">
        {marker}
      </span>
      <code aria-hidden="true" className="history-diff__code">
        {row.text || "\u00a0"}
      </code>
    </li>
  );
}

export function HistoryLineDiff({
  result,
  ariaLabel,
  emptyState,
}: HistoryLineDiffProps) {
  const { fmt, t } = useI18n();
  const resolvedEmptyState =
    emptyState === undefined
      ? t("No changes from this version")
      : emptyState;
  const hasChanges =
    result.summary.additions > 0 || result.summary.removals > 0;

  return (
    <section
      aria-label={
        ariaLabel ?? t("Changes from this version to the current document")
      }
      className="history-diff"
    >
      <header className="history-preview__section-header">
        <div>
          <h4 className="history-preview__section-title">
            {t("Changes since")}
          </h4>
          <p className="history-preview__section-note">
            {t("Historical → current")}
          </p>
        </div>
        <div
          aria-label={fmt(
            "%d added lines and %d removed lines",
            result.summary.additions,
            result.summary.removals,
          )}
          className="history-diff__summary"
        >
          <span className="history-diff__summary-addition">
            <strong>+{result.summary.additions}</strong>
            {t("Added")}
          </span>
          <span className="history-diff__summary-removal">
            <strong>−{result.summary.removals}</strong>
            {t("Removed")}
          </span>
        </div>
      </header>
      {hasChanges ? (
        <ol
          className="history-diff__lines viva-scroll-region"
          tabIndex={0}
        >
          {result.rows.map((row, index) => (
            <DiffLine
              key={`${index}:${row.kind}:${row.historicalLine ?? "x"}:${row.currentLine ?? "x"}`}
              row={row}
            />
          ))}
        </ol>
      ) : (
        <div className="history-diff__empty" role="status">
          <span aria-hidden="true" className="history-diff__empty-mark">
            =
          </span>
          {resolvedEmptyState}
        </div>
      )}
    </section>
  );
}

export function HistoryVersionPreview({
  entry,
  currentContent,
  onLoadVersion,
  loading = false,
  loadingState,
  loadLabel,
  loadIcon = "↩",
  emptyState,
}: HistoryVersionPreviewProps) {
  const { fmt, t } = useI18n();
  const resolvedLoadingState =
    loadingState === undefined
      ? t("Loading version content…")
      : loadingState;
  const resolvedLoadLabel = loadLabel ?? t("Load this version");
  const resolvedEmptyState =
    emptyState === undefined ? t("Select a version to inspect") : emptyState;
  const snapshotTitleId = useId();
  const content = entry?.content;
  const contentLoaded = typeof content === "string";
  const preview = useMemo(() => {
    if (typeof content !== "string") {
      return { lines: [] as string[], truncated: false };
    }
    const bounded = boundTextPrefix(
      content,
      HISTORY_PREVIEW_MAX_CHARACTERS,
      HISTORY_PREVIEW_MAX_LINES,
    );
    return {
      lines: splitPreviewLines(bounded.text),
      truncated: bounded.truncated,
    };
  }, [content]);
  const diffState = useMemo(() => {
    if (typeof content !== "string") return null;
    const historical = boundTextPrefix(
      content,
      HISTORY_DIFF_MAX_CHARACTERS,
      HISTORY_DIFF_MAX_LINES,
    );
    const current = boundTextPrefix(
      currentContent,
      HISTORY_DIFF_MAX_CHARACTERS,
      HISTORY_DIFF_MAX_LINES,
    );
    return {
      result: createHistoryLineDiff(historical.text, current.text),
      truncated: historical.truncated || current.truncated,
    };
  }, [content, currentContent]);
  const previewLines = preview.lines;
  const diff = diffState?.result ?? null;

  if (!entry) {
    return (
      <div className="history-preview history-preview--empty" role="status">
        <span aria-hidden="true" className="history-preview__empty-mark">
          H
        </span>
        <div>{resolvedEmptyState}</div>
      </div>
    );
  }

  return (
    <article aria-busy={loading} className="history-preview">
      <header className="history-preview__header">
        <div className="history-preview__identity">
          <span className="history-preview__eyebrow">
            {t("Selected version")}
          </span>
          <h3 className="history-preview__title">{entry.label}</h3>
          {entry.description ? (
            <p className="history-preview__description">{entry.description}</p>
          ) : null}
        </div>
        <button
          aria-label={fmt("%@: %@", resolvedLoadLabel, entry.label)}
          className="history-preview__load"
          disabled={!contentLoaded || loading}
          onClick={() => onLoadVersion(entry)}
          type="button"
        >
          <span aria-hidden="true" className="history-preview__load-icon">
            {loadIcon}
          </span>
          <span>{resolvedLoadLabel}</span>
        </button>
      </header>
      {loading ? (
        <div className="history-preview__state" role="status">
          <span aria-hidden="true" className="history-preview__spinner" />
          <div>
            <strong>{t("Opening snapshot")}</strong>
            <span>{resolvedLoadingState}</span>
          </div>
        </div>
      ) : contentLoaded && diff ? (
        <div className="history-preview__content">
          <section
            aria-labelledby={snapshotTitleId}
            className="history-source"
          >
            <header className="history-preview__section-header">
              <div>
                <h4
                  className="history-preview__section-title"
                  id={snapshotTitleId}
                >
                  {t("Snapshot")}
                </h4>
                <p className="history-preview__section-note">
                  {fmt(
                    preview.truncated
                      ? previewLines.length === 1
                        ? "%d line shown"
                        : "%d lines shown"
                      : previewLines.length === 1
                        ? "%d line"
                        : "%d lines",
                    previewLines.length,
                  )}
                </p>
              </div>
            </header>
            {previewLines.length > 0 ? (
              <ol
                aria-label={t("Version content")}
                className="history-source__lines viva-scroll-region"
                tabIndex={0}
              >
                {previewLines.map((line, index) => (
                  <SourceLine index={index} key={index} line={line} />
                ))}
              </ol>
            ) : (
              <div className="history-source__empty">{t("Empty document")}</div>
            )}
            {preview.truncated ? (
              <p className="history-preview__limit" role="status">
                {t(
                  "Snapshot display is limited to the first 2,000 lines or 256k characters. Loading the version still uses the complete file.",
                )}
              </p>
            ) : null}
          </section>
          <HistoryLineDiff result={diff} />
          {diffState?.truncated ? (
            <p className="history-preview__limit" role="status">
              {t(
                "Difference display is limited to the first 800 lines or 128k characters of each version.",
              )}
            </p>
          ) : null}
        </div>
      ) : (
        <div
          className="history-preview__state history-preview__state--unavailable"
          role="status"
        >
          <span aria-hidden="true" className="history-preview__empty-mark">
            ···
          </span>
          <div>
            <strong>{t("Snapshot not loaded")}</strong>
            <span>{t("Select this version again to request its content.")}</span>
          </div>
        </div>
      )}
    </article>
  );
}

export function HistoryPanel({
  entries,
  selectedId,
  currentContent,
  onSelect,
  onLoadVersion,
  loading = false,
  previewLoading = false,
  error,
  onRetry,
  heading,
  fileName,
  emptyState,
  loadingState,
  previewLoadingState,
  previewEmptyState,
  retryLabel,
  loadLabel,
  loadIcon,
  ariaLabel,
  className,
}: HistoryPanelProps) {
  const { fmt, t } = useI18n();
  const resolvedHeading = heading === undefined ? t("File history") : heading;
  const resolvedEmptyState =
    emptyState === undefined ? t("No saved versions yet") : emptyState;
  const resolvedLoadingState =
    loadingState === undefined ? t("Loading file history…") : loadingState;
  const resolvedRetryLabel = retryLabel ?? t("Try again");
  const selectedEntry =
    entries.find(({ id }) => id === selectedId) ?? null;

  let body: ReactNode;
  if (error !== undefined && error !== null) {
    body = (
      <div className="history-panel__state history-panel__state--error" role="alert">
        <span aria-hidden="true" className="history-panel__state-mark">
          !
        </span>
        <div className="history-panel__state-copy">
          <strong>{t("History unavailable")}</strong>
          <div className="history-panel__state-detail">{error}</div>
        </div>
        {onRetry ? (
          <button
            className="history-panel__retry"
            onClick={onRetry}
            type="button"
          >
            {resolvedRetryLabel}
          </button>
        ) : null}
      </div>
    );
  } else if (loading) {
    body = (
      <div className="history-panel__state" role="status">
        <span aria-hidden="true" className="history-panel__spinner" />
        <div className="history-panel__state-detail">{resolvedLoadingState}</div>
      </div>
    );
  } else if (entries.length === 0) {
    body = (
      <div className="history-panel__state" role="status">
        <span aria-hidden="true" className="history-panel__state-mark">
          00
        </span>
        <div className="history-panel__state-copy">
          <div className="history-panel__state-title">{resolvedEmptyState}</div>
          <div className="history-panel__state-detail">
            {t("Versions will appear here as the document changes.")}
          </div>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="history-panel__layout">
        <HistoryList
          entries={entries}
          onSelect={onSelect}
          selectedId={selectedId}
        />
        <HistoryVersionPreview
          currentContent={currentContent}
          emptyState={previewEmptyState}
          entry={selectedEntry}
          loadIcon={loadIcon}
          loadLabel={loadLabel}
          loading={previewLoading}
          loadingState={previewLoadingState}
          onLoadVersion={onLoadVersion}
        />
      </div>
    );
  }

  return (
    <section
      aria-busy={loading}
      aria-label={ariaLabel ?? t("File history")}
      className={joinClassNames("history-panel", className)}
    >
      <header className="history-panel__header">
        <div className="history-panel__heading">
          <span className="history-panel__eyebrow">{t("Local revisions")}</span>
          <h2 className="history-panel__title">{resolvedHeading}</h2>
        </div>
        {fileName ? (
          <div
            className="history-panel__file"
            title={typeof fileName === "string" ? fileName : undefined}
          >
            {fileName}
          </div>
        ) : null}
        <div
          aria-label={fmt(
            entries.length === 1 ? "%d saved version" : "%d saved versions",
            entries.length,
          )}
          className="history-panel__total"
        >
          <span>{String(entries.length).padStart(2, "0")}</span>
          <small>{t("versions")}</small>
        </div>
      </header>
      <div className="history-panel__body">{body}</div>
    </section>
  );
}
