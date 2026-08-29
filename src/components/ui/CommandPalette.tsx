import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { SearchIcon } from "../icons";
import { useI18n } from "../../i18n";
import "./ui.css";

export interface CommandPaletteItem {
  detail?: string;
  disabled?: boolean;
  icon?: ReactNode;
  id: string;
  keywords?: ReadonlyArray<string>;
  label: string;
  onSelect: () => void;
  section?: string;
  shortcut?: string;
}

export interface CommandPaletteProps {
  emptyMessage?: string;
  footer?: ReactNode;
  items: ReadonlyArray<CommandPaletteItem>;
  label?: string;
  maxResults?: number;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  placeholder?: string;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function rank(item: CommandPaletteItem, query: string): number {
  const label = normalize(item.label);
  if (!query) return 0;
  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (label.split(/\s+/).some((word) => word.startsWith(query))) return 2;
  if (label.includes(query)) return 3;
  if (item.keywords?.some((keyword) => normalize(keyword).includes(query))) {
    return 4;
  }
  return Number.POSITIVE_INFINITY;
}

export function CommandPalette({
  emptyMessage,
  footer,
  items,
  label,
  maxResults = 12,
  onOpenChange,
  open,
  placeholder,
}: CommandPaletteProps) {
  const { fmt, t } = useI18n();
  const resolvedEmptyMessage = emptyMessage ?? t("No matching commands");
  const resolvedLabel = label ?? t("Command palette");
  const resolvedPlaceholder = placeholder ?? t("Search files and commands");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const optionIdPrefix = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const visibleItems = useMemo(() => {
    const normalizedQuery = normalize(query);
    return items
      .map((item, originalIndex) => ({
        item,
        originalIndex,
        score: rank(item, normalizedQuery),
      }))
      .filter(({ score }) => Number.isFinite(score))
      .sort(
        (left, right) =>
          left.score - right.score || left.originalIndex - right.originalIndex,
      )
      .slice(0, maxResults)
      .map(({ item }) => item);
  }, [items, maxResults, query]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      setQuery("");
      setActiveIndex(0);
      queueMicrotask(() => inputRef.current?.focus());
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  useEffect(() => {
    const firstEnabled = visibleItems.findIndex((item) => !item.disabled);
    setActiveIndex(firstEnabled < 0 ? 0 : firstEnabled);
  }, [query, visibleItems]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const moveActive = (direction: 1 | -1) => {
    if (!visibleItems.length) return;
    for (let offset = 1; offset <= visibleItems.length; offset += 1) {
      const index =
        (activeIndex + direction * offset + visibleItems.length) %
        visibleItems.length;
      if (!visibleItems[index]?.disabled) {
        setActiveIndex(index);
        return;
      }
    }
  };

  const select = (item: CommandPaletteItem | undefined) => {
    if (!item || item.disabled) return;
    item.onSelect();
    onOpenChange(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(visibleItems[activeIndex]);
    }
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.button === 0 && event.target === event.currentTarget) {
      onOpenChange(false);
    }
  };

  return (
    <dialog
      aria-label={resolvedLabel}
      className="viva-command-palette"
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onMouseDown={handleBackdropClick}
      ref={dialogRef}
    >
      <div className="viva-command-palette__surface">
        <div className="viva-command-palette__search">
          <SearchIcon aria-hidden="true" size={18} />
          <input
            aria-activedescendant={
              visibleItems[activeIndex]
                ? `${optionIdPrefix}-${activeIndex}`
                : undefined
            }
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded="true"
            aria-label={resolvedLabel}
            autoComplete="off"
            className="viva-command-palette__input"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={resolvedPlaceholder}
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            type="search"
            value={query}
          />
        </div>
        <div
          aria-label={fmt("%@: %@", resolvedLabel, t("Search results"))}
          className="viva-command-palette__results viva-scroll-region"
          id={listboxId}
          role="listbox"
        >
          {visibleItems.length ? (
            visibleItems.map((item, index) => {
              const previousSection = visibleItems[index - 1]?.section;
              const showSection = item.section && item.section !== previousSection;
              const active = index === activeIndex;
              return (
                <div className="viva-command-palette__entry" key={item.id}>
                  {showSection ? (
                    <div
                      aria-hidden="true"
                      className="viva-command-palette__section"
                    >
                      {item.section}
                    </div>
                  ) : null}
                  <button
                    aria-disabled={item.disabled || undefined}
                    aria-selected={active}
                    className="viva-command-palette__item"
                    data-active={active || undefined}
                    disabled={item.disabled}
                    id={`${optionIdPrefix}-${index}`}
                    onClick={() => select(item)}
                    onMouseMove={() => {
                      if (!item.disabled) setActiveIndex(index);
                    }}
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    role="option"
                    tabIndex={-1}
                    type="button"
                  >
                    {item.icon ? (
                      <span
                        aria-hidden="true"
                        className="viva-command-palette__icon"
                      >
                        {item.icon}
                      </span>
                    ) : null}
                    <span className="viva-command-palette__copy">
                      <span className="viva-command-palette__label">
                        {item.label}
                      </span>
                      {item.detail ? (
                        <span className="viva-command-palette__detail">
                          {item.detail}
                        </span>
                      ) : null}
                    </span>
                    {item.shortcut ? (
                      <kbd className="viva-command-palette__shortcut">
                        {item.shortcut}
                      </kbd>
                    ) : null}
                  </button>
                </div>
              );
            })
          ) : (
            <div className="viva-command-palette__empty" role="status">
              {resolvedEmptyMessage}
            </div>
          )}
        </div>
        {footer ? (
          <footer className="viva-command-palette__footer">{footer}</footer>
        ) : null}
      </div>
    </dialog>
  );
}
