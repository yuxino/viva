import type { ReactNode } from "react";
import { useI18n } from "../../i18n";

export type StatusTone = "neutral" | "progress" | "success" | "error";

export interface StatusBarProps {
  line?: number;
  column?: number;
  wordCount?: number;
  readingMinutes?: number;
  encoding?: ReactNode;
  lineEnding?: ReactNode;
  message?: ReactNode;
  messageTone?: StatusTone;
  leading?: ReactNode;
  trailing?: ReactNode;
  ariaLabel?: string;
  className?: string;
}

function joinClassNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function StatusBar({
  line,
  column,
  wordCount,
  readingMinutes,
  encoding,
  lineEnding,
  message,
  messageTone = "neutral",
  leading,
  trailing,
  ariaLabel,
  className,
}: StatusBarProps) {
  const { fmt, t } = useI18n();
  return (
    <footer
      aria-label={ariaLabel ?? t("Document status")}
      className={joinClassNames("status-bar", className)}
    >
      <div className="status-bar__group status-bar__group--leading">
        {leading}
        {message ? (
          <output
            aria-live="polite"
            className={joinClassNames(
              "status-bar__message",
              `status-bar__message--${messageTone}`,
            )}
          >
            {message}
          </output>
        ) : null}
      </div>
      <div className="status-bar__group status-bar__group--trailing">
        {line !== undefined && column !== undefined ? (
          <span className="status-bar__item status-bar__cursor">
            {fmt("Ln %d, Col %d", line, column)}
          </span>
        ) : null}
        {wordCount !== undefined ? (
          <span className="status-bar__item status-bar__words">
            {fmt(wordCount === 1 ? "%d word" : "%d words", wordCount)}
          </span>
        ) : null}
        {readingMinutes !== undefined ? (
          <span className="status-bar__item status-bar__reading-time">
            {fmt("%d min read", readingMinutes)}
          </span>
        ) : null}
        {encoding ? (
          <span className="status-bar__item status-bar__encoding">
            {encoding}
          </span>
        ) : null}
        {lineEnding ? (
          <span className="status-bar__item status-bar__line-ending">
            {lineEnding}
          </span>
        ) : null}
        {trailing}
      </div>
    </footer>
  );
}
