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
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "../icons";
import { cx } from "./utils";
import "./ui.css";

interface MenuTriggerProps {
  "aria-controls"?: string;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "menu";
  onClick?: MouseEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
}

export interface MenuItem {
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  id: string;
  label: string;
  onSelect: () => void;
  separatorBefore?: boolean;
  shortcut?: string;
}

export interface MenuProps {
  align?: "start" | "end";
  children: ReactElement<MenuTriggerProps>;
  items: ReadonlyArray<MenuItem>;
  label: string;
  onOpenChange?: (open: boolean) => void;
}

interface MenuPosition {
  left: number;
  top: number;
}

export function Menu({
  align = "start",
  children,
  items,
  label,
  onOpenChange,
}: MenuProps) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pendingFocusRef = useRef<"first" | "last" | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ left: 0, top: 0 });

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

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
      const index = edge === "first" ? indexes[0] : indexes[indexes.length - 1];
      if (index !== undefined) itemRefs.current[index]?.focus();
    },
    [enabledIndexes],
  );

  const openMenu = useCallback(
    (focus: "first" | "last" = "first") => {
      pendingFocusRef.current = focus;
      setOpenState(true);
    },
    [setOpenState],
  );

  const closeMenu = useCallback(
    (restoreFocus = false) => {
      pendingFocusRef.current = null;
      setOpenState(false);
      if (restoreFocus) {
        const trigger = anchorRef.current?.firstElementChild as HTMLElement | null;
        trigger?.focus();
      }
    },
    [setOpenState],
  );

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;

    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const edge = 8;
    let left =
      align === "end" ? anchorRect.right - menuRect.width : anchorRect.left;
    let top = anchorRect.bottom + 6;

    left = Math.min(
      window.innerWidth - menuRect.width - edge,
      Math.max(edge, left),
    );
    if (top + menuRect.height > window.innerHeight - edge) {
      top = Math.max(edge, anchorRect.top - menuRect.height - 6);
    }

    setPosition({ left, top });
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    if (pendingFocusRef.current) {
      focusBoundary(pendingFocusRef.current);
      pendingFocusRef.current = null;
    }
  }, [focusBoundary, open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !anchorRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        closeMenu(false);
      }
    };
    const handleViewportChange = () => updatePosition();

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [closeMenu, open, updatePosition]);

  const moveFocus = (currentIndex: number, direction: 1 | -1) => {
    const indexes = enabledIndexes();
    const positionInEnabled = indexes.indexOf(currentIndex);
    if (positionInEnabled < 0 || !indexes.length) return;
    const next =
      (positionInEnabled + direction + indexes.length) % indexes.length;
    const nextIndex = indexes[next];
    if (nextIndex !== undefined) itemRefs.current[nextIndex]?.focus();
  };

  const handleMenuKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
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
      closeMenu(true);
    } else if (event.key === "Tab") {
      closeMenu(false);
    }
  };

  const trigger = Children.only(children);

  return (
    <span className="viva-menu-anchor" ref={anchorRef}>
      {cloneElement(trigger, {
        "aria-controls": open ? id : undefined,
        "aria-expanded": open,
        "aria-haspopup": "menu",
        onClick: (event) => {
          trigger.props.onClick?.(event);
          if (!event.defaultPrevented) {
            if (open) closeMenu(false);
            else openMenu("first");
          }
        },
        onKeyDown: (event) => {
          trigger.props.onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openMenu("first");
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openMenu("last");
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeMenu(false);
          }
        },
      })}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-label={label}
              className="viva-menu"
              id={id}
              ref={menuRef}
              role="menu"
              style={{ left: position.left, top: position.top }}
            >
              {items.map((item, index) => (
                <div className="viva-menu__entry" key={item.id}>
                  {item.separatorBefore ? (
                    <div className="viva-menu__separator" role="separator" />
                  ) : null}
                  <button
                    aria-checked={
                      item.checked === undefined ? undefined : item.checked
                    }
                    className={cx(
                      "viva-menu__item",
                      item.danger && "is-danger",
                    )}
                    disabled={item.disabled}
                    onClick={() => {
                      item.onSelect();
                      closeMenu(false);
                    }}
                    onKeyDown={(event) => handleMenuKeyDown(event, index)}
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    role={
                      item.checked === undefined ? "menuitem" : "menuitemcheckbox"
                    }
                    tabIndex={-1}
                    type="button"
                  >
                    <span aria-hidden="true" className="viva-menu__check">
                      {item.checked ? <CheckIcon size={16} /> : null}
                    </span>
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
    </span>
  );
}
