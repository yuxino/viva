use crate::filesystem::{HistoryDocument, MAX_DOCUMENT_BYTES, resolve_history_document};
use crate::locking::CrossProcessLock;
use crate::models::{
    CommandError, CommandResult, DocumentHistoryEntry, DocumentHistorySnapshot, ErrorCode,
    ListDocumentHistoryRequest, ReadDocumentHistoryRequest,
};
use crate::runtime::run_blocking;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, TryLockError, Weak};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tempfile::Builder as TempFileBuilder;

const HISTORY_DIRECTORY_NAME: &str = "document-history-v1";
const HISTORY_LOCK_FILE_NAME: &str = ".process.lock";
const SNAPSHOT_SUFFIX: &str = ".snapshot";
const METADATA_SUFFIX: &str = ".json";
const MAX_VERSIONS_PER_DOCUMENT: usize = 100;
const MAX_TOTAL_HISTORY_BYTES: u64 = 256 * 1024 * 1024;
const MAX_METADATA_BYTES: u64 = 4 * 1024;
const MAX_DOCUMENT_DIRECTORY_ENTRIES: usize = 2_000;
const MAX_GLOBAL_VERSIONS: usize = 50_000;

static HISTORY_LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();

#[derive(Debug, Clone)]
pub(crate) struct HistoryStore {
    root: PathBuf,
    max_versions_per_document: usize,
    max_total_bytes: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredVersionMetadata {
    version_id: String,
    created_at_ms: u64,
    size_bytes: u64,
}

#[derive(Debug, Clone)]
struct StoredVersion {
    directory: PathBuf,
    metadata: StoredVersionMetadata,
}

impl HistoryStore {
    fn for_app(app: &AppHandle) -> CommandResult<Self> {
        let app_data = app.path().app_data_dir().map_err(|error| {
            CommandError::new(
                ErrorCode::Io,
                format!("Could not locate Viva's app data folder: {error}"),
            )
        })?;
        Ok(Self::new(app_data.join(HISTORY_DIRECTORY_NAME)))
    }

    pub(crate) fn new(root: PathBuf) -> Self {
        Self {
            root,
            max_versions_per_document: MAX_VERSIONS_PER_DOCUMENT,
            max_total_bytes: MAX_TOTAL_HISTORY_BYTES,
        }
    }

    #[cfg(test)]
    fn with_limits(root: PathBuf, max_versions_per_document: usize, max_total_bytes: u64) -> Self {
        Self {
            root,
            max_versions_per_document,
            max_total_bytes,
        }
    }

    #[cfg(test)]
    pub(crate) fn record(
        &self,
        document: &HistoryDocument,
        content: &str,
    ) -> CommandResult<DocumentHistoryEntry> {
        let history_mutex = history_mutex(&self.root);
        let _guard = lock_history(&history_mutex);
        let _process_guard = self.process_lock()?;
        let directory = self.ensure_document_directory(document)?;
        let entry = self.record_content_unlocked(&directory, content, None)?;
        self.finish_housekeeping(&directory)?;
        Ok(entry)
    }

    pub(crate) fn record_batch_best_effort(
        &self,
        document: &HistoryDocument,
        contents: &[&str],
    ) -> bool {
        if contents.is_empty() {
            return true;
        }

        let history_mutex = history_mutex(&self.root);
        let Some(_guard) = try_lock_history(&history_mutex) else {
            return false;
        };
        let Ok(Some(_process_guard)) = self.try_process_lock() else {
            return false;
        };
        let Ok(directory) = self.ensure_document_directory(document) else {
            return false;
        };
        let mut succeeded = true;
        let mut recorded_contents = Vec::with_capacity(contents.len());
        let mut minimum_created_at_ms = match now_ms() {
            Ok(value) => value,
            Err(_) => return false,
        };
        for content in contents {
            if recorded_contents.contains(content) {
                continue;
            }
            match self.record_content_unlocked(&directory, content, Some(minimum_created_at_ms)) {
                Ok(entry) => {
                    recorded_contents.push(*content);
                    minimum_created_at_ms = entry.created_at_ms.saturating_add(1);
                }
                Err(_) => succeeded = false,
            }
        }
        self.finish_housekeeping(&directory).is_ok() && succeeded
    }

    fn record_content_unlocked(
        &self,
        directory: &Path,
        content: &str,
        minimum_created_at_ms: Option<u64>,
    ) -> CommandResult<DocumentHistoryEntry> {
        if content.len() as u64 > MAX_DOCUMENT_BYTES {
            return Err(CommandError::new(
                ErrorCode::FileTooLarge,
                "This document is too large to keep in local history.",
            ));
        }

        let version_id = content_version_id(content);
        let snapshot_path = snapshot_path(directory, &version_id)?;
        let metadata_path = metadata_path(directory, &version_id)?;

        ensure_snapshot(&snapshot_path, &version_id, content)?;

        let metadata = match read_stored_metadata(&metadata_path, &version_id) {
            Ok(mut existing) => {
                if existing.size_bytes != content.len() as u64 {
                    return Err(corrupt_history_error());
                }
                if let Some(minimum) = minimum_created_at_ms {
                    if minimum > existing.created_at_ms {
                        existing.created_at_ms = minimum;
                        let bytes = encode_metadata(&existing)?;
                        atomic_replace(&metadata_path, &bytes)?;
                        sync_parent_best_effort(directory);
                    }
                }
                existing
            }
            Err(error) if error.code == ErrorCode::NotFound => {
                let metadata = StoredVersionMetadata {
                    version_id: version_id.clone(),
                    created_at_ms: now_ms()?.max(minimum_created_at_ms.unwrap_or(0)),
                    size_bytes: content.len() as u64,
                };
                let bytes = encode_metadata(&metadata)?;
                if !atomic_create(&metadata_path, &bytes)? {
                    let existing = read_stored_metadata(&metadata_path, &version_id)?;
                    if existing.size_bytes != metadata.size_bytes {
                        return Err(corrupt_history_error());
                    }
                    existing
                } else {
                    sync_parent_best_effort(directory);
                    metadata
                }
            }
            Err(error) => return Err(error),
        };

        Ok(entry_from_metadata(&metadata))
    }

