# ADR-0007: Fail closed while native quit intent is unresolved

## Status

Accepted

## Context

A WebView `beforeunload` handler alone cannot reliably cover the window close
control, native menus, application quit, macOS Dock Quit, or Windows session end.
At the same time, native code cannot decide whether multiple dirty tabs should be
saved, discarded, or kept open without the renderer's document state and dialog.
Late IPC messages from a reloaded or failed renderer must not approve a newer quit.

## Decision

Intercept every unapproved main-window close in Rust and notify the renderer only
after it has explicitly reported readiness. The renderer uses one Save / Don't
Save / Cancel workflow for dirty tabs and application quit. Synchronize ready and
dirty flags with a native-issued session identifier and increasing sequence
numbers. Reset the session and clear readiness on page navigation or renderer
termination. If the listener or bridge is missing, cancel the quit.

On macOS, extend Tao's installed application delegate without adding ivars and
return `TerminateLater` from `applicationShouldTerminate:` while the renderer
dialog is active. Reply to that same AppKit request after Save, Don't Save, or
Cancel. For a close-button request without pending AppKit termination, grant one
native approval and ask AppKit to terminate normally. On Windows, subclass the
main HWND and reject `WM_QUERYENDSESSION` while the current process reports
unsaved content.

The guard is per independent Viva process. It protects application-controlled
quit paths; it does not claim protection from a forced process kill, forced OS
shutdown, power loss, or storage failure.

## Consequences

### Positive

- Window, menu, shortcut, Dock, and normal OS quit paths share one document-aware
  decision flow.
- Stale renderer messages cannot approve a newer native session.
- Bridge and renderer failures preserve unsaved text by leaving the process open.
- Windows can truthfully report that Viva is preventing a normal session end.

### Negative

- Platform-specific native code and installed-app tests are required.
- Dirty-state IPC must retry and remain correctly sequenced.
- A failed renderer can leave the application open until the user force-quits it.

## Alternatives considered

- Use only `beforeunload`: rejected because native application and session-end
  paths can bypass it or provide inconsistent behavior.
- Let native code close immediately and recover drafts later: rejected because
  Viva intentionally does not copy unsaved document bodies into session storage.
- Mirror complete document state into Rust: rejected because it duplicates the
  editor model and widens the native persistence boundary.
- Fail open when the renderer is unavailable: rejected because convenience is
  less important than preserving a user's only unsaved copy.
