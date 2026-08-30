use crate::history;
use crate::locking::CrossProcessLock;
use crate::models::{
    CommandError, CommandResult, CreateDocumentRequest, CreateWorkspaceDirectoryRequest,
    DocumentPathRequest, DocumentSnapshot, DuplicateWorkspaceEntryRequest, ErrorCode,
    ExpectedDocumentRevision, FileRevision, HistoryWarningCode, InspectSaveDestinationRequest,
    OpenWorkspaceRequest, RenameWorkspaceEntryRequest, SaveDestinationState, SaveDocumentAsRequest,
    SearchMatch, SearchWorkspaceRequest, TrashWorkspaceEntryRequest, WorkspaceEntry,
    WorkspaceEntryKind, WorkspaceEntryMutation, WorkspaceTree, WriteDocumentRequest,
};
use crate::runtime::run_blocking;
#[cfg(target_os = "windows")]
use crate::secure_fs::rename_open_handle_noclobber;
use crate::secure_fs::{StableFileIdentity, random_component, stable_handle_identity};
use cap_std::ambient_authority;
use cap_std::fs::{
    Dir as CapabilityDir, File as CapabilityFile, OpenOptions as CapabilityOpenOptions,
};
use regex::{Regex, RegexBuilder};
use sha2::{Digest, Sha256};
use std::ffi::{OsStr, OsString};
use std::fs::{self, File, Metadata};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};
use tempfile::{Builder as TempFileBuilder, NamedTempFile};

pub(crate) const MAX_DOCUMENT_BYTES: u64 = 10 * 1024 * 1024;
const MAX_SEARCH_BYTES: u64 = 32 * 1024 * 1024;
const DEFAULT_SEARCH_RESULTS: usize = 100;
const MAX_SEARCH_RESULTS: usize = 500;
const MAX_QUERY_CHARS: usize = 256;
const MAX_TREE_ENTRIES: usize = 50_000;
const MAX_TREE_DEPTH: usize = 64;
const PREVIEW_CONTEXT_CHARS: usize = 72;
const PROCESS_LOCK_DIRECTORY_NAME: &str = "process-locks-v1";
const DOCUMENT_WRITES_LOCK_FILE_NAME: &str = "document-writes.lock";

pub(crate) struct HistoryDocument {
    pub workspace_root: PathBuf,
    pub relative_path: String,
    pub name: String,
}

struct ResolvedDocument {
    absolute_path: PathBuf,
    relative_path: String,
}

struct ResolvedSaveDestination {
    target: PathBuf,
    relative_path: String,
}

struct ResolvedWorkspaceEntry {
    absolute_path: PathBuf,
    relative_path: String,
    kind: WorkspaceEntryKind,
}

struct CapabilityDirectory {
    dir: CapabilityDir,
    absolute_path: PathBuf,
}

enum StableEntryHandle {
    File(CapabilityFile),
    Directory(CapabilityDir),
}

impl StableEntryHandle {
    fn identity(&self) -> CommandResult<StableFileIdentity> {
        match self {
            Self::File(file) => stable_handle_identity(file),
            Self::Directory(directory) => stable_handle_identity(directory),
        }
        .map_err(|error| io_error("Could not identify this workspace entry", error))
    }

    fn metadata(&self) -> CommandResult<cap_std::fs::Metadata> {
        match self {
            Self::File(file) => file.metadata(),
            Self::Directory(directory) => directory.dir_metadata(),
        }
        .map_err(|error| io_error("Could not inspect this workspace entry", error))
    }
}

#[derive(Debug)]
struct WriteOutcome {
    snapshot: DocumentSnapshot,
    previous_content: Option<String>,
}

struct TreeBudget {
    entries: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct MetadataRevision {
    modified_at_ms: u64,
    size_bytes: u64,
}

#[derive(Clone, Copy)]
struct SearchLimits {
    max_read_bytes: u64,
    max_entries: usize,
}

impl SearchLimits {
    const PRODUCTION: Self = Self {
        max_read_bytes: MAX_SEARCH_BYTES,
        max_entries: MAX_TREE_ENTRIES,
    };
}

struct SearchContext<'a, P> {
    root: &'a Path,
    matcher: &'a Regex,
    max_results: usize,
    limits: SearchLimits,
    inspected_entries: usize,
    read_bytes: u64,
    matches: Vec<SearchMatch>,
    inspect: P,
}