    fn finish_housekeeping(&self, directory: &Path) -> CommandResult<()> {
        cleanup_orphaned_version_files(directory)?;
        self.prune_document(directory)?;
        self.prune_global(directory)
    }

    pub(crate) fn list(
        &self,
        document: &HistoryDocument,
    ) -> CommandResult<Vec<DocumentHistoryEntry>> {
        let history_mutex = history_mutex(&self.root);
        let _guard = lock_history(&history_mutex);
        let _process_guard = self.process_lock()?;
        let Some(directory) = self.existing_document_directory(document)? else {
            return Ok(Vec::new());
        };
        let mut versions = read_valid_versions(&directory)?;
        sort_newest_first(&mut versions);
        Ok(versions
            .into_iter()
            .map(|version| entry_from_metadata(&version.metadata))
            .collect())
    }

    pub(crate) fn read(
        &self,
        document: &HistoryDocument,
        version_id: &str,
    ) -> CommandResult<DocumentHistorySnapshot> {
        validate_version_id(version_id)?;
        let history_mutex = history_mutex(&self.root);
        let _guard = lock_history(&history_mutex);
        let _process_guard = self.process_lock()?;
        let directory = self
            .existing_document_directory(document)?
            .ok_or_else(history_not_found_error)?;
        let metadata = read_stored_metadata(&metadata_path(&directory, version_id)?, version_id)?;
        let content = read_and_verify_snapshot(
            &snapshot_path(&directory, version_id)?,
            version_id,
            metadata.size_bytes,
        )?;

        Ok(DocumentHistorySnapshot {
            version_id: metadata.version_id,
            relative_path: document.relative_path.clone(),
            name: document.name.clone(),
            content,
            created_at_ms: metadata.created_at_ms,
            size_bytes: metadata.size_bytes,
        })
    }

    fn process_lock(&self) -> CommandResult<CrossProcessLock> {
        CrossProcessLock::acquire(
            &self.root.join(HISTORY_LOCK_FILE_NAME),
            "local document history",
        )
    }

    fn try_process_lock(&self) -> CommandResult<Option<CrossProcessLock>> {
        CrossProcessLock::try_acquire(
            &self.root.join(HISTORY_LOCK_FILE_NAME),
            "local document history",
        )
    }

    fn ensure_document_directory(&self, document: &HistoryDocument) -> CommandResult<PathBuf> {
        let root = ensure_directory(&self.root)?;
        let workspace = ensure_child_directory(&root, &workspace_key(&document.workspace_root)?)?;
        ensure_child_directory(&workspace, &document_key(&document.relative_path))
    }

    fn existing_document_directory(
        &self,
        document: &HistoryDocument,
    ) -> CommandResult<Option<PathBuf>> {
        let Some(root) = existing_directory(&self.root)? else {
            return Ok(None);
        };
        let Some(workspace) =
            existing_child_directory(&root, &workspace_key(&document.workspace_root)?)?
        else {
            return Ok(None);
        };
        existing_child_directory(&workspace, &document_key(&document.relative_path))
    }

    fn prune_document(&self, directory: &Path) -> CommandResult<()> {
        let mut versions = read_valid_versions(directory)?;
        sort_newest_first(&mut versions);
        for version in versions.into_iter().skip(self.max_versions_per_document) {
            remove_version(&version)?;
        }
        Ok(())
    }

