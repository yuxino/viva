import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Tooltip, type TooltipPlacement } from "./Tooltip";
import { cx } from "./utils";
import "./ui.css";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> {
  children: ReactNode;
  label: string;
  selected?: boolean;
  shortcut?: string;
  size?: "small" | "medium" | "large";
  tooltip?: ReactNode | false;
  tooltipPlacement?: TooltipPlacement;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      children,
      className,
      label,
      selected,
      shortcut,
      size = "medium",
      tooltip,
      tooltipPlacement = "top",
      type = "button",
      ...props
    },
    ref,
  ) {
    const button = (
      <button
        {...props}
        aria-label={label}
        aria-pressed={selected === undefined ? undefined : selected}
        className={cx("viva-icon-button", className)}
        data-size={size}
        data-selected={selected || undefined}
        ref={ref}
        type={type}
      >
        <span aria-hidden="true" className="viva-icon-button__icon">
          {children}
        </span>
      </button>
    );

    if (tooltip === false) return button;

    return (
      <Tooltip
        content={tooltip ?? label}
        placement={tooltipPlacement}
        shortcut={shortcut}
      >
        {button}
      </Tooltip>
    );
  },
);
