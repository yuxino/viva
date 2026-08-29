import {
  Children,
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { joinIds } from "./utils";
import "./ui.css";

export type TooltipPlacement = "top" | "right" | "bottom" | "left";

interface TooltipChildProps {
  "aria-describedby"?: string;
}

export interface TooltipProps {
  children: ReactElement<TooltipChildProps>;
  content: ReactNode;
  delay?: number;
  disabled?: boolean;
  placement?: TooltipPlacement;
  shortcut?: string;
}

interface TooltipPosition {
  left: number;
  placement: TooltipPlacement;
  top: number;
}

export function Tooltip({
  children,
  content,
  delay = 450,
  disabled = false,
  placement = "top",
  shortcut,
}: TooltipProps) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({
    left: 0,
    placement,
    top: 0,
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const edge = 12;
    let resolved = placement;

    if (placement === "top" && rect.top < 48) resolved = "bottom";
    if (placement === "bottom" && window.innerHeight - rect.bottom < 48) {
      resolved = "top";
    }
    if (placement === "left" && rect.left < 120) resolved = "right";
    if (placement === "right" && window.innerWidth - rect.right < 120) {
      resolved = "left";
    }

    const left =
      resolved === "left"
        ? rect.left - 8
        : resolved === "right"
          ? rect.right + 8
          : Math.min(
              window.innerWidth - edge,
              Math.max(edge, rect.left + rect.width / 2),
            );
    const top =
      resolved === "top"
        ? rect.top - 8
        : resolved === "bottom"
          ? rect.bottom + 8
          : Math.min(
              window.innerHeight - edge,
              Math.max(edge, rect.top + rect.height / 2),
            );

    setPosition({ left, placement: resolved, top });
  }, [placement]);

  const show = useCallback(
    (immediate = false) => {
      if (disabled || !content) return;
      clearTimer();
      timerRef.current = setTimeout(
        () => {
          updatePosition();
          setOpen(true);
        },
        immediate ? 0 : delay,
      );
    },
    [clearTimer, content, delay, disabled, updatePosition],
  );

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (!open) return;

    const handleViewportChange = () => updatePosition();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [hide, open, updatePosition]);

  const handleBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      hide();
    }
  };

  const handlePointerLeave = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.pointerType !== "touch") hide();
  };

  const onlyChild = Children.only(children);
  const describedBy = open
    ? joinIds(onlyChild.props["aria-describedby"], id)
    : onlyChild.props["aria-describedby"];

  return (
    <span
      className="viva-tooltip-anchor"
      onBlurCapture={handleBlur}
      onFocusCapture={() => show(true)}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") show(false);
      }}
      onPointerLeave={handlePointerLeave}
      ref={anchorRef}
    >
      {cloneElement(onlyChild, { "aria-describedby": describedBy })}
      {open && typeof document !== "undefined"
        ? createPortal(
            <span
              className="viva-tooltip"
              data-placement={position.placement}
              id={id}
              role="tooltip"
              style={{ left: position.left, top: position.top }}
            >
              <span>{content}</span>
              {shortcut ? (
                <kbd className="viva-tooltip__shortcut">{shortcut}</kbd>
              ) : null}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
