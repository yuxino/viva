import { useMemo, useState } from "react";
import essay from "../../fixtures/field-notes/01 · A Quiet Interface.md?raw";
import rhythm from "../../fixtures/field-notes/02 · Interaction Rhythm.md?raw";
import tools from "../../fixtures/field-notes/03 · Small Tools.md?raw";
import {
  EditIcon,
  FileMarkdownIcon,
  FilesIcon,
  FolderIcon,
  HistoryIcon,
  LiveIcon,
  OutlineIcon,
  PreviewIcon,
  SearchIcon,
  SettingsIcon,
  SidebarIcon,
  SplitIcon,
} from "../components/icons";
import { IconButton, SegmentedControl } from "../components/ui";
import type { FileTreeNode, ViewMode } from "../domain/workspace";
import {
  ActivityRail,
  AppearancePanel,
  BackgroundLayer,
  DocumentTabs,
  EditorPane,
  FileTree,
  HistoryPanel,
  LiveEditorPane,
  PreviewPane,
  Sidebar,
  StatusBar,
  TitleBar,
  useBackgroundSettings,
  type EditorPosition,
  type HistoryEntry,
} from "../features";
import { getAppShortcutLabels } from "../lib/keyboard";
import { countWords, readingMinutes } from "../lib/markdown";

const initialDocuments: Record<string, string> = {
  "01 · A Quiet Interface.md": essay,
  "02 · Interaction Rhythm.md": rhythm,
  "03 · Small Tools.md": tools,
};

const tree: FileTreeNode[] = [
  ...Object.keys(initialDocuments).map((name) => ({
    name,
    relativePath: name,
    kind: "file" as const,
    children: [],
  })),
  {
    name: "References",
    relativePath: "References",
    kind: "directory",
    children: [
      {
        name: "Reading List.md",
        relativePath: "References/Reading List.md",
        kind: "file",
        children: [],
      },
    ],
  },
];

