# ADR-0005: Keep Markdown canonical in block-based Live editing

## Status

Accepted

## Context

Viva should feel as immediate as a direct-edit document surface without adopting
a heavy rich-text framework or storing a private document model. Converting
between Markdown and a mutable rich-text AST risks source churn and imperfect
round trips, especially for references, nested lists, and MDX-shaped source.

## Decision

Keep the complete Markdown string as the sole source of truth. For Live view,
parse the bounded document once and group the resulting top-level token stream by
source maps. Render inactive groups as sanitized Markdown. When the user selects a
group, replace only that group with a proportional textarea containing its exact
raw source slice. Splice edits between the unchanged prefix and suffix, then
reparse when the active block is left or the document context changes.

Parse the whole bounded document rather than splitting on blank lines so reference
definitions, multi-paragraph lists, task lists, and other shared parser context
remain correct. Preserve Source, Split, and Preview views. If a document exceeds
512 KiB or 5,000 lines, use Source instead of constructing the Live DOM.

## Consequences

### Positive

- Files remain ordinary Markdown with exact source preservation.
- The resting surface reads like a typeset document while the active block has
  familiar native text editing and selection behavior.
- The implementation stays small and testable without an editor framework.
- The same safe rendering and local-image boundary applies in Live and Preview.

### Negative

- Editing is block-oriented, not arbitrary WYSIWYG DOM manipulation.
- Complex structures expose their Markdown source while active.
- Structural changes are visually reconciled when the block is reparsed, not by
  continuously mutating a rich-text tree.
- Very large documents intentionally lose Live view and use Source.

## Alternatives considered

- Use `contenteditable` as the document model: rejected because browser DOM
  mutations do not round-trip predictably to Markdown.
- Adopt ProseMirror, Lexical, or another editor framework: rejected for bundle,
  schema, and source-conversion cost disproportionate to Viva's needs.
- Parse independent blank-line fragments: rejected because it breaks definitions
  and structures whose meaning spans multiple paragraphs.
- Keep only Source and Preview: rejected because it misses the direct-edit
  interaction that defines the rebuilt editor.