    fn prune_global(&self, already_cleaned: &Path) -> CommandResult<()> {
        let Some(root) = existing_directory(&self.root)? else {
            return Ok(());
        };
        let mut versions = collect_global_versions(&root, already_cleaned)?;
        let mut total_bytes = versions.iter().fold(0_u64, |total, version| {
            total.saturating_add(version.metadata.size_bytes)
        });
        if total_bytes <= self.max_total_bytes {
            return Ok(());
        }

        versions.sort_by(|left, right| {
            left.metadata
                .created_at_ms
                .cmp(&right.metadata.created_at_ms)
                .then_with(|| left.metadata.version_id.cmp(&right.metadata.version_id))
        });
        for version in versions {
            if total_bytes <= self.max_total_bytes {
                break;
            }
            remove_version(&version)?;
            total_bytes = total_bytes.saturating_sub(version.metadata.size_bytes);
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn list_document_history(
    app: AppHandle,
    request: ListDocumentHistoryRequest,
) -> CommandResult<Vec<DocumentHistoryEntry>> {
    run_blocking(move || list_document_history_core(&app, request)).await
}

fn list_document_history_core(
    app: &AppHandle,
    request: ListDocumentHistoryRequest,
) -> CommandResult<Vec<DocumentHistoryEntry>> {
    let document = resolve_history_document(&request.workspace_root, &request.relative_path)?;
    HistoryStore::for_app(app)?.list(&document)
}

#[tauri::command]
pub async fn read_document_history(
    app: AppHandle,
    request: ReadDocumentHistoryRequest,
) -> CommandResult<DocumentHistorySnapshot> {
    run_blocking(move || read_document_history_core(&app, request)).await
}

fn read_document_history_core(
    app: &AppHandle,
    request: ReadDocumentHistoryRequest,
) -> CommandResult<DocumentHistorySnapshot> {
    validate_version_id(&request.version_id)?;
    let document = resolve_history_document(&request.workspace_root, &request.relative_path)?;
    HistoryStore::for_app(app)?.read(&document, &request.version_id)
}

pub(crate) fn record_document_version_best_effort(
    app: &AppHandle,
    workspace_root: &Path,
    relative_path: &str,
    content: &str,
) -> bool {
    record_document_versions_best_effort(app, workspace_root, relative_path, &[content])
}

pub(crate) fn record_document_versions_best_effort(
    app: &AppHandle,
    workspace_root: &Path,
    relative_path: &str,
    contents: &[&str],
) -> bool {
    if contents.is_empty() {
        return true;
    }
    let Some(workspace_root) = workspace_root.to_str() else {
        return false;
    };
    let Ok(document) = resolve_history_document(workspace_root, relative_path) else {
        return false;
    };
    let Ok(store) = HistoryStore::for_app(app) else {
        return false;
    };
    store.record_batch_best_effort(&document, contents)
}

fn workspace_key(workspace_root: &Path) -> CommandResult<String> {
    let value = workspace_root.to_str().ok_or_else(|| {
        CommandError::new(
            ErrorCode::InvalidPath,
            "Workspace paths must be valid Unicode.",
        )
    })?;
    Ok(scoped_hash("workspace", value.as_bytes()))
}

fn document_key(relative_path: &str) -> String {
    scoped_hash("document", relative_path.as_bytes())
}

fn content_version_id(content: &str) -> String {
    scoped_hash("content", content.as_bytes())
}

fn scoped_hash(domain: &str, value: &[u8]) -> String {
    let mut hasher = scoped_hasher(domain);
    hasher.update(value);
    let digest = hasher.finalize();
    format!("{digest:x}")
}

fn scoped_hasher(domain: &str) -> Sha256 {
    let mut hasher = Sha256::new();
    hasher.update(b"viva-history-v1\0");
    hasher.update(domain.as_bytes());
    hasher.update(b"\0");
    hasher
}

fn validate_version_id(version_id: &str) -> CommandResult<()> {
    if version_id.len() == 64
        && version_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(CommandError::new(
            ErrorCode::InvalidVersionId,
            "The local history version ID is invalid.",
        ))
    }
}

fn ensure_directory(path: &Path) -> CommandResult<PathBuf> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| history_io_error("Could not create the app data folder", error))?;
    }
    match fs::create_dir(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => {
            return Err(history_io_error(
                "Could not create the local history folder",
                error,
            ));
        }
    }
    require_real_directory(path)
}

fn ensure_child_directory(parent: &Path, name: &str) -> CommandResult<PathBuf> {
    validate_version_id(name)?;
    let path = parent.join(name);
    match fs::create_dir(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => {
            return Err(history_io_error(
                "Could not create a local history scope",
                error,
            ));
        }
    }
    let canonical = require_real_directory(&path)?;
    if canonical.starts_with(parent) {
        Ok(canonical)
    } else {
        Err(corrupt_history_error())
    }
}

fn existing_directory(path: &Path) -> CommandResult<Option<PathBuf>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(corrupt_history_error());
            }
            Ok(Some(fs::canonicalize(path).map_err(|error| {
                history_io_error("Could not open the local history folder", error)
            })?))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(history_io_error(
            "Could not inspect the local history folder",
            error,
        )),
    }
}

fn existing_child_directory(parent: &Path, name: &str) -> CommandResult<Option<PathBuf>> {
    validate_version_id(name)?;
    let Some(canonical) = existing_directory(&parent.join(name))? else {
        return Ok(None);
    };
    if canonical.starts_with(parent) {
        Ok(Some(canonical))
    } else {
        Err(corrupt_history_error())
    }
}

fn require_real_directory(path: &Path) -> CommandResult<PathBuf> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| history_io_error("Could not inspect a local history folder", error))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(corrupt_history_error());
    }
    fs::canonicalize(path)
        .map_err(|error| history_io_error("Could not open a local history folder", error))
}

fn snapshot_path(directory: &Path, version_id: &str) -> CommandResult<PathBuf> {
    validate_version_id(version_id)?;
    Ok(directory.join(format!("{version_id}{SNAPSHOT_SUFFIX}")))
}

fn metadata_path(directory: &Path, version_id: &str) -> CommandResult<PathBuf> {
    validate_version_id(version_id)?;
    Ok(directory.join(format!("{version_id}{METADATA_SUFFIX}")))
}

fn ensure_snapshot(path: &Path, version_id: &str, content: &str) -> CommandResult<()> {
    match fs::symlink_metadata(path) {
        Ok(_) => verify_existing_snapshot(path, version_id, content.len() as u64),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if atomic_create(path, content.as_bytes())? {
                let parent = path.parent().ok_or_else(corrupt_history_error)?;
                sync_parent_best_effort(parent);
                Ok(())
            } else {
                verify_existing_snapshot(path, version_id, content.len() as u64)
            }
        }
        Err(error) => Err(history_io_error(
            "Could not inspect a local history snapshot",
            error,
        )),
    }
}

