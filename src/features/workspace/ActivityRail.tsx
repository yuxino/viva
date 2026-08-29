import type { ReactNode } from "react";
import type { Activity } from "../../domain/workspace";
import { useI18n } from "../../i18n";

export interface ActivityRailItem {
  id: Activity;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
}

export interface ActivityRailProps {
  items: readonly ActivityRailItem[];
  activeId: Activity;
  onSelect: (id: Activity) => void;
  footer?: ReactNode;
  ariaLabel?: string;
  className?: string;
}

function joinClassNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function ActivityRail({
  items,
  activeId,
  onSelect,
  footer,
  ariaLabel,
  className,
}: ActivityRailProps) {
  const { t } = useI18n();
  return (
    <nav
      aria-label={ariaLabel ?? t("Workspace views")}
      className={joinClassNames("activity-rail", className)}
    >
      <div className="activity-rail__items">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              className={joinClassNames(
                "activity-rail__item",
                active && "is-active",
              )}
              key={item.id}
              onClick={() => onSelect(item.id)}
              title={item.label}
              type="button"
            >
              <span aria-hidden="true" className="activity-rail__icon">
                {item.icon ?? item.label.slice(0, 1)}
              </span>
              {item.badge !== undefined ? (
                <span className="activity-rail__badge">{item.badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {footer ? <div className="activity-rail__footer">{footer}</div> : null}
    </nav>
  );
}
