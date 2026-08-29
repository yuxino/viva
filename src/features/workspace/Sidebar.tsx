import type { ReactNode } from "react";
import { useI18n } from "../../i18n";

export interface SidebarProps {
  title: ReactNode;
  children: ReactNode;
  headerActions?: ReactNode;
  footer?: ReactNode;
  hidden?: boolean;
  ariaLabel?: string;
  className?: string;
}

function joinClassNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function Sidebar({
  title,
  children,
  headerActions,
  footer,
  hidden = false,
  ariaLabel,
  className,
}: SidebarProps) {
  const { t } = useI18n();
  return (
    <aside
      aria-label={ariaLabel ?? t("Workspace sidebar")}
      className={joinClassNames(
        "workspace-sidebar",
        hidden && "is-hidden",
        className,
      )}
      hidden={hidden}
    >
      <header className="workspace-sidebar__header">
        <h2 className="workspace-sidebar__title">{title}</h2>
        {headerActions ? (
          <div className="workspace-sidebar__actions">{headerActions}</div>
        ) : null}
      </header>
      <div className="workspace-sidebar__body viva-scroll-region">
        {children}
      </div>
      {footer ? (
        <footer className="workspace-sidebar__footer">{footer}</footer>
      ) : null}
    </aside>
  );
}
