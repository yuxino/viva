<p align="center">
  <img src="public/art/viva-character-logo-round.webp" width="136" height="136" alt="Viva character logo">
</p>

<h1 align="center">Viva</h1>

<p align="center">A quiet, local-first workspace for Markdown.</p>

<p align="center">
  English · <a href="README_ZH.md">简体中文</a>
</p>

<p align="center">
  <img src="docs/images/viva-live-editor.png" width="1080" alt="Viva Live editor in the graphite-dark theme">
</p>

Viva brings your folders, Markdown source, and beautifully typeset pages into
one focused desktop workspace. Your files remain ordinary files on your own
computer—no account, sync service, or proprietary document format required.

## Write without leaving the page

Live mode keeps the document rendered while you write. Click a paragraph to
edit its Markdown in place, then move on without losing the shape and rhythm of
the page. Source, Split, Preview, and Focus modes are always close at hand when
you need a different view.

## What makes Viva useful

- Open any folder and work across real tabs with a fast, keyboard-friendly tree and safe file actions.
- Search the whole workspace, follow the document outline, and recover earlier saves.
- Find and replace in the current document, and paste images into local `assets/` with relative paths.
- Read Dart, TypeScript, and other fenced code with built-in syntax highlighting.
- Preserve each document's LF or CRLF line endings across editing, Save As, and history restores.
- Keep unsaved work visible and protected across tabs, windows, and native quit flows.
- Choose a calm light or graphite-dark workspace, with an optional local background.

## Local by default

Viva does not upload documents, run analytics, or require an account. Markdown,
history, appearance settings, and optional background artwork stay on the device.
External links open only when you choose them. A manual Software Update check
makes one native HTTPS request to Viva's fixed GitHub Release feed; documents,
settings, and usage data are never included.

## Signed software updates

Viva 2.0.6 introduces user-confirmed in-app updates. Open **Appearance and
background → Software Update** to check the fixed release feed, read the release
notes, and choose whether to download. Tauri verifies every downloaded updater
bundle against Viva's embedded public key before installation; there is no
unsigned fallback.

**Bootstrap:** Viva 2.0.5 and earlier do not contain the updater. Install 2.0.6
manually once from [GitHub Releases](https://github.com/yuxino/viva/releases),
then future signed releases can be installed from inside Viva.

<details>
<summary>Development</summary>

Viva is built with Tauri, Rust, React, and TypeScript for macOS and Windows.
Development requires Node.js 24, pnpm 11, stable Rust, and the platform-specific
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm tauri dev
```

</details>

## License

MIT
