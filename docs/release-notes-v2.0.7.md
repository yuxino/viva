# Viva 2.0.7

This patch fixes Markdown rendering and workspace search bounds, reduces desktop
bundle size, and includes the missing permission for Software Update checks.

## What changed

- Keep heading anchors unique when repeated headings meet numbered names, and preserve anchors that would otherwise be removed by HTML sanitization.
- Render task checkboxes only in actual list items; keep ordinary `[x]` prose, headings, quotes, and continuation paragraphs intact.
- Count invalid UTF-8 files toward the workspace search read limit, preventing malformed files from bypassing the I/O budget.
- Remove duplicate renderer styles and enable thin LTO while retaining the existing runtime optimization level. A controlled local macOS arm64 build comparison reduced the executable by 16.33% and app file bytes by 14.23%; release download sizes depend on platform and packaging.
- Fix the app-version permission needed to start Software Update checks.
- Refresh the Windows installer artwork and add centered bilingual README demos with an official website link.

## Upgrading from 2.0.6 or earlier

Install 2.0.7 manually once from this release. Versions through 2.0.5 have no
updater, and 2.0.6 cannot complete the app-version read needed for its update
check. Version 2.0.7 fixes that permission. Future signed releases can be checked
from **Appearance and background → Software Update**.

## Downloads and integrity

macOS arm64: DMG for manual installation and a signed app tarball for the updater.
Windows x64: NSIS installer with a detached updater signature. `latest.json`
contains both update targets; `SHA256SUMS.txt` lists the asset checksums.

macOS builds use ad-hoc code signing and are not Apple-notarized. Use the normal
system-supported manual Open flow when required. Windows device interaction and
an installed 2.0.7-to-later-version upgrade are not claimed by this release.