impl TreeBudget {
    fn count_entry(&mut self) -> CommandResult<()> {
        self.entries += 1;
        if self.entries > MAX_TREE_ENTRIES {
            return Err(CommandError::new(
                ErrorCode::WorkspaceTooLarge,
                "This workspace contains too many visible entries.",
            ));
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn open_workspace(request: OpenWorkspaceRequest) -> CommandResult<WorkspaceTree> {
    run_blocking(move || open_workspace_core(request)).await
}

fn open_workspace_core(request: OpenWorkspaceRequest) -> CommandResult<WorkspaceTree> {
    let root = canonical_workspace(&request.path)?;
    let mut budget = TreeBudget { entries: 0 };
    let children = walk_directory(&root, &root, 0, &mut budget)?;
    let name = root
        .file_name()
        .and_then(OsStr::to_str)
        .filter(|name| !name.is_empty())
        .unwrap_or("Workspace")
        .to_owned();

    Ok(WorkspaceTree {
        root_path: path_to_string(&root)?,
        name,
        children,
    })
}

#[tauri::command]
pub async fn read_document(request: DocumentPathRequest) -> CommandResult<DocumentSnapshot> {
    run_blocking(move || read_document_core(request)).await
}

fn read_document_core(request: DocumentPathRequest) -> CommandResult<DocumentSnapshot> {
    let root = canonical_workspace(&request.workspace_root)?;
    let resolved = resolve_existing_document(&root, &request.relative_path)?;
    snapshot_from_disk(&resolved)
}

#[tauri::command]
pub async fn write_document(
    app: AppHandle,
    request: WriteDocumentRequest,
) -> CommandResult<DocumentSnapshot> {
    run_blocking(move || write_document_sync(&app, request)).await
}

fn write_document_sync(
    app: &AppHandle,
    request: WriteDocumentRequest,
) -> CommandResult<DocumentSnapshot> {
    let workspace_root = request.workspace_root.clone();
    let (outcome, history_available) = with_document_write_lock_and_history(
        app,
        || write_document_core(request),
        |outcome| record_write_outcome_best_effort(app, &workspace_root, outcome),
    )?;
    Ok(with_history_warning(outcome.snapshot, history_available))
}

fn write_document_core(request: WriteDocumentRequest) -> CommandResult<WriteOutcome> {
    enforce_content_limit(&request.content)?;

    let root = canonical_workspace(&request.workspace_root)?;
    let resolved = resolve_existing_document(&root, &request.relative_path)?;
    let (previous_bytes, current_metadata) = read_bytes_limited(&resolved.absolute_path)?;
    if current_metadata.permissions().readonly() {
        return Err(CommandError::new(
            ErrorCode::Io,
            "This document is read-only.",
        ));
    }

    let current_revision =
        revision_from_metadata_and_hash(&current_metadata, sha256_hex(&previous_bytes))?;
    if current_revision != request.expected_revision {
        return Err(conflict_error());
    }

    let previous_content = String::from_utf8(previous_bytes).ok();

    let parent = resolved.absolute_path.parent().ok_or_else(|| {
        CommandError::new(ErrorCode::InvalidPath, "The document has no parent folder.")
    })?;
    let mut temporary = temporary_file(parent, Some(current_metadata.permissions()))?;
    write_and_flush(&mut temporary, request.content.as_bytes())?;

    ensure_no_symlink_components(&root, Path::new(&resolved.relative_path))?;
    if read_revision_limited(&resolved.absolute_path)? != request.expected_revision {
        return Err(conflict_error());
    }

    temporary
        .persist(&resolved.absolute_path)
        .map_err(|error| io_error("Could not replace this document", error.error))?;
    sync_parent_best_effort(parent);

    let revision = revision_from_metadata_and_hash(
        &fs::metadata(&resolved.absolute_path)
            .map_err(|error| io_error("Could not inspect the saved document", error))?,
        sha256_hex(request.content.as_bytes()),
    )?;

    Ok(WriteOutcome {
        snapshot: DocumentSnapshot {
            relative_path: resolved.relative_path,
            name: document_name(&resolved.absolute_path)?,
            content: request.content,
            revision,
            history_warning_code: None,
        },
        previous_content,
    })
}

#[tauri::command]
pub async fn create_document(
    app: AppHandle,
    request: CreateDocumentRequest,
) -> CommandResult<DocumentSnapshot> {
    run_blocking(move || create_document_sync(&app, request)).await
}

fn create_document_sync(
    app: &AppHandle,
    request: CreateDocumentRequest,
) -> CommandResult<DocumentSnapshot> {
    let workspace_root = request.workspace_root.clone();
    let (snapshot, history_available) = with_document_write_lock_and_history(
        app,
        || create_document_core(request),
        |snapshot| record_snapshot_best_effort(app, &workspace_root, snapshot),
    )?;
    Ok(with_history_warning(snapshot, history_available))
}

fn create_document_core(request: CreateDocumentRequest) -> CommandResult<DocumentSnapshot> {
    let root = canonical_workspace(&request.workspace_root)?;
    let content = request.content.unwrap_or_default();
    create_new_document(&root, &request.relative_path, content)
}

#[tauri::command]
pub async fn create_workspace_directory(
    app: AppHandle,
    request: CreateWorkspaceDirectoryRequest,
) -> CommandResult<WorkspaceEntryMutation> {
    run_blocking(move || {
        with_workspace_write_lock(&app, || create_workspace_directory_core(request))
    })
    .await
}

fn create_workspace_directory_core(
    request: CreateWorkspaceDirectoryRequest,
) -> CommandResult<WorkspaceEntryMutation> {
    create_workspace_directory_core_with_hook(request, || {})
}

fn create_workspace_directory_core_with_hook<F>(
    request: CreateWorkspaceDirectoryRequest,
    before_mutation: F,
) -> CommandResult<WorkspaceEntryMutation>
where
    F: FnOnce(),
{
    let root = canonical_workspace(&request.workspace_root)?;
    validate_mutation_name(&request.name)?;
    if is_ignored_directory(&request.name) {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "This folder is intentionally excluded from the workspace.",
        ));
    }

    let parent_path = resolve_workspace_directory(&root, &request.parent_relative_path)?;
    let parent_relative = parent_path.strip_prefix(&root).map_err(|_| {
        CommandError::new(
            ErrorCode::OutsideWorkspace,
            "The selected folder is outside the open workspace.",
        )
    })?;
    let parent = open_capability_directory(&root, parent_relative)?;
    before_mutation();

    parent
        .dir
        .create_dir(&request.name)
        .map_err(|error| io_error("Could not create this folder", error))?;
    if !capability_directory_matches_path(&parent, &parent_path)? {
        let rollback = parent.dir.remove_dir(&request.name);
        return Err(mutation_conflict_after_rollback(
            "The workspace folder changed while creating this folder.",
            rollback,
        ));
    }
    sync_capability_directory_best_effort(&parent.dir);

    let target = parent_path.join(&request.name);

    Ok(WorkspaceEntryMutation {
        kind: WorkspaceEntryKind::Directory,
        source_relative_path: None,
        destination_relative_path: Some(relative_path_to_string(&root, &target)?),
        recoverable: false,
        history_warning_code: None,
    })
}

#[tauri::command]
pub async fn rename_workspace_entry(
    app: AppHandle,
    request: RenameWorkspaceEntryRequest,
) -> CommandResult<WorkspaceEntryMutation> {
    run_blocking(move || {
        with_workspace_write_lock(&app, || rename_workspace_entry_sync(&app, request))
    })
    .await
}

fn rename_workspace_entry_sync(
    app: &AppHandle,
    request: RenameWorkspaceEntryRequest,
) -> CommandResult<WorkspaceEntryMutation> {
    let workspace_root = canonical_workspace(&request.workspace_root)?;
    let expected_document_paths: Vec<String> = request
        .expected_documents
        .iter()
        .map(|expected| expected.relative_path.clone())
        .collect();
    let mut result = rename_workspace_entry_core(request)?;
    let source_relative_path = result.source_relative_path.clone().ok_or_else(|| {
        CommandError::new(
            ErrorCode::Io,
            "The rename result did not include its source path.",
        )
    })?;
    let requested_destination = result.destination_relative_path.clone().ok_or_else(|| {
        CommandError::new(
            ErrorCode::Io,
            "The rename result did not include its destination path.",
        )
    })?;
    let renamed_entry = resolve_existing_workspace_entry(&workspace_root, &requested_destination)?;
    let destination_relative_path = renamed_entry.relative_path.clone();
    result.destination_relative_path = Some(destination_relative_path.clone());

    let (history_mappings, history_scan_complete) = match result.kind {
        WorkspaceEntryKind::File => (
            vec![(
                source_relative_path.clone(),
                destination_relative_path.clone(),
            )],
            true,
        ),
        WorkspaceEntryKind::Directory => {
            let mut budget = TreeBudget { entries: 0 };
            let mut scan_complete = true;
            match walk_directory_with_completeness(
                &workspace_root,
                &renamed_entry.absolute_path,
                0,
                &mut budget,
                &mut scan_complete,
            ) {
                Ok(entries) => directory_history_mappings(
                    &source_relative_path,
                    &destination_relative_path,
                    &entries,
                    scan_complete,
                    &expected_document_paths,
                ),
                Err(_) => directory_history_mappings(
                    &source_relative_path,
                    &destination_relative_path,
                    &[],
                    false,
                    &expected_document_paths,
                ),
            }
        }
        WorkspaceEntryKind::Image => (Vec::new(), true),
    };
    let history_available =
        history::move_document_histories_best_effort(app, &workspace_root, &history_mappings)
            && history_scan_complete;
    if !history_available {
        result.history_warning_code = Some(HistoryWarningCode::HistoryUnavailable);
    }
    Ok(result)
}

fn rename_workspace_entry_core(
    request: RenameWorkspaceEntryRequest,
) -> CommandResult<WorkspaceEntryMutation> {
    rename_workspace_entry_core_with_hooks(request, || {}, || {})
}

#[cfg(all(test, unix))]
fn rename_workspace_entry_core_with_hook<F>(
    request: RenameWorkspaceEntryRequest,
    before_mutation: F,
) -> CommandResult<WorkspaceEntryMutation>
where
    F: FnOnce(),
{
    rename_workspace_entry_core_with_hooks(request, before_mutation, || {})
}

fn rename_workspace_entry_core_with_hooks<F, G>(
    request: RenameWorkspaceEntryRequest,
    before_mutation: F,
    after_identity_check: G,
) -> CommandResult<WorkspaceEntryMutation>
where
    F: FnOnce(),
    G: FnOnce(),
{
    let root = canonical_workspace(&request.workspace_root)?;
    let source = resolve_existing_workspace_entry(&root, &request.relative_path)?;
    validate_mutation_name(&request.new_name)?;
    validate_renamed_entry(&source, &request.new_name)?;
    ensure_expected_documents_current(&root, &source, &request.expected_documents)?;
    ensure_entry_path_still_resolves(&root, &source)?;

    let parent_path = source.absolute_path.parent().ok_or_else(|| {
        CommandError::new(
            ErrorCode::InvalidPath,
            "Workspace entries must have a parent folder.",
        )
    })?;
    let parent_relative = parent_path.strip_prefix(&root).map_err(|_| {
        CommandError::new(
            ErrorCode::OutsideWorkspace,
            "The selected entry is outside the open workspace.",
        )
    })?;
    let parent = open_capability_directory(&root, parent_relative)?;
    let source_name = source.absolute_path.file_name().ok_or_else(|| {
        CommandError::new(ErrorCode::InvalidPath, "Choose a valid workspace entry.")
    })?;
    let source_handle = open_stable_entry(&parent.dir, source_name, source.kind)?;
    let source_identity = source_handle.identity()?;

    let destination = parent_path.join(&request.new_name);
    let destination_relative_path = relative_path_to_string(&root, &destination)?;

    if destination == source.absolute_path {
        return Ok(WorkspaceEntryMutation {
            kind: source.kind,
            source_relative_path: Some(source.relative_path),
            destination_relative_path: Some(destination_relative_path),
            recoverable: false,
            history_warning_code: None,
        });
    }

    before_mutation();
    if !stable_entry_path_matches(&parent.dir, source_name, source.kind, source_identity)? {
        return Err(workspace_entry_conflict_error());
    }

    let case_only_alias = match parent.dir.symlink_metadata(&request.new_name) {
        Ok(metadata) => {
            if metadata.is_symlink() {
                return Err(CommandError::new(
                    ErrorCode::AlreadyExists,
                    "A workspace entry already exists at this location.",
                ));
            }
            if !stable_entry_path_matches(
                &parent.dir,
                OsStr::new(&request.new_name),
                source.kind,
                source_identity,
            )? || directory_contains_exact_name(&parent.dir, OsStr::new(&request.new_name))?
            {
                return Err(CommandError::new(
                    ErrorCode::AlreadyExists,
                    "A workspace entry already exists at this location.",
                ));
            }
            true
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => return Err(io_error("Could not inspect the rename destination", error)),
    };

    after_identity_check();
    if case_only_alias {
        rename_case_only_bound(
            &parent,
            source_name,
            OsStr::new(&request.new_name),
            source.kind,
            source_identity,
        )?;
    } else {
        capability_rename_noclobber(
            &parent,
            source_name,
            &parent,
            OsStr::new(&request.new_name),
            "Could not rename this workspace entry",
        )?;
        ensure_moved_entry_identity_or_rollback(
            &parent,
            OsStr::new(&request.new_name),
            source_name,
            source.kind,
            source_identity,
            "The workspace entry changed while it was being renamed.",
        )?;
    }
    if !capability_directory_matches_path(&parent, parent_path)? {
        let rollback = rollback_moved_entry(&parent, OsStr::new(&request.new_name), source_name);
        return Err(mutation_conflict_after_rollback(
            "The workspace folder changed while renaming this entry.",
            rollback,
        ));
    }
    ensure_moved_entry_identity_or_rollback(
        &parent,
        OsStr::new(&request.new_name),
        source_name,
        source.kind,
        source_identity,
        "The workspace entry changed while it was being renamed.",
    )?;
    sync_capability_directory_best_effort(&parent.dir);

    Ok(WorkspaceEntryMutation {
        kind: source.kind,
        source_relative_path: Some(source.relative_path),
        destination_relative_path: Some(destination_relative_path),
        recoverable: false,
        history_warning_code: None,
    })
}

#[tauri::command]
pub async fn duplicate_workspace_entry(
    app: AppHandle,
    request: DuplicateWorkspaceEntryRequest,
) -> CommandResult<WorkspaceEntryMutation> {
    run_blocking(move || {
        with_workspace_write_lock(&app, || duplicate_workspace_entry_core(request))
    })
    .await
}

fn duplicate_workspace_entry_core(
    request: DuplicateWorkspaceEntryRequest,
) -> CommandResult<WorkspaceEntryMutation> {
    duplicate_workspace_entry_core_with_hooks(request, || {}, |_, _| {})
}

#[cfg(all(test, unix))]
fn duplicate_workspace_entry_core_with_hook<F>(
    request: DuplicateWorkspaceEntryRequest,
    before_mutation: F,
) -> CommandResult<WorkspaceEntryMutation>
where
    F: FnOnce(),
{
    duplicate_workspace_entry_core_with_hooks(request, before_mutation, |_, _| {})
}

fn duplicate_workspace_entry_core_with_hooks<F, G>(
    request: DuplicateWorkspaceEntryRequest,
    before_mutation: F,
    after_temporary_ready: G,
) -> CommandResult<WorkspaceEntryMutation>
where
    F: FnOnce(),
    G: FnOnce(&CapabilityDir, &OsStr),
{
    let root = canonical_workspace(&request.workspace_root)?;
    let source = resolve_existing_workspace_entry(&root, &request.relative_path)?;
    if source.kind == WorkspaceEntryKind::Directory {
        return Err(CommandError::new(
            ErrorCode::NotFile,
            "Folders cannot be duplicated yet.",
        ));
    }
    ensure_duplicate_revision_current(&source, request.expected_revision.as_ref())?;
    ensure_entry_path_still_resolves(&root, &source)?;

    let parent_path = source.absolute_path.parent().ok_or_else(|| {
        CommandError::new(
            ErrorCode::InvalidPath,
            "Workspace entries must have a parent folder.",
        )
    })?;
    let parent_relative = parent_path.strip_prefix(&root).map_err(|_| {
        CommandError::new(
            ErrorCode::OutsideWorkspace,
            "The selected entry is outside the open workspace.",
        )
    })?;
    let parent = open_capability_directory(&root, parent_relative)?;
    let source_name = source.absolute_path.file_name().ok_or_else(|| {
        CommandError::new(ErrorCode::InvalidPath, "Choose a valid workspace entry.")
    })?;
    let source_handle = open_stable_entry(&parent.dir, source_name, source.kind)?;
    let source_identity = source_handle.identity()?;
    before_mutation();
    if !stable_entry_path_matches(&parent.dir, source_name, source.kind, source_identity)? {
        return Err(workspace_entry_conflict_error());
    }

    let stem = source
        .absolute_path
        .file_stem()
        .and_then(OsStr::to_str)
        .ok_or_else(|| CommandError::new(ErrorCode::InvalidPath, "Choose a valid file name."))?;
    let extension = source
        .absolute_path
        .extension()
        .and_then(OsStr::to_str)
        .ok_or_else(|| CommandError::new(ErrorCode::InvalidPath, "Choose a valid file name."))?;

    let mut after_temporary_ready = Some(after_temporary_ready);
    for copy_index in 1..=10_000_u32 {
        let suffix = if copy_index == 1 {
            " copy".to_owned()
        } else {
            format!(" copy {copy_index}")
        };
        let destination_name = format!("{stem}{suffix}.{extension}");
        let destination = parent_path.join(&destination_name);
        match copy_file_noclobber_capability(
            &parent,
            source_name,
            source.kind,
            source_identity,
            &destination_name,
            request.expected_revision.as_ref(),
            &mut after_temporary_ready,
        ) {
            Ok(destination_identity) => {
                if !capability_directory_matches_path(&parent, parent_path)? {
                    let rollback = if verify_capability_file_identity(
                        &parent.dir,
                        OsStr::new(&destination_name),
                        destination_identity,
                    )
                    .unwrap_or(false)
                    {
                        parent.dir.remove_file(&destination_name)
                    } else {
                        Err(io::Error::other(
                            "the duplicate destination changed before rollback",
                        ))
                    };
                    return Err(mutation_conflict_after_rollback(
                        "The workspace folder changed while duplicating this entry.",
                        rollback,
                    ));
                }
                sync_capability_directory_best_effort(&parent.dir);
                return Ok(WorkspaceEntryMutation {
                    kind: source.kind,
                    source_relative_path: Some(source.relative_path),
                    destination_relative_path: Some(relative_path_to_string(&root, &destination)?),
                    recoverable: false,
                    history_warning_code: None,
                });
            }
            Err(error) if error.code == ErrorCode::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    Err(CommandError::new(
        ErrorCode::AlreadyExists,
        "Viva could not find an available copy name.",
    ))
}

#[tauri::command]
pub async fn trash_workspace_entry(
    app: AppHandle,
    request: TrashWorkspaceEntryRequest,
) -> CommandResult<WorkspaceEntryMutation> {
    run_blocking(move || {
        with_workspace_write_lock(&app, || {
            trash_workspace_entry_core(request, move_staged_entry_to_system_trash)
        })
    })
    .await
}

fn trash_workspace_entry_core<F>(
    request: TrashWorkspaceEntryRequest,
    move_to_trash: F,
) -> CommandResult<WorkspaceEntryMutation>
where
    F: FnOnce(
        &CapabilityDirectory,
        &OsStr,
        WorkspaceEntryKind,
        StableFileIdentity,
    ) -> CommandResult<()>,
{
    trash_workspace_entry_core_with_hooks(request, || {}, || {}, |_, _| {}, move_to_trash)
}

#[cfg(all(test, unix))]
fn trash_workspace_entry_core_with_hook<H, F>(
    request: TrashWorkspaceEntryRequest,
    before_staging: H,
    move_to_trash: F,
) -> CommandResult<WorkspaceEntryMutation>
where
    H: FnOnce(),
    F: FnOnce(
        &CapabilityDirectory,
        &OsStr,
        WorkspaceEntryKind,
        StableFileIdentity,
    ) -> CommandResult<()>,
{
    trash_workspace_entry_core_with_hooks(request, before_staging, || {}, |_, _| {}, move_to_trash)
}

fn trash_workspace_entry_core_with_hooks<H, I, J, F>(
    request: TrashWorkspaceEntryRequest,
    before_staging: H,
    after_identity_check: I,
    after_staging: J,
    move_to_trash: F,
) -> CommandResult<WorkspaceEntryMutation>
where
    H: FnOnce(),
    I: FnOnce(),
    J: FnOnce(&CapabilityDirectory, &OsStr),
    F: FnOnce(
        &CapabilityDirectory,
        &OsStr,
        WorkspaceEntryKind,
        StableFileIdentity,
    ) -> CommandResult<()>,
{
    let root = canonical_workspace(&request.workspace_root)?;
    let source = resolve_existing_workspace_entry(&root, &request.relative_path)?;
    ensure_expected_documents_current(&root, &source, &request.expected_documents)?;
    ensure_entry_path_still_resolves(&root, &source)?;
    let parent_path = source.absolute_path.parent().ok_or_else(|| {
        CommandError::new(
            ErrorCode::InvalidPath,
            "Workspace entries must have a parent folder.",
        )
    })?;
    let parent_relative = parent_path.strip_prefix(&root).map_err(|_| {
        CommandError::new(
            ErrorCode::OutsideWorkspace,
            "The selected entry is outside the open workspace.",
        )
    })?;
    let parent = open_capability_directory(&root, parent_relative)?;
    let workspace = open_capability_directory(&root, Path::new(""))?;
    let source_name = source.absolute_path.file_name().ok_or_else(|| {
        CommandError::new(ErrorCode::InvalidPath, "Choose a valid workspace entry.")
    })?;
    let source_handle = open_stable_entry(&parent.dir, source_name, source.kind)?;
    let source_identity = source_handle.identity()?;
    before_staging();
    if !stable_entry_path_matches(&parent.dir, source_name, source.kind, source_identity)? {
        return Err(workspace_entry_conflict_error());
    }
    after_identity_check();

    let staging = create_trash_staging_directory(&workspace)?;
    capability_rename_noclobber(
        &parent,
        source_name,
        staging.directory(),
        source_name,
        "Could not stage this workspace entry for the system Trash",
    )?;
    if !stable_entry_path_matches(
        &staging.directory().dir,
        source_name,
        source.kind,
        source_identity,
    )
    .unwrap_or(false)
    {
        let rollback =
            capability_rename_noclobber_io(staging.directory(), source_name, &parent, source_name);
        return Err(mutation_conflict_after_rollback(
            "The workspace entry changed while it was being staged for Trash.",
            rollback,
        ));
    }
    sync_capability_directory_best_effort(&parent.dir);
    sync_capability_directory_best_effort(&workspace.dir);

    after_staging(staging.directory(), source_name);
    if !stable_entry_path_matches(
        &staging.directory().dir,
        source_name,
        source.kind,
        source_identity,
    )? {
        return Err(mutation_conflict_after_rollback(
            "The staged workspace entry changed before it could be moved to Trash.",
            capability_rename_noclobber_io(staging.directory(), source_name, &parent, source_name),
        ));
    }
    if let Err(error) = move_to_trash(
        staging.directory(),
        source_name,
        source.kind,
        source_identity,
    ) {
        let rollback = capability_rename_noclobber(
            staging.directory(),
            source_name,
            &parent,
            source_name,
            "Could not restore this workspace entry after the system Trash failed",
        );
        return match rollback {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(CommandError::new(
                ErrorCode::Io,
                format!(
                    "{} Viva also could not restore the staged entry: {}",
                    error.message, rollback_error.message
                ),
            )),
        };
    }
    match staging.directory().dir.symlink_metadata(source_name) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Ok(_) | Err(_) => {
            let rollback = capability_rename_noclobber_io(
                staging.directory(),
                source_name,
                &parent,
                source_name,
            );
            return Err(mutation_conflict_after_rollback(
                "The system Trash did not remove the staged workspace entry cleanly.",
                rollback,
            ));
        }
    }
    sync_capability_directory_best_effort(&workspace.dir);

    Ok(WorkspaceEntryMutation {
        kind: source.kind,
        source_relative_path: Some(source.relative_path),
        destination_relative_path: None,
        recoverable: true,
        history_warning_code: None,
    })
}

#[tauri::command]
pub async fn inspect_save_destination(
    request: InspectSaveDestinationRequest,
) -> CommandResult<SaveDestinationState> {
    run_blocking(move || inspect_save_destination_core(request)).await
}

fn inspect_save_destination_core(
    request: InspectSaveDestinationRequest,
) -> CommandResult<SaveDestinationState> {
    let root = canonical_workspace(&request.workspace_root)?;
    let destination = resolve_save_destination(&root, &request.destination_path)?;
    let revision = match fs::symlink_metadata(&destination.target) {
        Ok(metadata) => {
            validate_save_destination_file(&root, &destination.target, &metadata)?;
            Some(read_revision_limited(&destination.target)?)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(io_error("Could not inspect the save destination", error)),
    };
    Ok(SaveDestinationState {
        relative_path: destination.relative_path,
        revision,
    })
}

#[tauri::command]
pub async fn save_document_as(
    app: AppHandle,
    request: SaveDocumentAsRequest,
) -> CommandResult<DocumentSnapshot> {
    run_blocking(move || save_document_as_sync(&app, request)).await
}

fn save_document_as_sync(
    app: &AppHandle,
    request: SaveDocumentAsRequest,
) -> CommandResult<DocumentSnapshot> {
    let workspace_root = request.workspace_root.clone();
    let (outcome, history_available) = with_document_write_lock_and_history(
        app,
        || save_document_as_core(request),
        |outcome| record_write_outcome_best_effort(app, &workspace_root, outcome),
    )?;
    Ok(with_history_warning(outcome.snapshot, history_available))
}

fn save_document_as_core(request: SaveDocumentAsRequest) -> CommandResult<WriteOutcome> {
    enforce_content_limit(&request.content)?;

    let root = canonical_workspace(&request.workspace_root)?;
    let destination = resolve_save_destination(&root, &request.destination_path)?;
    let previous_content = match request.expected_destination_revision {
        None => {
            ensure_target_absent(&destination.target)?;
            persist_new_document(&destination.target, &request.content)?;
            None
        }
        Some(expected_revision) => Some(replace_save_destination(
            &root,
            &destination.target,
            &request.content,
            &expected_revision,
        )?),
    };

    let revision = revision_from_metadata_and_hash(
        &fs::metadata(&destination.target)
            .map_err(|error| io_error("Could not inspect the saved document", error))?,
        sha256_hex(request.content.as_bytes()),
    )?;

    Ok(WriteOutcome {
        snapshot: DocumentSnapshot {
            relative_path: destination.relative_path,
            name: document_name(&destination.target)?,
            content: request.content,
            revision,
            history_warning_code: None,
        },
        previous_content,
    })
}

fn with_document_write_lock_and_history<T>(
    app: &AppHandle,
    persist: impl FnOnce() -> CommandResult<T>,
    record_history: impl FnOnce(&T) -> bool,
) -> CommandResult<(T, bool)> {
    let app_data = app_data_directory(app)?;
    with_document_write_lock_and_history_path(
        &app_data
            .join(PROCESS_LOCK_DIRECTORY_NAME)
            .join(DOCUMENT_WRITES_LOCK_FILE_NAME),
        persist,
        record_history,
    )
}

fn with_workspace_write_lock<T>(
    app: &AppHandle,
    operation: impl FnOnce() -> CommandResult<T>,
) -> CommandResult<T> {
    let app_data = app_data_directory(app)?;
    with_document_write_lock_path(
        &app_data
            .join(PROCESS_LOCK_DIRECTORY_NAME)
            .join(DOCUMENT_WRITES_LOCK_FILE_NAME),
        operation,
    )
}

fn app_data_directory(app: &AppHandle) -> CommandResult<PathBuf> {
    app.path().app_data_dir().map_err(|error| {
        CommandError::new(
            ErrorCode::Io,
            format!("Could not locate Viva's app data folder: {error}"),
        )
    })
}

fn with_document_write_lock_and_history_path<T>(
    lock_path: &Path,
    persist: impl FnOnce() -> CommandResult<T>,
    record_history: impl FnOnce(&T) -> bool,
) -> CommandResult<(T, bool)> {
    with_document_write_lock_path(lock_path, || {
        let value = persist()?;
        let history_available = record_history(&value);
        Ok((value, history_available))
    })
}

fn with_document_write_lock_path<T>(
    lock_path: &Path,
    operation: impl FnOnce() -> CommandResult<T>,
) -> CommandResult<T> {
    let _guard = CrossProcessLock::acquire(lock_path, "document writes")?;
    operation()
}

fn record_snapshot_best_effort(
    app: &AppHandle,
    requested_workspace_root: &str,
    snapshot: &DocumentSnapshot,
) -> bool {
    record_content_best_effort(
        app,
        requested_workspace_root,
        &snapshot.relative_path,
        &snapshot.content,
    )
}

fn record_write_outcome_best_effort(
    app: &AppHandle,
    requested_workspace_root: &str,
    outcome: &WriteOutcome,
) -> bool {
    let Ok(workspace_root) = canonical_workspace(requested_workspace_root) else {
        return false;
    };
    let mut contents = Vec::with_capacity(2);
    if let Some(previous_content) = outcome.previous_content.as_deref() {
        contents.push(previous_content);
    }
    contents.push(outcome.snapshot.content.as_str());
    history::record_document_versions_best_effort(
        app,
        &workspace_root,
        &outcome.snapshot.relative_path,
        &contents,
    )
}

#[cfg(test)]
fn for_each_write_version(outcome: &WriteOutcome, mut record: impl FnMut(&str)) {
    if let Some(previous_content) = outcome.previous_content.as_deref() {
        record(previous_content);
    }
    record(&outcome.snapshot.content);
}

fn record_content_best_effort(
    app: &AppHandle,
    requested_workspace_root: &str,
    relative_path: &str,
    content: &str,
) -> bool {
    let Ok(workspace_root) = canonical_workspace(requested_workspace_root) else {
        return false;
    };
    history::record_document_version_best_effort(app, &workspace_root, relative_path, content)
}

fn with_history_warning(
    mut snapshot: DocumentSnapshot,
    history_available: bool,
) -> DocumentSnapshot {
    if !history_available {
        snapshot.history_warning_code = Some(HistoryWarningCode::HistoryUnavailable);
    }
    snapshot
}

#[tauri::command]
pub async fn search_workspace(request: SearchWorkspaceRequest) -> CommandResult<Vec<SearchMatch>> {
    run_blocking(move || search_workspace_core(request)).await
}

fn search_workspace_core(request: SearchWorkspaceRequest) -> CommandResult<Vec<SearchMatch>> {
    search_workspace_with_limits(request, SearchLimits::PRODUCTION, |_| {})
}

fn search_workspace_with_limits<P>(
    request: SearchWorkspaceRequest,
    limits: SearchLimits,
    inspect: P,
) -> CommandResult<Vec<SearchMatch>>
where
    P: FnMut(&Path),
{
    if request.query.is_empty() {
        return Ok(Vec::new());
    }
    if request.query.chars().count() > MAX_QUERY_CHARS {
        return Err(CommandError::new(
            ErrorCode::InvalidQuery,
            format!("Search queries are limited to {MAX_QUERY_CHARS} characters."),
        ));
    }

    let max_results = request
        .max_results
        .unwrap_or(DEFAULT_SEARCH_RESULTS)
        .min(MAX_SEARCH_RESULTS);
    if max_results == 0 {
        return Ok(Vec::new());
    }

    let matcher = RegexBuilder::new(&regex::escape(&request.query))
        .case_insensitive(true)
        .unicode(true)
        .size_limit(1024 * 1024)
        .build()
        .map_err(|_| CommandError::new(ErrorCode::InvalidQuery, "Invalid search query."))?;

    let root = canonical_workspace(&request.workspace_root)?;
    let mut context = SearchContext {
        root: &root,
        matcher: &matcher,
        max_results,
        limits,
        inspected_entries: 0,
        read_bytes: 0,
        matches: Vec::new(),
        inspect,
    };
    context.visit_directory(&root, 0)?;
    Ok(context.matches)
}

impl<P> SearchContext<'_, P>
where
    P: FnMut(&Path),
{
    fn visit_directory(&mut self, current: &Path, depth: usize) -> CommandResult<bool> {
        if depth >= MAX_TREE_DEPTH || self.should_stop() {
            return Ok(self.should_stop());
        }

        let directory = fs::read_dir(current)
            .map_err(|error| io_error("Could not read this workspace folder", error))?;
        let mut entries = Vec::new();
        for entry in directory {
            let entry =
                entry.map_err(|error| io_error("Could not read a workspace entry", error))?;
            let name = match entry.file_name().into_string() {
                Ok(name) => name,
                Err(_) => continue,
            };
            if is_hidden_name(&name) || is_ignored_directory(&name) {
                continue;
            }
            entries.push((name.to_lowercase(), name, entry));
        }
        entries.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));

        for (_, _, entry) in entries {
            if self.should_stop() || self.inspected_entries >= self.limits.max_entries {
                return Ok(true);
            }
            self.inspected_entries += 1;

            let path = entry.path();
            (self.inspect)(&path);
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            if file_type.is_symlink() {
                continue;
            }

            if file_type.is_dir() {
                let relative = match path.strip_prefix(self.root) {
                    Ok(relative) => relative,
                    Err(_) => continue,
                };
                if ensure_no_symlink_components(self.root, relative).is_err() {
                    continue;
                }
                let canonical = match fs::canonicalize(&path) {
                    Ok(canonical) if ensure_within_workspace(self.root, &canonical).is_ok() => {
                        canonical
                    }
                    _ => continue,
                };
                if self.visit_directory(&canonical, depth + 1)? {
                    return Ok(true);
                }
            } else if file_type.is_file() && is_allowed_document(&path) {
                self.search_document(&path)?;
                if self.should_stop() {
                    return Ok(true);
                }
            }
        }

        Ok(false)
    }

    fn search_document(&mut self, path: &Path) -> CommandResult<()> {
        let relative_path = match relative_path_to_string(self.root, path) {
            Ok(relative_path) => relative_path,
            Err(_) => return Ok(()),
        };
        let resolved = match resolve_existing_document(self.root, &relative_path) {
            Ok(resolved) => resolved,
            Err(_) => return Ok(()),
        };
        let remaining_bytes = self.limits.max_read_bytes.saturating_sub(self.read_bytes);
        if remaining_bytes == 0 {
            return Ok(());
        }

        let (content, bytes_read) = match read_utf8_content_with_limit(
            &resolved.absolute_path,
            remaining_bytes.min(MAX_DOCUMENT_BYTES),
        ) {
            Ok(content) => content,
            Err(_) => return Ok(()),
        };
        self.read_bytes = self.read_bytes.saturating_add(bytes_read);
        for (line_index, line) in content.lines().enumerate() {
            for found in self.matcher.find_iter(line) {
                self.matches.push(SearchMatch {
                    relative_path: resolved.relative_path.clone(),
                    line: line_index + 1,
                    column: line[..found.start()].chars().count() + 1,
                    preview: search_preview(line, found.start(), found.end()),
                });
                if self.matches.len() >= self.max_results {
                    return Ok(());
                }
            }
        }
        Ok(())
    }

    fn should_stop(&self) -> bool {
        self.matches.len() >= self.max_results
            || self.read_bytes >= self.limits.max_read_bytes
            || self.inspected_entries >= self.limits.max_entries
    }
}

fn walk_directory(
    root: &Path,
    current: &Path,
    depth: usize,
    budget: &mut TreeBudget,
) -> CommandResult<Vec<WorkspaceEntry>> {
    let mut complete = true;
    walk_directory_with_completeness(root, current, depth, budget, &mut complete)
}

fn walk_directory_with_completeness(
    root: &Path,
    current: &Path,
    depth: usize,
    budget: &mut TreeBudget,
    complete: &mut bool,
) -> CommandResult<Vec<WorkspaceEntry>> {
    if depth >= MAX_TREE_DEPTH {
        *complete = false;
        return Ok(Vec::new());
    }

    let mut visible_entries = Vec::new();
    let directory = fs::read_dir(current)
        .map_err(|error| io_error("Could not read this workspace folder", error))?;

    for entry in directory {
        let entry = entry.map_err(|error| io_error("Could not read a workspace entry", error))?;
        let name = match entry.file_name().into_string() {
            Ok(name) => name,
            Err(_) => continue,
        };
        if is_hidden_name(&name) {
            continue;
        }

        let file_type = entry
            .file_type()
            .map_err(|error| io_error("Could not inspect a workspace entry", error))?;
        if file_type.is_symlink() {
            continue;
        }

        let path = entry.path();
        if file_type.is_dir() {
            if is_ignored_directory(&name) {
                continue;
            }
            let children =
                walk_directory_with_completeness(root, &path, depth + 1, budget, complete)?;
            budget.count_entry()?;
            visible_entries.push(WorkspaceEntry {
                name,
                relative_path: relative_path_to_string(root, &path)?,
                kind: WorkspaceEntryKind::Directory,
                children,
            });
        } else if file_type.is_file() {
            let kind = if is_allowed_document(&path) {
                Some(WorkspaceEntryKind::File)
            } else if is_allowed_image(&path) {
                Some(WorkspaceEntryKind::Image)
            } else {
                None
            };
            if let Some(kind) = kind {
                budget.count_entry()?;
                visible_entries.push(WorkspaceEntry {
                    name,
                    relative_path: relative_path_to_string(root, &path)?,
                    kind,
                    children: Vec::new(),
                });
            }
        }
    }

    visible_entries.sort_by(|left, right| {
        entry_sort_rank(left.kind)
            .cmp(&entry_sort_rank(right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(visible_entries)
}

fn entry_sort_rank(kind: WorkspaceEntryKind) -> u8 {
    match kind {
        WorkspaceEntryKind::Directory => 0,
        WorkspaceEntryKind::File => 1,
        WorkspaceEntryKind::Image => 2,
    }
}

fn collect_document_paths(entries: &[WorkspaceEntry], output: &mut Vec<String>) {
    for entry in entries {
        match entry.kind {
            WorkspaceEntryKind::Directory => collect_document_paths(&entry.children, output),
            WorkspaceEntryKind::File => output.push(entry.relative_path.clone()),
            WorkspaceEntryKind::Image => {}
        }
    }
}

fn directory_history_mappings(
    source_relative_path: &str,
    destination_relative_path: &str,
    entries: &[WorkspaceEntry],
    scan_complete: bool,
    expected_document_paths: &[String],
) -> (Vec<(String, String)>, bool) {
    let mut destination_documents = Vec::new();
    collect_document_paths(entries, &mut destination_documents);

    let mut complete = scan_complete;
    let mut mappings = Vec::new();
    for destination in destination_documents {
        match renamed_descendant_path(
            destination_relative_path,
            source_relative_path,
            &destination,
        ) {
            Some(source) => mappings.push((source, destination)),
            None => complete = false,
        }
    }

    // The tree walk is bounded for responsiveness. Open documents supplied by the
    // caller are authoritative and must still have their history migrated even
    // when they live below that bound or the best-effort scan fails.
    for source in expected_document_paths {
        let Some(destination) =
            renamed_descendant_path(source_relative_path, destination_relative_path, source)
        else {
            complete = false;
            continue;
        };
        if !mappings.iter().any(|mapping| mapping.0 == *source) {
            mappings.push((source.clone(), destination));
        }
    }

    (mappings, complete)
}

fn canonical_workspace(path: &str) -> CommandResult<PathBuf> {
    if path.is_empty() {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "Choose a workspace folder.",
        ));
    }

    let path = Path::new(path);
    if !path.is_absolute() {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "The workspace path must be absolute.",
        ));
    }

    let canonical =
        fs::canonicalize(path).map_err(|error| io_error("Could not open this workspace", error))?;
    let metadata = fs::metadata(&canonical)
        .map_err(|error| io_error("Could not inspect this workspace", error))?;
    if !metadata.is_dir() {
        return Err(CommandError::new(
            ErrorCode::NotDirectory,
            "The selected workspace is not a folder.",
        ));
    }
    path_to_string(&canonical)?;
    Ok(canonical)
}

pub(crate) fn resolve_history_document(
    workspace_root: &str,
    relative_path: &str,
) -> CommandResult<HistoryDocument> {
    let root = canonical_workspace(workspace_root)?;
    let resolved = resolve_existing_document(&root, relative_path)?;
    Ok(HistoryDocument {
        name: document_name(&resolved.absolute_path)?,
        workspace_root: root,
        relative_path: resolved.relative_path,
    })
}

fn resolve_existing_document(root: &Path, relative: &str) -> CommandResult<ResolvedDocument> {
    let clean_relative = validate_relative_document(relative)?;
    ensure_no_symlink_components(root, &clean_relative)?;

    let candidate = root.join(&clean_relative);
    let link_metadata = fs::symlink_metadata(&candidate)
        .map_err(|error| io_error("Could not find this document", error))?;
    if link_metadata.file_type().is_symlink() {
        return Err(CommandError::new(
            ErrorCode::SymlinkNotAllowed,
            "Symbolic links are not available in a Viva workspace.",
        ));
    }

    let canonical = fs::canonicalize(&candidate)
        .map_err(|error| io_error("Could not open this document", error))?;
    ensure_within_workspace(root, &canonical)?;
    if !fs::metadata(&canonical)
        .map_err(|error| io_error("Could not inspect this document", error))?
        .is_file()
    {
        return Err(CommandError::new(
            ErrorCode::NotFile,
            "The selected entry is not a document.",
        ));
    }

    let relative_path = relative_path_to_string(root, &canonical)?;
    Ok(ResolvedDocument {
        absolute_path: canonical,
        relative_path,
    })
}

fn resolve_existing_workspace_entry(
    root: &Path,
    relative: &str,
) -> CommandResult<ResolvedWorkspaceEntry> {
    let clean_relative = validate_relative_path(Path::new(relative))?;
    ensure_no_symlink_components(root, &clean_relative)?;

    let candidate = root.join(&clean_relative);
    let link_metadata = fs::symlink_metadata(&candidate)
        .map_err(|error| io_error("Could not find this workspace entry", error))?;
    if link_metadata.file_type().is_symlink() {
        return Err(CommandError::new(
            ErrorCode::SymlinkNotAllowed,
            "Symbolic links are not available in a Viva workspace.",
        ));
    }

    let canonical = fs::canonicalize(&candidate)
        .map_err(|error| io_error("Could not open this workspace entry", error))?;
    ensure_within_workspace(root, &canonical)?;
    let metadata = fs::metadata(&canonical)
        .map_err(|error| io_error("Could not inspect this workspace entry", error))?;
    let kind = if metadata.is_dir() {
        let name = canonical
            .file_name()
            .and_then(OsStr::to_str)
            .ok_or_else(|| {
                CommandError::new(ErrorCode::InvalidPath, "Choose a valid workspace folder.")
            })?;
        if is_ignored_directory(name) {
            return Err(CommandError::new(
                ErrorCode::InvalidPath,
                "This folder is intentionally excluded from the workspace.",
            ));
        }
        WorkspaceEntryKind::Directory
    } else if metadata.is_file() && is_allowed_document(&canonical) {
        WorkspaceEntryKind::File
    } else if metadata.is_file() && is_allowed_image(&canonical) {
        WorkspaceEntryKind::Image
    } else if metadata.is_file() {
        return Err(CommandError::new(
            ErrorCode::UnsupportedFileType,
            "This file type is not available in a Viva workspace.",
        ));
    } else {
        return Err(CommandError::new(
            ErrorCode::NotFile,
            "This workspace entry is not a regular file or folder.",
        ));
    };

    Ok(ResolvedWorkspaceEntry {
        relative_path: relative_path_to_string(root, &canonical)?,
        absolute_path: canonical,
        kind,
    })
}

fn resolve_workspace_directory(root: &Path, relative: &str) -> CommandResult<PathBuf> {
    if relative.is_empty() {
        return Ok(root.to_path_buf());
    }
    let resolved = resolve_existing_workspace_entry(root, relative)?;
    if resolved.kind != WorkspaceEntryKind::Directory {
        return Err(CommandError::new(
            ErrorCode::NotDirectory,
            "Choose a workspace folder.",
        ));
    }
    Ok(resolved.absolute_path)
}

fn open_capability_directory(root: &Path, relative: &Path) -> CommandResult<CapabilityDirectory> {
    let clean_relative = if relative.as_os_str().is_empty() {
        PathBuf::new()
    } else {
        validate_relative_path(relative)?
    };
    let mut directory = CapabilityDir::open_ambient_dir(root, ambient_authority())
        .map_err(|error| io_error("Could not open this workspace", error))?;

    for component in clean_relative.components() {
        let Component::Normal(name) = component else {
            return Err(CommandError::new(
                ErrorCode::InvalidPath,
                "Workspace paths cannot contain parent or absolute components.",
            ));
        };
        let metadata = directory
            .symlink_metadata(name)
            .map_err(|error| io_error("Could not inspect a workspace folder", error))?;
        if metadata.is_symlink() {
            return Err(CommandError::new(
                ErrorCode::SymlinkNotAllowed,
                "Symbolic links are not available in a Viva workspace.",
            ));
        }
        if !metadata.is_dir() {
            return Err(CommandError::new(
                ErrorCode::NotDirectory,
                "Choose a workspace folder.",
            ));
        }
        directory = directory
            .open_dir(name)
            .map_err(|error| io_error("Could not open a workspace folder", error))?;
    }

    let capability = CapabilityDirectory {
        dir: directory,
        absolute_path: root.join(&clean_relative),
    };
    if !capability_directory_matches_path(&capability, &capability.absolute_path)? {
        return Err(workspace_entry_conflict_error());
    }
    Ok(capability)
}

fn checked_capability_entry(
    parent: &CapabilityDir,
    name: &OsStr,
    kind: WorkspaceEntryKind,
) -> CommandResult<cap_std::fs::Metadata> {
    let metadata = parent
        .symlink_metadata(name)
        .map_err(|error| io_error("Could not inspect this workspace entry", error))?;
    if metadata.is_symlink() {
        return Err(CommandError::new(
            ErrorCode::SymlinkNotAllowed,
            "Symbolic links are not available in a Viva workspace.",
        ));
    }
    let valid_kind = match kind {
        WorkspaceEntryKind::Directory => metadata.is_dir(),
        WorkspaceEntryKind::File | WorkspaceEntryKind::Image => metadata.is_file(),
    };
    if !valid_kind {
        return Err(workspace_entry_conflict_error());
    }
    Ok(metadata)
}

fn open_stable_entry(
    parent: &CapabilityDir,
    name: &OsStr,
    kind: WorkspaceEntryKind,
) -> CommandResult<StableEntryHandle> {
    checked_capability_entry(parent, name, kind)?;
    let handle = match kind {
        #[cfg(not(target_os = "windows"))]
        WorkspaceEntryKind::Directory => StableEntryHandle::Directory(
            parent
                .open_dir(name)
                .map_err(|error| io_error("Could not open this workspace folder", error))?,
        ),
        #[cfg(target_os = "windows")]
        WorkspaceEntryKind::Directory => {
            use cap_std::fs::OpenOptionsExt;
            use windows_sys::Win32::Storage::FileSystem::{
                FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE,
                FILE_SHARE_READ, FILE_SHARE_WRITE,
            };
            let mut options = CapabilityOpenOptions::new();
            options
                .read(true)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT);
            StableEntryHandle::File(
                parent
                    .open_with(name, &options)
                    .map_err(|error| io_error("Could not open this workspace folder", error))?,
            )
        }
        WorkspaceEntryKind::File | WorkspaceEntryKind::Image => {
            let mut options = CapabilityOpenOptions::new();
            options.read(true);
            #[cfg(target_os = "windows")]
            {
                use cap_std::fs::OpenOptionsExt;
                use windows_sys::Win32::Storage::FileSystem::{
                    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
                };
                options.share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE);
            }
            StableEntryHandle::File(
                parent
                    .open_with(name, &options)
                    .map_err(|error| io_error("Could not open this workspace entry", error))?,
            )
        }
    };
    let metadata = handle.metadata()?;
    let valid_kind = match kind {
        WorkspaceEntryKind::Directory => metadata.is_dir(),
        WorkspaceEntryKind::File | WorkspaceEntryKind::Image => metadata.is_file(),
    };
    if !valid_kind {
        return Err(workspace_entry_conflict_error());
    }
    let expected_identity = handle.identity()?;
    if !stable_entry_path_matches(parent, name, kind, expected_identity)? {
        return Err(workspace_entry_conflict_error());
    }
    Ok(handle)
}

