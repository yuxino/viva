# ADR-0003: Store optional custom backgrounds in IndexedDB

## Status

Accepted

## Context

Viva should support one personal illustration background without adding uploads,
base64 settings bloat, unrestricted native image reads, or a heavy media dependency.

## Decision

Bundle one optimized Viva illustration and enable it at 12% opacity on a new install.
Keep small display settings in localStorage. When a user chooses an image, validate
type and dimensions, resize it in the renderer, encode WebP when the WebView really
returns WebP (otherwise use JPEG), enforce an 8 MiB result limit, and store a
versioned blob in IndexedDB. Commit settings only after the blob succeeds, prune
stale blobs afterward, and revoke object URLs after every switch.

## Consequences

### Positive

- Background selection is local, private, portable across Tauri WebViews, and fast.
- A 28% opacity ceiling preserves source and preview readability.
- No binary data crosses the Rust workspace boundary.

### Negative

- Browser storage clearing removes the custom image.
- Canvas image encoding can differ slightly by platform WebView.

## Alternatives considered

- localStorage data URLs: rejected for synchronous bloat and small quotas.
- Copy into the workspace: rejected because it modifies user project contents.
- A native media pipeline: rejected as unnecessary operational and binary weight.
