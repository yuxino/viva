use crate::history;
use crate::locking::CrossProcessLock;
use crate::models::{
    CommandError, CommandResult, CreateDocumentRequest, DocumentPathRequest, DocumentSnapshot,
    ErrorCode, FileRevision, HistoryWarningCode, InspectSaveDestinationRequest, LineEnding,
    OpenWorkspaceRequest, SaveDestinationState, SaveDocumentAsRequest, SearchMatch,
    SearchWorkspaceRequest, WorkspaceEntry, WorkspaceEntryKind, WorkspaceTree,
    WriteDocumentRequest,
};
use crate::runtime::run_blocking;
use regex::{Regex, RegexBuilder};
use sha2::{Digest, Sha256};
use std::ffi::{OsStr, OsString};
use std::fs::{self, File, Metadata};
use std::io::{Read, Write};
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

#[derive(Debug)]
struct WriteOutcome {
    snapshot: DocumentSnapshot,
    previous_content: Option<String>,
    persisted_content: String,
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
    let persisted_content = encode_content_with_limit(&request.content, request.line_ending)?;

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
    write_and_flush(&mut temporary, persisted_content.as_bytes())?;

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
        sha256_hex(persisted_content.as_bytes()),
    )?;

    Ok(WriteOutcome {
        snapshot: DocumentSnapshot {
            relative_path: resolved.relative_path,
            name: document_name(&resolved.absolute_path)?,
            content: LineEnding::normalize(&request.content),
            line_ending: request.line_ending,
            revision,
            history_warning_code: None,
        },
        previous_content,
        persisted_content,
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
    let line_ending = LineEnding::detect(&content);
    create_new_document(&root, &request.relative_path, content, line_ending)
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
    let persisted_content = encode_content_with_limit(&request.content, request.line_ending)?;

    let root = canonical_workspace(&request.workspace_root)?;
    let destination = resolve_save_destination(&root, &request.destination_path)?;
    let previous_content = match request.expected_destination_revision {
        None => {
            ensure_target_absent(&destination.target)?;
            persist_new_document(&destination.target, &persisted_content)?;
            None
        }
        Some(expected_revision) => Some(replace_save_destination(
            &root,
            &destination.target,
            &persisted_content,
            &expected_revision,
        )?),
    };

    let revision = revision_from_metadata_and_hash(
        &fs::metadata(&destination.target)
            .map_err(|error| io_error("Could not inspect the saved document", error))?,
        sha256_hex(persisted_content.as_bytes()),
    )?;

    Ok(WriteOutcome {
        snapshot: DocumentSnapshot {
            relative_path: destination.relative_path,
            name: document_name(&destination.target)?,
            content: LineEnding::normalize(&request.content),
            line_ending: request.line_ending,
            revision,
            history_warning_code: None,
        },
        previous_content,
        persisted_content,
    })
}

fn with_document_write_lock_and_history<T>(
    app: &AppHandle,
    persist: impl FnOnce() -> CommandResult<T>,
    record_history: impl FnOnce(&T) -> bool,
) -> CommandResult<(T, bool)> {
    let app_data = app.path().app_data_dir().map_err(|error| {
        CommandError::new(
            ErrorCode::Io,
            format!("Could not locate Viva's app data folder: {error}"),
        )
    })?;
    with_document_write_lock_and_history_path(
        &app_data
            .join(PROCESS_LOCK_DIRECTORY_NAME)
            .join(DOCUMENT_WRITES_LOCK_FILE_NAME),
        persist,
        record_history,
    )
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
    let persisted_content = snapshot.line_ending.encode(&snapshot.content);
    record_content_best_effort(
        app,
        requested_workspace_root,
        &snapshot.relative_path,
        &persisted_content,
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
    contents.push(outcome.persisted_content.as_str());
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
    record(&outcome.persisted_content);
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
    if depth >= MAX_TREE_DEPTH {
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
            let children = walk_directory(root, &path, depth + 1, budget)?;
            if children.is_empty() {
                continue;
            }
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

#[cfg(test)]
fn collect_document_paths(entries: &[WorkspaceEntry], output: &mut Vec<String>) {
    for entry in entries {
        match entry.kind {
            WorkspaceEntryKind::Directory => collect_document_paths(&entry.children, output),
            WorkspaceEntryKind::File => output.push(entry.relative_path.clone()),
            WorkspaceEntryKind::Image => {}
        }
    }
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
    line_ending: LineEnding,
) -> CommandResult<DocumentSnapshot> {
    let persisted_content = encode_content_with_limit(&content, line_ending)?;
    let clean_relative = validate_relative_document(relative)?;
    let parent_relative = clean_relative.parent().unwrap_or_else(|| Path::new(""));
    ensure_no_symlink_components(root, parent_relative)?;

    let parent = fs::canonicalize(root.join(parent_relative))
        .map_err(|error| io_error("Could not open the destination folder", error))?;
    ensure_within_workspace(root, &parent)?;

    let file_name = clean_relative
        .file_name()
        .ok_or_else(|| CommandError::new(ErrorCode::InvalidPath, "Choose a document file name."))?;
    let target = parent.join(file_name);
    ensure_target_absent(&target)?;
    persist_new_document(&target, &persisted_content)?;

    let revision = revision_from_metadata_and_hash(
        &fs::metadata(&target)
            .map_err(|error| io_error("Could not inspect the new document", error))?,
        sha256_hex(persisted_content.as_bytes()),
    )?;
    Ok(DocumentSnapshot {
        relative_path: relative_path_to_string(root, &target)?,
        name: document_name(&target)?,
        content: LineEnding::normalize(&content),
        line_ending,
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
    let (content, line_ending, revision) = read_utf8_limited(&resolved.absolute_path)?;
    Ok(DocumentSnapshot {
        relative_path: resolved.relative_path.clone(),
        name: document_name(&resolved.absolute_path)?,
        content,
        line_ending,
        revision,
        history_warning_code: None,
    })
}

fn read_utf8_limited(path: &Path) -> CommandResult<(String, LineEnding, FileRevision)> {
    let (bytes, metadata) = read_bytes_limited(path)?;
    let revision = revision_from_metadata_and_hash(&metadata, sha256_hex(&bytes))?;
    let raw_content = decode_utf8(bytes)?;
    let line_ending = LineEnding::detect(&raw_content);
    let content = LineEnding::normalize(&raw_content);
    Ok((content, line_ending, revision))
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

fn encode_content_with_limit(content: &str, line_ending: LineEnding) -> CommandResult<String> {
    // Reject untrusted renderer input before normalization or CRLF expansion can
    // allocate another large buffer, then enforce the exact persisted byte size.
    enforce_content_limit(content)?;
    let persisted_content = line_ending.encode(content);
    enforce_content_limit(&persisted_content)?;
    Ok(persisted_content)
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

    fn open_fixture(workspace: &TempDir) -> WorkspaceTree {
        open_workspace_core(OpenWorkspaceRequest {
            path: root_string(workspace),
        })
        .unwrap()
    }

    fn document_paths(tree: &WorkspaceTree) -> Vec<String> {
        let mut paths = Vec::new();
        collect_document_paths(&tree.children, &mut paths);
        paths
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
    fn crlf_documents_use_lf_in_the_editor_but_hash_and_save_exact_disk_bytes() {
        let workspace = tempdir().unwrap();
        let path = workspace.path().join("windows.md");
        write_fixture(&workspace, "windows.md", b"first\r\nsecond\r\n");

        let opened = read_document_core(DocumentPathRequest {
            workspace_root: root_string(&workspace),
            relative_path: "windows.md".to_owned(),
        })
        .unwrap();

        assert_eq!(opened.content, "first\nsecond\n");
        assert_eq!(opened.line_ending, LineEnding::Crlf);
        assert_eq!(serde_json::to_value(&opened).unwrap()["lineEnding"], "crlf");
        assert_eq!(
            opened.revision.content_sha256,
            sha256_hex(b"first\r\nsecond\r\n")
        );

        let saved = write_document_core(WriteDocumentRequest {
            workspace_root: root_string(&workspace),
            relative_path: "windows.md".to_owned(),
            content: "first\nchanged\n".to_owned(),
            line_ending: opened.line_ending,
            expected_revision: opened.revision,
        })
        .unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"first\r\nchanged\r\n");
        assert_eq!(saved.snapshot.content, "first\nchanged\n");
        assert_eq!(saved.snapshot.line_ending, LineEnding::Crlf);
        assert_eq!(saved.snapshot.revision.size_bytes, 16);
        assert_eq!(
            saved.snapshot.revision.content_sha256,
            sha256_hex(b"first\r\nchanged\r\n")
        );
    }

    #[test]
    fn only_consistent_crlf_is_classified_as_crlf() {
        assert_eq!(LineEnding::detect("first\r\nsecond\r\n"), LineEnding::Crlf);
        assert_eq!(LineEnding::detect("first\nsecond\n"), LineEnding::Lf);
        assert_eq!(LineEnding::detect("first\r\nsecond\n"), LineEnding::Lf);
        assert_eq!(LineEnding::detect("first\rsecond\r\n"), LineEnding::Lf);
        assert_eq!(LineEnding::detect("one line"), LineEnding::Lf);
        assert_eq!(
            LineEnding::normalize("first\r\nsecond\rthird\n"),
            "first\nsecond\nthird\n"
        );
    }

    #[test]
    fn rejects_oversized_input_and_crlf_expansion() {
        let oversized_input = "x".repeat((MAX_DOCUMENT_BYTES + 1) as usize);
        let input_error = encode_content_with_limit(&oversized_input, LineEnding::Crlf)
            .expect_err("oversized input must be rejected before CRLF expansion");
        assert_eq!(input_error.code, ErrorCode::FileTooLarge);

        let expansion_overflow = "\n".repeat((MAX_DOCUMENT_BYTES / 2 + 1) as usize);
        let expansion_error = encode_content_with_limit(&expansion_overflow, LineEnding::Crlf)
            .expect_err("persisted CRLF bytes must stay within the document limit");
        assert_eq!(expansion_error.code, ErrorCode::FileTooLarge);
    }

    #[test]
    fn save_as_encodes_crlf_before_revision_and_size_are_calculated() {
        let workspace = tempdir().unwrap();
        let destination = workspace.path().join("copy.md");

        let saved = save_document_as_core(SaveDocumentAsRequest {
            workspace_root: root_string(&workspace),
            destination_path: destination.to_string_lossy().into_owned(),
            content: "first\nsecond\n".to_owned(),
            line_ending: LineEnding::Crlf,
            expected_destination_revision: None,
        })
        .unwrap();

        assert_eq!(fs::read(&destination).unwrap(), b"first\r\nsecond\r\n");
        assert_eq!(saved.snapshot.content, "first\nsecond\n");
        assert_eq!(saved.snapshot.line_ending, LineEnding::Crlf);
        assert_eq!(saved.snapshot.revision.size_bytes, 15);
        assert_eq!(
            saved.snapshot.revision.content_sha256,
            sha256_hex(b"first\r\nsecond\r\n")
        );

        let replaced = save_document_as_core(SaveDocumentAsRequest {
            workspace_root: root_string(&workspace),
            destination_path: destination.to_string_lossy().into_owned(),
            content: "replacement\n".to_owned(),
            line_ending: LineEnding::Crlf,
            expected_destination_revision: Some(saved.snapshot.revision),
        })
        .unwrap();

        assert_eq!(
            replaced.previous_content.as_deref(),
            Some("first\r\nsecond\r\n")
        );
        assert_eq!(fs::read(&destination).unwrap(), b"replacement\r\n");
        assert_eq!(
            replaced.snapshot.revision.content_sha256,
            sha256_hex(b"replacement\r\n")
        );
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
            line_ending: LineEnding::Lf,
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
            line_ending: LineEnding::Lf,
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
            line_ending: LineEnding::Lf,
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
            line_ending: LineEnding::Lf,
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
            line_ending: LineEnding::Lf,
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
                        line_ending: LineEnding::Lf,
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
            line_ending: LineEnding::Lf,
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
            line_ending: LineEnding::Lf,
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
            line_ending: LineEnding::Lf,
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
            line_ending: LineEnding::Lf,
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
            line_ending: LineEnding::Lf,
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
            line_ending: LineEnding::Lf,
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
                        line_ending: LineEnding::Lf,
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
            line_ending: LineEnding::Lf,
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