fn stable_entry_path_matches(
    parent: &CapabilityDir,
    name: &OsStr,
    kind: WorkspaceEntryKind,
    expected_identity: StableFileIdentity,
) -> CommandResult<bool> {
    let metadata = match checked_capability_entry(parent, name, kind) {
        Ok(metadata) => metadata,
        Err(error) if matches!(error.code, ErrorCode::NotFound) => return Ok(false),
        Err(error) => return Err(error),
    };
    let current = match kind {
        WorkspaceEntryKind::Directory => match parent.open_dir(name) {
            Ok(directory) => StableEntryHandle::Directory(directory),
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => {
                return Err(io_error("Could not recheck this workspace folder", error));
            }
        },
        WorkspaceEntryKind::File | WorkspaceEntryKind::Image => {
            let mut options = CapabilityOpenOptions::new();
            options.read(true);
            #[cfg(target_os = "windows")]
            {
                use cap_std::fs::OpenOptionsExt;
                use windows_sys::Win32::Storage::FileSystem::{
                    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
                };
                options.share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE);
            }
            match parent.open_with(name, &options) {
                Ok(file) => StableEntryHandle::File(file),
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
                Err(error) => {
                    return Err(io_error("Could not recheck this workspace entry", error));
                }
            }
        }
    };
    let current_metadata = current.metadata()?;
    let current_kind_matches = match kind {
        WorkspaceEntryKind::Directory => current_metadata.is_dir(),
        WorkspaceEntryKind::File | WorkspaceEntryKind::Image => current_metadata.is_file(),
    };
    Ok(current_kind_matches && !metadata.is_symlink() && current.identity()? == expected_identity)
}

fn directory_contains_exact_name(directory: &CapabilityDir, name: &OsStr) -> CommandResult<bool> {
    let entries = directory
        .entries()
        .map_err(|error| io_error("Could not inspect the rename destination", error))?;
    for entry in entries {
        let entry = entry.map_err(|error| io_error("Could not inspect this folder", error))?;
        if entry.file_name() == name {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(unix)]
fn capability_metadata_matches_std(capability: &cap_std::fs::Metadata, ambient: &Metadata) -> bool {
    use cap_std::fs::MetadataExt as CapabilityMetadataExt;
    use std::os::unix::fs::MetadataExt as StdMetadataExt;
    capability.dev() == ambient.dev() && capability.ino() == ambient.ino()
}

#[cfg(unix)]
fn capability_directory_matches_path(
    capability: &CapabilityDirectory,
    path: &Path,
) -> CommandResult<bool> {
    let ambient = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(io_error("Could not recheck a workspace folder", error)),
    };
    if ambient.file_type().is_symlink() || !ambient.is_dir() {
        return Ok(false);
    }
    let metadata = capability
        .dir
        .dir_metadata()
        .map_err(|error| io_error("Could not recheck a workspace folder", error))?;
    Ok(capability_metadata_matches_std(&metadata, &ambient))
}

#[cfg(target_os = "windows")]
fn capability_directory_matches_path(
    capability: &CapabilityDirectory,
    path: &Path,
) -> CommandResult<bool> {
    let current = match CapabilityDir::open_ambient_dir(path, ambient_authority()) {
        Ok(directory) => directory,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(io_error("Could not recheck a workspace folder", error)),
    };
    Ok(windows_directory_identity(&capability.dir)? == windows_directory_identity(&current)?)
}

#[cfg(all(not(unix), not(target_os = "windows")))]
fn capability_directory_matches_path(
    capability: &CapabilityDirectory,
    path: &Path,
) -> CommandResult<bool> {
    Ok(path.is_dir()
        && capability
            .dir
            .dir_metadata()
            .map_err(|error| io_error("Could not recheck a workspace folder", error))?
            .is_dir())
}

#[cfg(target_os = "windows")]
fn windows_directory_identity(directory: &CapabilityDir) -> CommandResult<(u32, u64)> {
    use std::mem::MaybeUninit;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
    };

    let mut information = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::zeroed();
    // SAFETY: the directory owns a valid OS handle and the output pointer is writable.
    let succeeded = unsafe {
        GetFileInformationByHandle(directory.as_raw_handle() as _, information.as_mut_ptr())
    };
    if succeeded == 0 {
        return Err(io_error(
            "Could not identify a workspace folder",
            io::Error::last_os_error(),
        ));
    }
    // SAFETY: GetFileInformationByHandle initialized the structure on success.
    let information = unsafe { information.assume_init() };
    let file_index = ((information.nFileIndexHigh as u64) << 32) | information.nFileIndexLow as u64;
    Ok((information.dwVolumeSerialNumber, file_index))
}

fn ensure_expected_documents_current(
    root: &Path,
    source: &ResolvedWorkspaceEntry,
    expected_documents: &[ExpectedDocumentRevision],
) -> CommandResult<()> {
    for expected in expected_documents {
        let document = resolve_existing_document(root, &expected.relative_path)?;
        let affected = match source.kind {
            WorkspaceEntryKind::Directory => {
                Path::new(&document.relative_path).starts_with(Path::new(&source.relative_path))
            }
            WorkspaceEntryKind::File => document.relative_path == source.relative_path,
            WorkspaceEntryKind::Image => false,
        };
        if !affected {
            return Err(CommandError::new(
                ErrorCode::InvalidPath,
                "Expected document revisions must belong to the selected workspace entry.",
            ));
        }
        if read_revision_limited(&document.absolute_path)? != expected.revision {
            return Err(conflict_error());
        }
    }
    Ok(())
}

fn ensure_duplicate_revision_current(
    source: &ResolvedWorkspaceEntry,
    expected_revision: Option<&FileRevision>,
) -> CommandResult<()> {
    let Some(expected_revision) = expected_revision else {
        return Ok(());
    };
    if source.kind != WorkspaceEntryKind::File {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "Revision checks are only available for text documents.",
        ));
    }
    if &read_revision_limited(&source.absolute_path)? != expected_revision {
        return Err(conflict_error());
    }
    Ok(())
}

fn ensure_entry_path_still_resolves(
    root: &Path,
    expected: &ResolvedWorkspaceEntry,
) -> CommandResult<()> {
    let current = resolve_existing_workspace_entry(root, &expected.relative_path)?;
    if current.absolute_path != expected.absolute_path || current.kind != expected.kind {
        return Err(CommandError::new(
            ErrorCode::Conflict,
            "This workspace entry changed on disk. Refresh the workspace and try again.",
        ));
    }
    Ok(())
}

fn validate_renamed_entry(source: &ResolvedWorkspaceEntry, new_name: &str) -> CommandResult<()> {
    let destination = Path::new(new_name);
    match source.kind {
        WorkspaceEntryKind::Directory => {
            if is_ignored_directory(new_name) {
                return Err(CommandError::new(
                    ErrorCode::InvalidPath,
                    "This folder is intentionally excluded from the workspace.",
                ));
            }
        }
        WorkspaceEntryKind::File => ensure_allowed_extension(destination)?,
        WorkspaceEntryKind::Image => {
            if !is_allowed_image(destination) || !same_extension(&source.absolute_path, destination)
            {
                return Err(CommandError::new(
                    ErrorCode::UnsupportedFileType,
                    "Renaming an image cannot change its file format.",
                ));
            }
        }
    }
    Ok(())
}

fn same_extension(left: &Path, right: &Path) -> bool {
    match (
        left.extension().and_then(OsStr::to_str),
        right.extension().and_then(OsStr::to_str),
    ) {
        (Some(left), Some(right)) => left.eq_ignore_ascii_case(right),
        _ => false,
    }
}

fn renamed_descendant_path(
    source_relative_path: &str,
    destination_relative_path: &str,
    document_relative_path: &str,
) -> Option<String> {
    let tail = Path::new(document_relative_path)
        .strip_prefix(Path::new(source_relative_path))
        .ok()?;
    let renamed = Path::new(destination_relative_path).join(tail);
    let mut parts = Vec::new();
    for component in renamed.components() {
        let Component::Normal(value) = component else {
            return None;
        };
        parts.push(value.to_str()?);
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn copy_file_noclobber_capability<G>(
    parent: &CapabilityDirectory,
    source_name: &OsStr,
    source_kind: WorkspaceEntryKind,
    expected_source_identity: StableFileIdentity,
    destination_name: &str,
    expected_revision: Option<&FileRevision>,
    after_temporary_ready: &mut Option<G>,
) -> CommandResult<StableFileIdentity>
where
    G: FnOnce(&CapabilityDir, &OsStr),
{
    if !stable_entry_path_matches(
        &parent.dir,
        source_name,
        source_kind,
        expected_source_identity,
    )? {
        return Err(workspace_entry_conflict_error());
    }
    let StableEntryHandle::File(mut source_file) =
        open_stable_entry(&parent.dir, source_name, source_kind)?
    else {
        unreachable!("directories are rejected before copying")
    };
    if stable_handle_identity(&source_file)
        .map_err(|error| io_error("Could not identify the file to duplicate", error))?
        != expected_source_identity
    {
        return Err(workspace_entry_conflict_error());
    }
    let before_metadata = source_file
        .metadata()
        .map_err(|error| io_error("Could not inspect the file to duplicate", error))?;
    let before = capability_metadata_revision(&before_metadata)?;
    let max_bytes = match source_kind {
        WorkspaceEntryKind::File => MAX_DOCUMENT_BYTES,
        WorkspaceEntryKind::Image => 24 * 1024 * 1024,
        WorkspaceEntryKind::Directory => unreachable!("directories are rejected before copying"),
    };
    if before.size_bytes > max_bytes {
        return Err(file_too_large_error());
    }

    let mut temporary = temporary_capability_file(&parent.dir)?;
    let temporary_identity = temporary.identity()?;
    let mut total_bytes = 0_u64;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = source_file
            .read(&mut buffer)
            .map_err(|error| io_error("Could not duplicate this file", error))?;
        if read == 0 {
            break;
        }
        total_bytes = total_bytes.saturating_add(read as u64);
        if total_bytes > max_bytes {
            return Err(file_too_large_error());
        }
        hasher.update(&buffer[..read]);
        temporary
            .file_mut()?
            .write_all(&buffer[..read])
            .map_err(|error| io_error("Could not duplicate this file", error))?;
    }

    let after_metadata = source_file
        .metadata()
        .map_err(|error| io_error("Could not recheck the file to duplicate", error))?;
    let after = capability_metadata_revision(&after_metadata)?;
    if before != after || total_bytes != after.size_bytes {
        return Err(CommandError::new(
            ErrorCode::Conflict,
            "This file changed while it was being duplicated. Try again.",
        ));
    }
    if !stable_entry_path_matches(
        &parent.dir,
        source_name,
        source_kind,
        expected_source_identity,
    )? {
        return Err(workspace_entry_conflict_error());
    }
    let copied_hash = format!("{:x}", hasher.finalize());
    if let Some(expected) = expected_revision {
        let copied_revision = FileRevision {
            modified_at_ms: after.modified_at_ms,
            size_bytes: after.size_bytes,
            content_sha256: copied_hash.clone(),
        };
        if copied_revision != *expected {
            return Err(conflict_error());
        }
    }
    temporary
        .file_mut()?
        .set_permissions(before_metadata.permissions())
        .map_err(|error| io_error("Could not preserve the duplicate's permissions", error))?;
    temporary
        .file_mut()?
        .sync_all()
        .map_err(|error| io_error("Could not flush the duplicate", error))?;
    if !verify_capability_file_path(
        &parent.dir,
        temporary.name(),
        temporary_identity,
        total_bytes,
        &copied_hash,
    )? {
        return Err(workspace_entry_conflict_error());
    }
    if let Some(after_temporary_ready) = after_temporary_ready.take() {
        after_temporary_ready(&parent.dir, temporary.name());
    }
    let source_path_identity = capability_entry_identity_at(&parent.dir, temporary.name())?;
    if source_path_identity != Some(temporary_identity) {
        temporary.remove_securely();
        if let Some(source_path_identity) = source_path_identity {
            remove_capability_file_if_identity(&parent.dir, temporary.name(), source_path_identity);
        }
        return Err(workspace_entry_conflict_error());
    }
    parent
        .dir
        .hard_link(temporary.name(), &parent.dir, destination_name)
        .map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                CommandError::new(
                    ErrorCode::AlreadyExists,
                    "A workspace entry already exists at this location.",
                )
            } else {
                io_error("Could not create the duplicate", error)
            }
        })?;
    let published_identity =
        capability_entry_identity_at(&parent.dir, OsStr::new(destination_name))?;
    if !verify_capability_file_path(
        &parent.dir,
        OsStr::new(destination_name),
        temporary_identity,
        total_bytes,
        &copied_hash,
    )? {
        temporary.remove_securely();
        if let Some(published_identity) = published_identity {
            remove_capability_file_if_identity(
                &parent.dir,
                OsStr::new(destination_name),
                published_identity,
            );
        }
        return Err(workspace_entry_conflict_error());
    }
    temporary.remove_securely();
    Ok(temporary_identity)
}

