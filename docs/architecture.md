# Viva architecture

Viva is a local-first Markdown workspace for macOS and Windows. It opens an
ordinary folder, edits UTF-8 Markdown-compatible files, and keeps optional
history and appearance data on the device. The application has no account,
analytics, upload, sync, or in-WebView network-content path.

## Runtime overview

```text
Tauri WebView
  React 19 + TypeScript 6
  ├─ workspace reducer: tabs, drafts, view state, operation generations
  ├─ Live / Source / Split / Preview surfaces
  ├─ markdown-it → DOMPurify → inert local preview
  ├─ English / Simplified Chinese i18n
  └─ typed Tauri adapter
           │ invoke only
           ▼
Rust / Tauri 2
  ├─ canonical workspace and symlink boundary
  ├─ bounded tree, UTF-8 reads, search, and validated local images
  ├─ revision check → temporary file → flush → atomic replace
  ├─ content-addressed history in application data
  ├─ native menu, new-process window launch, and process locks
  └─ fail-closed native quit protection
```

Tauri commands that may block on disk or process work run on worker threads.
The renderer has no unrestricted filesystem capability; Rust is the authority
for workspace reads, writes, search, history, and local image bytes. UI
primitives and icons are repository-owned. The renderer's content dependencies
are deliberately limited to `markdown-it` and DOMPurify.

## Workspace and document integrity

Rust canonicalizes the selected workspace and accepts only relative, visible
paths that remain inside it. Hidden paths, common generated directories, and
all symlink components are excluded. Documents are limited to `.md`,
`.markdown`, `.mdx`, and `.txt`; visible workspace images are JPEG, PNG, GIF,
and WebP.

Each document snapshot includes its full SHA-256, size, and modification time.
A save checks that revision, writes and flushes a sibling temporary file,
rechecks the destination immediately before replacement, then atomically
persists it and best-effort syncs the parent directory. Save As first inspects
the destination and applies the same compare-and-replace rule. A mismatch stops
with a conflict instead of overwriting an external edit.

The React controller adds a second race boundary. A workspace generation and a
per-document incarnation token cause late opens, saves, searches, refreshes,
and Save As completions to be ignored after their workspace or tab has changed.
The reducer keeps a final identity guard before accepting a result.

## Editing and content rendering

Markdown text remains the only document source of truth. Viva offers four
views:

- **Live** parses the complete bounded document, renders top-level Markdown
  blocks, and turns only the selected block into a proportional raw-Markdown
  textarea. Exact source slices are spliced back into the document; no private
  rich-text format is stored.
- **Source** is a plain textarea editor with deterministic Markdown typing and
  selection helpers.
- **Split** keeps source and sanitized preview aligned by source-line metadata.
- **Preview** presents the same sanitized result without the source pane.

Documents larger than 512 KiB or 5,000 lines fall back from Live to Source.
This bounds parsing and DOM work without truncating the value that is edited or
sent to Rust. History previews and diffs have separate display-only bounds.

Raw HTML is disabled before rendering, and DOMPurify removes active or embedded
content. An `.mdx` file uses a safe source-compatible preview: imports, exports,
JSX, and expressions are never imported, evaluated, or executed. They remain
inert text rather than becoming a component runtime.

Markdown images are placeholders until the renderer resolves a safe relative
workspace path and asks Rust for validated bytes. Rust rejects path escape,
symlinks, mismatched extensions/signatures, unsafe dimensions, oversized files,
animated PNG/WebP, and excessive GIF frames. The renderer creates revocable
object URLs, loads near-viewport images lazily, and keeps a bounded lease-aware cache.
Remote and embedded image URLs stay blocked. Clicking a loaded local image opens
the built-in zoomable image viewer. Web and email links may be handed to the
operating system, but are not fetched inside Viva.

See [ADR-0004](adr/0004-safe-mdx-and-local-images.md) and
[ADR-0005](adr/0005-live-markdown-direct-editing.md).

## Local persistence

| Data | Location | Contract |
| --- | --- | --- |
| Markdown documents | Selected workspace | Ordinary user files; Rust-controlled atomic writes |
| Saved history | Viva application-data directory | Content-addressed, deduplicated, at most 100 versions per document and about 256 MiB globally |
| Main workspace session | `localStorage` | Paths, tab order, active tab, view, and sidebar state only; never draft contents |
| Language, theme, layout, background metadata | `localStorage` | Small preferences shared by application instances |
| Custom background image | Versioned IndexedDB record | Locally decoded, resized, compressed, and pruned after settings commit |
| Main window geometry | Tauri window-state storage | Enabled only for the ordinary main process |

History is best-effort after the primary save. It records the previous and new
UTF-8 bodies, verifies metadata, size, UTF-8, and SHA-256 on read, and never
turns a successful file save into a failure. Loading a version creates a dirty
editor draft; it does not overwrite disk until the user saves normally.

