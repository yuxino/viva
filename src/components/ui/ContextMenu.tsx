import {
  Children,
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu as NativeMenu, type MenuOptions } from "@tauri-apps/api/menu";
import type { MenuItem } from "./Menu";
import { cx } from "./utils";
import "./ui.css";

interface ContextMenuTriggerProps {
  onContextMenu?: MouseEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
}

export interface ContextMenuProps {
  children: ReactElement<ContextMenuTriggerProps>;
  items: ReadonlyArray<MenuItem>;
  label: string;
  preferCustomTextMenu?: boolean;
}

interface MenuRequest {
  left: number;
  top: number;
  trigger: HTMLElement;
}

export function ContextMenu({
  children,
  items,
  label,
  preferCustomTextMenu = false,
}: ContextMenuProps) {
  const id = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [request, setRequest] = useState<MenuRequest | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const close = useCallback((restoreFocus = false) => {
    setRequest((current) => {
      if (restoreFocus) current?.trigger.focus();
      return null;
    });
  }, []);

  const enabledIndexes = useCallback(
    () =>
      items
        .map((item, index) => (item.disabled ? -1 : index))
        .filter((index) => index >= 0),
    [items],
  );

  const focusBoundary = useCallback(
    (edge: "first" | "last") => {
      const indexes = enabledIndexes();
      const index = edge === "first" ? indexes[0] : indexes.at(-1);
      if (index === undefined) return false;
      itemRefs.current[index]?.focus();
      return true;
    },
    [enabledIndexes],
  );

  useLayoutEffect(() => {
    if (!request) return;
    const menu = menuRef.current;
    if (!menu) return;
    const edge = 8;
    const rect = menu.getBoundingClientRect();
    setPosition({
      left: Math.min(
        window.innerWidth - rect.width - edge,
        Math.max(edge, request.left),
      ),
      top: Math.min(
        window.innerHeight - rect.height - edge,
        Math.max(edge, request.top),
      ),
    });
    if (!focusBoundary("first")) menu.focus();
  }, [focusBoundary, request]);

  useEffect(() => {
    if (!request) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close(false);
    };
    const handleWindowChange = () => close(false);
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("blur", handleWindowChange);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("blur", handleWindowChange);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [close, request]);

  function moveFocus(currentIndex: number, direction: 1 | -1): void {
    const indexes = enabledIndexes();
    const current = indexes.indexOf(currentIndex);
    if (current < 0 || !indexes.length) return;
    const next = (current + direction + indexes.length) % indexes.length;
    const nextIndex = indexes[next];
    if (nextIndex !== undefined) itemRefs.current[nextIndex]?.focus();
  }

  function handleMenuKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(index, 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(index, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusBoundary("first");
    } else if (event.key === "End") {
      event.preventDefault();
      focusBoundary("last");
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  }

  function handleMenuSurfaceKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
  ): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  }

  const trigger = Children.only(children);

  async function openNativeMenu(menuRequest: MenuRequest): Promise<void> {
    const nativeItems: NonNullable<MenuOptions["items"]> = [];
    for (const item of items) {
      if (item.separatorBefore) nativeItems.push({ item: "Separator" });
      nativeItems.push({
        action: item.onSelect,
        enabled: !item.disabled,
        id: item.id,
        text: item.label,
      });
    }
    const menu = await NativeMenu.new({ items: nativeItems });
    try {
      await menu.popup(
        new LogicalPosition(menuRequest.left, menuRequest.top),
      );
    } finally {
      await menu.close().catch(() => undefined);
    }
  }

  function openWebMenu(menuRequest: MenuRequest): void {
    setPosition({ left: menuRequest.left, top: menuRequest.top });
    setRequest(menuRequest);
  }

  function openRequestedMenu(menuRequest: MenuRequest): void {
    if (isTauri()) {
      void openNativeMenu(menuRequest).catch(() => openWebMenu(menuRequest));
      return;
    }
    openWebMenu(menuRequest);
  }

  function isNativeTextTarget(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  return (
    <>
      {cloneElement(trigger, {
        onContextMenu: (event) => {
          trigger.props.onContextMenu?.(event);
          if (event.defaultPrevented) return;
          if (
            isTauri() &&
            isNativeTextTarget(event.target) &&
            !preferCustomTextMenu
          ) {
            return;
          }
          event.preventDefault();
          openRequestedMenu({
            left: event.clientX,
            top: event.clientY,
            trigger: event.currentTarget,
          });
        },
        onKeyDown: (event) => {
          trigger.props.onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (
            (event.shiftKey && event.key === "F10") ||
            event.key === "ContextMenu"
          ) {
            if (
              isTauri() &&
              isNativeTextTarget(event.target) &&
              !preferCustomTextMenu
            ) {
              return;
            }
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            openRequestedMenu({
              left: rect.left + 12,
              top: rect.top + 12,
              trigger: event.currentTarget,
            });
          }
        },
      })}
      {request && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-label={label}
              className="viva-menu viva-context-menu"
              id={id}
              onKeyDown={handleMenuSurfaceKeyDown}
              ref={menuRef}
              role="menu"
              style={position}
              tabIndex={-1}
            >
              {items.map((item, index) => (
                <div className="viva-menu__entry" key={item.id}>
                  {item.separatorBefore ? (
                    <div className="viva-menu__separator" role="separator" />
                  ) : null}
                  <button
                    className={cx("viva-menu__item", item.danger && "is-danger")}
                    disabled={item.disabled}
                    onClick={() => {
                      request.trigger.focus({ preventScroll: true });
                      item.onSelect();
                      close(false);
                    }}
                    onKeyDown={(event) => handleMenuKeyDown(event, index)}
                    ref={(element) => {
                      itemRefs.current[index] = element;
                    }}
                    role="menuitem"
                    tabIndex={-1}
                    type="button"
                  >
                    <span aria-hidden="true" className="viva-menu__check" />
                    {item.icon ? (
                      <span aria-hidden="true" className="viva-menu__icon">
                        {item.icon}
                      </span>
                    ) : null}
                    <span className="viva-menu__label">{item.label}</span>
                    {item.shortcut ? (
                      <kbd className="viva-menu__shortcut">{item.shortcut}</kbd>
                    ) : null}
                  </button>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