struct CapabilityTemporaryFile<'a> {
    directory: &'a CapabilityDir,
    name: String,
    file: Option<CapabilityFile>,
}

impl CapabilityTemporaryFile<'_> {
    fn name(&self) -> &OsStr {
        OsStr::new(&self.name)
    }

    fn file_mut(&mut self) -> CommandResult<&mut CapabilityFile> {
        self.file.as_mut().ok_or_else(|| {
            CommandError::new(ErrorCode::Io, "The temporary duplicate file is closed.")
        })
    }

    fn identity(&self) -> CommandResult<StableFileIdentity> {
        stable_handle_identity(self.file.as_ref().ok_or_else(|| {
            CommandError::new(ErrorCode::Io, "The temporary duplicate file is closed.")
        })?)
        .map_err(|error| io_error("Could not identify the temporary duplicate", error))
    }

    fn remove_securely(&mut self) {
        let expected_identity = self.identity().ok();
        let path_matches = expected_identity
            .and_then(|identity| {
                verify_capability_file_identity(self.directory, self.name(), identity).ok()
            })
            .unwrap_or(false);
        self.file.take();
        if path_matches {
            let _ = self.directory.remove_file(&self.name);
        }
    }
}

impl Drop for CapabilityTemporaryFile<'_> {
    fn drop(&mut self) {
        self.remove_securely();
    }
}

fn temporary_capability_file(parent: &CapabilityDir) -> CommandResult<CapabilityTemporaryFile<'_>> {
    for _ in 0..128 {
        let name = random_component(".viva-duplicate-", ".tmp").map_err(|error| {
            io_error(
                "Could not allocate a secure temporary duplicate name",
                error,
            )
        })?;
        let mut options = CapabilityOpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use cap_std::fs::OpenOptionsExt;
            options.mode(0o666);
        }
        #[cfg(target_os = "windows")]
        {
            use cap_std::fs::OpenOptionsExt;
            use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;
            options.share_mode(FILE_SHARE_READ);
        }
        match parent.open_with(&name, &options) {
            Ok(file) => {
                return Ok(CapabilityTemporaryFile {
                    directory: parent,
                    name,
                    file: Some(file),
                });
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(io_error("Could not create a temporary duplicate", error));
            }
        }
    }
    Err(CommandError::new(
        ErrorCode::AlreadyExists,
        "Viva could not allocate a temporary duplicate name.",
    ))
}

fn verify_capability_file_identity(
    parent: &CapabilityDir,
    name: &OsStr,
    expected_identity: StableFileIdentity,
) -> CommandResult<bool> {
    let metadata = match parent.symlink_metadata(name) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(io_error("Could not inspect a temporary file", error)),
    };
    if metadata.is_symlink() || !metadata.is_file() {
        return Ok(false);
    }
    let file = match parent.open(name) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(io_error("Could not open a temporary file", error)),
    };
    Ok(stable_handle_identity(&file)
        .map_err(|error| io_error("Could not identify a temporary file", error))?
        == expected_identity)
}

#[cfg(unix)]
fn capability_entry_identity_at(
    parent: &CapabilityDir,
    name: &OsStr,
) -> CommandResult<Option<StableFileIdentity>> {
    use cap_std::fs::MetadataExt;
    match parent.symlink_metadata(name) {
        Ok(metadata) => Ok(Some(StableFileIdentity {
            volume: metadata.dev(),
            file: metadata.ino(),
        })),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error("Could not inspect a published duplicate", error)),
    }
}

#[cfg(target_os = "windows")]
fn capability_entry_identity_at(
    parent: &CapabilityDir,
    name: &OsStr,
) -> CommandResult<Option<StableFileIdentity>> {
    let metadata = match parent.symlink_metadata(name) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error("Could not inspect a published duplicate", error)),
    };
    if metadata.is_symlink() || !metadata.is_file() {
        return Ok(None);
    }
    let file = parent
        .open(name)
        .map_err(|error| io_error("Could not open a published duplicate", error))?;
    stable_handle_identity(&file)
        .map(Some)
        .map_err(|error| io_error("Could not identify a published duplicate", error))
}

fn verify_capability_file_path(
    parent: &CapabilityDir,
    name: &OsStr,
    expected_identity: StableFileIdentity,
    expected_size: u64,
    expected_hash: &str,
) -> CommandResult<bool> {
    if !verify_capability_file_identity(parent, name, expected_identity)? {
        return Ok(false);
    }
    let mut file = parent
        .open(name)
        .map_err(|error| io_error("Could not verify the duplicated file", error))?;
    if stable_handle_identity(&file)
        .map_err(|error| io_error("Could not identify the duplicated file", error))?
        != expected_identity
    {
        return Ok(false);
    }
    let metadata = file
        .metadata()
        .map_err(|error| io_error("Could not inspect the duplicated file", error))?;
    if !metadata.is_file() || metadata.len() != expected_size {
        return Ok(false);
    }
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| io_error("Could not verify the duplicated file", error))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()) == expected_hash
        && verify_capability_file_identity(parent, name, expected_identity)?)
}

#[cfg(unix)]
fn remove_capability_file_if_identity(
    parent: &CapabilityDir,
    name: &OsStr,
    expected_identity: StableFileIdentity,
) {
    use rustix::fs::{RenameFlags, renameat_with};
    let Ok(quarantine_name) = random_component(".viva-duplicate-cleanup-", ".tmp") else {
        return;
    };
    if renameat_with(
        parent,
        name,
        parent,
        OsStr::new(&quarantine_name),
        RenameFlags::NOREPLACE,
    )
    .is_err()
    {
        return;
    }
    if capability_entry_identity_at(parent, OsStr::new(&quarantine_name))
        .ok()
        .flatten()
        == Some(expected_identity)
    {
        let _ = parent.remove_file(&quarantine_name);
    } else {
        let _ = renameat_with(
            parent,
            OsStr::new(&quarantine_name),
            parent,
            name,
            RenameFlags::NOREPLACE,
        );
    }
}

#[cfg(target_os = "windows")]
fn remove_capability_file_if_identity(
    parent: &CapabilityDir,
    name: &OsStr,
    expected_identity: StableFileIdentity,
) {
    use cap_std::fs::OpenOptionsExt;
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        DELETE, FILE_DISPOSITION_INFO, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FileDispositionInfo,
        SYNCHRONIZE, SetFileInformationByHandle,
    };

    let mut options = CapabilityOpenOptions::new();
    options.access_mode(DELETE | FILE_READ_ATTRIBUTES | SYNCHRONIZE);
    options.share_mode(FILE_SHARE_READ);
    let Ok(file) = parent.open_with(name, &options) else {
        return;
    };
    if stable_handle_identity(&file).ok() != Some(expected_identity)
        || !verify_capability_file_identity(parent, name, expected_identity).unwrap_or(false)
    {
        return;
    }
    let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
    // SAFETY: the handle has DELETE access and the disposition buffer is initialized.
    let _ = unsafe {
        SetFileInformationByHandle(
            file.as_raw_handle() as _,
            FileDispositionInfo,
            (&raw const disposition).cast(),
            size_of::<FILE_DISPOSITION_INFO>() as u32,
        )
    };
}

#[cfg(all(not(unix), not(target_os = "windows")))]
fn remove_capability_file_if_identity(
    parent: &CapabilityDir,
    name: &OsStr,
    expected_identity: StableFileIdentity,
) {
    if verify_capability_file_identity(parent, name, expected_identity).unwrap_or(false) {
        let _ = parent.remove_file(name);
    }
}

fn capability_metadata_revision(
    metadata: &cap_std::fs::Metadata,
) -> CommandResult<MetadataRevision> {
    let modified = metadata
        .modified()
        .map_err(|error| io_error("Could not read the modification time", error))?
        .into_std();
    let duration = modified.duration_since(UNIX_EPOCH).map_err(|_| {
        CommandError::new(
            ErrorCode::Io,
            "This document has an invalid modification time.",
        )
    })?;
    let modified_at_ms = u64::try_from(duration.as_millis()).map_err(|_| {
        CommandError::new(
            ErrorCode::Io,
            "This document has an unsupported modification time.",
        )
    })?;
    Ok(MetadataRevision {
        modified_at_ms,
        size_bytes: metadata.len(),
    })
}

struct TrashStagingDirectory<'a> {
    workspace: &'a CapabilityDirectory,
    name: String,
    directory: CapabilityDirectory,
}

impl TrashStagingDirectory<'_> {
    fn directory(&self) -> &CapabilityDirectory {
        &self.directory
    }
}

impl Drop for TrashStagingDirectory<'_> {
    fn drop(&mut self) {
        let _ = self.workspace.dir.remove_dir(&self.name);
    }
}

fn create_trash_staging_directory(
    workspace: &CapabilityDirectory,
) -> CommandResult<TrashStagingDirectory<'_>> {
    for _ in 0..128 {
        let name = random_component(".viva-trash-", ".tmp")
            .map_err(|error| io_error("Could not allocate a secure Trash staging name", error))?;
        match create_private_trash_staging_directory(&workspace.dir, &name) {
            Ok(()) => {
                #[cfg(unix)]
                {
                    use cap_std::fs::PermissionsExt;
                    if let Err(error) = workspace
                        .dir
                        .set_permissions(&name, cap_std::fs::Permissions::from_mode(0o700))
                    {
                        let _ = workspace.dir.remove_dir(&name);
                        return Err(io_error("Could not secure the Trash staging folder", error));
                    }
                }
                let directory = workspace
                    .dir
                    .open_dir(&name)
                    .map_err(|error| io_error("Could not open the Trash staging folder", error))?;
                return Ok(TrashStagingDirectory {
                    workspace,
                    directory: CapabilityDirectory {
                        dir: directory,
                        absolute_path: workspace.absolute_path.join(&name),
                    },
                    name,
                });
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(io_error(
                    "Could not create a secure Trash staging folder",
                    error,
                ));
            }
        }
    }
    Err(CommandError::new(
        ErrorCode::AlreadyExists,
        "Viva could not allocate a secure Trash staging folder.",
    ))
}

#[cfg(unix)]
fn create_private_trash_staging_directory(workspace: &CapabilityDir, name: &str) -> io::Result<()> {
    use cap_std::fs::DirBuilderExt;
    let mut directory = cap_std::fs::DirBuilder::new();
    directory.mode(0o700);
    workspace.create_dir_with(name, &directory)
}

#[cfg(not(unix))]
fn create_private_trash_staging_directory(workspace: &CapabilityDir, name: &str) -> io::Result<()> {
    workspace.create_dir(name)
}

#[cfg(target_os = "macos")]
fn move_staged_entry_to_system_trash(
    staging: &CapabilityDirectory,
    source_name: &OsStr,
    kind: WorkspaceEntryKind,
    expected_identity: StableFileIdentity,
) -> CommandResult<()> {
    let stable_directory_path = capability_directory_absolute_path(staging)?;
    if !capability_directory_matches_path(staging, &stable_directory_path)? {
        return Err(workspace_entry_conflict_error());
    }
    let trash = macos_nsfilemanager_trash_context();
    move_staged_entry_with_path_trash_using(
        staging,
        source_name,
        kind,
        expected_identity,
        &stable_directory_path,
        |path| trash.delete(path).map_err(|error| error.to_string()),
    )
}

#[cfg(target_os = "macos")]
fn macos_nsfilemanager_trash_context() -> trash::TrashContext {
    use trash::macos::{DeleteMethod, TrashContextExtMacos};
    let mut trash = trash::TrashContext::default();
    trash.set_delete_method(DeleteMethod::NsFileManager);
    trash
}

#[cfg(any(target_os = "linux", target_os = "freebsd"))]
fn move_staged_entry_to_system_trash(
    staging: &CapabilityDirectory,
    source_name: &OsStr,
    kind: WorkspaceEntryKind,
    expected_identity: StableFileIdentity,
) -> CommandResult<()> {
    use std::os::fd::AsRawFd;
    let descriptor_root = if cfg!(target_os = "linux") {
        PathBuf::from(format!("/proc/self/fd/{}", staging.dir.as_raw_fd()))
    } else {
        return Err(CommandError::new(
            ErrorCode::Io,
            "A handle-relative system Trash is unavailable on this platform.",
        ));
    };
    move_staged_entry_with_path_trash(
        staging,
        source_name,
        kind,
        expected_identity,
        &descriptor_root,
    )
}

#[cfg(target_os = "windows")]
fn move_staged_entry_to_system_trash(
    staging: &CapabilityDirectory,
    source_name: &OsStr,
    kind: WorkspaceEntryKind,
    expected_identity: StableFileIdentity,
) -> CommandResult<()> {
    let pinned_path = pin_windows_directory_path(staging)?;
    move_staged_entry_with_path_trash(
        staging,
        source_name,
        kind,
        expected_identity,
        &pinned_path.path,
    )
}

#[cfg(target_os = "windows")]
struct PinnedWindowsDirectoryPath {
    path: PathBuf,
    _handles: Vec<CapabilityDir>,
}

#[cfg(target_os = "windows")]
fn pin_windows_directory_path(
    directory: &CapabilityDirectory,
) -> CommandResult<PinnedWindowsDirectoryPath> {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

    let path = fs::canonicalize(&directory.absolute_path)
        .map_err(|error| io_error("Could not resolve the Trash staging folder", error))?;
    let mut component_paths: Vec<PathBuf> = path
        .ancestors()
        .filter(|ancestor| !ancestor.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .collect();
    component_paths.reverse();

    let mut handles = Vec::with_capacity(component_paths.len());
    for component_path in &component_paths {
        let metadata = fs::symlink_metadata(component_path)
            .map_err(|error| io_error("Could not inspect the Trash staging path", error))?;
        if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(CommandError::new(
                ErrorCode::SymlinkNotAllowed,
                "The Trash staging path contains an unsafe Windows reparse point.",
            ));
        }
        handles.push(
            CapabilityDir::open_ambient_dir(component_path, ambient_authority())
                .map_err(|error| io_error("Could not pin the Trash staging path", error))?,
        );
    }

    if fs::canonicalize(&path)
        .map_err(|error| io_error("Could not recheck the Trash staging path", error))?
        != path
    {
        return Err(workspace_entry_conflict_error());
    }
    for (component_path, handle) in component_paths.iter().zip(&handles) {
        let metadata = fs::symlink_metadata(component_path)
            .map_err(|error| io_error("Could not recheck the Trash staging path", error))?;
        if !metadata.is_dir()
            || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || open_windows_directory_identity(component_path)?
                != stable_handle_identity(handle).map_err(|error| {
                    io_error("Could not identify the pinned Trash staging path", error)
                })?
        {
            return Err(workspace_entry_conflict_error());
        }
    }
    let pinned_staging_identity = handles
        .last()
        .ok_or_else(workspace_entry_conflict_error)
        .and_then(|handle| {
            stable_handle_identity(handle)
                .map_err(|error| io_error("Could not identify the pinned staging folder", error))
        })?;
    let capability_staging_identity = stable_handle_identity(&directory.dir)
        .map_err(|error| io_error("Could not identify the Trash staging folder", error))?;
    if pinned_staging_identity != capability_staging_identity {
        return Err(workspace_entry_conflict_error());
    }

    Ok(PinnedWindowsDirectoryPath {
        path,
        _handles: handles,
    })
}

#[cfg(target_os = "windows")]
fn open_windows_directory_identity(path: &Path) -> CommandResult<StableFileIdentity> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE,
        FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    let file = fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|error| io_error("Could not re-open the pinned Trash staging path", error))?;
    stable_handle_identity(&file)
        .map_err(|error| io_error("Could not identify the pinned Trash staging path", error))
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn move_staged_entry_with_path_trash(
    staging: &CapabilityDirectory,
    source_name: &OsStr,
    kind: WorkspaceEntryKind,
    expected_identity: StableFileIdentity,
    stable_directory_path: &Path,
) -> CommandResult<()> {
    move_staged_entry_with_path_trash_using(
        staging,
        source_name,
        kind,
        expected_identity,
        stable_directory_path,
        |path| trash::delete(path).map_err(|error| error.to_string()),
    )
}

#[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
fn move_staged_entry_with_path_trash_using<F>(
    staging: &CapabilityDirectory,
    source_name: &OsStr,
    kind: WorkspaceEntryKind,
    expected_identity: StableFileIdentity,
    stable_directory_path: &Path,
    delete: F,
) -> CommandResult<()>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    let quarantine_name = random_component(".viva-trash-item-", ".tmp")
        .map_err(|error| io_error("Could not allocate a secure Trash item name", error))?;
    capability_rename_noclobber(
        staging,
        source_name,
        staging,
        OsStr::new(&quarantine_name),
        "Could not secure this workspace entry before moving it to Trash",
    )?;
    ensure_moved_entry_identity_or_rollback(
        staging,
        OsStr::new(&quarantine_name),
        source_name,
        kind,
        expected_identity,
        "The staged workspace entry changed before it could be moved to Trash.",
    )?;

    let secured_path = stable_directory_path.join(&quarantine_name);
    if let Err(error) = delete(&secured_path) {
        let rollback = capability_rename_noclobber_io(
            staging,
            OsStr::new(&quarantine_name),
            staging,
            source_name,
        );
        return Err(match rollback {
            Ok(()) => CommandError::new(
                ErrorCode::Io,
                format!("Could not move this workspace entry to the system Trash: {error}"),
            ),
            Err(rollback_error) => CommandError::new(
                ErrorCode::Io,
                format!(
                    "Could not move this workspace entry to the system Trash: {error}. Viva also could not restore its staged name: {rollback_error}"
                ),
            ),
        });
    }
    match staging.dir.symlink_metadata(&quarantine_name) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Ok(_) | Err(_) => Err(mutation_conflict_after_rollback(
            "The system Trash did not remove the secured workspace entry cleanly.",
            capability_rename_noclobber_io(
                staging,
                OsStr::new(&quarantine_name),
                staging,
                source_name,
            ),
        )),
    }
}

#[cfg(all(
    not(target_os = "macos"),
    not(target_os = "linux"),
    not(target_os = "freebsd"),
    not(target_os = "windows")
))]
fn move_staged_entry_to_system_trash(
    _staging: &CapabilityDirectory,
    _source_name: &OsStr,
    _kind: WorkspaceEntryKind,
    _expected_identity: StableFileIdentity,
) -> CommandResult<()> {
    Err(CommandError::new(
        ErrorCode::Io,
        "A recoverable system Trash is unavailable on this platform.",
    ))
}

#[cfg(target_os = "macos")]
fn capability_directory_absolute_path(directory: &CapabilityDirectory) -> CommandResult<PathBuf> {
    use std::os::unix::ffi::OsStringExt;
    let path = rustix::fs::getpath(&directory.dir)
        .map_err(|error| io::Error::from_raw_os_error(error.raw_os_error()))
        .map_err(|error| io_error("Could not resolve the Trash staging folder", error))?;
    Ok(PathBuf::from(OsString::from_vec(path.to_bytes().to_vec())))
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn capability_directory_absolute_path(directory: &CapabilityDirectory) -> CommandResult<PathBuf> {
    use std::os::fd::AsRawFd;
    fs::read_link(format!("/proc/self/fd/{}", directory.dir.as_raw_fd()))
        .map_err(|error| io_error("Could not resolve the Trash staging folder", error))
}

#[cfg(all(
    not(target_os = "macos"),
    not(target_os = "linux"),
    not(target_os = "android"),
    not(target_os = "windows")
))]
fn capability_directory_absolute_path(directory: &CapabilityDirectory) -> CommandResult<PathBuf> {
    fs::canonicalize(&directory.absolute_path)
        .map_err(|error| io_error("Could not resolve the Trash staging folder", error))
}

