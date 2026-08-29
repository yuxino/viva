<p align="center">
  <img src="public/art/viva-character-logo.jpg" width="144" height="144" alt="Viva character logo">
</p>

<h1 align="center">Viva</h1>

<p align="center">A quiet local workspace for Markdown.</p>

<p align="center">
  English · <a href="README_ZH.md">简体中文</a>
</p>

<p align="center">
  <img src="docs/images/viva-live-editor.png" width="1080" alt="Viva Live editor in the graphite-dark theme">
</p>

Viva keeps the file tree, Markdown source, and typeset preview in one focused
desktop workspace. Files stay ordinary, portable, and on your computer.

## What works

- Open a folder and browse its Markdown files in a recursive, keyboard-friendly tree.
- Keep several documents open in real tabs, or open an independent editor
  window for another folder with `Shift+Command+N` / `Shift+Ctrl+N`.
- Write directly in a typeset Live document: click one block to edit its exact
  Markdown, while the rest of the page stays rendered. Source, Split, Preview,
  and a distraction-free Focus mode remain one shortcut away.
- Search across the workspace and jump to the exact line of a result.
- Navigate a live document outline and keep source and preview positions aligned.
- Save atomically, detect outside changes, and confirm before discarding edits.
- Coordinate document writes and history across independent Viva windows so
  concurrent saves become visible conflicts instead of silent overwrites.
- Route window, menu, shortcut, Dock, logout, and restart requests through
  native loss-prevention guards before unsaved text can be discarded.
- Inspect a bounded local history, compare saved versions, and load one as a draft.
- Preview Markdown and MDX without executing document code. View validated local
  workspace images in place, then zoom and pan them in Viva's image viewer.
- Continue lists, tasks, quotes, and indentation naturally while typing; wrap
  bold, italic, and inline code with native shortcuts.
- Use the complete interface and Viva-owned native menus in English or Simplified
  Chinese, following the operating system by default.
- Restore the main window, workspace, open tabs, view mode, and sidebar on relaunch.
- Follow the system appearance or choose the light and graphite-dark themes.
- Use the built-in Viva illustration or one private local image as a restrained
  writing background, with opacity, blur, fit, and position controls.

## Local by design

Viva has no account, analytics, upload, or background network service. The Rust
core only accepts supported text files inside the folder you selected. It rejects
path traversal and symbolic-link escapes, limits file and search size, and never
silently overwrites a document changed by another application.

Saved versions live in Viva's application-data folder, not in your workspace.
They are deduplicated, capped at 100 versions per document and about 256 MiB in
total, and never replace a file until you explicitly save the loaded draft.
Custom background images are resized and compressed locally, then stored in the
embedded browser database; they are never uploaded.

Documents up to 10 MiB remain fully editable and saveable. To keep typing fast,
live preview and outline render at most 512 KiB or 5,000 lines; history preview
uses 256 KiB or 2,000 lines, and comparison uses 128 KiB or 800 lines per side.
Viva labels these bounded views without truncating the file itself.

Markdown and MDX are treated as untrusted input. Raw HTML is disabled, rendered
output is sanitized, and MDX imports, exports, expressions, and JSX are displayed
as inert source instead of being executed. Remote and embedded images are not
loaded. Supported relative JPEG, PNG, GIF, and static WebP files are validated by
the Rust core before Viva creates a temporary local viewer URL. A web link opens
only after you click it, in the operating system's default browser.

## Architecture

- Tauri 2.11 and Rust for the narrow local filesystem boundary and native menus.
- React 19, TypeScript 6, and Vite 8 for the desktop interface.
- Repository-owned UI primitives and SVG icons under `src/components`.
- `markdown-it` and DOMPurify for parsing and sanitizing document content.
- Bounded Rust history storage and dependency-free line comparison.
- Cross-process file locks for independent editor windows.
- IndexedDB for one optional custom background; small appearance preferences only
  in localStorage.

New windows are intentionally isolated editor processes. They share language and
appearance preferences, but not live tabs or unsaved drafts. Disk revision checks
and process locks are the coordination boundary.

The previous Electron 11 implementation remains available in Git history. The
current application is a clean rebuild; it does not depend on the former
`@viva-ui` component packages.

## Development

Requirements: Node.js 24, pnpm 11, current stable Rust, and the platform-specific
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). The packaged
macOS application requires macOS 12.3 or later.

```bash
pnpm install
pnpm tauri dev
```

Run the complete local checks:

```bash
pnpm test
pnpm build
pnpm check:size
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git diff --check
```

Create a desktop package with `pnpm tauri build`. The repository includes GitHub
Actions jobs for macOS and Windows source builds; signing and notarization are
separate release steps.

For a stable local macOS installation, set a persistent identity and run:

```bash
VIVA_SIGNING_IDENTITY="Your Code Signing Identity" ./scripts/install-app.sh
```

The script never falls back to ad-hoc signing. An existing `/Applications/Viva.app`
is moved to the Trash before the verified replacement is installed.

## License

MIT
