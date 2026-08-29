# Viva modern rebuild design

Status: implemented. `docs/architecture.md`, current source, and accepted ADRs
are the source of truth where delivery refinements differ from this design record.

## Product

Viva is a quiet workspace for local Markdown. The rebuilt application keeps the
original idea—files, source, and a typeset preview in one window—but removes the
unfinished cloud, source-control, and export promises. The first complete version
must open a folder, navigate a recursive Markdown tree, open several documents,
edit without losing work, save and save as, search the workspace, and switch among
Edit, Split, Preview, and Focus views. Everything stays on the user's machine.

The application targets macOS and Windows. It follows the operating system theme,
uses native file dialogs, restores the last window and workspace, and exposes the
same keyboard model on both platforms (`Command` on macOS and `Control` on
Windows). The UI must never show an action that is only a placeholder.

Viva belongs to the same character-led product family as Mimi without copying
Mimi's identity. Its original mascot is a dark-haired editor with a geometric
`V` hair clip and fountain pen. The visual mark uses warm paper, charcoal ink,
espresso brown, and a single restrained cinnabar detail; the application chrome
remains neutral so the character never turns the editor into a themed toy.

## Architecture

Use Tauri 2 as the desktop shell, React 19 and TypeScript 6.0 for the renderer, and
Vite 8 for development and production bundling. TypeScript 7 is deferred until the
surrounding Tauri and lint tooling declares support. Rust owns scoped local file access:
listing a selected workspace, reading supported UTF-8 text, saving atomically,
creating files, and checking full file revisions. The renderer never receives unrestricted
filesystem access. Native open/save dialogs come from the official Tauri dialog
plugin; window size and position use the official window-state plugin.

Document history is a bounded local sidecar owned by Viva, stored in the operating
system's application-data directory rather than inside the selected workspace.
Successful saves create content-addressed, deduplicated snapshots. Reading or
restoring history never bypasses the workspace boundary: restoration first loads
the old body into the editor as an unsaved change, then uses the ordinary atomic
save path only if the user chooses to save it.

The frontend uses React context plus a reducer instead of Redux. Domain state is
split into `Workspace`, ordered `DocumentSession`, and view preferences. All visual
components, icons, dialogs, tooltips, menus, tabs, file-tree rows, and editor chrome
live under `src/`; there is no external UI or icon package. `markdown-it` parses
Markdown and DOMPurify sanitizes its output. No network request is permitted by the
application CSP.

## Interface

The visual direction is a quiet editorial workbench: warm neutral surfaces,
graphite text, very light separators, compact navigation, and a generous writing
canvas. The layout contains a 44 px activity rail, a resizable 236 px file/search
sidebar, a 36 px document tab strip, the editor/preview workspace, and a 26 px
status bar. Edit and preview use different typographic voices while sharing a
carefully aligned vertical rhythm. Color never carries selection or status alone.

The default Split view is the primary product screenshot. It shows a safe fixture
workspace called Field Notes, a real Markdown source document, and the rendered
result at the corresponding position. Focus mode removes navigation chrome and
centers a readable writing column. Quick Open appears below the title area as a
compact keyboard-first surface rather than a centered card. Motion is limited to
120–160 ms fades and panel transitions and is disabled by reduced-motion settings.

An optional illustration background uses the same Viva character in a quiet
reading room. The bundled illustration is enabled at a restrained 12% opacity on a
fresh install and can be turned off. Users may choose a local image; its compressed
blob lives in IndexedDB while small display preferences live in localStorage. A
solid readability veil always remains between artwork and source or preview text.

## Data flow and safety

Opening a folder starts with a native dialog. Rust canonicalizes the selected path,
walks it without following symlink escapes, ignores hidden/build directories, and
returns a typed tree containing supported Markdown and plain-text files. Reading a
document returns its contents plus modification time, byte size, and SHA-256.
Saving writes a sibling temporary file, flushes it, rechecks the full revision, and
renames it over the target so an interrupted write cannot truncate the source. A
revision conflict stops the save instead of offering an unsafe overwrite.

Each open document stores `content`, `savedContent`, a full `revision`, and cursor/scroll
metadata. Dirty state is derived from content equality. Closing a dirty tab or the
window presents Save, Don't Save, and Cancel. Session metadata contains paths and
view preferences only; document contents are never copied into settings storage.
Markdown output is sanitized and external links open through the operating system.
Remote images are not loaded in the first release.

The editor keeps common Markdown actions close to plain typing: Enter continues
lists, tasks, quotes, and indentation; an empty marker exits the block; native
bold, italic, and inline-code shortcuts wrap or unwrap the selection. These helpers
remain deterministic text transforms instead of introducing a large editor
framework, preserving fast startup and ordinary Markdown files.

## Verification

Pure reducers, file-tree transforms, search ranking, word counts, and Markdown
sanitization receive unit tests. Rust tests cover extension filtering, hidden-file
rules, symlink boundaries, atomic saving, invalid UTF-8, and modification conflicts.
Component tests cover opening tabs, dirty markers, view switching, search, and
keyboard commands. The delivery gate is `pnpm test`, `pnpm build`, `cargo test`,
`cargo check`, `cargo fmt --check`, strict Clippy, and `git diff --check`.

Native acceptance uses a packaged, consistently signed application from a stable
path. The real app must open the Field Notes fixture, edit and save a document,
restore the workspace, search, switch views, and close a dirty tab safely. Final
screenshots are captured from that installed app at a clean desktop state and are
reviewed for private paths, clipping, alignment, contrast, and unfinished controls.