fn verify_existing_snapshot(
    path: &Path,
    expected_id: &str,
    expected_size: u64,
) -> CommandResult<()> {
    validate_version_id(expected_id)?;
    let metadata = safe_regular_file(path, "local history snapshot")?;
    if expected_size > MAX_DOCUMENT_BYTES || metadata.len() != expected_size {
        return Err(corrupt_history_error());
    }

    let mut file = File::open(path)
        .map_err(|error| history_io_error("Could not verify a local history snapshot", error))?;
    let mut hasher = scoped_hasher("content");
    let mut total_bytes = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| history_io_error("Could not verify local history", error))?;
        if read == 0 {
            break;
        }
        total_bytes = total_bytes.saturating_add(read as u64);
        if total_bytes > MAX_DOCUMENT_BYTES {
            return Err(corrupt_history_error());
        }
        hasher.update(&buffer[..read]);
    }
    let digest = hasher.finalize();
    if total_bytes != expected_size || format!("{digest:x}") != expected_id {
        return Err(corrupt_history_error());
    }
    Ok(())
}

fn atomic_create(path: &Path, bytes: &[u8]) -> CommandResult<bool> {
    let parent = path.parent().ok_or_else(corrupt_history_error)?;
    let temporary = write_temporary_history_file(parent, bytes)?;
    match temporary.persist_noclobber(path) {
        Ok(_) => Ok(true),
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(history_io_error(
            "Could not store local history",
            error.error,
        )),
    }
}

fn atomic_replace(path: &Path, bytes: &[u8]) -> CommandResult<()> {
    safe_regular_file(path, "local history metadata")?;
    let parent = path.parent().ok_or_else(corrupt_history_error)?;
    write_temporary_history_file(parent, bytes)?
        .persist(path)
        .map_err(|error| history_io_error("Could not update local history", error.error))?;
    Ok(())
}

fn write_temporary_history_file(
    parent: &Path,
    bytes: &[u8],
) -> CommandResult<tempfile::NamedTempFile> {
    let mut builder = TempFileBuilder::new();
    builder.prefix(".viva-history-").suffix(".tmp");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(fs::Permissions::from_mode(0o600));
    }
    let mut temporary = builder
        .tempfile_in(parent)
        .map_err(|error| history_io_error("Could not create a local history file", error))?;
    temporary
        .write_all(bytes)
        .map_err(|error| history_io_error("Could not write local history", error))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| history_io_error("Could not flush local history", error))?;
    Ok(temporary)
}

fn encode_metadata(metadata: &StoredVersionMetadata) -> CommandResult<Vec<u8>> {
    serde_json::to_vec(metadata).map_err(|error| {
        CommandError::new(
            ErrorCode::Io,
            format!("Could not encode local history metadata: {error}"),
        )
    })
}

fn read_stored_metadata(path: &Path, expected_id: &str) -> CommandResult<StoredVersionMetadata> {
    validate_version_id(expected_id)?;
    let metadata = safe_regular_file(path, "local history metadata")?;
    if metadata.len() > MAX_METADATA_BYTES {
        return Err(corrupt_history_error());
    }
    let bytes = fs::read(path)
        .map_err(|error| history_io_error("Could not read local history metadata", error))?;
    let stored: StoredVersionMetadata =
        serde_json::from_slice(&bytes).map_err(|_| corrupt_history_error())?;
    validate_version_id(&stored.version_id).map_err(|_| corrupt_history_error())?;
    if stored.version_id != expected_id || stored.size_bytes > MAX_DOCUMENT_BYTES {
        return Err(corrupt_history_error());
    }
    Ok(stored)
}

fn read_and_verify_snapshot(
    path: &Path,
    expected_id: &str,
    expected_size: u64,
) -> CommandResult<String> {
    validate_version_id(expected_id)?;
    let metadata = safe_regular_file(path, "local history snapshot")?;
    if expected_size > MAX_DOCUMENT_BYTES || metadata.len() != expected_size {
        return Err(corrupt_history_error());
    }

    let mut file = File::open(path)
        .map_err(|error| history_io_error("Could not read a local history snapshot", error))?;
    let mut bytes = Vec::with_capacity(expected_size as usize);
    Read::by_ref(&mut file)
        .take(MAX_DOCUMENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| history_io_error("Could not read a local history snapshot", error))?;
    if bytes.len() as u64 != expected_size {
        return Err(corrupt_history_error());
    }
    let content = String::from_utf8(bytes).map_err(|_| corrupt_history_error())?;
    if content_version_id(&content) != expected_id {
        return Err(corrupt_history_error());
    }
    Ok(content)
}

fn safe_regular_file(path: &Path, description: &str) -> CommandResult<fs::Metadata> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| history_io_error(&format!("Could not inspect {description}"), error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(corrupt_history_error());
    }
    Ok(metadata)
}

