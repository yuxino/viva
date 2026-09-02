# Signed In-App Updater Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use the current repository's canonical checks and execute this plan task-by-task.

**Goal:** Ship Viva's first signed, user-confirmed, in-app update workflow and the release pipeline that feeds it.

**Architecture:** A typed React updater controller wraps the official Tauri JavaScript plugin while a small presentation component renders settings states. Tauri owns endpoint selection, signature verification, download, install, and relaunch capabilities; GitHub Actions builds signed target artifacts and publishes validated static metadata.

**Tech Stack:** React 19, TypeScript 6, Vitest, Tauri 2 updater/process plugins, Rust, GitHub Actions.

---

### Task 1: Add failing updater-state tests

**Files:**
- Create: `src/features/updater/updateState.test.ts`
- Create: `src/features/updater/UpdatePanel.test.tsx`

1. Test current, available, known-size, unknown-size, download/install error,
   retry, single-flight, Windows install wording, and explicit restart states.
2. Run the focused tests and confirm the missing implementation fails.

### Task 2: Implement the updater controller and UI

**Files:**
- Create: `src/features/updater/updateState.ts`
- Create: `src/features/updater/useAppUpdater.ts`
- Create: `src/features/updater/UpdatePanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/workspace.css`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh-Hans.ts`

1. Implement a single-flight state model and injectable official-plugin adapter.
2. Render version, notes, honest progress, retry, recovery, and platform-specific
   install/restart actions with keyboard and live-region semantics.
3. Run focused updater and i18n parity tests.

### Task 3: Enable official native plugins and signing

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/tauri.conf.json`

1. Pin the current official updater/process bindings and Rust crates.
2. Register both plugins and grant updater plus restart permissions only.
3. Enable updater artifacts, fixed HTTPS metadata, passive Windows installation,
   and the repository-safe public key.
4. Generate and recoverably store an encrypted private key outside the repo;
   set the two required GitHub Actions secrets without printing values.

### Task 4: Make releases fail closed

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `scripts/validate-updater-release.mjs`
- Create: `scripts/validate-updater-release.node-test.mjs`

1. Test rejection of wrong versions, non-HTTPS or wrong-tag URLs, duplicate
   targets/assets, empty signatures, missing target/arch entries, and mismatched
   asset hashes.
2. Build signed macOS arm64 and Windows x64 bundles into a draft Release.
3. Download and validate the complete draft, publish only after validation, and
   emit a SHA-256 ledger.

### Task 5: Document and deliver the bootstrap release

**Files:**
- Modify: `README.md`
- Modify: `README_ZH.md`
- Modify: `docs/architecture.md`
- Modify: `docs/README.md`
- Create: `docs/adr/0008-signed-user-confirmed-updates.md`
- Create: `docs/release-notes-v2.0.6.md`
- Modify: version sources and lockfiles

1. Explain the fixed signed feed, local document boundary, and one-time manual
   bootstrap from 2.0.5 or earlier.
2. Run focused tests, full canonical checks, builds, packaging, and a separate
   final diff/security review.
3. Commit and push `master`, verify live parity, tag the patch release, wait for
   CI/release completion, and verify public metadata, signatures, assets, and
   hashes before reporting native upgrade evidence separately.
