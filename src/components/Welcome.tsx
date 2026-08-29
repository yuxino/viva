import { FolderOpenIcon, PlusIcon } from "./icons";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";
import type { RecentWorkspace } from "../lib/session";
import { useI18n } from "../i18n";

export interface WelcomeProps {
  busy: boolean;
  onNewDocument: () => void;
  onOpenFolder: () => void;
  onOpenRecent: (path: string) => void;
  recentWorkspaces: RecentWorkspace[];
}

export function Welcome({
  busy,
  onNewDocument,
  onOpenFolder,
  onOpenRecent,
  recentWorkspaces,
}: WelcomeProps) {
  const { t } = useI18n();
  return (
    <main className="welcome" aria-label={t("Viva welcome")}>
      <div className="welcome__mark" aria-hidden="true">
        <img
          alt=""
          decoding="async"
          height="360"
          src="/art/viva-character-logo.jpg"
          width="360"
        />
      </div>
      <EmptyState
        actions={
          <>
            <Button
              loading={busy}
              onClick={onOpenFolder}
              startIcon={<FolderOpenIcon />}
              variant="primary"
            >
              {t("Open folder")}
            </Button>
            <Button
              disabled
              onClick={onNewDocument}
              startIcon={<PlusIcon />}
              title={t("Open a folder before creating a note")}
              variant="ghost"
            >
              {t("New note")}
            </Button>
          </>
        }
        description={t(
          "Open a folder of Markdown files. Everything stays on this computer.",
        )}
        title={t("A quiet place for local notes")}
      />

      {recentWorkspaces.length > 0 ? (
        <section className="welcome__recent" aria-labelledby="recent-title">
          <h2 id="recent-title">{t("Recent folders")}</h2>
          <div className="welcome__recent-list">
            {recentWorkspaces.map((workspace) => (
              <button
                className="welcome__recent-item"
                key={workspace.path}
                onClick={() => onOpenRecent(workspace.path)}
                type="button"
              >
                <span>{workspace.name}</span>
                <span>{workspace.path}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