fn read_valid_versions(directory: &Path) -> CommandResult<Vec<StoredVersion>> {
    let mut versions = Vec::new();
    let mut inspected = 0_usize;
    let entries = fs::read_dir(directory)
        .map_err(|error| history_io_error("Could not read local history", error))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| history_io_error("Could not read a local history entry", error))?;
        inspected += 1;
        if inspected > MAX_DOCUMENT_DIRECTORY_ENTRIES {
            return Err(corrupt_history_error());
        }
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() || !file_type.is_file() {
            continue;
        }
        let Some(version_id) = metadata_version_id(&entry.file_name()) else {
            continue;
        };
        let metadata = match read_stored_metadata(&entry.path(), &version_id) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let snapshot = match snapshot_path(directory, &version_id) {
            Ok(path) => path,
            Err(_) => continue,
        };
        let snapshot_metadata = match safe_regular_file(&snapshot, "local history snapshot") {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if snapshot_metadata.len() != metadata.size_bytes {
            continue;
        }
        versions.push(StoredVersion {
            directory: directory.to_path_buf(),
            metadata,
        });
    }
    Ok(versions)
}

fn metadata_version_id(name: &OsStr) -> Option<String> {
    let name = name.to_str()?;
    let version_id = name.strip_suffix(METADATA_SUFFIX)?;
    validate_version_id(version_id).ok()?;
    Some(version_id.to_owned())
}

fn snapshot_version_id(name: &OsStr) -> Option<String> {
    let name = name.to_str()?;
    let version_id = name.strip_suffix(SNAPSHOT_SUFFIX)?;
    validate_version_id(version_id).ok()?;
    Some(version_id.to_owned())
}

fn cleanup_orphaned_version_files(directory: &Path) -> CommandResult<()> {
    let mut inspected = 0_usize;
    let entries = fs::read_dir(directory)
        .map_err(|error| history_io_error("Could not inspect local history", error))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| history_io_error("Could not inspect a local history entry", error))?;
        inspected += 1;
        if inspected > MAX_DOCUMENT_DIRECTORY_ENTRIES {
            return Err(corrupt_history_error());
        }
        let Some(version_id) = snapshot_version_id(&entry.file_name()) else {
            continue;
        };
        let snapshot_metadata = match safe_regular_file(&entry.path(), "local history snapshot") {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let metadata_path = metadata_path(directory, &version_id)?;
        let valid_pair = read_stored_metadata(&metadata_path, &version_id)
            .map(|metadata| metadata.size_bytes == snapshot_metadata.len())
            .unwrap_or(false);
        if !valid_pair {
            remove_regular_file_if_present(&entry.path())?;
            remove_regular_file_if_present(&metadata_path)?;
        }
    }

    let entries = fs::read_dir(directory)
        .map_err(|error| history_io_error("Could not inspect local history", error))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| history_io_error("Could not inspect a local history entry", error))?;
        let Some(version_id) = metadata_version_id(&entry.file_name()) else {
            continue;
        };
        let metadata = match read_stored_metadata(&entry.path(), &version_id) {
            Ok(metadata) => metadata,
            Err(_) => {
                remove_regular_file_if_present(&entry.path())?;
                continue;
            }
        };
        let snapshot_path = snapshot_path(directory, &version_id)?;
        let valid_pair = safe_regular_file(&snapshot_path, "local history snapshot")
            .map(|snapshot| snapshot.len() == metadata.size_bytes)
            .unwrap_or(false);
        if !valid_pair {
            remove_regular_file_if_present(&entry.path())?;
            remove_regular_file_if_present(&snapshot_path)?;
        }
    }
    sync_parent_best_effort(directory);
    Ok(())
}

fn remove_regular_file_if_present(path: &Path) -> CommandResult<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
            fs::remove_file(path).map_err(|error| {
                history_io_error("Could not clean up incomplete local history", error)
            })
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(history_io_error(
            "Could not inspect incomplete local history",
            error,
        )),
    }
}

fn collect_global_versions(
    root: &Path,
    already_cleaned: &Path,
) -> CommandResult<Vec<StoredVersion>> {
    let mut output = Vec::new();
    for workspace in safe_hash_directories(root)? {
        for document in safe_hash_directories(&workspace)? {
            if document != already_cleaned {
                cleanup_orphaned_version_files(&document)?;
            }
            output.extend(read_valid_versions(&document)?);
            if output.len() > MAX_GLOBAL_VERSIONS {
                return Err(CommandError::new(
                    ErrorCode::HistoryCorrupt,
                    "Local history contains too many entries to scan safely.",
                ));
            }
        }
    }
    Ok(output)
}

fn safe_hash_directories(parent: &Path) -> CommandResult<Vec<PathBuf>> {
    let mut directories = Vec::new();
    let entries = fs::read_dir(parent)
        .map_err(|error| history_io_error("Could not scan local history", error))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| history_io_error("Could not scan a local history entry", error))?;
        let name = match entry.file_name().into_string() {
            Ok(name) if validate_version_id(&name).is_ok() => name,
            _ => continue,
        };
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }
        if let Some(canonical) = existing_child_directory(parent, &name)? {
            directories.push(canonical);
        }
    }
    Ok(directories)
}

fn remove_version(version: &StoredVersion) -> CommandResult<()> {
    let snapshot = snapshot_path(&version.directory, &version.metadata.version_id)?;
    let metadata = metadata_path(&version.directory, &version.metadata.version_id)?;
    safe_regular_file(&snapshot, "local history snapshot")?;
    safe_regular_file(&metadata, "local history metadata")?;
    fs::remove_file(&snapshot)
        .map_err(|error| history_io_error("Could not prune a local history snapshot", error))?;
    fs::remove_file(&metadata)
        .map_err(|error| history_io_error("Could not prune local history metadata", error))?;
    sync_parent_best_effort(&version.directory);
    Ok(())
}

