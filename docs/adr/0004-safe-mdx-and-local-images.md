# ADR-0004: Render safe MDX and local workspace images without content execution

## Status

Accepted

## Context

Writers need to open existing `.mdx` documents and see nearby local images.
Running arbitrary imports, JSX, expressions, HTML, remote media, or browser file
URLs would turn a local editor into a code-execution or network boundary. Giving
the renderer general filesystem access would also bypass Viva's workspace rules.

## Decision

Parse Markdown and MDX-shaped source with `markdown-it` while raw HTML is
disabled, then sanitize the result with DOMPurify. Treat MDX imports, exports,
JSX, and expressions as inert source text; Viva never imports or evaluates them.
Replace every Markdown image with metadata-only placeholder markup. Remote and
embedded URLs remain blocked.

For a relative local image, resolve its path against the current document in the
renderer and request bytes through one Rust command. Rust independently verifies
that the canonical path stays inside the workspace, contains no symlink, matches
an allowed extension and binary signature, and satisfies byte, dimension, pixel,
and animation bounds. Return a framed binary IPC response. The renderer creates a
revocable object URL, loads images near the viewport, and retains them only in a
bounded lease-aware cache shared by preview, Live editing, and the image viewer.

## Consequences

### Positive

- Opening author-controlled MDX cannot run modules or expressions.
- Local images work without `file://`, remote fetches, or general renderer file
  permissions.
- The same validated media path serves inline preview and full-size viewing.
- Object URLs and decoded-image pressure have explicit lifetimes and bounds.

### Negative

- Viva is source-compatible with MDX but does not render MDX components.
- Remote images, data URLs, animated PNG, and animated WebP do not display.
- Format inspection and GIF bounds add native parser code that must be tested
  against malformed files.

## Alternatives considered

- Execute an MDX runtime: rejected because imports and expressions are arbitrary
  code and require a dependency and trust model Viva does not have.
- Expose Tauri filesystem assets or browser file URLs: rejected because they
  widen renderer authority and make workspace escape harder to audit.
- Fetch remote images through the WebView: rejected because it breaks the
  no-network content contract and leaks document viewing activity.
