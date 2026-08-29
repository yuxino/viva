import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { cx } from "./utils";
import "./ui.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "small" | "medium" | "large";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: ReactNode;
  endIcon?: ReactNode;
  loading?: boolean;
  size?: ButtonSize;
  startIcon?: ReactNode;
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      children,
      className,
      disabled,
      endIcon,
      loading = false,
      size = "medium",
      startIcon,
      type = "button",
      variant = "secondary",
      ...props
    },
    ref,
  ) {
    return (
      <button
        {...props}
        aria-busy={loading || undefined}
        className={cx("viva-button", loading && "is-loading", className)}
        data-size={size}
        data-variant={variant}
        disabled={disabled || loading}
        ref={ref}
        type={type}
      >
        <span className="viva-button__content">
          {startIcon ? (
            <span aria-hidden="true" className="viva-button__icon">
              {startIcon}
            </span>
          ) : null}
          <span className="viva-button__label">{children}</span>
          {endIcon ? (
            <span aria-hidden="true" className="viva-button__icon">
              {endIcon}
            </span>
          ) : null}
        </span>
        {loading ? (
          <span aria-hidden="true" className="viva-spinner viva-button__spinner" />
        ) : null}
      </button>
    );
  },
);
