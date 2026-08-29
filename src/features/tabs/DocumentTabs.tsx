import {
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ContextMenu, type MenuItem } from "../../components/ui";
import { useI18n } from "../../i18n";

export interface DocumentTabItem {
  id: string;
  label: string;
  dirty?: boolean;
  title?: string;
}

export interface DocumentTabsProps {
  tabs: readonly DocumentTabItem[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onSave?: (id: string) => void;
  onSaveAs?: (id: string) => void;
  closeIcon?: ReactNode;
  ariaLabel?: string;
  className?: string;
}

function joinClassNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function DocumentTabs({
  tabs,
  activeId,
  onActivate,
  onClose,
  onSave,
  onSaveAs,
  closeIcon = "×",
  ariaLabel,
  className,
}: DocumentTabsProps) {
  const { fmt, t } = useI18n();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedId = tabs.some(({ id }) => id === activeId)
    ? activeId
    : (tabs[0]?.id ?? null);

  function focusAndActivate(index: number): void {
    const tab = tabs[index];
    if (!tab) return;
    onActivate(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    tab: DocumentTabItem,
  ): void {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        focusAndActivate((index + 1) % tabs.length);
        break;
      case "ArrowLeft":
        event.preventDefault();
        focusAndActivate((index - 1 + tabs.length) % tabs.length);
        break;
      case "Home":
        event.preventDefault();
        focusAndActivate(0);
        break;
      case "End":
        event.preventDefault();
        focusAndActivate(tabs.length - 1);
        break;
      case "Delete":
        event.preventDefault();
        onClose(tab.id);
        break;
    }
  }

  function handleAuxClick(
    event: MouseEvent<HTMLButtonElement>,
    id: string,
  ): void {
    if (event.button !== 1) return;
    event.preventDefault();
    onClose(id);
  }

  return (
    <div
      aria-label={ariaLabel ?? t("Open documents")}
      className={joinClassNames("document-tabs", className)}
      role="tablist"
    >
      {tabs.map((tab, index) => {
        const active = tab.id === selectedId;
        const contextItems: MenuItem[] = [
          {
            disabled: !tab.dirty || !onSave,
            id: "save",
            label: t("Save"),
            onSelect: () => onSave?.(tab.id),
          },
          {
            disabled: !onSaveAs,
            id: "save-as",
            label: t("Save as…"),
            onSelect: () => onSaveAs?.(tab.id),
          },
          {
            id: "close",
            label: t("Close"),
            onSelect: () => onClose(tab.id),
            separatorBefore: true,
          },
        ];
        return (
          <ContextMenu items={contextItems} key={tab.id} label={t("Tab menu")}>
            <div
              className={joinClassNames(
                "document-tabs__item",
                active && "is-active",
                tab.dirty && "is-dirty",
              )}
            >
            <button
              aria-selected={active}
              className="document-tabs__tab"
              onAuxClick={(event) => handleAuxClick(event, tab.id)}
              onClick={() => onActivate(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index, tab)}
              ref={(element) => {
                if (element) tabRefs.current.set(tab.id, element);
                else tabRefs.current.delete(tab.id);
              }}
              role="tab"
              tabIndex={active ? 0 : -1}
              title={tab.title ?? tab.label}
              type="button"
            >
              <span className="document-tabs__label">{tab.label}</span>
              {tab.dirty ? (
                <span
                  aria-label={t("Unsaved changes")}
                  className="document-tabs__dirty"
                >
                  {t("Modified")}
                </span>
              ) : null}
            </button>
            <button
              aria-label={fmt("Close %@", tab.label)}
              className="document-tabs__close"
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
              tabIndex={-1}
              type="button"
            >
              <span aria-hidden="true">{closeIcon}</span>
            </button>
            </div>
          </ContextMenu>
        );
      })}
    </div>
  );
}