fn sort_newest_first(versions: &mut [StoredVersion]) {
    versions.sort_by(|left, right| {
        right
            .metadata
            .created_at_ms
            .cmp(&left.metadata.created_at_ms)
            .then_with(|| right.metadata.version_id.cmp(&left.metadata.version_id))
    });
}

fn entry_from_metadata(metadata: &StoredVersionMetadata) -> DocumentHistoryEntry {
    DocumentHistoryEntry {
        version_id: metadata.version_id.clone(),
        created_at_ms: metadata.created_at_ms,
        size_bytes: metadata.size_bytes,
    }
}

fn now_ms() -> CommandResult<u64> {
    let duration = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| {
        CommandError::new(
            ErrorCode::Io,
            "The system clock cannot timestamp local history.",
        )
    })?;
    u64::try_from(duration.as_millis()).map_err(|_| {
        CommandError::new(
            ErrorCode::Io,
            "The system clock is outside the supported range.",
        )
    })
}

fn history_mutex(root: &Path) -> Arc<Mutex<()>> {
    let registry = HISTORY_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(lock) = locks.get(root).and_then(Weak::upgrade) {
        return lock;
    }
    locks.retain(|_, lock| lock.strong_count() > 0);
    let lock = Arc::new(Mutex::new(()));
    locks.insert(root.to_path_buf(), Arc::downgrade(&lock));
    lock
}

fn lock_history(mutex: &Mutex<()>) -> MutexGuard<'_, ()> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn try_lock_history(mutex: &Mutex<()>) -> Option<MutexGuard<'_, ()>> {
    match mutex.try_lock() {
        Ok(guard) => Some(guard),
        Err(TryLockError::Poisoned(poisoned)) => Some(poisoned.into_inner()),
        Err(TryLockError::WouldBlock) => None,
    }
}

fn history_not_found_error() -> CommandError {
    CommandError::new(
        ErrorCode::NotFound,
        "This local history version is no longer available.",
    )
}

fn corrupt_history_error() -> CommandError {
    CommandError::new(
        ErrorCode::HistoryCorrupt,
        "This local history entry is invalid or damaged.",
    )
}

