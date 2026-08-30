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
import { isImeKeyEvent } from "../../lib/keyboard";
import "./ui.css";

export interface CommandPaletteDataItem {
  detail?: string;
  disabled?: boolean;
  id: string;
  keywords?: ReadonlyArray<string>;
  label: string;
  searchText?: string;
  section?: string;
  shortcut?: string;
  value?: string;
}

export interface CommandPaletteItem extends CommandPaletteDataItem {
  icon?: ReactNode;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  emptyMessage?: string;
  footer?: ReactNode;
  items: ReadonlyArray<CommandPaletteDataItem | CommandPaletteItem>;
  label?: string;
  maxResults?: number;
  onItemSelect?: (item: CommandPaletteDataItem) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  placeholder?: string;
  renderItemIcon?: (item: CommandPaletteDataItem) => ReactNode;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

interface IndexedCommandPaletteItem {
  item: CommandPaletteDataItem | CommandPaletteItem;
  label: string;
  searchText: string;
  wordStarts: string;
}

function indexItem(
  item: CommandPaletteDataItem | CommandPaletteItem,
): IndexedCommandPaletteItem {
  const label = normalize(item.label);
  return {
    item,
    label,
    searchText: normalize(
      [item.searchText, ...(item.keywords ?? [])].filter(Boolean).join("\n"),
    ),
    wordStarts: `\n${label.replace(/\s+/g, "\n")}`,
  };
}

function rank(item: IndexedCommandPaletteItem, query: string): number {
  const { label } = item;
  if (!query) return 0;
  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (item.wordStarts.includes(`\n${query}`)) return 2;
  if (label.includes(query)) return 3;
  if (item.searchText.includes(query)) return 4;
  return Number.POSITIVE_INFINITY;
}

function findTopMatches(
  items: readonly IndexedCommandPaletteItem[],
  query: string,
  maxResults: number,
): Array<CommandPaletteDataItem | CommandPaletteItem> {
  const limit = Math.max(0, Math.floor(maxResults));
  if (limit === 0) return [];

  // Ranks are a fixed 0...4 scale. Keeping at most `limit` candidates per
  // bucket preserves stable source order without allocating or sorting every
  // match in a large workspace on each keystroke.
  const buckets: IndexedCommandPaletteItem[][] = Array.from(
    { length: 5 },
    () => [],
  );
  for (const item of items) {
    const score = rank(item, query);
    if (!Number.isFinite(score)) continue;
    const bucket = buckets[score];
    if (bucket && bucket.length < limit) bucket.push(item);
  }

  const matches: Array<CommandPaletteDataItem | CommandPaletteItem> = [];
  for (const bucket of buckets) {
    for (const indexedItem of bucket) {
      matches.push(indexedItem.item);
      if (matches.length === limit) return matches;
    }
  }
  return matches;
}

function isActionableItem(
  item: CommandPaletteDataItem | CommandPaletteItem,
): item is CommandPaletteItem {
  return "onSelect" in item && typeof item.onSelect === "function";
}

export function CommandPalette({
  emptyMessage,
  footer,
  items,
  label,
  maxResults = 12,
  onItemSelect,
  onOpenChange,
  open,
  placeholder,
  renderItemIcon,
}: CommandPaletteProps) {
  const { fmt, t } = useI18n();
  const resolvedEmptyMessage = emptyMessage ?? t("No matching commands");
  const resolvedLabel = label ?? t("Command palette");
  const resolvedPlaceholder = placeholder ?? t("Search files and commands");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const composingRef = useRef(false);
  const suppressImeCancelRef = useRef(false);
  const listboxId = useId();
  const optionIdPrefix = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const indexedItems = useMemo(() => items.map(indexItem), [items]);

  const visibleItems = useMemo(
    () => findTopMatches(indexedItems, normalize(query), maxResults),
    [indexedItems, maxResults, query],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      setQuery("");
      setActiveIndex(0);
      composingRef.current = false;
      suppressImeCancelRef.current = false;
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

  const select = (
    item: CommandPaletteDataItem | CommandPaletteItem | undefined,
  ) => {
    if (!item || item.disabled) return;
    if (isActionableItem(item)) item.onSelect();
    else if (onItemSelect) onItemSelect(item);
    else return;
    onOpenChange(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeKeyEvent(event.nativeEvent)) {
      if (event.key === "Escape") suppressImeCancelRef.current = true;
      return;
    }
    suppressImeCancelRef.current = false;
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
    } else if (event.key === "ArrowDown") {
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
        if (composingRef.current || suppressImeCancelRef.current) {
          suppressImeCancelRef.current = false;
          return;
        }
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
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
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
              const icon = isActionableItem(item)
                ? (item.icon ?? renderItemIcon?.(item))
                : renderItemIcon?.(item);
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
                    {icon ? (
                      <span
                        aria-hidden="true"
                        className="viva-command-palette__icon"
                      >
                        {icon}
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
