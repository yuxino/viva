import {
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useI18n } from "../../i18n";
import type { OutlineItem } from "../../lib/markdown";

export interface OutlinePanelProps {
  items: readonly OutlineItem[];
  activeSourceLine?: number | null;
  onSelect: (item: OutlineItem) => void;
  heading?: ReactNode;
  emptyState?: ReactNode;
  ariaLabel?: string;
  className?: string;
}

function joinClassNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function OutlinePanel({
  items,
  activeSourceLine = null,
  onSelect,
  heading,
  emptyState,
  ariaLabel,
  className,
}: OutlinePanelProps) {
  const { fmt, t } = useI18n();
  const resolvedHeading = heading === undefined ? t("Outline") : heading;
  const resolvedEmptyState =
    emptyState === undefined
      ? t("Add a heading to build an outline")
      : emptyState;
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeIndex = useMemo(() => {
    if (activeSourceLine == null) return -1;
    let index = -1;
    for (let candidateIndex = 0; candidateIndex < items.length; candidateIndex += 1) {
      const candidate = items[candidateIndex];
      if (!candidate || candidate.sourceLine > activeSourceLine) break;
      index = candidateIndex;
    }
    return index;
  }, [activeSourceLine, items]);

  function itemKey(item: OutlineItem): string {
    return `${item.id}:${item.sourceLine}`;
  }

  function focusItem(index: number): void {
    const item = items[index];
    if (!item) return;
    itemRefs.current.get(itemKey(item))?.focus();
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(Math.min(index + 1, items.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        focusItem(0);
        break;
      case "End":
        event.preventDefault();
        focusItem(items.length - 1);
        break;
    }
  }

  return (
    <nav
      aria-label={ariaLabel ?? t("Document outline")}
      className={joinClassNames("outline-panel", className)}
    >
      {resolvedHeading ? (
        <h2 className="outline-panel__heading">{resolvedHeading}</h2>
      ) : null}
      {items.length > 0 ? (
        <ol className="outline-panel__list viva-scroll-region">
          {items.map((item, index) => {
            const active = index === activeIndex;
            const key = itemKey(item);
            return (
              <li
                className={joinClassNames(
                  "outline-panel__item",
                  `outline-panel__item--level-${item.level}`,
                  active && "is-active",
                )}
                key={key}
              >
                <button
                  aria-current={active ? "location" : undefined}
                  className="outline-panel__button"
                  onClick={() => onSelect(item)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  ref={(element) => {
                    if (element) itemRefs.current.set(key, element);
                    else itemRefs.current.delete(key);
                  }}
                  tabIndex={active || (activeIndex < 0 && index === 0) ? 0 : -1}
                  title={fmt("%@: %@", item.text, fmt("%d line", item.sourceLine))}
                  type="button"
                >
                  <span aria-hidden="true" className="outline-panel__marker">
                    H{item.level}
                  </span>
                  <span className="outline-panel__label">{item.text}</span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="outline-panel__empty" role="status">
          {resolvedEmptyState}
        </div>
      )}
    </nav>
  );
}