The built-in background is a bundled image enabled at low opacity. A custom
JPEG, PNG, or WebP is decoded locally, reduced to at most 3,840 px / 12 MP,
encoded as WebP when supported (otherwise JPEG), capped at 8 MiB, and stored in
IndexedDB. Object URLs are revoked when replaced. A readability veil and 28%
opacity ceiling keep artwork subordinate to document content.

English and Simplified Chinese share one typed key set. The preference can
follow the operating system or be pinned in `localStorage`; language and storage
events update open renderers, and Viva-owned native menu labels are rebuilt for
the resolved language.

See [ADR-0002](adr/0002-bounded-local-history.md) and
[ADR-0003](adr/0003-local-background-storage.md).

## Independent editor windows

`New Window` starts another Viva process with `--new-window` (using a new app
instance on macOS). Each process owns exactly one editor window, one React tree,
and one quit flow. A fresh process asks for a folder, does not restore window
geometry, and keeps its workspace/tab session ephemeral so it cannot overwrite
the main process's restore record. It may read the shared recent-workspace list.
Appearance and language preferences remain intentionally shared.

All document creation and replacement operations take one exclusive app-data
process lock around revision check through atomic persistence. History has its
own in-process mutex and cross-process lock around record, list, read, cleanup,
and pruning. Save-time history recording tries the cross-process history lock
without waiting: if another process is busy, the document save stays successful
and returns a localized history warning. Thus two instances cannot pass the same
revision check and silently overwrite one another; the later writer receives a
conflict.

This process-per-window design favors isolation and small coordination surfaces
over live tab sharing. Quit, unsaved prompts, tab state, and folder selection are
per process. See [ADR-0006](adr/0006-independent-editor-processes.md).

## Loss prevention and quit handling

Dirty-tab close, the window close control, the application menu, and the native
quit shortcut converge on one Save / Don't Save / Cancel flow. Rust cancels an
unapproved close before notifying the renderer. A session identifier plus
monotonic sequences prevents a late renderer message from changing a newer
native dirty/ready state; page navigation or renderer termination clears
readiness.

On macOS, Viva extends Tao's existing application delegate without ivars and
answers `applicationShouldTerminate:` with `TerminateLater` while the renderer
dialog is open. The renderer eventually replies yes or no to that same AppKit
request. On Windows, a native window subclass rejects `WM_QUERYENDSESSION` while
the current process reports an unsaved document. Missing listeners and bridge
failures fail closed, leaving Viva open. A user-forced shutdown, process kill,
power loss, or operating-system failure remains outside any application's
guarantee.

See [ADR-0007](adr/0007-fail-closed-native-quit-protection.md).

## Resource bounds

| Surface | Bound |
| --- | --- |
| Workspace tree | 50,000 visible entries, depth 64 |
| Workspace search | 32 MiB total text read, up to 500 results |
| Editable document | 10 MiB, UTF-8 |
| Live/renderer work | First 512 KiB or 5,000 lines; larger documents use Source |
| History preview | 256 KiB or 2,000 lines; loading still uses the full snapshot |
| History diff | 128 KiB or 800 lines per side |
| Workspace image | 24 MiB, 16,384 px per side, 32 MP |
| GIF | 256 frames and 128 MP cumulative frame area |
| Workspace image cache | 48 entries and 96 MiB, evicting only unused leases |
| Production renderer budget | JavaScript and CSS below 300 KiB gzip combined |

## Known tradeoffs

- Safe MDX is not an MDX application runtime; components and expressions do
  not render or execute.
- Live editing is block-oriented Markdown editing, not arbitrary WYSIWYG DOM
  manipulation. Source mode remains available for complex structural changes.
- New windows do not share live tabs or unsaved drafts. File revision checks and
  locks protect disk state, not in-memory collaboration.
- History is local recovery assistance, not a backup or sync service, and older
  versions may be pruned.
- Remote images and embeds are intentionally unavailable. External links leave
  Viva and open through the operating system.
- Application UI and Viva-owned native menu labels are translated into English
  and Simplified Chinese. Low-level operating-system error text may still follow
  the OS language.

## Verification

The repository gate is `pnpm test`, `pnpm build`, `pnpm check:size`, Rust
tests/check/format/strict Clippy on supported targets, and `git diff --check`.
`check:size` enforces the 300 KiB compressed renderer budget above and a 1 MiB
complete `dist` budget that includes the bundled artwork. Native acceptance uses
a consistently signed app at a stable path and exercises folder open, Live
editing, local images, history restore, multi-process conflict handling, and
every dirty quit outcome. CI compilation is not a substitute for installed-app
acceptance.
