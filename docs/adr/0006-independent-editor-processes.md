# ADR-0006: Use independent editor processes with explicit coordination

## Status

Accepted

## Context

Users need several folders open at once. A single Tauri process with multiple
WebViews would require shared tab ownership, window-addressed menu events, global
quit arbitration, and careful window-state persistence. Completely independent
processes are simpler, but shared files, history, and browser storage still need
defined concurrency behavior.

## Decision

Launch `New Window` as another Viva process with `--new-window` (`open -n` for a
new macOS app instance). Each process owns one `main` window and one React state
tree. A fresh process asks for a folder, disables window-state restoration, and
keeps its workspace/tab session in memory. It may read the shared recent-workspace
list but cannot overwrite the ordinary process's persisted restore record.
Language, theme, layout, and appearance settings remain intentionally shared.

Serialize document creation and replacement across processes with one exclusive
lock file in Viva's application-data directory. Hold the lock from revision
inspection through atomic persistence and parent sync. Keep a separate history
lock, paired with an in-process mutex, around recording, listing, reading,
cleanup, and pruning. Continue to use full file revisions, so the process that
observes a stale revision receives a conflict after it acquires the lock.
Save-time history recording uses a non-blocking attempt on the cross-process
history lock; a busy history store produces a warning without delaying or
rolling back the successful document write.

## Consequences

### Positive

- Every editor window has isolated UI, tab, failure, and quit state.
- A fresh window cannot clobber the main workspace restore record or geometry.
- Cross-process saves and history housekeeping cannot race silently.
- A stalled history process cannot indefinitely block a document save.
- The design works the same way on macOS and Windows without a new shared-state
  service.

### Negative

- Each window pays for another process and WebView.
- Tabs, unsaved drafts, search state, and quit prompts are not shared live.
- Quit applies to the current process rather than coordinating all Viva windows.
- One global document-write lock serializes unrelated saves for a short period.

## Alternatives considered

- Multiple Tauri windows in one process: deferred because it broadens state,
  menu-routing, and quit coordination before the product needs live shared tabs.
- No cross-process locking: rejected because two instances could pass the same
  revision check and overwrite one another.
- Per-document lock files: deferred because canonical keying, Save As, and path
  replacement make the lock lifecycle more complex for little user-visible gain.
- Let every process persist the shared session: rejected because last-writer-wins
  storage would restore an arbitrary window next launch.
