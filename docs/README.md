# Viva documentation

Current source, tests, this index, `architecture.md`, and accepted ADRs describe
the rebuilt application. Completed plans are implementation records, not a
parallel specification.

## Current architecture

- [Architecture overview](architecture.md) — runtime boundaries, storage,
  safety, resource limits, and known tradeoffs.

## Accepted decisions

- [ADR-0001 — Rebuild on Tauri with a narrow Rust boundary](adr/0001-tauri-local-first-rebuild.md)
- [ADR-0002 — Keep bounded content-addressed document history](adr/0002-bounded-local-history.md)
- [ADR-0003 — Store optional custom backgrounds in IndexedDB](adr/0003-local-background-storage.md)
- [ADR-0004 — Render safe MDX and local workspace images without content execution](adr/0004-safe-mdx-and-local-images.md)
- [ADR-0005 — Keep Markdown canonical in block-based Live editing](adr/0005-live-markdown-direct-editing.md)
- [ADR-0006 — Use independent editor processes with explicit coordination](adr/0006-independent-editor-processes.md)
- [ADR-0007 — Fail closed while native quit intent is unresolved](adr/0007-fail-closed-native-quit-protection.md)
- [ADR-0008 — Ship signed, user-confirmed updates](adr/0008-signed-user-confirmed-updates.md)

## Historical implementation records

- [Modern rebuild design](plans/2026-08-29-viva-modern-rebuild-design.md)
- [Modern rebuild implementation plan](plans/2026-08-29-viva-modern-rebuild-implementation.md)
- [Signed updater design](plans/2026-09-02-signed-in-app-updater-design.md)
- [Signed updater implementation plan](plans/2026-09-02-signed-in-app-updater-implementation.md)

When a plan differs from current source, tests, the architecture overview, or an
accepted ADR, the current implementation and accepted decision win.