fn capability_rename_noclobber(
    source_directory: &CapabilityDirectory,
    source_name: &OsStr,
    destination_directory: &CapabilityDirectory,
    destination_name: &OsStr,
    context: &str,
) -> CommandResult<()> {
    capability_rename_noclobber_io(
        source_directory,
        source_name,
        destination_directory,
        destination_name,
    )
    .map_err(|error| io_error(context, error))
}

fn rollback_moved_entry(
    parent: &CapabilityDirectory,
    current_name: &OsStr,
    original_name: &OsStr,
) -> io::Result<()> {
    capability_rename_noclobber_io(parent, current_name, parent, original_name)
}

fn ensure_moved_entry_identity_or_rollback(
    parent: &CapabilityDirectory,
    current_name: &OsStr,
    original_name: &OsStr,
    kind: WorkspaceEntryKind,
    expected_identity: StableFileIdentity,
    message: &str,
) -> CommandResult<()> {
    match stable_entry_path_matches(&parent.dir, current_name, kind, expected_identity) {
        Ok(true) => Ok(()),
        Ok(false) | Err(_) => Err(mutation_conflict_after_rollback(
            message,
            rollback_moved_entry(parent, current_name, original_name),
        )),
    }
}

fn rename_case_only_bound(
    parent: &CapabilityDirectory,
    source_name: &OsStr,
    destination_name: &OsStr,
    kind: WorkspaceEntryKind,
    expected_identity: StableFileIdentity,
) -> CommandResult<()> {
    let temporary_name = loop {
        let candidate = random_component(".viva-rename-", ".tmp")
            .map_err(|error| io_error("Could not allocate a secure rename name", error))?;
        match capability_rename_noclobber_io(parent, source_name, parent, OsStr::new(&candidate)) {
            Ok(()) => break candidate,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(workspace_entry_conflict_error());
            }
            Err(error) => return Err(io_error("Could not stage this case-only rename", error)),
        }
    };

    ensure_moved_entry_identity_or_rollback(
        parent,
        OsStr::new(&temporary_name),
        source_name,
        kind,
        expected_identity,
        "The workspace entry changed while it was being renamed.",
    )?;
    if let Err(error) = capability_rename_noclobber_io(
        parent,
        OsStr::new(&temporary_name),
        parent,
        destination_name,
    ) {
        let rollback = rollback_moved_entry(parent, OsStr::new(&temporary_name), source_name);
        return match rollback {
            Ok(()) => Err(io_error("Could not complete this case-only rename", error)),
            Err(rollback_error) => Err(CommandError::new(
                ErrorCode::Io,
                format!(
                    "Could not complete this case-only rename: {error}. Viva also could not restore the original name: {rollback_error}"
                ),
            )),
        };
    }
    ensure_moved_entry_identity_or_rollback(
        parent,
        destination_name,
        source_name,
        kind,
        expected_identity,
        "The workspace entry changed while it was being renamed.",
    )
}

#[cfg(unix)]
fn capability_rename_noclobber_io(
    source_directory: &CapabilityDirectory,
    source_name: &OsStr,
    destination_directory: &CapabilityDirectory,
    destination_name: &OsStr,
) -> io::Result<()> {
    use rustix::fs::{RenameFlags, renameat_with};
    renameat_with(
        &source_directory.dir,
        source_name,
        &destination_directory.dir,
        destination_name,
        RenameFlags::NOREPLACE,
    )
    .map_err(|error| io::Error::from_raw_os_error(error.raw_os_error()))
}

#[cfg(target_os = "windows")]
fn capability_rename_noclobber_io(
    source_directory: &CapabilityDirectory,
    source_name: &OsStr,
    destination_directory: &CapabilityDirectory,
    destination_name: &OsStr,
) -> io::Result<()> {
    use cap_std::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        DELETE, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ, FILE_SHARE_WRITE, SYNCHRONIZE,
    };

    let mut options = CapabilityOpenOptions::new();
    options
        .read(true)
        .access_mode(DELETE | FILE_READ_ATTRIBUTES | SYNCHRONIZE)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT);
    let source = source_directory.dir.open_with(source_name, &options)?;
    rename_open_handle_noclobber(&source, &destination_directory.dir, destination_name)
}

#[cfg(all(not(unix), not(target_os = "windows")))]
fn capability_rename_noclobber_io(
    source_directory: &CapabilityDirectory,
    source_name: &OsStr,
    destination_directory: &CapabilityDirectory,
    destination_name: &OsStr,
) -> io::Result<()> {
    match destination_directory.dir.symlink_metadata(destination_name) {
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "the destination already exists",
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    source_directory
        .dir
        .rename(source_name, &destination_directory.dir, destination_name)
}

fn resolve_save_destination(
    root: &Path,
    destination_path: &str,
) -> CommandResult<ResolvedSaveDestination> {
    let destination = PathBuf::from(destination_path);
    if !destination.is_absolute() {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "Save As requires an absolute destination path.",
        ));
    }

    let file_name = destination
        .file_name()
        .ok_or_else(|| CommandError::new(ErrorCode::InvalidPath, "Choose a document file name."))?;
    validate_visible_name(file_name)?;
    ensure_allowed_extension(Path::new(file_name))?;

    let parent = destination.parent().ok_or_else(|| {
        CommandError::new(
            ErrorCode::InvalidPath,
            "The destination has no parent folder.",
        )
    })?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| io_error("Could not open the destination folder", error))?;
    ensure_within_workspace(root, &canonical_parent)?;

    let relative_parent = canonical_parent.strip_prefix(root).map_err(|_| {
        CommandError::new(
            ErrorCode::OutsideWorkspace,
            "The destination must remain inside the open workspace.",
        )
    })?;
    validate_relative_directory(relative_parent)?;
    ensure_no_symlink_components(root, relative_parent)?;

    let requested_target = canonical_parent.join(file_name);
    let target = match fs::symlink_metadata(&requested_target) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(CommandError::new(
                    ErrorCode::SymlinkNotAllowed,
                    "Symbolic links are not available in a Viva workspace.",
                ));
            }
            let canonical_target = fs::canonicalize(&requested_target)
                .map_err(|error| io_error("Could not open the save destination", error))?;
            ensure_within_workspace(root, &canonical_target)?;
            canonical_target
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => requested_target,
        Err(error) => return Err(io_error("Could not inspect the save destination", error)),
    };
    Ok(ResolvedSaveDestination {
        relative_path: relative_path_to_string(root, &target)?,
        target,
    })
}

fn validate_save_destination_file(
    root: &Path,
    target: &Path,
    metadata: &Metadata,
) -> CommandResult<()> {
    if metadata.file_type().is_symlink() {
        return Err(CommandError::new(
            ErrorCode::SymlinkNotAllowed,
            "Symbolic links are not available in a Viva workspace.",
        ));
    }
    if !metadata.is_file() {
        return Err(CommandError::new(
            ErrorCode::NotFile,
            "The save destination is not a document.",
        ));
    }
    let canonical = fs::canonicalize(target)
        .map_err(|error| io_error("Could not open the save destination", error))?;
    ensure_within_workspace(root, &canonical)
}

fn replace_save_destination(
    root: &Path,
    target: &Path,
    content: &str,
    expected_revision: &FileRevision,
) -> CommandResult<String> {
    let metadata = fs::symlink_metadata(target).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            conflict_error()
        } else {
            io_error("Could not inspect the save destination", error)
        }
    })?;
    validate_save_destination_file(root, target, &metadata)?;
    if metadata.permissions().readonly() {
        return Err(CommandError::new(
            ErrorCode::Io,
            "This document is read-only.",
        ));
    }

    let (previous_bytes, current_metadata) = read_bytes_limited(target)?;
    let current_revision =
        revision_from_metadata_and_hash(&current_metadata, sha256_hex(&previous_bytes))?;
    if &current_revision != expected_revision {
        return Err(conflict_error());
    }
    let previous_content = String::from_utf8(previous_bytes).map_err(|_| {
        CommandError::new(
            ErrorCode::InvalidUtf8,
            "The existing destination is not valid UTF-8 text.",
        )
    })?;

    let parent = target.parent().ok_or_else(|| {
        CommandError::new(ErrorCode::InvalidPath, "The document has no parent folder.")
    })?;
    let mut temporary = temporary_file(parent, Some(current_metadata.permissions()))?;
    write_and_flush(&mut temporary, content.as_bytes())?;

    let latest_metadata = fs::symlink_metadata(target).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            conflict_error()
        } else {
            io_error("Could not inspect the save destination", error)
        }
    })?;
    validate_save_destination_file(root, target, &latest_metadata)?;
    if read_revision_limited(target)? != *expected_revision {
        return Err(conflict_error());
    }

    temporary
        .persist(target)
        .map_err(|error| io_error("Could not replace this document", error.error))?;
    sync_parent_best_effort(parent);
    Ok(previous_content)
}

fn create_new_document(
    root: &Path,
    relative: &str,
    content: String,
) -> CommandResult<DocumentSnapshot> {
    enforce_content_limit(&content)?;
    let clean_relative = validate_relative_document(relative)?;
    let parent_relative = clean_relative.parent().unwrap_or_else(|| Path::new(""));
    ensure_no_symlink_components(root, parent_relative)?;

    let parent = fs::canonicalize(root.join(parent_relative))
        .map_err(|error| io_error("Could not open the destination folder", error))?;
    ensure_within_workspace(root, &parent)?;

    let file_name = clean_relative
        .file_name()
        .ok_or_else(|| CommandError::new(ErrorCode::InvalidPath, "Choose a document file name."))?;
    let file_name_text = file_name.to_str().ok_or_else(|| {
        CommandError::new(
            ErrorCode::InvalidPath,
            "Workspace paths must be valid Unicode.",
        )
    })?;
    validate_mutation_name(file_name_text)?;
    let target = parent.join(file_name);
    ensure_target_absent(&target)?;
    persist_new_document(&target, &content)?;

    let revision = revision_from_metadata_and_hash(
        &fs::metadata(&target)
            .map_err(|error| io_error("Could not inspect the new document", error))?,
        sha256_hex(content.as_bytes()),
    )?;
    Ok(DocumentSnapshot {
        relative_path: relative_path_to_string(root, &target)?,
        name: document_name(&target)?,
        content,
        revision,
        history_warning_code: None,
    })
}

fn persist_new_document(target: &Path, content: &str) -> CommandResult<()> {
    let parent = target.parent().ok_or_else(|| {
        CommandError::new(ErrorCode::InvalidPath, "The document has no parent folder.")
    })?;
    let mut temporary = temporary_file(parent, None)?;
    write_and_flush(&mut temporary, content.as_bytes())?;
    temporary.persist_noclobber(target).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            CommandError::new(
                ErrorCode::AlreadyExists,
                "A document already exists at this location.",
            )
        } else {
            io_error("Could not create this document", error.error)
        }
    })?;
    sync_parent_best_effort(parent);
    Ok(())
}

fn temporary_file(
    parent: &Path,
    permissions: Option<fs::Permissions>,
) -> CommandResult<NamedTempFile> {
    let mut builder = TempFileBuilder::new();
    builder.prefix(".viva-").suffix(".tmp");

    if let Some(permissions) = permissions {
        builder.permissions(permissions);
    } else {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            builder.permissions(fs::Permissions::from_mode(0o666));
        }
    }

    builder
        .tempfile_in(parent)
        .map_err(|error| io_error("Could not create a temporary save file", error))
}

fn write_and_flush(temporary: &mut NamedTempFile, content: &[u8]) -> CommandResult<()> {
    temporary
        .write_all(content)
        .map_err(|error| io_error("Could not write this document", error))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| io_error("Could not flush this document", error))
}

fn snapshot_from_disk(resolved: &ResolvedDocument) -> CommandResult<DocumentSnapshot> {
    let (content, revision) = read_utf8_limited(&resolved.absolute_path)?;
    Ok(DocumentSnapshot {
        relative_path: resolved.relative_path.clone(),
        name: document_name(&resolved.absolute_path)?,
        content,
        revision,
        history_warning_code: None,
    })
}

fn read_utf8_limited(path: &Path) -> CommandResult<(String, FileRevision)> {
    let (bytes, metadata) = read_bytes_limited(path)?;
    let revision = revision_from_metadata_and_hash(&metadata, sha256_hex(&bytes))?;
    let content = decode_utf8(bytes)?;
    Ok((content, revision))
}

fn read_utf8_content_with_limit(path: &Path, max_bytes: u64) -> CommandResult<(String, u64)> {
    let (bytes, _) = read_bytes_with_limit(path, max_bytes)?;
    let bytes_read = bytes.len() as u64;
    Ok((decode_utf8(bytes)?, bytes_read))
}

fn read_bytes_limited(path: &Path) -> CommandResult<(Vec<u8>, Metadata)> {
    read_bytes_with_limit(path, MAX_DOCUMENT_BYTES)
}

fn read_bytes_with_limit(path: &Path, max_bytes: u64) -> CommandResult<(Vec<u8>, Metadata)> {
    let mut file =
        File::open(path).map_err(|error| io_error("Could not read this document", error))?;
    let before_metadata = file
        .metadata()
        .map_err(|error| io_error("Could not inspect this document", error))?;
    let before = metadata_revision(&before_metadata)?;
    if before.size_bytes > max_bytes {
        return Err(file_too_large_error());
    }

    let mut bytes = Vec::with_capacity(before.size_bytes.min(max_bytes) as usize);
    Read::by_ref(&mut file)
        .take(max_bytes)
        .read_to_end(&mut bytes)
        .map_err(|error| io_error("Could not read this document", error))?;

    let after_metadata = file
        .metadata()
        .map_err(|error| io_error("Could not recheck this document", error))?;
    let after = metadata_revision(&after_metadata)?;
    ensure_stable_read(before, after, bytes.len() as u64)?;

    Ok((bytes, after_metadata))
}

fn read_revision_limited(path: &Path) -> CommandResult<FileRevision> {
    let mut file =
        File::open(path).map_err(|error| io_error("Could not read this document", error))?;
    let before_metadata = file
        .metadata()
        .map_err(|error| io_error("Could not inspect this document", error))?;
    let before = metadata_revision(&before_metadata)?;
    if before.size_bytes > MAX_DOCUMENT_BYTES {
        return Err(file_too_large_error());
    }

    let mut hasher = Sha256::new();
    let mut total_bytes = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| io_error("Could not read this document", error))?;
        if read == 0 {
            break;
        }
        total_bytes = total_bytes.saturating_add(read as u64);
        if total_bytes > MAX_DOCUMENT_BYTES {
            return Err(file_too_large_error());
        }
        hasher.update(&buffer[..read]);
    }

    let after_metadata = file
        .metadata()
        .map_err(|error| io_error("Could not recheck this document", error))?;
    let after = metadata_revision(&after_metadata)?;
    ensure_stable_read(before, after, total_bytes)?;

    Ok(FileRevision {
        modified_at_ms: after.modified_at_ms,
        size_bytes: after.size_bytes,
        content_sha256: format!("{:x}", hasher.finalize()),
    })
}

fn ensure_stable_read(
    before: MetadataRevision,
    after: MetadataRevision,
    bytes_read: u64,
) -> CommandResult<()> {
    if before != after || after.size_bytes != bytes_read {
        return Err(CommandError::new(
            ErrorCode::Conflict,
            "This document changed while it was being read. Try again.",
        ));
    }
    Ok(())
}

fn decode_utf8(bytes: Vec<u8>) -> CommandResult<String> {
    String::from_utf8(bytes).map_err(|_| {
        CommandError::new(
            ErrorCode::InvalidUtf8,
            "Viva can only open UTF-8 text documents.",
        )
    })
}

fn validate_relative_document(path: &str) -> CommandResult<PathBuf> {
    let relative = validate_relative_path(Path::new(path))?;
    ensure_allowed_extension(&relative)?;
    Ok(relative)
}

fn validate_relative_directory(path: &Path) -> CommandResult<()> {
    if path.as_os_str().is_empty() {
        return Ok(());
    }
    validate_relative_path(path).map(|_| ())
}

fn validate_relative_path(path: &Path) -> CommandResult<PathBuf> {
    if path.as_os_str().is_empty() || path.is_absolute() {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "Use a non-empty path relative to the open workspace.",
        ));
    }

    let components: Vec<OsString> = path
        .components()
        .map(|component| match component {
            Component::Normal(value) => Ok(value.to_owned()),
            _ => Err(CommandError::new(
                ErrorCode::InvalidPath,
                "Workspace paths cannot contain parent or absolute components.",
            )),
        })
        .collect::<CommandResult<_>>()?;

    if components.is_empty() {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "Choose a document path.",
        ));
    }

    let mut clean = PathBuf::new();
    for (index, component) in components.iter().enumerate() {
        validate_visible_name(component)?;
        let value = component.to_str().ok_or_else(|| {
            CommandError::new(
                ErrorCode::InvalidPath,
                "Workspace paths must be valid Unicode.",
            )
        })?;
        if index + 1 < components.len() && is_ignored_directory(value) {
            return Err(CommandError::new(
                ErrorCode::InvalidPath,
                "This folder is intentionally excluded from the workspace.",
            ));
        }
        clean.push(component);
    }
    Ok(clean)
}

fn validate_visible_name(name: &OsStr) -> CommandResult<()> {
    let name = name.to_str().ok_or_else(|| {
        CommandError::new(
            ErrorCode::InvalidPath,
            "Workspace paths must be valid Unicode.",
        )
    })?;
    if name.is_empty() || is_hidden_name(name) {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "Hidden workspace paths are not available.",
        ));
    }
    Ok(())
}

fn validate_mutation_name(name: &str) -> CommandResult<()> {
    validate_visible_name(OsStr::new(name))?;
    let mut components = Path::new(name).components();
    if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "Use a single file or folder name.",
        ));
    }
    if name.ends_with([' ', '.'])
        || name
            .chars()
            .any(|character| character <= '\u{1f}' || "<>:\"/\\|?*".contains(character))
    {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "This file or folder name is not supported.",
        ));
    }

    let device_name = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    let numbered_device = device_name
        .strip_prefix("COM")
        .or_else(|| device_name.strip_prefix("LPT"))
        .is_some_and(|number| {
            matches!(number, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        });
    if matches!(
        device_name.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$"
    ) || numbered_device
    {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "This file or folder name is reserved by the operating system.",
        ));
    }
    Ok(())
}

fn ensure_no_symlink_components(root: &Path, relative: &Path) -> CommandResult<()> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(value) = component else {
            return Err(CommandError::new(
                ErrorCode::InvalidPath,
                "Workspace paths cannot contain parent or absolute components.",
            ));
        };
        current.push(value);
        let metadata = fs::symlink_metadata(&current)
            .map_err(|error| io_error("Could not inspect a workspace path", error))?;
        if metadata.file_type().is_symlink() {
            return Err(CommandError::new(
                ErrorCode::SymlinkNotAllowed,
                "Symbolic links are not available in a Viva workspace.",
            ));
        }
    }
    Ok(())
}

fn ensure_within_workspace(root: &Path, path: &Path) -> CommandResult<()> {
    if path == root || path.starts_with(root) {
        Ok(())
    } else {
        Err(CommandError::new(
            ErrorCode::OutsideWorkspace,
            "The selected path is outside the open workspace.",
        ))
    }
}

