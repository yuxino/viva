import type { ReactNode } from "react";
import { cx } from "./utils";
import "./ui.css";

export interface EmptyStateProps {
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
}

export function EmptyState({
  actions,
  className,
  compact = false,
  description,
  icon,
  title,
}: EmptyStateProps) {
  return (
    <section
      className={cx("viva-empty-state", compact && "is-compact", className)}
    >
      {icon ? (
        <span aria-hidden="true" className="viva-empty-state__icon">
          {icon}
        </span>
      ) : null}
      <h2 className="viva-empty-state__title">{title}</h2>
      {description ? (
        <div className="viva-empty-state__description">{description}</div>
      ) : null}
      {actions ? (
        <div className="viva-empty-state__actions">{actions}</div>
      ) : null}
    </section>
  );
}