fn history_io_error(context: &str, error: std::io::Error) -> CommandError {
    let code = match error.kind() {
        std::io::ErrorKind::NotFound => ErrorCode::NotFound,
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
    use std::collections::HashSet;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, Instant};
    use tempfile::{TempDir, tempdir};

    const HISTORY_CHILD_ENV: &str = "VIVA_HISTORY_LOCK_TEST_CHILD";
    const HISTORY_WORKSPACE_ENV: &str = "VIVA_HISTORY_LOCK_TEST_WORKSPACE";
    const HISTORY_ROOT_ENV: &str = "VIVA_HISTORY_LOCK_TEST_ROOT";
    const HISTORY_ATTEMPT_ENV: &str = "VIVA_HISTORY_LOCK_TEST_ATTEMPT";
    const HISTORY_COMPLETE_ENV: &str = "VIVA_HISTORY_LOCK_TEST_COMPLETE";

    fn history_document(workspace: &TempDir, relative_path: &str) -> HistoryDocument {
        let workspace_root = fs::canonicalize(workspace.path()).unwrap();
        let path = workspace_root.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        if !path.exists() {
            fs::write(&path, "current").unwrap();
        }
        HistoryDocument {
            workspace_root,
            relative_path: relative_path.to_owned(),
            name: Path::new(relative_path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
        }
    }

    fn test_store(app_data: &TempDir) -> HistoryStore {
        HistoryStore::new(app_data.path().join(HISTORY_DIRECTORY_NAME))
    }

    #[test]
    fn cross_process_history_record_child() {
        if std::env::var_os(HISTORY_CHILD_ENV).is_none() {
            return;
        }
        let workspace_root = PathBuf::from(std::env::var_os(HISTORY_WORKSPACE_ENV).unwrap());
        let history_root = PathBuf::from(std::env::var_os(HISTORY_ROOT_ENV).unwrap());
        let attempt_path = PathBuf::from(std::env::var_os(HISTORY_ATTEMPT_ENV).unwrap());
        let complete_path = PathBuf::from(std::env::var_os(HISTORY_COMPLETE_ENV).unwrap());
        let document = HistoryDocument {
            workspace_root,
            relative_path: "note.md".to_owned(),
            name: "note.md".to_owned(),
        };
        fs::write(attempt_path, b"attempting").unwrap();
        HistoryStore::new(history_root)
            .record(&document, "from another process")
            .unwrap();
        fs::write(complete_path, b"complete").unwrap();
    }

    #[test]
    fn history_record_waits_for_the_cross_process_history_lock() {
        let workspace = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let document = history_document(&workspace, "note.md");
        let store = test_store(&app_data);
        let attempt_path = app_data.path().join("child-attempting");
        let complete_path = app_data.path().join("child-complete");
        let guard = store.process_lock().unwrap();

        let mut child = Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("history::tests::cross_process_history_record_child")
            .arg("--nocapture")
            .env(HISTORY_CHILD_ENV, "1")
            .env(HISTORY_WORKSPACE_ENV, &document.workspace_root)
            .env(HISTORY_ROOT_ENV, &store.root)
            .env(HISTORY_ATTEMPT_ENV, &attempt_path)
            .env(HISTORY_COMPLETE_ENV, &complete_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();

        wait_for_path(&attempt_path, Duration::from_secs(5));
        assert!(!complete_path.exists());
        assert!(child.try_wait().unwrap().is_none());

        drop(guard);
        wait_for_path(&complete_path, Duration::from_secs(5));
        assert!(child.wait().unwrap().success());
        let versions = store.list(&document).unwrap();
        assert_eq!(versions.len(), 1);
        assert_eq!(
            store
                .read(&document, &versions[0].version_id)
                .unwrap()
                .content,
            "from another process"
        );
    }

    #[test]
    fn best_effort_batch_skips_a_busy_cross_process_lock_without_waiting() {
        let workspace = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let document = history_document(&workspace, "note.md");
        let store = test_store(&app_data);
        let guard = store.process_lock().unwrap();
        let worker_store = store.clone();
        let (result_tx, result_rx) = mpsc::channel();

        let worker = thread::spawn(move || {
            result_tx
                .send(worker_store.record_batch_best_effort(&document, &["saved"]))
                .unwrap();
        });

        assert!(!result_rx.recv_timeout(Duration::from_secs(1)).unwrap());
        worker.join().unwrap();
        drop(guard);
    }

    #[test]
    fn best_effort_batch_skips_a_busy_in_process_lock_without_waiting() {
        let workspace = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let document = history_document(&workspace, "note.md");
        let store = test_store(&app_data);
        let mutex = history_mutex(&store.root);
        let guard = lock_history(&mutex);
        let started = Instant::now();

        assert!(!store.record_batch_best_effort(&document, &["saved"]));
        assert!(started.elapsed() < Duration::from_secs(1));

        drop(guard);
        assert!(store.record_batch_best_effort(&document, &["saved"]));
    }

    fn wait_for_path(path: &Path, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        while !path.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(path.exists(), "{} was not created in time", path.display());
    }

    #[test]
    fn deduplicates_content_and_reads_an_immutable_snapshot() {
        let workspace = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let document = history_document(&workspace, "notes/a.md");
        let store = test_store(&app_data);

        let first = store.record(&document, "same content").unwrap();
        let duplicate = store.record(&document, "same content").unwrap();
        assert_eq!(first, duplicate);
        assert_eq!(store.list(&document).unwrap().len(), 1);

        let snapshot = store.read(&document, &first.version_id).unwrap();
        assert_eq!(snapshot.relative_path, "notes/a.md");
        assert_eq!(snapshot.name, "a.md");
        assert_eq!(snapshot.content, "same content");
        assert_eq!(snapshot.size_bytes, 12);
        assert_eq!(
            fs::read_to_string(workspace.path().join("notes/a.md")).unwrap(),
            "current"
        );
    }

    #[test]
    fn batch_recording_continues_after_one_version_fails_and_deduplicates() {
        let workspace = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let document = history_document(&workspace, "a.md");
        let store = test_store(&app_data);
        let oversized = "x".repeat((MAX_DOCUMENT_BYTES + 1) as usize);

        let succeeded = store.record_batch_best_effort(&document, &[&oversized, "kept", "kept"]);

        assert!(!succeeded);
        let versions = store.list(&document).unwrap();
        assert_eq!(versions.len(), 1);
        let snapshot = store.read(&document, &versions[0].version_id).unwrap();
        assert_eq!(snapshot.content, "kept");
    }

    #[test]
    fn batch_recording_keeps_the_saved_content_newer_than_the_previous_content() {
        let workspace = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let document = history_document(&workspace, "a.md");
        let store = test_store(&app_data);

        assert!(store.record_batch_best_effort(&document, &["previous", "saved"]));

        let versions = store.list(&document).unwrap();
        assert_eq!(versions.len(), 2);
        assert!(versions[0].created_at_ms > versions[1].created_at_ms);
        assert_eq!(
            store
                .read(&document, &versions[0].version_id)
                .unwrap()
                .content,
            "saved"
        );
        assert_eq!(
            store
                .read(&document, &versions[1].version_id)
                .unwrap()
                .content,
            "previous"
        );
    }

    #[test]
    fn saving_an_older_content_version_moves_it_back_to_the_front() {
        let workspace = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let document = history_document(&workspace, "a.md");
        let store = test_store(&app_data);

        assert!(store.record_batch_best_effort(&document, &["alpha", "beta"]));
        assert!(store.record_batch_best_effort(&document, &["beta", "alpha"]));

        let versions = store.list(&document).unwrap();
        assert_eq!(versions.len(), 2);
        assert!(versions[0].created_at_ms > versions[1].created_at_ms);
        assert_eq!(
            store
                .read(&document, &versions[0].version_id)
                .unwrap()
                .content,
            "alpha"
        );
        assert_eq!(
            store
                .read(&document, &versions[1].version_id)
                .unwrap()
                .content,
            "beta"
        );
    }

    #[cfg(unix)]
    #[test]
    fn reuses_a_verified_snapshot_without_creating_a_temporary_copy() {
        use std::os::unix::fs::PermissionsExt;

        let workspace = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let document = history_document(&workspace, "a.md");
        let store = test_store(&app_data);
        let first = store.record(&document, "already stored").unwrap();
        let directory = store
            .existing_document_directory(&document)
            .unwrap()
            .unwrap();
        let original_permissions = fs::metadata(&directory).unwrap().permissions();
        let mut read_only = original_permissions.clone();
        read_only.set_mode(0o500);
        fs::set_permissions(&directory, read_only).unwrap();

        let duplicate = store.record(&document, "already stored");

        fs::set_permissions(&directory, original_permissions).unwrap();
        assert_eq!(duplicate.unwrap(), first);
        assert_eq!(store.list(&document).unwrap().len(), 1);
    }

    #[test]
    fn keeps_history_out_of_the_workspace_and_hashes_scope_names() {
        let workspace = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let document = history_document(&workspace, "private-name.md");
        let store = test_store(&app_data);
        store.record(&document, "version").unwrap();

        let workspace_names: Vec<_> = fs::read_dir(workspace.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(workspace_names, vec![OsStr::new("private-name.md")]);

        let root = store.root.clone();
        let scope_names: Vec<_> = fs::read_dir(root)
            .unwrap()
            .filter_map(|entry| {
                let entry = entry.unwrap();
                entry
                    .file_type()
                    .unwrap()
                    .is_dir()
                    .then(|| entry.file_name().into_string().unwrap())
            })
            .collect();
        assert_eq!(scope_names.len(), 1);
        let scope_name = &scope_names[0];
        assert_eq!(scope_name.len(), 64);
        assert!(!scope_name.contains("private-name"));
    }

    #[test]
    fn rejects_untrusted_version_ids_before_joining_paths() {
        for version_id in [
            "../secret",
            "A".repeat(64).as_str(),
            "abc",
            "g".repeat(64).as_str(),
        ] {
            let error = validate_version_id(version_id).unwrap_err();
            assert_eq!(error.code, ErrorCode::InvalidVersionId);
        }
    }

    #[test]
    fn enforces_per_document_retention_and_global_capacity() {
        let workspace = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let first_document = history_document(&workspace, "first.md");
        let second_document = history_document(&workspace, "second.md");
        let store = HistoryStore::with_limits(app_data.path().join(HISTORY_DIRECTORY_NAME), 3, 30);

        for content in ["first-1", "first-2", "first-3", "first-4"] {
            store.record(&first_document, content).unwrap();
        }
        assert_eq!(store.list(&first_document).unwrap().len(), 3);

        store.record(&second_document, "second-1234").unwrap();
        let all: Vec<_> = store
            .list(&first_document)
            .unwrap()
            .into_iter()
            .chain(store.list(&second_document).unwrap())
            .collect();
        assert!(all.iter().map(|entry| entry.size_bytes).sum::<u64>() <= 30);
    }

    #[test]
    fn versions_are_scoped_to_the_validated_workspace_and_document() {
        let workspace = tempdir().unwrap();
        let other_workspace = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let document = history_document(&workspace, "a.md");
        let other_document = history_document(&other_workspace, "a.md");
        let store = test_store(&app_data);
        let version = store.record(&document, "private").unwrap();

        assert!(store.list(&other_document).unwrap().is_empty());
        assert_eq!(
            store
                .read(&other_document, &version.version_id)
                .unwrap_err()
                .code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn corrupt_snapshot_is_not_returned() {
        let workspace = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let document = history_document(&workspace, "a.md");
        let store = test_store(&app_data);
        let version = store.record(&document, "healthy").unwrap();
        let directory = store
            .existing_document_directory(&document)
            .unwrap()
            .unwrap();
        fs::write(
            snapshot_path(&directory, &version.version_id).unwrap(),
            "tampered",
        )
        .unwrap();

        let error = store.read(&document, &version.version_id).unwrap_err();
        assert_eq!(error.code, ErrorCode::HistoryCorrupt);
        assert!(store.list(&document).unwrap().is_empty());
    }

    #[test]
    fn removes_incomplete_snapshots_before_enforcing_capacity() {
        let workspace = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let document = history_document(&workspace, "a.md");
        let store = test_store(&app_data);
        let directory = store.ensure_document_directory(&document).unwrap();
        let orphan_id = content_version_id("orphan");
        let orphan_path = snapshot_path(&directory, &orphan_id).unwrap();
        assert!(atomic_create(&orphan_path, b"orphan").unwrap());

        store.record(&document, "complete").unwrap();

        assert!(!orphan_path.exists());
        assert_eq!(store.list(&document).unwrap().len(), 1);
    }

    #[test]
    fn history_failure_is_safe_to_ignore_after_a_document_save() {
        let workspace = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let document = history_document(&workspace, "a.md");
        fs::write(workspace.path().join("a.md"), "saved body").unwrap();

        let blocked_root = app_data.path().join(HISTORY_DIRECTORY_NAME);
        fs::write(&blocked_root, "not a directory").unwrap();
        let store = HistoryStore::new(blocked_root);
        let history_result = store.record(&document, "saved body");
        let batch_succeeded = store.record_batch_best_effort(&document, &["saved body"]);

        assert!(history_result.is_err());
        assert!(!batch_succeeded);
        assert_eq!(
            fs::read_to_string(workspace.path().join("a.md")).unwrap(),
            "saved body"
        );
    }

    #[test]
    fn content_hashes_produce_unique_stable_ids() {
        let ids: HashSet<_> = ["one", "two", "three"]
            .into_iter()
            .map(content_version_id)
            .collect();
        assert_eq!(ids.len(), 3);
        assert_eq!(content_version_id("one"), content_version_id("one"));
        assert!(ids.iter().all(|id| validate_version_id(id).is_ok()));
    }
}
