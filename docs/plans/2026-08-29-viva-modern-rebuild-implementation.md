# Viva Modern Rebuild Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild Viva as a polished, local-first Markdown workspace on a current Tauri and React architecture.

**Architecture:** Tauri 2 provides a narrow Rust command surface for scoped and atomic local file operations. React 19 uses typed reducer state and repository-owned UI components; markdown-it and DOMPurify are the only content-rendering dependencies.

**Tech Stack:** Tauri 2.11, Rust 2021, React 19.2, TypeScript 6.0, Vite 8, Vitest 4, Testing Library 16, markdown-it 15, DOMPurify 3.

---

### Task 1: Replace the legacy build system

**Files:**
- Replace: `package.json`, `tsconfig.json`, `index.html`
- Create: `vite.config.ts`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
- Remove: legacy Webpack, Electron, Redux, Saga, styled-components, and viva-ui files

**Steps:**
1. Write the modern manifests with exact stable versions.
2. Create a minimal Tauri command and React entrypoint.
3. Install with `pnpm install` and confirm the lockfile is created.
4. Run `pnpm build` and `cargo check --manifest-path src-tauri/Cargo.toml`.

### Task 2: Implement the safe filesystem boundary

**Files:**
- Create: `src-tauri/src/files.rs`
- Create: `src-tauri/src/lib.rs`, `src-tauri/src/main.rs`
- Test: Rust unit tests within `src-tauri/src/files.rs`

**Steps:**
1. Add failing tests for tree filtering, hidden directories, and invalid paths.
2. Implement canonical workspace listing without symlink escape.
3. Add failing tests for read metadata, atomic save, and modification conflicts.
4. Implement read, save, create, and rename commands.
5. Run `cargo test --manifest-path src-tauri/Cargo.toml`.

### Task 3: Build the document and workspace model

**Files:**
- Create: `src/domain/types.ts`, `src/domain/reducer.ts`, `src/domain/selectors.ts`
- Create: `src/domain/reducer.test.ts`, `src/lib/text.ts`, `src/lib/text.test.ts`

**Steps:**
1. Write failing reducer tests for tab order, activation, dirty state, and close.
2. Implement typed workspace, document, session, and preference state.
3. Write and implement word count, reading time, and search ranking tests.
4. Run `pnpm test --run`.

### Task 4: Build repository-owned interface primitives

**Files:**
- Create: `src/components/ui/*`, `src/components/icons/*`
- Create: `src/styles/tokens.css`, `src/styles/base.css`, `src/styles/markdown.css`
- Test: relevant component tests under `src/components/**/*.test.tsx`

**Steps:**
1. Create local SVG Icon, IconButton, Tooltip, Dialog, Menu, and SegmentedControl.
2. Implement keyboard focus, labels, reduced motion, and neutral theme tokens.
3. Test dialog focus, menu keyboard navigation, and button accessibility.
4. Run focused component tests.

### Task 5: Implement the workspace shell

**Files:**
- Create: `src/components/shell/*`, `src/components/workspace/*`
- Create: `src/hooks/useWorkspace.ts`, `src/hooks/useCommands.ts`

**Steps:**
1. Implement activity rail, resizable sidebar, file tree, tab strip, and status bar.
2. Connect native folder/file dialogs and Rust commands.
3. Add recent workspace restore and native drag/drop.
4. Implement Quick Open and workspace search.
5. Test opening, switching, closing, and restoring documents.

### Task 6: Implement editing and preview

**Files:**
- Create: `src/components/editor/MarkdownEditor.tsx`
- Create: `src/components/editor/MarkdownPreview.tsx`
- Create: `src/lib/markdown.ts`, `src/lib/markdown.test.ts`

**Steps:**
1. Implement a local textarea-based editor with selection and scroll persistence.
2. Render sanitized Markdown with heading anchors and blocked remote images.
3. Add Edit, Split, Preview, and Focus views.
4. Implement proportional fallback plus heading-aware scroll synchronization.
5. Test sanitization, view switching, and preserved editing state.

### Task 7: Implement saving and loss prevention

**Files:**
- Modify: `src/hooks/useCommands.ts`, `src/domain/reducer.ts`
- Create: `src/components/dialogs/UnsavedChangesDialog.tsx`

**Steps:**
1. Add `Command/Ctrl+S`, Save As, New File, and close-tab commands.
2. Add modification-conflict and unsaved-change dialogs.
3. Intercept native window close while dirty documents exist.
4. Verify Save, Don't Save, and Cancel paths with tests.

### Task 8: Package and perform visual acceptance

**Files:**
- Create: `scripts/install-app.sh`, `fixtures/field-notes/*`
- Update: `README.md`

**Steps:**
1. Run `pnpm test --run`, `pnpm build`, Cargo tests/checks, and diff checks.
2. Package with the stable local signing identity and install at `/Applications/Viva.app`.
3. Exercise opening, editing, saving, search, view modes, restore, and dirty close.
4. Capture and inspect real Retina screenshots with the safe Field Notes fixture.
5. Fix evidenced defects and rerun the gate. Commit or push only when the user
   explicitly asks for repository publication.

### Task 9: Establish the Viva character brand

**Files:**
- Create: `src-tauri/icons/app-icon-source.png`, generated platform icons
- Create: `public/art/viva-character-logo.jpg`
- Modify: `src/components/Welcome.tsx`, both README files

**Steps:**
1. Use the existing Mimi icon only as a family-style reference.
2. Generate an original dark-haired Viva editor with a `V` hair clip and pen motif.
3. Verify the mark at 1024, 128, and 32 px, then generate the native icon set.
4. Keep the optimized welcome asset below 50 KiB.

### Task 10: Add optional illustration backgrounds

**Files:**
- Create: `public/art/viva-editor-background.jpg`
- Create: `src/features/appearance/*`, `src/lib/background.ts`
- Modify: `src/App.tsx`

**Steps:**
1. Generate a wide, low-detail illustration with the Viva character at the edge.
2. Implement None, built-in illustration, and custom local image choices.
3. Persist custom blobs in IndexedDB and small settings in localStorage.
4. Add opacity, blur, fit, and position controls with a permanent readability veil.
5. Verify the background is lazy, does not block startup, and remains optional.

### Task 11: Add bounded local document history

**Files:**
- Modify: `src-tauri/src/filesystem.rs`, `models.rs`, `lib.rs`
- Create: `src/features/history/*`
- Modify: `src/lib/native.ts`, `src/hooks/useWorkspaceController.ts`, `src/App.tsx`

**Steps:**
1. Record deduplicated versions after successful saves under Tauri app data.
2. Enforce per-document count and storage bounds; history failures never corrupt saves.
3. List and preview versions with a compact line-level comparison.
4. Restore into the editor as a dirty draft instead of silently overwriting disk.
5. Cover storage limits, traversal, listing, reading, and UI restoration with tests.