export function FixturePreviewApp() {
  const shortcutLabels = useMemo(getAppShortcutLabels, []);
  const [documents, setDocuments] = useState(initialDocuments);
  const [activePath, setActivePath] = useState("01 · A Quiet Interface.md");
  const [viewMode, setViewMode] = useState<ViewMode>("live");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [cursor, setCursor] = useState<EditorPosition>({ line: 1, column: 1 });
  const [surface, setSurface] = useState<"document" | "history" | "appearance">(
    "document",
  );
  const [historyId, setHistoryId] = useState("saved-2");
  const background = useBackgroundSettings();
  const content = documents[activePath] ?? essay;
  const historyEntries = useMemo<HistoryEntry[]>(
    () => [
      {
        id: "saved-2",
        label: "Today, 16:42",
        createdAt: "2026-08-29T16:42:00+08:00",
        description: "3 KiB · saved locally",
        content: essay,
      },
      {
        id: "saved-1",
        label: "Yesterday, 22:18",
        createdAt: "2026-08-28T22:18:00+08:00",
        description: "2 KiB · saved locally",
        content: rhythm,
      },
    ],
    [],
  );
  const tabs = useMemo(
    () =>
      Object.keys(documents).map((path) => ({
        id: path,
        label: path,
      })),
    [documents],
  );

  return (
    <div className="app-shell" data-theme-fixture="true">
      <TitleBar
        actions={
          <>
            <SegmentedControl<ViewMode>
              iconOnly
              label="Document view"
              onChange={(value) => {
                setSurface("document");
                setViewMode(value);
              }}
              options={[
                { value: "live", label: "Live", icon: <LiveIcon size={16} /> },
                { value: "edit", label: "Source", icon: <EditIcon size={16} /> },
                { value: "split", label: "Split", icon: <SplitIcon size={16} /> },
                {
                  value: "preview",
                  label: "Preview",
                  icon: <PreviewIcon size={16} />,
                },
              ]}
              size="small"
              value={viewMode}
            />
            <IconButton
              label={surface === "history" ? "Return to document" : "File history"}
              onClick={() =>
                setSurface((current) =>
                  current === "history" ? "document" : "history",
                )
              }
              selected={surface === "history"}
              size="small"
            >
              <HistoryIcon size={16} />
            </IconButton>
          </>
        }
        leading={
          <IconButton
            label={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
            onClick={() => setSidebarVisible((visible) => !visible)}
            size="small"
          >
            <SidebarIcon size={16} />
          </IconButton>
        }
        subtitle="Field Notes"
        title={
          <button className="title-bar__command" type="button">
            <span>{activePath}</span>
            <kbd>{shortcutLabels.quickOpen}</kbd>
          </button>
        }
      />
      <div className="app-body">
        <ActivityRail
          activeId="files"
          footer={
            <IconButton
              label={
                surface === "appearance"
                  ? "Return to document"
                  : "Appearance and background"
              }
              onClick={() =>
                setSurface((current) =>
                  current === "appearance" ? "document" : "appearance",
                )
              }
              selected={surface === "appearance"}
              tooltipPlacement="right"
            >
              <SettingsIcon size={17} />
            </IconButton>
          }
          items={[
            { id: "files", label: "Files", icon: <FilesIcon size={18} /> },
            { id: "search", label: "Search", icon: <SearchIcon size={18} /> },
            { id: "outline", label: "Outline", icon: <OutlineIcon size={18} /> },
          ]}
          onSelect={() => undefined}
        />
        {sidebarVisible ? (
          <Sidebar title="Field Notes">
            <FileTree
              activePath={activePath}
              expandedPaths={[]}
              nodes={tree}
              onOpen={(path) => {
                if (documents[path]) setActivePath(path);
              }}
              onToggle={() => undefined}
              renderIcon={(node) =>
                node.kind === "directory" ? (
                  <FolderIcon size={15} />
                ) : (
                  <FileMarkdownIcon size={15} />
                )
              }
            />
          </Sidebar>
        ) : null}
        <main className="workbench">
          <DocumentTabs
            activeId={activePath}
            onActivate={setActivePath}
            onClose={(path) => {
              const remaining = Object.keys(documents).filter((item) => item !== path);
              setDocuments((current) =>
                Object.fromEntries(
                  Object.entries(current).filter(([item]) => item !== path),
                ),
              );
              if (path === activePath && remaining[0]) setActivePath(remaining[0]);
            }}
            tabs={tabs}
          />
          {surface === "history" ? (
            <HistoryPanel
              currentContent={content}
              entries={historyEntries}
              fileName={activePath}
              onLoadVersion={(entry) => {
                if (entry.content !== undefined) {
                  setDocuments((current) => ({
                    ...current,
                    [activePath]: entry.content ?? "",
                  }));
                }
                setSurface("document");
              }}
              onSelect={setHistoryId}
              selectedId={historyId}
            />
          ) : surface === "appearance" ? (
            <div className="appearance-workspace viva-scroll-region">
              <div className="appearance-workspace__inner">
                <AppearancePanel controller={background} />
              </div>
            </div>
          ) : (
          <div
            className="editor-stage"
            data-background={
              background.settings.source !== "none" &&
              (background.settings.source === "viva" || background.assetUrl)
                ? "true"
                : undefined
            }
            data-view={viewMode}
          >
            <BackgroundLayer
              assetUrl={background.assetUrl}
              settings={background.settings}
            />
            {viewMode === "live" ? (
              <LiveEditorPane
                documentId={activePath}
                onChange={(value) =>
                  setDocuments((current) => ({ ...current, [activePath]: value }))
                }
                onPositionChange={setCursor}
                value={content}
              />
            ) : viewMode !== "preview" ? (
              <EditorPane
                onChange={(value) =>
                  setDocuments((current) => ({ ...current, [activePath]: value }))
                }
                onPositionChange={setCursor}
                showPosition={false}
                value={content}
              />
            ) : null}
            {viewMode === "split" ? <div className="editor-stage__divider" /> : null}
            {viewMode !== "edit" && viewMode !== "live" ? (
              <PreviewPane source={content} />
            ) : null}
          </div>
          )}
        </main>
      </div>
      <StatusBar
        column={cursor.column}
        encoding="UTF-8"
        line={cursor.line}
        message="Saved locally"
        readingMinutes={readingMinutes(content)}
        wordCount={countWords(content)}
      />
    </div>
  );
}
