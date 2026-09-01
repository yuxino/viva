# Viva 2.0.2

## Fixed

- Preserve consistent CRLF line endings when Windows documents are edited, saved, copied with Save As, or restored from local history.
- Normalize mixed line endings and lone carriage returns to LF instead of writing a mixed document back to disk.
- Calculate document revisions, hashes, and size limits from the exact bytes persisted on disk.
- Keep line-ending-only changes dirty, including when another edit lands while a save is still completing.

## Windows packaging

- Build a current-user NSIS installer with the verified Viva product name and icon resources.
- Treat the CI artifact as a release candidate until its exact installer bytes pass an installed-app CRLF round-trip on Windows.