fn ensure_target_absent(target: &Path) -> CommandResult<()> {
    match fs::symlink_metadata(target) {
        Ok(_) => Err(CommandError::new(
            ErrorCode::AlreadyExists,
            "A document already exists at this location.",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error("Could not inspect the destination", error)),
    }
}

fn ensure_allowed_extension(path: &Path) -> CommandResult<()> {
    if is_allowed_document(path) {
        Ok(())
    } else {
        Err(CommandError::new(
            ErrorCode::UnsupportedFileType,
            "Viva supports .md, .markdown, .mdx, and .txt documents.",
        ))
    }
}

fn is_allowed_document(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .map(|extension| {
            ["md", "markdown", "mdx", "txt"]
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
        .unwrap_or(false)
}

fn is_allowed_image(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .map(|extension| {
            ["png", "jpg", "jpeg", "gif", "webp"]
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
        .unwrap_or(false)
}

fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.')
}

fn is_ignored_directory(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "node_modules"
            | "target"
            | "dist"
            | "build"
            | "out"
            | "coverage"
            | "vendor"
            | "deriveddata"
    )
}

fn enforce_content_limit(content: &str) -> CommandResult<()> {
    if content.len() as u64 > MAX_DOCUMENT_BYTES {
        Err(file_too_large_error())
    } else {
        Ok(())
    }
}

fn file_too_large_error() -> CommandError {
    CommandError::new(
        ErrorCode::FileTooLarge,
        format!(
            "Documents are limited to {} MiB.",
            MAX_DOCUMENT_BYTES / 1024 / 1024
        ),
    )
}

fn conflict_error() -> CommandError {
    CommandError::new(
        ErrorCode::Conflict,
        "This document changed on disk. Reload it before saving.",
    )
}

fn workspace_entry_conflict_error() -> CommandError {
    CommandError::new(
        ErrorCode::Conflict,
        "This workspace entry changed on disk. Refresh the workspace and try again.",
    )
}

fn mutation_conflict_after_rollback(message: &str, rollback: io::Result<()>) -> CommandError {
    match rollback {
        Ok(()) => CommandError::new(ErrorCode::Conflict, message),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            CommandError::new(ErrorCode::Conflict, message)
        }
        Err(error) => CommandError::new(
            ErrorCode::Io,
            format!("{message} Viva also could not roll back the partial change: {error}"),
        ),
    }
}

fn metadata_revision(metadata: &Metadata) -> CommandResult<MetadataRevision> {
    let modified = metadata
        .modified()
        .map_err(|error| io_error("Could not read the modification time", error))?;
    let duration = modified.duration_since(UNIX_EPOCH).map_err(|_| {
        CommandError::new(
            ErrorCode::Io,
            "This document has an invalid modification time.",
        )
    })?;
    let modified_at_ms = u64::try_from(duration.as_millis()).map_err(|_| {
        CommandError::new(
            ErrorCode::Io,
            "This document has an unsupported modification time.",
        )
    })?;
    Ok(MetadataRevision {
        modified_at_ms,
        size_bytes: metadata.len(),
    })
}

fn revision_from_metadata_and_hash(
    metadata: &Metadata,
    content_sha256: String,
) -> CommandResult<FileRevision> {
    let revision = metadata_revision(metadata)?;
    Ok(FileRevision {
        modified_at_ms: revision.modified_at_ms,
        size_bytes: revision.size_bytes,
        content_sha256,
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("{digest:x}")
}

fn path_to_string(path: &Path) -> CommandResult<String> {
    path.to_str().map(str::to_owned).ok_or_else(|| {
        CommandError::new(
            ErrorCode::InvalidPath,
            "Workspace paths must be valid Unicode.",
        )
    })
}

fn document_name(path: &Path) -> CommandResult<String> {
    path.file_name()
        .and_then(OsStr::to_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            CommandError::new(
                ErrorCode::InvalidPath,
                "The document name must be valid Unicode.",
            )
        })
}

fn relative_path_to_string(root: &Path, path: &Path) -> CommandResult<String> {
    let relative = path.strip_prefix(root).map_err(|_| {
        CommandError::new(
            ErrorCode::OutsideWorkspace,
            "The selected path is outside the open workspace.",
        )
    })?;
    let mut parts = Vec::new();
    for component in relative.components() {
        let Component::Normal(value) = component else {
            return Err(CommandError::new(
                ErrorCode::InvalidPath,
                "The selected path is not a valid workspace path.",
            ));
        };
        parts.push(value.to_str().ok_or_else(|| {
            CommandError::new(
                ErrorCode::InvalidPath,
                "Workspace paths must be valid Unicode.",
            )
        })?);
    }
    if parts.is_empty() {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "Choose a document path.",
        ));
    }
    Ok(parts.join("/"))
}

fn search_preview(line: &str, match_start: usize, match_end: usize) -> String {
    let characters: Vec<char> = line.chars().collect();
    let match_start_chars = line[..match_start].chars().count();
    let match_end_chars = match_start_chars + line[match_start..match_end].chars().count();
    let start = match_start_chars.saturating_sub(PREVIEW_CONTEXT_CHARS);
    let end = (match_end_chars + PREVIEW_CONTEXT_CHARS).min(characters.len());
    let mut preview = String::new();
    if start > 0 {
        preview.push('…');
    }
    preview.extend(characters[start..end].iter());
    if end < characters.len() {
        preview.push('…');
    }
    preview
}

fn io_error(context: &str, error: std::io::Error) -> CommandError {
    let code = match error.kind() {
        std::io::ErrorKind::NotFound => ErrorCode::NotFound,
        std::io::ErrorKind::AlreadyExists => ErrorCode::AlreadyExists,
        _ => ErrorCode::Io,
    };
    CommandError::new(code, format!("{context}: {error}"))
}

fn sync_capability_directory_best_effort(directory: &CapabilityDir) {
    if let Ok(directory) = directory.try_clone() {
        let _ = directory.into_std_file().sync_all();
    }
}

#[cfg(unix)]
fn sync_parent_best_effort(parent: &Path) {
    let _ = File::open(parent).and_then(|directory| directory.sync_all());
}

#[cfg(not(unix))]
fn sync_parent_best_effort(_parent: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::HistoryStore;
    use std::collections::HashSet;
    use std::fs;
    use std::sync::{Arc, Barrier, mpsc};
    use std::time::Duration;
    use tempfile::{TempDir, tempdir};

    fn root_string(workspace: &TempDir) -> String {
        workspace.path().to_string_lossy().into_owned()
    }

    fn write_fixture(workspace: &TempDir, relative: &str, content: &[u8]) {
        let path = workspace.path().join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn recover_staged_entry(
        staging: &CapabilityDirectory,
        source_name: &OsStr,
        recovered_path: &Path,
    ) -> CommandResult<()> {
        let recovered_parent_path = recovered_path.parent().unwrap();
        let recovered_parent = CapabilityDirectory {
            dir: CapabilityDir::open_ambient_dir(recovered_parent_path, ambient_authority())
                .unwrap(),
            absolute_path: recovered_parent_path.to_path_buf(),
        };
        capability_rename_noclobber(
            staging,
            source_name,
            &recovered_parent,
            recovered_path.file_name().unwrap(),
            "test Trash recovery failed",
        )
    }

    fn open_fixture(workspace: &TempDir) -> WorkspaceTree {
        open_workspace_core(OpenWorkspaceRequest {
            path: root_string(workspace),
        })
        .unwrap()
    }

    fn expected_document(workspace: &TempDir, relative_path: &str) -> ExpectedDocumentRevision {
        let snapshot = read_document_core(DocumentPathRequest {
            workspace_root: root_string(workspace),
            relative_path: relative_path.to_owned(),
        })
        .unwrap();
        ExpectedDocumentRevision {
            relative_path: relative_path.to_owned(),
            revision: snapshot.revision,
        }
    }

    fn document_paths(tree: &WorkspaceTree) -> Vec<String> {
        let mut paths = Vec::new();
        collect_document_paths(&tree.children, &mut paths);
        paths
    }

    #[cfg(unix)]
    fn swap_parent_for_symlink_at_barrier(
        parent: PathBuf,
        held_parent: PathBuf,
        outside: PathBuf,
        barrier: Arc<Barrier>,
    ) -> std::thread::JoinHandle<()> {
        std::thread::spawn(move || {
            use std::os::unix::fs::symlink;
            barrier.wait();
            fs::rename(parent.as_path(), held_parent).unwrap();
            symlink(outside, parent).unwrap();
            barrier.wait();
        })
    }

    #[test]
    fn filters_extensions_hidden_entries_and_large_directories() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "README.md", b"readme");
        write_fixture(&workspace, "notes/field.MDX", b"field");
        write_fixture(&workspace, "notes/plain.txt", b"plain");
        write_fixture(&workspace, "notes/image.png", b"png");
        write_fixture(&workspace, ".private.md", b"private");
        write_fixture(&workspace, ".hidden/secret.md", b"secret");
        write_fixture(&workspace, "node_modules/package.md", b"package");
        write_fixture(&workspace, "target/generated.markdown", b"generated");

        let tree = open_fixture(&workspace);

        assert_eq!(
            document_paths(&tree),
            vec![
                "notes/field.MDX".to_owned(),
                "notes/plain.txt".to_owned(),
                "README.md".to_owned(),
            ]
        );
        assert_eq!(tree.children[0].kind, WorkspaceEntryKind::Directory);
        let notes = &tree.children[0];
        assert!(notes.children.iter().any(|entry| {
            entry.relative_path == "notes/image.png" && entry.kind == WorkspaceEntryKind::Image
        }));
    }

    #[test]
    fn workspace_tree_keeps_visible_empty_directories() {
        let workspace = tempdir().unwrap();
        fs::create_dir_all(workspace.path().join("empty/nested")).unwrap();

        let tree = open_fixture(&workspace);
        let empty = tree
            .children
            .iter()
            .find(|entry| entry.relative_path == "empty")
            .expect("empty directory should remain visible");
        assert_eq!(empty.kind, WorkspaceEntryKind::Directory);
        assert_eq!(empty.children[0].relative_path, "empty/nested");
        assert!(empty.children[0].children.is_empty());
    }

    #[test]
    fn bounded_tree_walk_reports_deep_truncation_and_unions_expected_documents() {
        let workspace = tempdir().unwrap();
        let mut directory = workspace.path().to_path_buf();
        let mut relative = PathBuf::new();
        for depth in 0..MAX_TREE_DEPTH {
            let name = format!("depth-{depth}");
            directory.push(&name);
            relative.push(&name);
            fs::create_dir(&directory).unwrap();
        }
        directory.push("open.md");
        relative.push("open.md");
        fs::write(&directory, "deep").unwrap();

        let mut complete = true;
        let mut budget = TreeBudget { entries: 0 };
        let entries = walk_directory_with_completeness(
            workspace.path(),
            workspace.path(),
            0,
            &mut budget,
            &mut complete,
        )
        .unwrap();
        assert!(!complete, "the bounded walk must disclose truncation");
        let expected_source = format!("notes/{}", relative.to_string_lossy());
        let (mappings, history_complete) = directory_history_mappings(
            "notes",
            "archive",
            &entries,
            complete,
            std::slice::from_ref(&expected_source),
        );
        assert!(!history_complete);
        assert!(mappings.contains(&(
            expected_source,
            format!("archive/{}", relative.to_string_lossy())
        )));
    }

    #[test]
    fn creates_root_and_nested_workspace_directories_without_clobbering() {
        let workspace = tempdir().unwrap();

        let root_directory = create_workspace_directory_core(CreateWorkspaceDirectoryRequest {
            workspace_root: root_string(&workspace),
            parent_relative_path: String::new(),
            name: "Archive".to_owned(),
        })
        .unwrap();
        assert_eq!(root_directory.kind, WorkspaceEntryKind::Directory);
        assert_eq!(
            root_directory.destination_relative_path.as_deref(),
            Some("Archive")
        );
        assert!(workspace.path().join("Archive").is_dir());

        let nested = create_workspace_directory_core(CreateWorkspaceDirectoryRequest {
            workspace_root: root_string(&workspace),
            parent_relative_path: "Archive".to_owned(),
            name: "2026".to_owned(),
        })
        .unwrap();
        assert_eq!(
            nested.destination_relative_path.as_deref(),
            Some("Archive/2026")
        );

        let collision = create_workspace_directory_core(CreateWorkspaceDirectoryRequest {
            workspace_root: root_string(&workspace),
            parent_relative_path: "Archive".to_owned(),
            name: "2026".to_owned(),
        })
        .unwrap_err();
        assert_eq!(collision.code, ErrorCode::AlreadyExists);
    }

    #[test]
    fn workspace_directory_names_reject_paths_hidden_build_folders_and_windows_devices() {
        let workspace = tempdir().unwrap();
        for name in [
            "../escape",
            "a/b",
            "a\\b",
            ".hidden",
            "node_modules",
            "CON",
            "LPT1.txt",
            "trailing. ",
        ] {
            let error = create_workspace_directory_core(CreateWorkspaceDirectoryRequest {
                workspace_root: root_string(&workspace),
                parent_relative_path: String::new(),
                name: name.to_owned(),
            })
            .unwrap_err();
            assert_eq!(error.code, ErrorCode::InvalidPath, "{name}");
        }
    }

    #[test]
    fn new_documents_use_portable_single_component_names() {
        let workspace = tempdir().unwrap();
        for relative_path in ["CON.md", "notes/a\\b.md", "notes/bad:name.md"] {
            if relative_path.starts_with("notes/") {
                fs::create_dir_all(workspace.path().join("notes")).unwrap();
            }
            let error = create_document_core(CreateDocumentRequest {
                workspace_root: root_string(&workspace),
                relative_path: relative_path.to_owned(),
                content: None,
            })
            .unwrap_err();
            assert_eq!(error.code, ErrorCode::InvalidPath, "{relative_path}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn workspace_mutations_never_follow_symlinked_entries_or_parents() {
        use std::os::unix::fs::symlink;

        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        write_fixture(&outside, "secret.md", b"secret");
        symlink(outside.path(), workspace.path().join("linked-folder")).unwrap();
        symlink(
            outside.path().join("secret.md"),
            workspace.path().join("linked.md"),
        )
        .unwrap();

        let create_error = create_workspace_directory_core(CreateWorkspaceDirectoryRequest {
            workspace_root: root_string(&workspace),
            parent_relative_path: "linked-folder".to_owned(),
            name: "escaped".to_owned(),
        })
        .unwrap_err();
        assert_eq!(create_error.code, ErrorCode::SymlinkNotAllowed);

        let rename_error = rename_workspace_entry_core(RenameWorkspaceEntryRequest {
            workspace_root: root_string(&workspace),
            relative_path: "linked.md".to_owned(),
            new_name: "renamed.md".to_owned(),
            expected_documents: Vec::new(),
        })
        .unwrap_err();
        assert_eq!(rename_error.code, ErrorCode::SymlinkNotAllowed);

        let duplicate_error = duplicate_workspace_entry_core(DuplicateWorkspaceEntryRequest {
            workspace_root: root_string(&workspace),
            relative_path: "linked.md".to_owned(),
            expected_revision: None,
        })
        .unwrap_err();
        assert_eq!(duplicate_error.code, ErrorCode::SymlinkNotAllowed);

        let callback_called = std::cell::Cell::new(false);
        let trash_error = trash_workspace_entry_core(
            TrashWorkspaceEntryRequest {
                workspace_root: root_string(&workspace),
                relative_path: "linked-folder".to_owned(),
                expected_documents: Vec::new(),
            },
            |_, _, _, _| {
                callback_called.set(true);
                Ok(())
            },
        )
        .unwrap_err();
        assert_eq!(trash_error.code, ErrorCode::SymlinkNotAllowed);
        assert!(!callback_called.get());
        assert_eq!(
            fs::read_to_string(outside.path().join("secret.md")).unwrap(),
            "secret"
        );
    }

    #[cfg(unix)]
    #[test]
    fn create_rolls_back_if_the_parent_is_swapped_after_its_capability_is_opened() {
        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::create_dir(workspace.path().join("notes")).unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let worker = swap_parent_for_symlink_at_barrier(
            workspace.path().join("notes"),
            workspace.path().join("held-notes"),
            outside.path().to_path_buf(),
            Arc::clone(&barrier),
        );

        let error = create_workspace_directory_core_with_hook(
            CreateWorkspaceDirectoryRequest {
                workspace_root: root_string(&workspace),
                parent_relative_path: "notes".to_owned(),
                name: "private".to_owned(),
            },
            || {
                barrier.wait();
                barrier.wait();
            },
        )
        .unwrap_err();
        worker.join().unwrap();

        assert_eq!(error.code, ErrorCode::Conflict);
        assert!(!outside.path().join("private").exists());
        assert!(!workspace.path().join("held-notes/private").exists());
    }

    #[cfg(unix)]
    #[test]
    fn rename_rolls_back_if_the_parent_is_swapped_after_its_capability_is_opened() {
        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        write_fixture(&workspace, "notes/draft.md", b"draft");
        write_fixture(&outside, "ready.md", b"outside");
        let barrier = Arc::new(Barrier::new(2));
        let worker = swap_parent_for_symlink_at_barrier(
            workspace.path().join("notes"),
            workspace.path().join("held-notes"),
            outside.path().to_path_buf(),
            Arc::clone(&barrier),
        );

        let error = rename_workspace_entry_core_with_hook(
            RenameWorkspaceEntryRequest {
                workspace_root: root_string(&workspace),
                relative_path: "notes/draft.md".to_owned(),
                new_name: "ready.md".to_owned(),
                expected_documents: vec![expected_document(&workspace, "notes/draft.md")],
            },
            || {
                barrier.wait();
                barrier.wait();
            },
        )
        .unwrap_err();
        worker.join().unwrap();

        assert_eq!(error.code, ErrorCode::Conflict);
        assert_eq!(
            fs::read_to_string(workspace.path().join("held-notes/draft.md")).unwrap(),
            "draft"
        );
        assert_eq!(
            fs::read_to_string(outside.path().join("ready.md")).unwrap(),
            "outside"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rename_rolls_back_the_exact_item_if_the_source_name_is_replaced_after_validation() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "draft.md", b"original");
        let held = workspace.path().join("held-original.md");
        let expected = expected_document(&workspace, "draft.md");

        let error = rename_workspace_entry_core_with_hooks(
            RenameWorkspaceEntryRequest {
                workspace_root: root_string(&workspace),
                relative_path: "draft.md".to_owned(),
                new_name: "ready.md".to_owned(),
                expected_documents: vec![expected],
            },
            || {},
            || {
                fs::rename(workspace.path().join("draft.md"), &held).unwrap();
                fs::write(workspace.path().join("draft.md"), b"replacement").unwrap();
            },
        )
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::Conflict);
        assert_eq!(fs::read(&held).unwrap(), b"original");
        assert_eq!(
            fs::read(workspace.path().join("draft.md")).unwrap(),
            b"replacement"
        );
        assert!(!workspace.path().join("ready.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn duplicate_rolls_back_if_the_parent_is_swapped_after_its_capability_is_opened() {
        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        write_fixture(&workspace, "notes/draft.md", b"draft");
        let barrier = Arc::new(Barrier::new(2));
        let worker = swap_parent_for_symlink_at_barrier(
            workspace.path().join("notes"),
            workspace.path().join("held-notes"),
            outside.path().to_path_buf(),
            Arc::clone(&barrier),
        );

        let error = duplicate_workspace_entry_core_with_hook(
            DuplicateWorkspaceEntryRequest {
                workspace_root: root_string(&workspace),
                relative_path: "notes/draft.md".to_owned(),
                expected_revision: Some(expected_document(&workspace, "notes/draft.md").revision),
            },
            || {
                barrier.wait();
                barrier.wait();
            },
        )
        .unwrap_err();
        worker.join().unwrap();

        assert_eq!(error.code, ErrorCode::Conflict);
        assert!(!workspace.path().join("held-notes/draft copy.md").exists());
        assert!(!outside.path().join("draft copy.md").exists());
        assert_eq!(
            fs::read_to_string(workspace.path().join("held-notes/draft.md")).unwrap(),
            "draft"
        );
    }

    #[cfg(unix)]
    #[test]
    fn duplicate_never_publishes_a_replaced_temporary_symlink() {
        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        write_fixture(&workspace, "draft.md", b"draft");
        let outside_file = outside.path().join("untouched.md");
        fs::write(&outside_file, b"outside").unwrap();

        let error = duplicate_workspace_entry_core_with_hooks(
            DuplicateWorkspaceEntryRequest {
                workspace_root: root_string(&workspace),
                relative_path: "draft.md".to_owned(),
                expected_revision: Some(expected_document(&workspace, "draft.md").revision),
            },
            || {},
            |parent, temporary_name| {
                parent.remove_file(temporary_name).unwrap();
                parent
                    .symlink_contents(&outside_file, temporary_name)
                    .unwrap();
            },
        )
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::Conflict);
        assert!(!workspace.path().join("draft copy.md").exists());
        assert_eq!(fs::read(outside_file).unwrap(), b"outside");
    }

    #[cfg(unix)]
    #[test]
    fn trash_stages_from_the_open_parent_without_touching_a_swapped_path() {
        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let recovered = tempdir().unwrap();
        write_fixture(&workspace, "notes/draft.md", b"draft");
        write_fixture(&outside, "draft.md", b"outside");
        let barrier = Arc::new(Barrier::new(2));
        let worker = swap_parent_for_symlink_at_barrier(
            workspace.path().join("notes"),
            workspace.path().join("held-notes"),
            outside.path().to_path_buf(),
            Arc::clone(&barrier),
        );
        let recovered_path = recovered.path().join("draft.md");

        let result = trash_workspace_entry_core_with_hook(
            TrashWorkspaceEntryRequest {
                workspace_root: root_string(&workspace),
                relative_path: "notes/draft.md".to_owned(),
                expected_documents: vec![expected_document(&workspace, "notes/draft.md")],
            },
            || {
                barrier.wait();
                barrier.wait();
            },
            |staging, source_name, _, _| {
                assert_eq!(source_name, OsStr::new("draft.md"));
                recover_staged_entry(staging, source_name, &recovered_path)
            },
        )
        .unwrap();
        worker.join().unwrap();

        assert!(result.recoverable);
        assert_eq!(fs::read_to_string(&recovered_path).unwrap(), "draft");
        assert_eq!(
            fs::read_to_string(outside.path().join("draft.md")).unwrap(),
            "outside"
        );
        assert!(!workspace.path().join("held-notes/draft.md").exists());
        assert!(fs::read_dir(workspace.path()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".viva-trash-")
        }));
    }

    #[cfg(unix)]
    #[test]
    fn trash_rolls_back_a_replaced_source_after_the_last_identity_check() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "draft.md", b"original");
        let held = workspace.path().join("held-original.md");
        let expected = expected_document(&workspace, "draft.md");
        let callback_called = std::cell::Cell::new(false);

        let error = trash_workspace_entry_core_with_hooks(
            TrashWorkspaceEntryRequest {
                workspace_root: root_string(&workspace),
                relative_path: "draft.md".to_owned(),
                expected_documents: vec![expected],
            },
            || {},
            || {
                fs::rename(workspace.path().join("draft.md"), &held).unwrap();
                fs::write(workspace.path().join("draft.md"), b"replacement").unwrap();
            },
            |_, _| {},
            |_, _, _, _| {
                callback_called.set(true);
                Ok(())
            },
        )
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::Conflict);
        assert!(!callback_called.get());
        assert_eq!(fs::read(&held).unwrap(), b"original");
        assert_eq!(
            fs::read(workspace.path().join("draft.md")).unwrap(),
            b"replacement"
        );
    }

    #[cfg(unix)]
    #[test]
    fn trash_rolls_back_a_staged_name_replaced_before_the_backend() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "draft.md", b"original");
        let held = workspace.path().join("held-original.md");
        let expected = expected_document(&workspace, "draft.md");
        let callback_called = std::cell::Cell::new(false);

        let error = trash_workspace_entry_core_with_hooks(
            TrashWorkspaceEntryRequest {
                workspace_root: root_string(&workspace),
                relative_path: "draft.md".to_owned(),
                expected_documents: vec![expected],
            },
            || {},
            || {},
            |staging, source_name| {
                fs::rename(staging.absolute_path.join(source_name), &held).unwrap();
                fs::write(staging.absolute_path.join(source_name), b"replacement").unwrap();
            },
            |_, _, _, _| {
                callback_called.set(true);
                Ok(())
            },
        )
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::Conflict);
        assert!(!callback_called.get());
        assert_eq!(fs::read(&held).unwrap(), b"original");
        assert_eq!(
            fs::read(workspace.path().join("draft.md")).unwrap(),
            b"replacement"
        );
        assert!(fs::read_dir(workspace.path()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".viva-trash-")
        }));
    }

    #[cfg(unix)]
    #[test]
    fn trash_backend_uses_the_open_staging_directory_after_its_name_is_rebound() {
        use std::os::unix::fs::symlink;

        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let recovered = tempdir().unwrap();
        write_fixture(&workspace, "draft.md", b"inside");
        write_fixture(&outside, "draft.md", b"outside");
        let recovered_path = recovered.path().join("draft.md");
        let held_staging = workspace.path().join("held-staging");
        let mut rebound_path = None;

        let result = trash_workspace_entry_core_with_hooks(
            TrashWorkspaceEntryRequest {
                workspace_root: root_string(&workspace),
                relative_path: "draft.md".to_owned(),
                expected_documents: vec![expected_document(&workspace, "draft.md")],
            },
            || {},
            || {},
            |staging, _| {
                let original_path = staging.absolute_path.clone();
                fs::rename(&original_path, &held_staging).unwrap();
                symlink(outside.path(), &original_path).unwrap();
                rebound_path = Some(original_path);
            },
            |staging, source_name, _, _| {
                recover_staged_entry(staging, source_name, &recovered_path)
            },
        )
        .unwrap();

        assert!(result.recoverable);
        assert_eq!(fs::read(&recovered_path).unwrap(), b"inside");
        assert_eq!(
            fs::read(outside.path().join("draft.md")).unwrap(),
            b"outside"
        );
        fs::remove_file(rebound_path.unwrap()).unwrap();
        fs::remove_dir(held_staging).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_system_trash_uses_nsfilemanager_without_finder_permissions() {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        assert!(matches!(
            macos_nsfilemanager_trash_context().delete_method(),
            DeleteMethod::NsFileManager
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_trash_adapter_requires_disappearance_and_rolls_back_backend_errors() {
        let unchanged = tempdir().unwrap();
        write_fixture(&unchanged, "draft.md", b"unchanged");
        let unchanged_error = trash_workspace_entry_core(
            TrashWorkspaceEntryRequest {
                workspace_root: root_string(&unchanged),
                relative_path: "draft.md".to_owned(),
                expected_documents: vec![expected_document(&unchanged, "draft.md")],
            },
            |staging, source_name, kind, identity| {
                let path = capability_directory_absolute_path(staging)?;
                move_staged_entry_with_path_trash_using(
                    staging,
                    source_name,
                    kind,
                    identity,
                    &path,
                    |secured_path| {
                        assert!(secured_path.is_file());
                        Ok(())
                    },
                )
            },
        )
        .unwrap_err();
        assert_eq!(unchanged_error.code, ErrorCode::Conflict);
        assert_eq!(
            fs::read(unchanged.path().join("draft.md")).unwrap(),
            b"unchanged"
        );

        let failed = tempdir().unwrap();
        write_fixture(&failed, "draft.md", b"failed");
        let failed_error = trash_workspace_entry_core(
            TrashWorkspaceEntryRequest {
                workspace_root: root_string(&failed),
                relative_path: "draft.md".to_owned(),
                expected_documents: vec![expected_document(&failed, "draft.md")],
            },
            |staging, source_name, kind, identity| {
                let path = capability_directory_absolute_path(staging)?;
                move_staged_entry_with_path_trash_using(
                    staging,
                    source_name,
                    kind,
                    identity,
                    &path,
                    |_| Err("synthetic NSFileManager failure".to_owned()),
                )
            },
        )
        .unwrap_err();
        assert_eq!(failed_error.code, ErrorCode::Io);
        assert_eq!(fs::read(failed.path().join("draft.md")).unwrap(), b"failed");

        let removed = tempdir().unwrap();
        write_fixture(&removed, "draft.md", b"removed");
        let mutation = trash_workspace_entry_core(
            TrashWorkspaceEntryRequest {
                workspace_root: root_string(&removed),
                relative_path: "draft.md".to_owned(),
                expected_documents: vec![expected_document(&removed, "draft.md")],
            },
            |staging, source_name, kind, identity| {
                let path = capability_directory_absolute_path(staging)?;
                move_staged_entry_with_path_trash_using(
                    staging,
                    source_name,
                    kind,
                    identity,
                    &path,
                    |secured_path| fs::remove_file(secured_path).map_err(|error| error.to_string()),
                )
            },
        )
        .unwrap();
        assert!(mutation.recoverable);
        assert!(!removed.path().join("draft.md").exists());
    }

    #[test]
    fn renames_documents_images_and_directories_in_place_without_overwriting() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "draft.md", b"draft");
        write_fixture(&workspace, "photo.png", b"png");
        write_fixture(&workspace, "notes/inside.txt", b"inside");
        write_fixture(&workspace, "taken.md", b"taken");

        let renamed_document = rename_workspace_entry_core(RenameWorkspaceEntryRequest {
            workspace_root: root_string(&workspace),
            relative_path: "draft.md".to_owned(),
            new_name: "ready.markdown".to_owned(),
            expected_documents: vec![expected_document(&workspace, "draft.md")],
        })
        .unwrap();
        assert_eq!(
            renamed_document.source_relative_path.as_deref(),
            Some("draft.md")
        );
        assert_eq!(
            renamed_document.destination_relative_path.as_deref(),
            Some("ready.markdown")
        );
        assert_eq!(
            fs::read_to_string(workspace.path().join("ready.markdown")).unwrap(),
            "draft"
        );

        let renamed_image = rename_workspace_entry_core(RenameWorkspaceEntryRequest {
            workspace_root: root_string(&workspace),
            relative_path: "photo.png".to_owned(),
            new_name: "cover.PNG".to_owned(),
            expected_documents: Vec::new(),
        })
        .unwrap();
        assert_eq!(renamed_image.kind, WorkspaceEntryKind::Image);
        assert!(workspace.path().join("cover.PNG").is_file());

        let renamed_directory = rename_workspace_entry_core(RenameWorkspaceEntryRequest {
            workspace_root: root_string(&workspace),
            relative_path: "notes".to_owned(),
            new_name: "archive".to_owned(),
            expected_documents: vec![expected_document(&workspace, "notes/inside.txt")],
        })
        .unwrap();
        assert_eq!(
            renamed_directory.destination_relative_path.as_deref(),
            Some("archive")
        );
        assert!(workspace.path().join("archive/inside.txt").is_file());

        let collision = rename_workspace_entry_core(RenameWorkspaceEntryRequest {
            workspace_root: root_string(&workspace),
            relative_path: "ready.markdown".to_owned(),
            new_name: "taken.md".to_owned(),
            expected_documents: vec![expected_document(&workspace, "ready.markdown")],
        })
        .unwrap_err();
        assert_eq!(collision.code, ErrorCode::AlreadyExists);
        assert_eq!(
            fs::read_to_string(workspace.path().join("taken.md")).unwrap(),
            "taken"
        );
        assert!(workspace.path().join("ready.markdown").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn rename_rejects_a_distinct_hardlink_instead_of_treating_it_as_case_only() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "draft.md", b"draft");
        fs::hard_link(
            workspace.path().join("draft.md"),
            workspace.path().join("ready.md"),
        )
        .unwrap();

        let error = rename_workspace_entry_core(RenameWorkspaceEntryRequest {
            workspace_root: root_string(&workspace),
            relative_path: "draft.md".to_owned(),
            new_name: "ready.md".to_owned(),
            expected_documents: vec![expected_document(&workspace, "draft.md")],
        })
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::AlreadyExists);
        assert_eq!(
            fs::read(workspace.path().join("draft.md")).unwrap(),
            b"draft"
        );
        assert_eq!(
            fs::read(workspace.path().join("ready.md")).unwrap(),
            b"draft"
        );
    }

    #[test]
    fn case_only_rename_uses_two_names_when_the_filesystem_aliases_case() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "draft.md", b"draft");
        if !workspace.path().join("DRAFT.md").exists() {
            return;
        }

        let result = rename_workspace_entry_core(RenameWorkspaceEntryRequest {
            workspace_root: root_string(&workspace),
            relative_path: "draft.md".to_owned(),
            new_name: "DRAFT.md".to_owned(),
            expected_documents: vec![expected_document(&workspace, "draft.md")],
        })
        .unwrap();

        assert_eq!(
            result.destination_relative_path.as_deref(),
            Some("DRAFT.md")
        );
        let exact_names: Vec<_> = fs::read_dir(workspace.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert!(exact_names.contains(&OsString::from("DRAFT.md")));
        assert!(!exact_names.contains(&OsString::from("draft.md")));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_workspace_rename_is_atomic_and_never_replaces_an_existing_target() {
        let workspace = tempdir().unwrap();
        let source = workspace.path().join("source.md");
        let destination = workspace.path().join("destination.md");
        fs::write(&source, "source").unwrap();
        fs::write(&destination, "destination").unwrap();
        let directory = CapabilityDirectory {
            dir: CapabilityDir::open_ambient_dir(workspace.path(), ambient_authority()).unwrap(),
            absolute_path: workspace.path().to_path_buf(),
        };

        let error = capability_rename_noclobber_io(
            &directory,
            OsStr::new("source.md"),
            &directory,
            OsStr::new("destination.md"),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read_to_string(&source).unwrap(), "source");
        assert_eq!(fs::read_to_string(&destination).unwrap(), "destination");

        fs::remove_file(&destination).unwrap();
        capability_rename_noclobber_io(
            &directory,
            OsStr::new("source.md"),
            &directory,
            OsStr::new("destination.md"),
        )
        .unwrap();
        assert!(!source.exists());
        assert_eq!(fs::read_to_string(destination).unwrap(), "source");
    }

    #[test]
    fn rename_rejects_stale_open_documents_and_image_format_changes() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "notes/open.md", b"original");
        write_fixture(&workspace, "photo.png", b"png");
        let stale = expected_document(&workspace, "notes/open.md");
        fs::write(workspace.path().join("notes/open.md"), "external").unwrap();

        let conflict = rename_workspace_entry_core(RenameWorkspaceEntryRequest {
            workspace_root: root_string(&workspace),
            relative_path: "notes".to_owned(),
            new_name: "renamed".to_owned(),
            expected_documents: vec![stale],
        })
        .unwrap_err();
        assert_eq!(conflict.code, ErrorCode::Conflict);
        assert!(workspace.path().join("notes/open.md").is_file());

        let format_change = rename_workspace_entry_core(RenameWorkspaceEntryRequest {
            workspace_root: root_string(&workspace),
            relative_path: "photo.png".to_owned(),
            new_name: "photo.jpg".to_owned(),
            expected_documents: Vec::new(),
        })
        .unwrap_err();
        assert_eq!(format_change.code, ErrorCode::UnsupportedFileType);
        assert!(workspace.path().join("photo.png").is_file());

        let unrelated_revision = expected_document(&workspace, "notes/open.md");
        let unrelated = rename_workspace_entry_core(RenameWorkspaceEntryRequest {
            workspace_root: root_string(&workspace),
            relative_path: "photo.png".to_owned(),
            new_name: "cover.png".to_owned(),
            expected_documents: vec![unrelated_revision],
        })
        .unwrap_err();
        assert_eq!(unrelated.code, ErrorCode::InvalidPath);

        assert_eq!(
            renamed_descendant_path("notes", "archive", "notes/deep/日记.md").as_deref(),
            Some("archive/deep/日记.md")
        );
        assert!(renamed_descendant_path("notes", "archive", "not-notes/a.md").is_none());
    }

    #[test]
    fn duplicates_files_with_safe_collision_names_and_exact_bytes() {
        let workspace = tempdir().unwrap();
        let image = [0_u8, 255, 42, 10];
        write_fixture(&workspace, "photo.png", &image);
        write_fixture(&workspace, "note.md", b"note");

        let first = duplicate_workspace_entry_core(DuplicateWorkspaceEntryRequest {
            workspace_root: root_string(&workspace),
            relative_path: "photo.png".to_owned(),
            expected_revision: None,
        })
        .unwrap();
        let second = duplicate_workspace_entry_core(DuplicateWorkspaceEntryRequest {
            workspace_root: root_string(&workspace),
            relative_path: "photo.png".to_owned(),
            expected_revision: None,
        })
        .unwrap();

        assert_eq!(
            first.destination_relative_path.as_deref(),
            Some("photo copy.png")
        );
        assert_eq!(
            second.destination_relative_path.as_deref(),
            Some("photo copy 2.png")
        );
        assert_eq!(
            fs::read(workspace.path().join("photo copy.png")).unwrap(),
            image
        );
        assert_eq!(
            fs::read(workspace.path().join("photo copy 2.png")).unwrap(),
            image
        );

        let document_copy = duplicate_workspace_entry_core(DuplicateWorkspaceEntryRequest {
            workspace_root: root_string(&workspace),
            relative_path: "note.md".to_owned(),
            expected_revision: Some(expected_document(&workspace, "note.md").revision),
        })
        .unwrap();
        assert_eq!(
            document_copy.destination_relative_path.as_deref(),
            Some("note copy.md")
        );
        assert_eq!(
            fs::read_to_string(workspace.path().join("note copy.md")).unwrap(),
            "note"
        );
        assert!(fs::read_dir(workspace.path()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".viva-")
        }));
    }

    #[test]
    fn duplicate_rejects_directories_and_stale_document_revisions() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "notes/open.md", b"original");
        let stale = expected_document(&workspace, "notes/open.md").revision;
        fs::write(workspace.path().join("notes/open.md"), "external").unwrap();

        let directory = duplicate_workspace_entry_core(DuplicateWorkspaceEntryRequest {
            workspace_root: root_string(&workspace),
            relative_path: "notes".to_owned(),
            expected_revision: None,
        })
        .unwrap_err();
        assert_eq!(directory.code, ErrorCode::NotFile);

        let conflict = duplicate_workspace_entry_core(DuplicateWorkspaceEntryRequest {
            workspace_root: root_string(&workspace),
            relative_path: "notes/open.md".to_owned(),
            expected_revision: Some(stale),
        })
        .unwrap_err();
        assert_eq!(conflict.code, ErrorCode::Conflict);
        assert!(!workspace.path().join("notes/open copy.md").exists());
    }

    #[test]
    fn trash_uses_only_the_recoverable_backend_and_checks_open_revisions_first() {
        let workspace = tempdir().unwrap();
        let recovered = tempdir().unwrap();
        write_fixture(&workspace, "notes/open.md", b"original");
        let expected = expected_document(&workspace, "notes/open.md");
        let recovered_path = recovered.path().join("notes");

        let trashed = trash_workspace_entry_core(
            TrashWorkspaceEntryRequest {
                workspace_root: root_string(&workspace),
                relative_path: "notes".to_owned(),
                expected_documents: vec![expected],
            },
            |staging, source_name, _, _| {
                recover_staged_entry(staging, source_name, &recovered_path)
            },
        )
        .unwrap();
        assert!(trashed.recoverable);
        assert_eq!(trashed.source_relative_path.as_deref(), Some("notes"));
        assert!(recovered_path.join("open.md").is_file());

        write_fixture(&workspace, "keep.md", b"keep");
        let failed = trash_workspace_entry_core(
            TrashWorkspaceEntryRequest {
                workspace_root: root_string(&workspace),
                relative_path: "keep.md".to_owned(),
                expected_documents: vec![expected_document(&workspace, "keep.md")],
            },
            |_, _, _, _| Err(CommandError::new(ErrorCode::Io, "system trash unavailable")),
        )
        .unwrap_err();
        assert_eq!(failed.code, ErrorCode::Io);
        assert_eq!(
            fs::read_to_string(workspace.path().join("keep.md")).unwrap(),
            "keep"
        );

        let stale = expected_document(&workspace, "keep.md");
        fs::write(workspace.path().join("keep.md"), "external").unwrap();
        let callback_called = std::cell::Cell::new(false);
        let conflict = trash_workspace_entry_core(
            TrashWorkspaceEntryRequest {
                workspace_root: root_string(&workspace),
                relative_path: "keep.md".to_owned(),
                expected_documents: vec![stale],
            },
            |_, _, _, _| {
                callback_called.set(true);
                Ok(())
            },
        )
        .unwrap_err();
        assert_eq!(conflict.code, ErrorCode::Conflict);
        assert!(!callback_called.get());
        assert!(workspace.path().join("keep.md").is_file());
    }

    #[test]
    fn async_workspace_wrapper_returns_the_sync_core_result() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "README.md", b"readme");

        let tree = tauri::async_runtime::block_on(open_workspace(OpenWorkspaceRequest {
            path: root_string(&workspace),
        }))
        .unwrap();

        assert_eq!(document_paths(&tree), vec!["README.md"]);
    }

    #[test]
    fn allowed_extensions_are_case_insensitive_and_explicit() {
        for path in ["a.md", "a.MARKDOWN", "a.mdx", "a.TxT"] {
            assert!(is_allowed_document(Path::new(path)), "{path}");
        }
        for path in ["a", "a.html", "a.png", ".md"] {
            assert!(!is_allowed_document(Path::new(path)), "{path}");
        }
    }

    #[test]
    fn image_extensions_are_case_insensitive_and_explicit() {
        for path in ["a.png", "a.JPG", "a.jpeg", "a.GiF", "a.webp"] {
            assert!(is_allowed_image(Path::new(path)), "{path}");
        }
        for path in ["a", "a.svg", "a.avif", "a.html", ".png"] {
            assert!(!is_allowed_image(Path::new(path)), "{path}");
        }
    }

    #[test]
    fn rejects_parent_absolute_hidden_and_ignored_paths() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "safe.md", b"safe");
        write_fixture(&workspace, ".hidden.md", b"hidden");
        write_fixture(&workspace, "node_modules/hidden.md", b"hidden");

        for relative_path in [
            "../outside.md",
            "/outside.md",
            ".hidden.md",
            "node_modules/hidden.md",
        ] {
            let error = read_document_core(DocumentPathRequest {
                workspace_root: root_string(&workspace),
                relative_path: relative_path.to_owned(),
            })
            .unwrap_err();
            assert_eq!(error.code, ErrorCode::InvalidPath, "{relative_path}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn ignores_and_rejects_symlink_escapes() {
        use std::os::unix::fs::symlink;

        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        write_fixture(&outside, "secret.md", b"secret");
        symlink(
            outside.path().join("secret.md"),
            workspace.path().join("linked.md"),
        )
        .unwrap();

        assert!(document_paths(&open_fixture(&workspace)).is_empty());
        let error = read_document_core(DocumentPathRequest {
            workspace_root: root_string(&workspace),
            relative_path: "linked.md".to_owned(),
        })
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::SymlinkNotAllowed);
    }

    #[test]
    fn rejects_invalid_utf8_and_oversized_documents() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "invalid.md", &[0xff, 0xfe]);

        let invalid_utf8 = read_document_core(DocumentPathRequest {
            workspace_root: root_string(&workspace),
            relative_path: "invalid.md".to_owned(),
        })
        .unwrap_err();
        assert_eq!(invalid_utf8.code, ErrorCode::InvalidUtf8);

        let oversized_path = workspace.path().join("oversized.md");
        let oversized = File::create(&oversized_path).unwrap();
        oversized.set_len(MAX_DOCUMENT_BYTES + 1).unwrap();
        drop(oversized);

        let too_large = read_document_core(DocumentPathRequest {
            workspace_root: root_string(&workspace),
            relative_path: "oversized.md".to_owned(),
        })
        .unwrap_err();
        assert_eq!(too_large.code, ErrorCode::FileTooLarge);
    }

    #[test]
    fn read_snapshots_include_a_sha256_revision_without_a_history_warning() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "note.md", b"read me");

        let snapshot = read_document_core(DocumentPathRequest {
            workspace_root: root_string(&workspace),
            relative_path: "note.md".to_owned(),
        })
        .unwrap();

        assert_eq!(snapshot.revision.content_sha256, sha256_hex(b"read me"));
        assert!(snapshot.history_warning_code.is_none());
        let serialized = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(
            serialized["revision"]["contentSha256"],
            sha256_hex(b"read me")
        );
        assert!(serialized["revision"].get("contentHash").is_none());
    }

    #[test]
    fn creates_and_atomically_saves_documents_without_temp_residue() {
        let workspace = tempdir().unwrap();
        fs::create_dir(workspace.path().join("notes")).unwrap();

        let created = create_document_core(CreateDocumentRequest {
            workspace_root: root_string(&workspace),
            relative_path: "notes/new.md".to_owned(),
            content: Some("first".to_owned()),
        })
        .unwrap();
        assert_eq!(created.content, "first");
        assert_eq!(created.revision.content_sha256, sha256_hex(b"first"));
        assert!(created.history_warning_code.is_none());

        let saved = write_document_core(WriteDocumentRequest {
            workspace_root: root_string(&workspace),
            relative_path: "notes/new.md".to_owned(),
            content: "second version".to_owned(),
            expected_revision: created.revision,
        })
        .unwrap();
        assert_eq!(saved.snapshot.content, "second version");
        assert_eq!(
            saved.snapshot.revision.content_sha256,
            sha256_hex(b"second version")
        );
        assert!(saved.snapshot.history_warning_code.is_none());
        assert_eq!(saved.previous_content.as_deref(), Some("first"));
        assert_eq!(
            fs::read_to_string(workspace.path().join("notes/new.md")).unwrap(),
            "second version"
        );

        let names: Vec<String> = fs::read_dir(workspace.path().join("notes"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["new.md"]);

        let duplicate = create_document_core(CreateDocumentRequest {
            workspace_root: root_string(&workspace),
            relative_path: "notes/new.md".to_owned(),
            content: None,
        })
        .unwrap_err();
        assert_eq!(duplicate.code, ErrorCode::AlreadyExists);
    }

    #[test]
    fn first_write_history_contains_previous_and_new_content_and_deduplicates() {
        let workspace = tempdir().unwrap();
        let history_data = tempdir().unwrap();
        write_fixture(&workspace, "note.md", b"before");
        let initial = read_document_core(DocumentPathRequest {
            workspace_root: root_string(&workspace),
            relative_path: "note.md".to_owned(),
        })
        .unwrap();

        let first_write = write_document_core(WriteDocumentRequest {
            workspace_root: root_string(&workspace),
            relative_path: "note.md".to_owned(),
            content: "after".to_owned(),
            expected_revision: initial.revision,
        })
        .unwrap();
        let document = resolve_history_document(&root_string(&workspace), "note.md").unwrap();
        let store = HistoryStore::new(history_data.path().join("history"));
        let mut recording_order = Vec::new();
        for_each_write_version(&first_write, |content| {
            recording_order.push(content.to_owned());
        });

        assert_eq!(recording_order, vec!["before", "after"]);
        let first_batch: Vec<_> = recording_order.iter().map(String::as_str).collect();
        store.record_batch_best_effort(&document, &first_batch);
        let versions = store.list(&document).unwrap();
        assert_eq!(versions.len(), 2);
        let contents: HashSet<_> = versions
            .iter()
            .map(|version| store.read(&document, &version.version_id).unwrap().content)
            .collect();
        assert_eq!(
            contents,
            HashSet::from(["before".to_owned(), "after".to_owned()])
        );

        let second_write = write_document_core(WriteDocumentRequest {
            workspace_root: root_string(&workspace),
            relative_path: "note.md".to_owned(),
            content: "after".to_owned(),
            expected_revision: first_write.snapshot.revision,
        })
        .unwrap();
        let mut second_batch = Vec::new();
        if let Some(previous_content) = second_write.previous_content.as_deref() {
            second_batch.push(previous_content);
        }
        second_batch.push(second_write.snapshot.content.as_str());
        store.record_batch_best_effort(&document, &second_batch);
        assert_eq!(store.list(&document).unwrap().len(), 2);
    }

    #[test]
    fn failure_to_read_previous_content_does_not_block_the_save() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "invalid.md", &[0xff, 0xfe]);
        let expected_revision =
            read_revision_limited(&workspace.path().join("invalid.md")).unwrap();

        let outcome = write_document_core(WriteDocumentRequest {
            workspace_root: root_string(&workspace),
            relative_path: "invalid.md".to_owned(),
            content: "valid replacement".to_owned(),
            expected_revision,
        })
        .unwrap();

        assert!(outcome.previous_content.is_none());
        assert_eq!(
            fs::read_to_string(workspace.path().join("invalid.md")).unwrap(),
            "valid replacement"
        );
    }

    #[test]
    fn refuses_to_overwrite_a_document_changed_on_disk() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "note.md", b"original");
        let snapshot = read_document_core(DocumentPathRequest {
            workspace_root: root_string(&workspace),
            relative_path: "note.md".to_owned(),
        })
        .unwrap();

        fs::write(workspace.path().join("note.md"), "external change").unwrap();
        let result = write_document_core(WriteDocumentRequest {
            workspace_root: root_string(&workspace),
            relative_path: "note.md".to_owned(),
            content: "viva change".to_owned(),
            expected_revision: snapshot.revision,
        });
        let error = match result {
            Ok(_) => panic!("the conflicting save unexpectedly succeeded"),
            Err(error) => error,
        };

        assert_eq!(error.code, ErrorCode::Conflict);
        assert_eq!(
            fs::read_to_string(workspace.path().join("note.md")).unwrap(),
            "external change"
        );
    }

    #[test]
    fn concurrent_locked_writes_allow_one_revision_to_win_and_reject_the_other() {
        let workspace = tempdir().unwrap();
        let lock_data = tempdir().unwrap();
        write_fixture(&workspace, "note.md", b"original");
        let snapshot = read_document_core(DocumentPathRequest {
            workspace_root: root_string(&workspace),
            relative_path: "note.md".to_owned(),
        })
        .unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let lock_path = lock_data.path().join("locks/document-writes.lock");

        let results: Vec<_> = std::thread::scope(|scope| {
            ["first process", "second process"]
                .into_iter()
                .map(|content| {
                    let barrier = Arc::clone(&barrier);
                    let lock_path = lock_path.clone();
                    let request = WriteDocumentRequest {
                        workspace_root: root_string(&workspace),
                        relative_path: "note.md".to_owned(),
                        content: content.to_owned(),
                        expected_revision: snapshot.revision.clone(),
                    };
                    scope.spawn(move || {
                        barrier.wait();
                        with_document_write_lock_path(&lock_path, || write_document_core(request))
                    })
                })
                .collect::<Vec<_>>()
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect()
        });

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter_map(|result| result.as_ref().err())
                .filter(|error| error.code == ErrorCode::Conflict)
                .count(),
            1
        );
        let saved = fs::read_to_string(workspace.path().join("note.md")).unwrap();
        assert!(saved == "first process" || saved == "second process");
        assert!(!lock_path.starts_with(workspace.path()));
    }

    #[test]
    fn document_write_lock_stays_held_until_history_recording_finishes() {
        let lock_data = tempdir().unwrap();
        let lock_path = lock_data.path().join("locks/document-writes.lock");
        let (history_started_tx, history_started_rx) = mpsc::channel();
        let (release_history_tx, release_history_rx) = mpsc::channel();
        let (second_persisted_tx, second_persisted_rx) = mpsc::channel();

        std::thread::scope(|scope| {
            let first_lock_path = lock_path.clone();
            let first = scope.spawn(move || {
                with_document_write_lock_and_history_path(
                    &first_lock_path,
                    || Ok("first"),
                    |_| {
                        history_started_tx.send(()).unwrap();
                        release_history_rx.recv().unwrap();
                        true
                    },
                )
            });
            history_started_rx
                .recv_timeout(Duration::from_secs(5))
                .unwrap();

            let second_lock_path = lock_path.clone();
            let second = scope.spawn(move || {
                with_document_write_lock_and_history_path(
                    &second_lock_path,
                    || {
                        second_persisted_tx.send(()).unwrap();
                        Ok("second")
                    },
                    |_| true,
                )
            });

            assert!(matches!(
                second_persisted_rx.recv_timeout(Duration::from_millis(100)),
                Err(mpsc::RecvTimeoutError::Timeout)
            ));
            release_history_tx.send(()).unwrap();

            assert_eq!(first.join().unwrap().unwrap(), ("first", true));
            assert_eq!(second.join().unwrap().unwrap(), ("second", true));
        });
    }

    #[test]
    fn content_hash_detects_same_size_external_changes_with_restored_mtime() {
        let workspace = tempdir().unwrap();
        let path = workspace.path().join("note.md");
        write_fixture(&workspace, "note.md", b"aaaaaaaa");
        let original_modified = fs::metadata(&path).unwrap().modified().unwrap();
        let snapshot = read_document_core(DocumentPathRequest {
            workspace_root: root_string(&workspace),
            relative_path: "note.md".to_owned(),
        })
        .unwrap();
        let expected_revision = snapshot.revision.clone();

        fs::write(&path, b"bbbbbbbb").unwrap();
        let file = fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_times(fs::FileTimes::new().set_modified(original_modified))
            .unwrap();
        drop(file);

        let restored_metadata = metadata_revision(&fs::metadata(&path).unwrap()).unwrap();
        assert_eq!(
            restored_metadata.modified_at_ms,
            expected_revision.modified_at_ms
        );
        assert_eq!(restored_metadata.size_bytes, expected_revision.size_bytes);
        assert_ne!(
            read_revision_limited(&path).unwrap().content_sha256,
            expected_revision.content_sha256
        );

        let result = write_document_core(WriteDocumentRequest {
            workspace_root: root_string(&workspace),
            relative_path: "note.md".to_owned(),
            content: "cccccccc".to_owned(),
            expected_revision,
        });
        let error = match result {
            Ok(_) => panic!("the same-metadata conflicting save unexpectedly succeeded"),
            Err(error) => error,
        };

        assert_eq!(error.code, ErrorCode::Conflict);
        assert_eq!(fs::read(&path).unwrap(), b"bbbbbbbb");
    }

    #[test]
    fn save_as_stays_inside_workspace_and_replaces_only_the_inspected_revision() {
        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let destination = workspace.path().join("saved.markdown");

        let saved = save_document_as_core(SaveDocumentAsRequest {
            workspace_root: root_string(&workspace),
            destination_path: destination.to_string_lossy().into_owned(),
            content: "saved".to_owned(),
            expected_destination_revision: None,
        })
        .unwrap();
        assert_eq!(saved.snapshot.relative_path, "saved.markdown");
        assert_eq!(saved.snapshot.revision.content_sha256, sha256_hex(b"saved"));
        assert!(saved.snapshot.history_warning_code.is_none());
        assert!(saved.previous_content.is_none());

        let collision = save_document_as_core(SaveDocumentAsRequest {
            workspace_root: root_string(&workspace),
            destination_path: destination.to_string_lossy().into_owned(),
            content: "replacement".to_owned(),
            expected_destination_revision: None,
        })
        .unwrap_err();
        assert_eq!(collision.code, ErrorCode::AlreadyExists);
        assert_eq!(fs::read_to_string(&destination).unwrap(), "saved");

        let inspected = inspect_save_destination_core(InspectSaveDestinationRequest {
            workspace_root: root_string(&workspace),
            destination_path: destination.to_string_lossy().into_owned(),
        })
        .unwrap();
        let replaced = save_document_as_core(SaveDocumentAsRequest {
            workspace_root: root_string(&workspace),
            destination_path: destination.to_string_lossy().into_owned(),
            content: "replacement".to_owned(),
            expected_destination_revision: inspected.revision,
        })
        .unwrap();
        assert_eq!(replaced.previous_content.as_deref(), Some("saved"));
        assert_eq!(fs::read_to_string(&destination).unwrap(), "replacement");

        let stale_revision = replaced.snapshot.revision;
        fs::write(&destination, "external change").unwrap();
        let conflict = save_document_as_core(SaveDocumentAsRequest {
            workspace_root: root_string(&workspace),
            destination_path: destination.to_string_lossy().into_owned(),
            content: "must not win".to_owned(),
            expected_destination_revision: Some(stale_revision),
        })
        .unwrap_err();
        assert_eq!(conflict.code, ErrorCode::Conflict);
        assert_eq!(fs::read_to_string(&destination).unwrap(), "external change");

        let escaped = save_document_as_core(SaveDocumentAsRequest {
            workspace_root: root_string(&workspace),
            destination_path: outside
                .path()
                .join("escaped.md")
                .to_string_lossy()
                .into_owned(),
            content: "escaped".to_owned(),
            expected_destination_revision: None,
        })
        .unwrap_err();
        assert_eq!(escaped.code, ErrorCode::OutsideWorkspace);
    }

    #[test]
    fn concurrent_locked_save_as_replacements_reject_the_stale_writer() {
        let workspace = tempdir().unwrap();
        let lock_data = tempdir().unwrap();
        let destination = workspace.path().join("saved.md");
        fs::write(&destination, "original").unwrap();
        let inspected = inspect_save_destination_core(InspectSaveDestinationRequest {
            workspace_root: root_string(&workspace),
            destination_path: destination.to_string_lossy().into_owned(),
        })
        .unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let lock_path = lock_data.path().join("locks/document-writes.lock");

        let results: Vec<_> = std::thread::scope(|scope| {
            ["first replacement", "second replacement"]
                .into_iter()
                .map(|content| {
                    let barrier = Arc::clone(&barrier);
                    let lock_path = lock_path.clone();
                    let request = SaveDocumentAsRequest {
                        workspace_root: root_string(&workspace),
                        destination_path: destination.to_string_lossy().into_owned(),
                        content: content.to_owned(),
                        expected_destination_revision: inspected.revision.clone(),
                    };
                    scope.spawn(move || {
                        barrier.wait();
                        with_document_write_lock_path(&lock_path, || save_document_as_core(request))
                    })
                })
                .collect::<Vec<_>>()
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect()
        });

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter_map(|result| result.as_ref().err())
                .filter(|error| error.code == ErrorCode::Conflict)
                .count(),
            1
        );
        let saved = fs::read_to_string(destination).unwrap();
        assert!(saved == "first replacement" || saved == "second replacement");
    }

    #[test]
    fn save_as_uses_canonical_casing_for_existing_destination_aliases() {
        let workspace = tempdir().unwrap();
        let actual = workspace.path().join("Other.md");
        let alias = workspace.path().join("other.md");
        fs::write(&actual, "original").unwrap();

        // Case-sensitive volumes have no alias to normalize.
        if fs::canonicalize(&alias).is_err() {
            return;
        }

        let inspected = inspect_save_destination_core(InspectSaveDestinationRequest {
            workspace_root: root_string(&workspace),
            destination_path: alias.to_string_lossy().into_owned(),
        })
        .unwrap();
        assert_eq!(inspected.relative_path, "Other.md");

        let saved = save_document_as_core(SaveDocumentAsRequest {
            workspace_root: root_string(&workspace),
            destination_path: alias.to_string_lossy().into_owned(),
            content: "replacement".to_owned(),
            expected_destination_revision: inspected.revision,
        })
        .unwrap();
        assert_eq!(saved.snapshot.relative_path, "Other.md");
        assert_eq!(saved.snapshot.name, "Other.md");
        assert_eq!(fs::read_to_string(&actual).unwrap(), "replacement");
    }

    #[test]
    fn history_failure_adds_a_stable_optional_warning_without_changing_the_snapshot() {
        let workspace = tempdir().unwrap();
        let snapshot = create_document_core(CreateDocumentRequest {
            workspace_root: root_string(&workspace),
            relative_path: "note.md".to_owned(),
            content: Some("saved body".to_owned()),
        })
        .unwrap();

        let available = with_history_warning(snapshot.clone(), true);
        let unavailable = with_history_warning(snapshot, false);

        assert!(available.history_warning_code.is_none());
        assert!(
            serde_json::to_value(&available)
                .unwrap()
                .get("historyWarningCode")
                .is_none()
        );
        assert_eq!(
            unavailable.history_warning_code,
            Some(HistoryWarningCode::HistoryUnavailable)
        );
        assert_eq!(
            serde_json::to_value(&unavailable).unwrap()["historyWarningCode"],
            "HISTORY_UNAVAILABLE"
        );
        assert_eq!(unavailable.content, "saved body");
        assert_eq!(
            fs::read_to_string(workspace.path().join("note.md")).unwrap(),
            "saved body"
        );
    }

    #[test]
    fn searches_visible_documents_with_unicode_columns_and_limits() {
        let workspace = tempdir().unwrap();
        write_fixture(
            &workspace,
            "a.md",
            "标题 Alpha\nsecond ALPHA result".as_bytes(),
        );
        write_fixture(&workspace, "nested/b.txt", b"before alpha after");
        write_fixture(&workspace, ".hidden.md", b"alpha hidden");
        write_fixture(&workspace, ".git/index.md", b"alpha git");
        write_fixture(&workspace, "node_modules/package.md", b"alpha package");
        write_fixture(&workspace, "target/generated.md", b"alpha target");

        let empty = search_workspace_core(SearchWorkspaceRequest {
            workspace_root: root_string(&workspace),
            query: String::new(),
            max_results: None,
        })
        .unwrap();
        assert!(empty.is_empty());

        let matches = search_workspace_core(SearchWorkspaceRequest {
            workspace_root: root_string(&workspace),
            query: "alpha".to_owned(),
            max_results: Some(3),
        })
        .unwrap();
        assert_eq!(matches.len(), 3);
        assert_eq!(matches[0].relative_path, "a.md");
        assert_eq!(matches[0].line, 1);
        assert_eq!(matches[0].column, 4);
        assert_eq!(matches[1].relative_path, "a.md");
        assert_eq!(matches[1].line, 2);
        assert_eq!(matches[1].column, 8);
        assert_eq!(matches[2].relative_path, "nested/b.txt");
        assert_eq!(matches[2].line, 1);
        assert_eq!(matches[2].column, 8);
    }

    #[test]
    fn search_skips_files_after_the_total_read_budget() {
        let workspace = tempdir().unwrap();
        let chunk_size = 9 * 1024 * 1024;
        for index in 0..4 {
            let mut content = vec![b'x'; chunk_size];
            if index == 3 {
                content[..6].copy_from_slice(b"needle");
            }
            write_fixture(&workspace, &format!("{index}.md"), &content);
        }

        let matches = search_workspace_core(SearchWorkspaceRequest {
            workspace_root: root_string(&workspace),
            query: "needle".to_owned(),
            max_results: None,
        })
        .unwrap();
        assert!(matches.is_empty());
    }

    #[test]
    fn search_does_not_inspect_entries_after_the_read_budget_is_exhausted() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "a.md", b"aaaa");
        write_fixture(&workspace, "b.md", b"bbbb");
        write_fixture(&workspace, "z-after-budget.md", b"needle");
        let mut inspected = Vec::new();

        let matches = search_workspace_with_limits(
            SearchWorkspaceRequest {
                workspace_root: root_string(&workspace),
                query: "needle".to_owned(),
                max_results: None,
            },
            SearchLimits {
                max_read_bytes: 8,
                max_entries: MAX_TREE_ENTRIES,
            },
            |path| inspected.push(path.file_name().unwrap().to_string_lossy().into_owned()),
        )
        .unwrap();

        assert!(matches.is_empty());
        assert_eq!(inspected, vec!["a.md", "b.md"]);
    }

    #[test]
    fn search_does_not_inspect_entries_after_result_or_entry_limits() {
        let workspace = tempdir().unwrap();
        write_fixture(&workspace, "a.md", b"needle");
        write_fixture(&workspace, "b.md", b"needle");
        write_fixture(&workspace, "c.md", b"needle");

        let mut after_result = Vec::new();
        let matches = search_workspace_with_limits(
            SearchWorkspaceRequest {
                workspace_root: root_string(&workspace),
                query: "needle".to_owned(),
                max_results: Some(1),
            },
            SearchLimits::PRODUCTION,
            |path| after_result.push(path.file_name().unwrap().to_string_lossy().into_owned()),
        )
        .unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(after_result, vec!["a.md"]);

        let mut after_entry_limit = Vec::new();
        let matches = search_workspace_with_limits(
            SearchWorkspaceRequest {
                workspace_root: root_string(&workspace),
                query: "absent".to_owned(),
                max_results: None,
            },
            SearchLimits {
                max_read_bytes: MAX_SEARCH_BYTES,
                max_entries: 2,
            },
            |path| {
                after_entry_limit.push(path.file_name().unwrap().to_string_lossy().into_owned());
            },
        )
        .unwrap();
        assert!(matches.is_empty());
        assert_eq!(after_entry_limit, vec!["a.md", "b.md"]);
    }

    #[cfg(unix)]
    #[test]
    fn search_never_follows_document_symlinks() {
        use std::os::unix::fs::symlink;

        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        write_fixture(&outside, "secret.md", b"needle");
        symlink(
            outside.path().join("secret.md"),
            workspace.path().join("linked.md"),
        )
        .unwrap();

        let matches = search_workspace_core(SearchWorkspaceRequest {
            workspace_root: root_string(&workspace),
            query: "needle".to_owned(),
            max_results: None,
        })
        .unwrap();
        assert!(matches.is_empty());
    }
}
