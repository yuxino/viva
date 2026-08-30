# Windows line-ending preservation implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use the Code execution and verification workflow task by task.

**Goal:** Keep CRLF Markdown files CRLF across edits while exposing LF-only text to Viva's editor.

**Architecture:** The Rust boundary owns decoding and encoding. `DocumentSnapshot` carries an explicit `lineEnding`, revisions continue to hash exact on-disk bytes, and local history stores exact UTF-8 bodies but returns normalized editor text with its detected line ending.

**Tech Stack:** Rust/Tauri, TypeScript/React, Vitest.

---

### Task 1: Lock the native contract with failing tests

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/filesystem.rs`
- Modify: `src-tauri/src/history.rs`

1. Add tests for all-CRLF detection, mixed-ending fallback to LF, LF-normalized reads, exact-byte revision hashes, CRLF write/save-as bytes, and normalized history snapshots.
2. Run `cargo test` and confirm the new assertions fail before implementation.

### Task 2: Implement exact-byte persistence

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/filesystem.rs`
- Modify: `src-tauri/src/history.rs`

1. Add the serialized `LineEnding::{Lf,Crlf}` contract.
2. Normalize CRLF and lone CR to LF for editor-facing content.
3. Enforce the input limit before encoding LF editor content, then enforce the persisted-byte limit before atomic persistence.
4. Compute revisions and history identities from encoded bytes, then return normalized content plus `lineEnding`.
5. Run the focused Rust tests and confirm they pass.

### Task 3: Propagate the frontend contract

**Files:**
- Modify: `src/domain/workspace.ts`
- Modify: `src/lib/native.ts`
- Modify: `src/domain/workspace.test.ts`
- Modify: `src/lib/native.test.ts`
- Modify: `src/hooks/useWorkspaceController.ts`
- Modify: `src/hooks/useWorkspaceController.test.tsx`
- Modify: `src/hooks/useDocumentHistory.ts`
- Create: `src/hooks/useDocumentHistory.test.tsx`
- Modify: `src/features/history/HistoryPanel.tsx`
- Modify: `src/features/editor/EditorPane.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

1. Add `LineEnding` to snapshots and native requests.
2. Preserve the active document's line ending through Save As and history restore; use LF for a new document.
3. Include line-ending-only changes and concurrent save changes in dirty-state handling.
4. Assert native payloads, Save As/history propagation, and dirty-state stability with LF-normalized content.
5. Document that jsdom is not evidence for Chromium textarea newline normalization.

### Task 4: Verify and commit

**Files:**
- Verify all files above.

1. Run Rust formatting and tests.
2. Run Vitest, TypeScript build, and size checks.
3. Inspect the final diff and commit only this isolated branch.
