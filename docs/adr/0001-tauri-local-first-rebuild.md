# ADR-0001: Rebuild on Tauri with a narrow Rust boundary

## Status

Accepted

## Context

The Electron 11 prototype depended on unfinished private component packages and
exposed product actions that were not implemented. Viva needs current macOS and
Windows support, ordinary local files, fast startup, and a small dependency surface.

## Decision

Use Tauri 2 and Rust for native menus and scoped filesystem operations. Use React
19, TypeScript 6, and Vite 8 for a renderer composed entirely of repository-owned
UI primitives and icons. Keep only `markdown-it` and DOMPurify for content parsing
and sanitization. Do not grant the renderer a general filesystem capability.

## Consequences

### Positive

- The security and persistence boundary is explicit and testable.
- The renderer stays familiar, compact, and independently testable.
- The old private UI package chain is removed.

### Negative

- Native behavior must be implemented and verified on both platforms.
- Tauri WebView differences require targeted macOS and Windows acceptance.

## Alternatives considered

- Keep Electron: rejected because it preserves the obsolete runtime and larger shell.
- Native Swift plus WinUI: rejected because two product implementations would drift.
- Expose Tauri's general filesystem plugin: rejected because it widens renderer authority.
