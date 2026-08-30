use crate::filesystem::resolve_history_document;
use crate::models::{CommandError, CommandResult, ErrorCode};
use crate::runtime::run_blocking;
#[cfg(target_os = "windows")]
use crate::secure_fs::rename_open_handle_noclobber;
use crate::secure_fs::{StableFileIdentity, random_component, stable_handle_identity};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use cap_std::ambient_authority;
use cap_std::fs::{Dir, File as CapabilityFile, OpenOptions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

const MAX_IMAGE_BYTES: u64 = 24 * 1024 * 1024;
const MAX_IMAGE_BASE64_CHARS: usize = (MAX_IMAGE_BYTES as usize).div_ceil(3) * 4;
const MAX_IMAGE_DIMENSION: u32 = 16_384;
const MAX_IMAGE_PIXELS: u64 = 32_000_000;
const MAX_GIF_FRAMES: usize = 256;
const MAX_GIF_TOTAL_FRAME_PIXELS: u64 = 128_000_000;
const PAYLOAD_HEADER_LEN: usize = 14;
const PAYLOAD_MAGIC: &[u8; 4] = b"VIMG";
const PAYLOAD_VERSION: u8 = 1;
const MAX_IMAGE_LEASES_PER_SESSION: usize = 8_192;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadWorkspaceImageRequest {
    workspace_root: String,
    relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateWorkspaceImageRequest {
    workspace_root: String,
    document_relative_path: String,
    data_base64: String,
    lease_id: String,
    session: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettleWorkspaceImageRequest {
    workspace_root: String,
    lease_id: String,
    session: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceImageResponse {
    relative_path: String,
    markdown_path: String,
    format: String,
    width: u32,
    height: u32,
    size_bytes: u64,
    deduplicated: bool,
}

#[derive(Clone, Debug, Eq)]
struct ImageLeaseKey {
    session: u64,
    lease_id: String,
}

impl PartialEq for ImageLeaseKey {
    fn eq(&self, other: &Self) -> bool {
        self.session == other.session && self.lease_id == other.lease_id
    }
}

impl Hash for ImageLeaseKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.session.hash(state);
        self.lease_id.hash(state);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ImageCreateFingerprint {
    workspace_root: String,
    document_relative_path: String,
    content_sha256: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ImageLeaseStatus {
    Pending,
    Committed,
    Cancelled,
}

#[derive(Clone, Debug)]
struct ImageLeaseRecord {
    workspace_root: String,
    status: ImageLeaseStatus,
    fingerprint: Option<ImageCreateFingerprint>,
    response: Option<CreateWorkspaceImageResponse>,
    asset_key: Option<ManagedImageAssetKey>,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct ManagedImageAssetKey {
    directory_identity: StableFileIdentity,
    file_identity: StableFileIdentity,
    file_name: String,
}

struct ManagedImageAsset {
    directory: Dir,
    file_name: String,
    file_identity: StableFileIdentity,
    content_sha256: String,
    size_bytes: u64,
    auto_delete: bool,
    has_committed_lease: bool,
    pending_leases: HashSet<ImageLeaseKey>,
}

#[derive(Default)]
struct ImageLeaseRegistry {
    active_session: Option<u64>,
    leases: HashMap<ImageLeaseKey, ImageLeaseRecord>,
    assets: HashMap<ManagedImageAssetKey, ManagedImageAsset>,
}

static IMAGE_LEASE_REGISTRY: OnceLock<Mutex<ImageLeaseRegistry>> = OnceLock::new();

struct PreparedWorkspaceImage {
    workspace_root: String,
    document_relative_path: String,
    bytes: Vec<u8>,
    kind: ImageKind,
    width: u32,
    height: u32,
    content_sha256: String,
}

struct CreatedWorkspaceImageAsset {
    response: CreateWorkspaceImageResponse,
    directory: Dir,
    directory_identity: StableFileIdentity,
    file_name: String,
    file_identity: StableFileIdentity,
    content_sha256: String,
    size_bytes: u64,
    auto_delete: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ImageKind {
    Jpeg = 1,
    Png = 2,
    WebP = 3,
    Gif = 4,
}

impl ImageKind {
    fn from_extension(path: &Path) -> Option<Self> {
        let extension = path.extension()?.to_str()?;
        if extension.eq_ignore_ascii_case("jpg") || extension.eq_ignore_ascii_case("jpeg") {
            Some(Self::Jpeg)
        } else if extension.eq_ignore_ascii_case("png") {
            Some(Self::Png)
        } else if extension.eq_ignore_ascii_case("webp") {
            Some(Self::WebP)
        } else if extension.eq_ignore_ascii_case("gif") {
            Some(Self::Gif)
        } else {
            None
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::WebP => "webp",
            Self::Gif => "gif",
        }
    }
}

#[tauri::command]
pub async fn read_workspace_image(
    request: ReadWorkspaceImageRequest,
) -> CommandResult<tauri::ipc::Response> {
    run_blocking(move || read_workspace_image_core(request).map(tauri::ipc::Response::new)).await
}

#[tauri::command]
pub async fn create_workspace_image(
    request: CreateWorkspaceImageRequest,
) -> CommandResult<CreateWorkspaceImageResponse> {
    run_blocking(move || create_workspace_image_core_with_session_check(request, true)).await
}

#[tauri::command]
pub async fn commit_workspace_image(request: SettleWorkspaceImageRequest) -> CommandResult<()> {
    run_blocking(move || commit_workspace_image_core_with_session_check(request, true)).await
}

#[tauri::command]
pub async fn cancel_workspace_image(request: SettleWorkspaceImageRequest) -> CommandResult<()> {
    run_blocking(move || cancel_workspace_image_core_with_session_check(request, true)).await
}

fn read_workspace_image_core(request: ReadWorkspaceImageRequest) -> CommandResult<Vec<u8>> {
    let relative = validate_relative_image_path(&request.relative_path)?;
    let root_directory = open_workspace_directory(&request.workspace_root)?;
    read_workspace_image_from_directory(&root_directory, &relative)
}

fn read_workspace_image_from_directory(root: &Dir, relative: &Path) -> CommandResult<Vec<u8>> {
    let parent_relative = relative.parent().unwrap_or_else(|| Path::new(""));
    let parent = open_directory_without_symlinks(root, parent_relative)?;
    let file_name = relative
        .file_name()
        .ok_or_else(|| CommandError::new(ErrorCode::InvalidPath, "Choose an image path."))?;

    let link_metadata = parent
        .symlink_metadata(file_name)
        .map_err(|error| io_error("Could not find this image", error))?;
    reject_symlink(&link_metadata)?;
    if !link_metadata.is_file() {
        return Err(CommandError::new(
            ErrorCode::NotFile,
            "The selected image is not a file.",
        ));
    }

    let mut file = parent
        .open(file_name)
        .map_err(|error| io_error("Could not open this image", error))?;
    let current_link_metadata = parent
        .symlink_metadata(file_name)
        .map_err(|error| io_error("Could not inspect this image", error))?;
    reject_symlink(&current_link_metadata)?;
    let opened_metadata = file
        .metadata()
        .map_err(|error| io_error("Could not inspect this image", error))?;
    if !opened_metadata.is_file() {
        return Err(CommandError::new(
            ErrorCode::NotFile,
            "The selected image is not a file.",
        ));
    }
    if opened_metadata.len() == 0 {
        return Err(invalid_image("This image is empty."));
    }
    if opened_metadata.len() > MAX_IMAGE_BYTES {
        return Err(image_too_large());
    }

    let kind = ImageKind::from_extension(relative).ok_or_else(unsupported_image)?;
    let mut limited = Read::by_ref(&mut file).take(MAX_IMAGE_BYTES + 1);
    let mut bytes = Vec::with_capacity(opened_metadata.len() as usize);
    limited
        .read_to_end(&mut bytes)
        .map_err(|error| io_error("Could not read this image", error))?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(image_too_large());
    }

    let (detected_kind, width, height) = inspect_image(&bytes)?;
    if detected_kind != kind {
        return Err(invalid_image(
            "The image contents do not match the file extension.",
        ));
    }
    validate_dimensions(width, height)?;

    let mut payload = Vec::with_capacity(PAYLOAD_HEADER_LEN + bytes.len());
    payload.extend_from_slice(PAYLOAD_MAGIC);
    payload.push(PAYLOAD_VERSION);
    payload.push(kind as u8);
    payload.extend_from_slice(&width.to_be_bytes());
    payload.extend_from_slice(&height.to_be_bytes());
    payload.extend_from_slice(&bytes);
    Ok(payload)
}

#[cfg(test)]
fn create_workspace_image_core(
    request: CreateWorkspaceImageRequest,
) -> CommandResult<CreateWorkspaceImageResponse> {
    create_workspace_image_core_with_session_check(request, false)
}

fn create_workspace_image_core_with_session_check(
    request: CreateWorkspaceImageRequest,
    enforce_active_session: bool,
) -> CommandResult<CreateWorkspaceImageResponse> {
    let key =
        validate_image_lease_envelope(request.session, &request.lease_id, &request.workspace_root)?;

    {
        let registry = lock_image_lease_registry();
        ensure_active_image_session(&registry, request.session, enforce_active_session)?;
        if registry
            .leases
            .get(&key)
            .is_some_and(|record| record.status == ImageLeaseStatus::Cancelled)
        {
            return Err(cancelled_image_lease_conflict());
        }
    }

    let prepared = prepare_workspace_image(&request)?;
    let fingerprint = ImageCreateFingerprint {
        workspace_root: prepared.workspace_root.clone(),
        document_relative_path: prepared.document_relative_path.clone(),
        content_sha256: prepared.content_sha256.clone(),
    };
    let mut registry = lock_image_lease_registry();
    ensure_active_image_session(&registry, request.session, enforce_active_session)?;

    if let Some(record) = registry.leases.get(&key) {
        return response_for_existing_image_lease(record, &request.workspace_root, &fingerprint);
    }
    ensure_image_lease_capacity(&registry, request.session)?;

    let created = create_prepared_workspace_image(&prepared)?;
    let asset_key = ManagedImageAssetKey {
        directory_identity: created.directory_identity,
        file_identity: created.file_identity,
        file_name: created.file_name.clone(),
    };
    let response = created.response.clone();

    match registry.assets.get_mut(&asset_key) {
        Some(asset) => {
            asset.pending_leases.insert(key.clone());
        }
        None => {
            let mut pending_leases = HashSet::new();
            pending_leases.insert(key.clone());
            registry.assets.insert(
                asset_key.clone(),
                ManagedImageAsset {
                    directory: created.directory,
                    file_name: created.file_name,
                    file_identity: created.file_identity,
                    content_sha256: created.content_sha256,
                    size_bytes: created.size_bytes,
                    auto_delete: created.auto_delete,
                    has_committed_lease: false,
                    pending_leases,
                },
            );
        }
    }
    registry.leases.insert(
        key,
        ImageLeaseRecord {
            workspace_root: request.workspace_root,
            status: ImageLeaseStatus::Pending,
            fingerprint: Some(fingerprint),
            response: Some(response.clone()),
            asset_key: Some(asset_key),
        },
    );

    Ok(response)
}

#[cfg(test)]
fn create_workspace_image_unleased_core(
    request: CreateWorkspaceImageRequest,
) -> CommandResult<CreateWorkspaceImageResponse> {
    let prepared = prepare_workspace_image(&request)?;
    Ok(create_prepared_workspace_image(&prepared)?.response)
}

fn prepare_workspace_image(
    request: &CreateWorkspaceImageRequest,
) -> CommandResult<PreparedWorkspaceImage> {
    validate_portable_workspace_relative_path(&request.document_relative_path)?;
    let bytes = decode_image_base64(&request.data_base64)?;
    let (kind, width, height) = inspect_image(&bytes)?;
    validate_dimensions(width, height)?;
    let content_sha256 = format!("{:x}", Sha256::digest(&bytes));
    Ok(PreparedWorkspaceImage {
        workspace_root: request.workspace_root.clone(),
        document_relative_path: request.document_relative_path.clone(),
        bytes,
        kind,
        width,
        height,
        content_sha256,
    })
}

fn create_prepared_workspace_image(
    prepared: &PreparedWorkspaceImage,
) -> CommandResult<CreatedWorkspaceImageAsset> {
    let workspace = open_workspace_directory(&prepared.workspace_root)?;
    let document =
        resolve_history_document(&prepared.workspace_root, &prepared.document_relative_path)?;
    let document_relative = Path::new(&document.relative_path);
    let document_parent_relative = document_relative.parent().unwrap_or_else(|| Path::new(""));
    let document_parent = open_document_parent(&workspace, document_relative)?;
    let assets = ensure_assets_directory(&document_parent)?;
    let managed_directory = assets
        .try_clone()
        .map_err(|error| io_error("Could not retain the image assets folder", error))?;
    let directory_identity = stable_handle_identity(&managed_directory)
        .map_err(|error| io_error("Could not identify the image assets folder", error))?;
    let persisted = persist_content_addressed_image(
        &assets,
        &prepared.content_sha256,
        prepared.kind.extension(),
        &prepared.bytes,
    )?;
    let markdown_path = slash_path(&Path::new("assets").join(&persisted.file_name))?;
    let relative_path = slash_path(
        &document_parent_relative
            .join("assets")
            .join(&persisted.file_name),
    )?;

    Ok(CreatedWorkspaceImageAsset {
        response: CreateWorkspaceImageResponse {
            relative_path,
            markdown_path,
            format: prepared.kind.extension().to_owned(),
            width: prepared.width,
            height: prepared.height,
            size_bytes: prepared.bytes.len() as u64,
            deduplicated: persisted.deduplicated,
        },
        directory: managed_directory,
        directory_identity,
        file_name: persisted.file_name,
        file_identity: persisted.file_identity,
        content_sha256: prepared.content_sha256.clone(),
        size_bytes: prepared.bytes.len() as u64,
        auto_delete: !persisted.deduplicated,
    })
}

fn response_for_existing_image_lease(
    record: &ImageLeaseRecord,
    workspace_root: &str,
    fingerprint: &ImageCreateFingerprint,
) -> CommandResult<CreateWorkspaceImageResponse> {
    if record.workspace_root != workspace_root {
        return Err(image_lease_scope_conflict());
    }
    match record.status {
        ImageLeaseStatus::Cancelled => Err(cancelled_image_lease_conflict()),
        ImageLeaseStatus::Pending | ImageLeaseStatus::Committed => {
            if record.fingerprint.as_ref() != Some(fingerprint) {
                return Err(image_lease_reuse_conflict());
            }
            record.response.clone().ok_or_else(image_lease_state_error)
        }
    }
}

#[cfg(test)]
fn commit_workspace_image_core(request: SettleWorkspaceImageRequest) -> CommandResult<()> {
    commit_workspace_image_core_with_session_check(request, false)
}

fn commit_workspace_image_core_with_session_check(
    request: SettleWorkspaceImageRequest,
    enforce_active_session: bool,
) -> CommandResult<()> {
    let key =
        validate_image_lease_envelope(request.session, &request.lease_id, &request.workspace_root)?;
    let mut registry = lock_image_lease_registry();
    ensure_active_image_session(&registry, request.session, enforce_active_session)?;
    let (status, asset_key) = {
        let record = registry
            .leases
            .get(&key)
            .ok_or_else(missing_image_lease_conflict)?;
        ensure_image_lease_scope(record, &request.workspace_root)?;
        (record.status, record.asset_key.clone())
    };

    match status {
        ImageLeaseStatus::Committed => return Ok(()),
        ImageLeaseStatus::Cancelled => return Err(cancelled_image_lease_conflict()),
        ImageLeaseStatus::Pending => {}
    }

    let asset_key = asset_key.ok_or_else(image_lease_state_error)?;
    let remove_asset = {
        let asset = registry
            .assets
            .get_mut(&asset_key)
            .ok_or_else(image_lease_state_error)?;
        if !asset.pending_leases.remove(&key) {
            return Err(image_lease_state_error());
        }
        asset.has_committed_lease = true;
        asset.pending_leases.is_empty()
    };
    if remove_asset {
        registry.assets.remove(&asset_key);
    }
    let record = registry
        .leases
        .get_mut(&key)
        .ok_or_else(image_lease_state_error)?;
    record.status = ImageLeaseStatus::Committed;
    record.asset_key = None;
    Ok(())
}

#[cfg(test)]
fn cancel_workspace_image_core(request: SettleWorkspaceImageRequest) -> CommandResult<()> {
    cancel_workspace_image_core_with_session_check_and_hooks(request, false, |_, _| {}, |_, _| {})
}

#[cfg(all(test, unix))]
fn cancel_workspace_image_core_with_hook<F>(
    request: SettleWorkspaceImageRequest,
    after_initial_identity_check: F,
) -> CommandResult<()>
where
    F: FnOnce(&Dir, &str),
{
    cancel_workspace_image_core_with_session_check_and_hooks(
        request,
        false,
        after_initial_identity_check,
        |_, _| {},
    )
}

#[cfg(all(test, unix))]
fn cancel_workspace_image_core_with_quarantine_hook<G>(
    request: SettleWorkspaceImageRequest,
    after_quarantine_identity_check: G,
) -> CommandResult<()>
where
    G: FnOnce(&Dir, &str),
{
    cancel_workspace_image_core_with_session_check_and_hooks(
        request,
        false,
        |_, _| {},
        after_quarantine_identity_check,
    )
}

fn cancel_workspace_image_core_with_session_check(
    request: SettleWorkspaceImageRequest,
    enforce_active_session: bool,
) -> CommandResult<()> {
    cancel_workspace_image_core_with_session_check_and_hooks(
        request,
        enforce_active_session,
        |_, _| {},
        |_, _| {},
    )
}

fn cancel_workspace_image_core_with_session_check_and_hooks<F, G>(
    request: SettleWorkspaceImageRequest,
    enforce_active_session: bool,
    after_initial_identity_check: F,
    after_quarantine_identity_check: G,
) -> CommandResult<()>
where
    F: FnOnce(&Dir, &str),
    G: FnOnce(&Dir, &str),
{
    let key =
        validate_image_lease_envelope(request.session, &request.lease_id, &request.workspace_root)?;
    let mut registry = lock_image_lease_registry();
    ensure_active_image_session(&registry, request.session, enforce_active_session)?;
    let Some(record) = registry.leases.get(&key) else {
        ensure_image_lease_capacity(&registry, request.session)?;
        registry.leases.insert(
            key,
            ImageLeaseRecord {
                workspace_root: request.workspace_root,
                status: ImageLeaseStatus::Cancelled,
                fingerprint: None,
                response: None,
                asset_key: None,
            },
        );
        return Ok(());
    };
    ensure_image_lease_scope(record, &request.workspace_root)?;
    match record.status {
        ImageLeaseStatus::Committed | ImageLeaseStatus::Cancelled => return Ok(()),
        ImageLeaseStatus::Pending => {}
    }

    let asset_key = record
        .asset_key
        .clone()
        .ok_or_else(image_lease_state_error)?;
    release_pending_image_lease(
        &mut registry,
        &key,
        &asset_key,
        after_initial_identity_check,
        after_quarantine_identity_check,
    )?;
    let record = registry
        .leases
        .get_mut(&key)
        .ok_or_else(image_lease_state_error)?;
    record.status = ImageLeaseStatus::Cancelled;
    record.fingerprint = None;
    record.response = None;
    record.asset_key = None;
    Ok(())
}

fn release_pending_image_lease<F, G>(
    registry: &mut ImageLeaseRegistry,
    key: &ImageLeaseKey,
    asset_key: &ManagedImageAssetKey,
    after_initial_identity_check: F,
    after_quarantine_identity_check: G,
) -> CommandResult<()>
where
    F: FnOnce(&Dir, &str),
    G: FnOnce(&Dir, &str),
{
    let should_delete = {
        let asset = registry
            .assets
            .get(asset_key)
            .ok_or_else(image_lease_state_error)?;
        if !asset.pending_leases.contains(key) {
            return Err(image_lease_state_error());
        }
        asset.auto_delete && !asset.has_committed_lease && asset.pending_leases.len() == 1
    };
    if should_delete {
        let asset = registry
            .assets
            .get(asset_key)
            .ok_or_else(image_lease_state_error)?;
        delete_managed_image_asset_with_hooks(
            asset,
            after_initial_identity_check,
            after_quarantine_identity_check,
        )?;
    }

    let remove_asset = {
        let asset = registry
            .assets
            .get_mut(asset_key)
            .ok_or_else(image_lease_state_error)?;
        if !asset.pending_leases.remove(key) {
            return Err(image_lease_state_error());
        }
        asset.pending_leases.is_empty()
    };
    if remove_asset {
        registry.assets.remove(asset_key);
    }
    Ok(())
}

fn validate_image_lease_envelope(
    session: u64,
    lease_id: &str,
    workspace_root: &str,
) -> CommandResult<ImageLeaseKey> {
    if session == 0 {
        return Err(CommandError::new(
            ErrorCode::Conflict,
            "The image lease session is no longer active.",
        ));
    }
    if lease_id.is_empty()
        || lease_id.len() > 128
        || !lease_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
    {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "The image lease identifier is invalid.",
        ));
    }
    let workspace = Path::new(workspace_root);
    if workspace.as_os_str().is_empty() || !workspace.is_absolute() {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "The workspace path must be absolute.",
        ));
    }
    Ok(ImageLeaseKey {
        session,
        lease_id: lease_id.to_owned(),
    })
}

fn ensure_image_lease_scope(record: &ImageLeaseRecord, workspace_root: &str) -> CommandResult<()> {
    if record.workspace_root == workspace_root {
        Ok(())
    } else {
        Err(image_lease_scope_conflict())
    }
}

fn ensure_active_image_session(
    registry: &ImageLeaseRegistry,
    request_session: u64,
    enforce: bool,
) -> CommandResult<()> {
    if !enforce || registry.active_session == Some(request_session) {
        Ok(())
    } else {
        Err(stale_image_lease_session_conflict())
    }
}

fn ensure_image_lease_capacity(registry: &ImageLeaseRegistry, session: u64) -> CommandResult<()> {
    if registry
        .leases
        .keys()
        .filter(|key| key.session == session)
        .count()
        < MAX_IMAGE_LEASES_PER_SESSION
    {
        Ok(())
    } else {
        Err(CommandError::new(
            ErrorCode::WorkspaceTooLarge,
            "This Viva session has too many completed image operations. Reload the window before pasting more images.",
        ))
    }
}

pub(crate) fn reset_frontend_image_session(session: u64) {
    activate_frontend_image_session(session);

    if std::thread::Builder::new()
        .name("viva-image-lease-reset".to_owned())
        .spawn(move || cleanup_expired_image_leases(session))
        .is_err()
    {
        cleanup_expired_image_leases(session);
    }
}

fn activate_frontend_image_session(session: u64) {
    let mut registry = lock_image_lease_registry();
    registry.active_session = Some(session);
    registry
        .leases
        .retain(|key, record| key.session == session || record.status == ImageLeaseStatus::Pending);
}

#[cfg(test)]
fn reset_frontend_image_session_sync(session: u64) {
    activate_frontend_image_session(session);
    cleanup_expired_image_leases(session);
}

fn cleanup_expired_image_leases(active_session: u64) {
    let mut registry = lock_image_lease_registry();
    if registry.active_session != Some(active_session) {
        return;
    }
    let expired: Vec<_> = registry
        .leases
        .iter()
        .filter(|(key, record)| {
            key.session != active_session && record.status == ImageLeaseStatus::Pending
        })
        .map(|(key, record)| (key.clone(), record.asset_key.clone()))
        .collect();

    for (key, asset_key) in expired {
        if let Some(asset_key) = asset_key.as_ref() {
            let released =
                release_pending_image_lease(&mut registry, &key, asset_key, |_, _| {}, |_, _| {})
                    .is_ok();
            if !released {
                let remove_asset = registry.assets.get_mut(asset_key).is_some_and(|asset| {
                    asset.pending_leases.remove(&key);
                    asset.pending_leases.is_empty() && !asset.has_committed_lease
                });
                if remove_asset {
                    // A replacement or an OS lock made secure deletion impossible. Dropping
                    // the capability record leaves every on-disk object untouched while
                    // preventing renderer reloads from retaining unbounded handles forever.
                    registry.assets.remove(asset_key);
                }
            }
        }
        // Old renderer leases are never callable again. A failed cleanup is
        // intentionally abandoned safely instead of becoming an unbounded retry queue.
        registry.leases.remove(&key);
    }
}

fn lock_image_lease_registry() -> MutexGuard<'static, ImageLeaseRegistry> {
    IMAGE_LEASE_REGISTRY
        .get_or_init(|| Mutex::new(ImageLeaseRegistry::default()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn missing_image_lease_conflict() -> CommandError {
    CommandError::new(
        ErrorCode::Conflict,
        "Viva no longer has a pending image operation for this lease.",
    )
}

fn cancelled_image_lease_conflict() -> CommandError {
    CommandError::new(
        ErrorCode::Conflict,
        "This image operation was already cancelled.",
    )
}

fn image_lease_scope_conflict() -> CommandError {
    CommandError::new(
        ErrorCode::Conflict,
        "This image lease belongs to a different workspace.",
    )
}

fn image_lease_reuse_conflict() -> CommandError {
    CommandError::new(
        ErrorCode::Conflict,
        "This image lease was already used for different content.",
    )
}

fn image_lease_state_error() -> CommandError {
    CommandError::new(
        ErrorCode::Io,
        "Viva could not recover the pending image lease safely.",
    )
}

fn stale_image_lease_session_conflict() -> CommandError {
    CommandError::new(
        ErrorCode::Conflict,
        "This image operation belongs to an expired Viva window session.",
    )
}

fn decode_image_base64(data_base64: &str) -> CommandResult<Vec<u8>> {
    if data_base64.len() > MAX_IMAGE_BASE64_CHARS {
        return Err(image_too_large());
    }
    let bytes = STANDARD
        .decode(data_base64)
        .map_err(|_| invalid_image("The pasted image data is not valid standard Base64."))?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(image_too_large());
    }
    Ok(bytes)
}

fn open_workspace_directory(path: &str) -> CommandResult<Dir> {
    let path = Path::new(path);
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "The workspace path must be absolute.",
        ));
    }
    let directory = Dir::open_ambient_dir(path, ambient_authority())
        .map_err(|error| io_error("Could not open this workspace", error))?;
    if !directory
        .dir_metadata()
        .map_err(|error| io_error("Could not inspect this workspace", error))?
        .is_dir()
    {
        return Err(CommandError::new(
            ErrorCode::NotDirectory,
            "The selected workspace is not a folder.",
        ));
    }
    Ok(directory)
}

fn open_directory_without_symlinks(root: &Dir, relative: &Path) -> CommandResult<Dir> {
    let mut current = root
        .try_clone()
        .map_err(|error| io_error("Could not open this workspace", error))?;

    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(CommandError::new(
                ErrorCode::InvalidPath,
                "Workspace paths cannot contain parent or absolute components.",
            ));
        };
        let metadata = current
            .symlink_metadata(name)
            .map_err(|error| io_error("Could not inspect a workspace path", error))?;
        reject_symlink(&metadata)?;
        if !metadata.is_dir() {
            return Err(CommandError::new(
                ErrorCode::NotDirectory,
                "A workspace path component is not a folder.",
            ));
        }

        let next = current
            .open_dir(name)
            .map_err(|error| io_error("Could not open a workspace folder", error))?;
        let current_metadata = current
            .symlink_metadata(name)
            .map_err(|error| io_error("Could not inspect a workspace path", error))?;
        reject_symlink(&current_metadata)?;
        if !current_metadata.is_dir() {
            return Err(CommandError::new(
                ErrorCode::NotDirectory,
                "A workspace path component is not a folder.",
            ));
        }
        current = next;
    }

    Ok(current)
}

fn open_document_parent(root: &Dir, document_relative: &Path) -> CommandResult<Dir> {
    let parent_relative = document_relative.parent().unwrap_or_else(|| Path::new(""));
    let parent = open_directory_without_symlinks(root, parent_relative)?;
    let file_name = document_relative
        .file_name()
        .ok_or_else(|| CommandError::new(ErrorCode::InvalidPath, "Choose a document path."))?;
    let metadata = parent
        .symlink_metadata(file_name)
        .map_err(|error| io_error("Could not find this document", error))?;
    reject_symlink(&metadata)?;
    if !metadata.is_file() {
        return Err(CommandError::new(
            ErrorCode::NotFile,
            "The selected entry is not a document.",
        ));
    }
    Ok(parent)
}

fn ensure_assets_directory(document_parent: &Dir) -> CommandResult<Dir> {
    match document_parent.create_dir("assets") {
        Ok(()) => sync_directory_best_effort(document_parent),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(io_error("Could not create the image assets folder", error)),
    }

    let metadata = document_parent
        .symlink_metadata("assets")
        .map_err(|error| io_error("Could not inspect the image assets folder", error))?;
    reject_symlink(&metadata)?;
    if !metadata.is_dir() {
        return Err(CommandError::new(
            ErrorCode::NotDirectory,
            "The image assets path is not a folder.",
        ));
    }

    let assets = document_parent
        .open_dir("assets")
        .map_err(|error| io_error("Could not open the image assets folder", error))?;
    let current_metadata = document_parent
        .symlink_metadata("assets")
        .map_err(|error| io_error("Could not inspect the image assets folder", error))?;
    reject_symlink(&current_metadata)?;
    if !current_metadata.is_dir() {
        return Err(CommandError::new(
            ErrorCode::NotDirectory,
            "The image assets path is not a folder.",
        ));
    }
    if !assets
        .dir_metadata()
        .map_err(|error| io_error("Could not inspect the image assets folder", error))?
        .is_dir()
    {
        return Err(CommandError::new(
            ErrorCode::NotDirectory,
            "The image assets path is not a folder.",
        ));
    }
    Ok(assets)
}

fn persist_content_addressed_image(
    assets: &Dir,
    hash: &str,
    extension: &str,
    bytes: &[u8],
) -> CommandResult<PersistedWorkspaceImage> {
    persist_content_addressed_image_with_hook(assets, hash, extension, bytes, |_, _| {})
}

#[derive(Debug, Eq, PartialEq)]
struct PersistedWorkspaceImage {
    file_name: String,
    file_identity: StableFileIdentity,
    deduplicated: bool,
}

fn persist_content_addressed_image_with_hook<F>(
    assets: &Dir,
    hash: &str,
    extension: &str,
    bytes: &[u8],
    after_temporary_ready: F,
) -> CommandResult<PersistedWorkspaceImage>
where
    F: FnOnce(&Dir, &str),
{
    const PREFIX_LENGTHS: [usize; 7] = [20, 28, 36, 44, 52, 60, 64];
    let mut after_temporary_ready = Some(after_temporary_ready);

    for prefix_length in PREFIX_LENGTHS {
        let file_name = format!("pasted-{}.{}", &hash[..prefix_length], extension);
        if let Some(file_identity) = existing_file_identity_if_matches(assets, &file_name, bytes)? {
            return Ok(PersistedWorkspaceImage {
                file_name,
                file_identity,
                deduplicated: true,
            });
        }
        match assets.symlink_metadata(&file_name) {
            Ok(metadata) => {
                reject_symlink(&metadata)?;
                continue;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("Could not inspect an existing image", error)),
        }

        let mut temporary = temporary_image_file(assets)?;
        let temporary_identity = temporary.identity()?;
        write_and_flush_image(&mut temporary, bytes)?;
        if verify_image_file_path(
            assets,
            temporary.name(),
            Some(temporary_identity),
            bytes.len() as u64,
            hash,
        )?
        .is_none()
        {
            return Err(workspace_image_conflict());
        }
        if let Some(after_temporary_ready) = after_temporary_ready.take() {
            after_temporary_ready(assets, temporary.name());
        }
        let source_path_identity = image_entry_identity_at(assets, temporary.name())?;
        if source_path_identity != Some(temporary_identity) {
            temporary.remove_securely();
            if let Some(source_path_identity) = source_path_identity {
                remove_image_file_if_identity(assets, temporary.name(), source_path_identity);
            }
            return Err(workspace_image_conflict());
        }
        let publish_result = assets.hard_link(temporary.name(), assets, &file_name);
        match publish_result {
            Ok(()) => {
                let published_identity = image_entry_identity_at(assets, &file_name)?;
                if verify_image_file_path(
                    assets,
                    &file_name,
                    Some(temporary_identity),
                    bytes.len() as u64,
                    hash,
                )?
                .is_none()
                {
                    temporary.remove_securely();
                    if let Some(published_identity) = published_identity {
                        remove_image_file_if_identity(assets, &file_name, published_identity);
                    }
                    return Err(workspace_image_conflict());
                }
                temporary.remove_securely();
                sync_directory_best_effort(assets);
                return Ok(PersistedWorkspaceImage {
                    file_name,
                    file_identity: temporary_identity,
                    deduplicated: false,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if let Some(file_identity) =
                    existing_file_identity_if_matches(assets, &file_name, bytes)?
                {
                    return Ok(PersistedWorkspaceImage {
                        file_name,
                        file_identity,
                        deduplicated: true,
                    });
                }
            }
            Err(error) => return Err(io_error("Could not store this image", error)),
        }
    }

    Err(CommandError::new(
        ErrorCode::AlreadyExists,
        "Viva could not choose an unused content-addressed image name.",
    ))
}

fn existing_file_identity_if_matches(
    assets: &Dir,
    file_name: &str,
    expected: &[u8],
) -> CommandResult<Option<StableFileIdentity>> {
    let hash = format!("{:x}", Sha256::digest(expected));
    verify_image_file_path(assets, file_name, None, expected.len() as u64, &hash)
}

struct TemporaryImageFile<'a> {
    directory: &'a Dir,
    name: String,
    file: Option<CapabilityFile>,
}

impl TemporaryImageFile<'_> {
    fn name(&self) -> &str {
        &self.name
    }

    fn identity(&self) -> CommandResult<StableFileIdentity> {
        stable_handle_identity(self.file.as_ref().ok_or_else(|| {
            CommandError::new(ErrorCode::Io, "The temporary image file is closed.")
        })?)
        .map_err(|error| io_error("Could not identify the temporary image file", error))
    }

    fn remove_securely(&mut self) {
        let expected_identity = self.identity().ok();
        let path_matches = expected_identity
            .and_then(|identity| {
                image_file_identity_at(self.directory, &self.name)
                    .ok()
                    .flatten()
                    .map(|current| current == identity)
            })
            .unwrap_or(false);
        self.file.take();
        if path_matches {
            let _ = self.directory.remove_file(&self.name);
        }
    }
}

impl Drop for TemporaryImageFile<'_> {
    fn drop(&mut self) {
        self.remove_securely();
    }
}

fn temporary_image_file(parent: &Dir) -> CommandResult<TemporaryImageFile<'_>> {
    for _ in 0..128 {
        let name = random_component(".viva-image-", ".tmp")
            .map_err(|error| io_error("Could not allocate a secure image name", error))?;
        let mut options = OpenOptions::new();
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
                return Ok(TemporaryImageFile {
                    directory: parent,
                    name,
                    file: Some(file),
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(io_error("Could not create a temporary image file", error));
            }
        }
    }

    Err(io_error(
        "Could not create a temporary image file",
        std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "temporary image names are exhausted",
        ),
    ))
}

fn write_and_flush_image(
    temporary: &mut TemporaryImageFile<'_>,
    bytes: &[u8],
) -> CommandResult<()> {
    let file = temporary
        .file
        .as_mut()
        .ok_or_else(|| CommandError::new(ErrorCode::Io, "The temporary image file is closed."))?;
    file.write_all(bytes)
        .map_err(|error| io_error("Could not write this image", error))?;
    file.sync_all()
        .map_err(|error| io_error("Could not flush this image", error))?;
    Ok(())
}

fn image_file_identity_at(
    directory: &Dir,
    name: &str,
) -> CommandResult<Option<StableFileIdentity>> {
    let metadata = match directory.symlink_metadata(name) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error("Could not inspect an image file", error)),
    };
    if metadata.is_symlink() || !metadata.is_file() {
        return Ok(None);
    }
    let file = match directory.open(name) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error("Could not open an image file", error)),
    };
    stable_handle_identity(&file)
        .map(Some)
        .map_err(|error| io_error("Could not identify an image file", error))
}

#[cfg(unix)]
fn image_entry_identity_at(
    directory: &Dir,
    name: &str,
) -> CommandResult<Option<StableFileIdentity>> {
    use cap_std::fs::MetadataExt;
    match directory.symlink_metadata(name) {
        Ok(metadata) => Ok(Some(StableFileIdentity {
            volume: metadata.dev(),
            file: metadata.ino(),
        })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error("Could not inspect a published image entry", error)),
    }
}

#[cfg(target_os = "windows")]
fn image_entry_identity_at(
    directory: &Dir,
    name: &str,
) -> CommandResult<Option<StableFileIdentity>> {
    image_file_identity_at(directory, name)
}

fn verify_image_file_path(
    directory: &Dir,
    name: &str,
    expected_identity: Option<StableFileIdentity>,
    expected_size: u64,
    expected_hash: &str,
) -> CommandResult<Option<StableFileIdentity>> {
    let Some(identity) = image_file_identity_at(directory, name)? else {
        return Ok(None);
    };
    if expected_identity.is_some_and(|expected| expected != identity) {
        return Ok(None);
    }
    let mut file = directory
        .open(name)
        .map_err(|error| io_error("Could not verify an image file", error))?;
    if stable_handle_identity(&file)
        .map_err(|error| io_error("Could not identify an image file", error))?
        != identity
    {
        return Ok(None);
    }
    let metadata = file
        .metadata()
        .map_err(|error| io_error("Could not inspect an image file", error))?;
    if !metadata.is_file() || metadata.len() != expected_size {
        return Ok(None);
    }
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| io_error("Could not verify an image file", error))?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read as u64);
        if total > MAX_IMAGE_BYTES {
            return Ok(None);
        }
        hasher.update(&buffer[..read]);
    }
    if total == expected_size
        && format!("{:x}", hasher.finalize()) == expected_hash
        && image_file_identity_at(directory, name)? == Some(identity)
    {
        Ok(Some(identity))
    } else {
        Ok(None)
    }
}

fn delete_managed_image_asset_with_hooks<F, G>(
    asset: &ManagedImageAsset,
    after_initial_identity_check: F,
    after_quarantine_identity_check: G,
) -> CommandResult<()>
where
    F: FnOnce(&Dir, &str),
    G: FnOnce(&Dir, &str),
{
    let mut held_file = open_verified_managed_image(asset)?;
    after_initial_identity_check(&asset.directory, &asset.file_name);
    if verify_image_file_path(
        &asset.directory,
        &asset.file_name,
        Some(asset.file_identity),
        asset.size_bytes,
        &asset.content_sha256,
    )? != Some(asset.file_identity)
        || stable_handle_identity(&held_file)
            .map_err(|error| io_error("Could not re-identify the pending image", error))?
            != asset.file_identity
    {
        return Err(workspace_image_conflict());
    }

    let quarantine_name = random_component(".viva-cancel-", ".tmp")
        .map_err(|error| io_error("Could not allocate a secure image cancellation name", error))?;
    rename_managed_image_no_replace(
        &asset.directory,
        &mut held_file,
        &asset.file_name,
        &quarantine_name,
    )
    .map_err(|_| workspace_image_conflict())?;

    let quarantine_matches = verify_image_file_path(
        &asset.directory,
        &quarantine_name,
        Some(asset.file_identity),
        asset.size_bytes,
        &asset.content_sha256,
    )? == Some(asset.file_identity)
        && stable_handle_identity(&held_file)
            .map_err(|error| io_error("Could not identify the cancelled image", error))?
            == asset.file_identity;

    if !quarantine_matches {
        // The no-clobber rollback never deletes either object. If a concurrent
        // swap won the rename race, its object is simply returned to the name
        // from which Viva moved it.
        let _ = rollback_managed_image_name(
            &asset.directory,
            &mut held_file,
            &quarantine_name,
            &asset.file_name,
        );
        return Err(workspace_image_conflict());
    }

    after_quarantine_identity_check(&asset.directory, &quarantine_name);
    let quarantine_still_matches = verify_image_file_path(
        &asset.directory,
        &quarantine_name,
        Some(asset.file_identity),
        asset.size_bytes,
        &asset.content_sha256,
    )? == Some(asset.file_identity)
        && stable_handle_identity(&held_file)
            .map_err(|error| io_error("Could not re-identify the cancelled image", error))?
            == asset.file_identity;
    if !quarantine_still_matches {
        // Never rename or unlink a replacement merely because it occupies the
        // private quarantine name. The original remains held and any surviving
        // verified name is restored on a best-effort basis.
        let _ = rollback_managed_image_name(
            &asset.directory,
            &mut held_file,
            &quarantine_name,
            &asset.file_name,
        );
        return Err(workspace_image_conflict());
    }

    if let Err(error) =
        delete_quarantined_managed_image(&asset.directory, &mut held_file, &quarantine_name)
    {
        rollback_verified_managed_image(asset, &mut held_file, &quarantine_name);
        return Err(io_error("Could not cancel this pasted image safely", error));
    }
    drop(held_file);
    sync_directory_best_effort(&asset.directory);
    Ok(())
}

fn rollback_verified_managed_image(
    asset: &ManagedImageAsset,
    held_file: &mut CapabilityFile,
    quarantine_name: &str,
) {
    let quarantine_matches = verify_image_file_path(
        &asset.directory,
        quarantine_name,
        Some(asset.file_identity),
        asset.size_bytes,
        &asset.content_sha256,
    )
    .ok()
    .flatten()
        == Some(asset.file_identity);
    if quarantine_matches {
        let _ = rollback_managed_image_name(
            &asset.directory,
            held_file,
            quarantine_name,
            &asset.file_name,
        );
    }
}

fn open_verified_managed_image(asset: &ManagedImageAsset) -> CommandResult<CapabilityFile> {
    let metadata = asset
        .directory
        .symlink_metadata(&asset.file_name)
        .map_err(|_| workspace_image_conflict())?;
    if metadata.is_symlink() || !metadata.is_file() {
        return Err(workspace_image_conflict());
    }

    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(target_os = "windows")]
    {
        use cap_std::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            DELETE, FILE_READ_ATTRIBUTES, FILE_READ_DATA, FILE_SHARE_READ, SYNCHRONIZE,
        };
        options.access_mode(DELETE | FILE_READ_ATTRIBUTES | FILE_READ_DATA | SYNCHRONIZE);
        options.share_mode(FILE_SHARE_READ);
    }
    let mut file = asset
        .directory
        .open_with(&asset.file_name, &options)
        .map_err(|_| workspace_image_conflict())?;
    if stable_handle_identity(&file)
        .map_err(|error| io_error("Could not identify the pending image", error))?
        != asset.file_identity
        || !open_image_file_matches(&mut file, asset.size_bytes, &asset.content_sha256)?
        || image_file_identity_at(&asset.directory, &asset.file_name)? != Some(asset.file_identity)
    {
        return Err(workspace_image_conflict());
    }
    Ok(file)
}

fn open_image_file_matches(
    file: &mut CapabilityFile,
    expected_size: u64,
    expected_hash: &str,
) -> CommandResult<bool> {
    let metadata = file
        .metadata()
        .map_err(|error| io_error("Could not inspect the pending image", error))?;
    if !metadata.is_file() || metadata.len() != expected_size {
        return Ok(false);
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|error| io_error("Could not verify the pending image", error))?;
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| io_error("Could not verify the pending image", error))?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read as u64);
        if total > MAX_IMAGE_BYTES {
            return Ok(false);
        }
        hasher.update(&buffer[..read]);
    }
    Ok(total == expected_size && format!("{:x}", hasher.finalize()) == expected_hash)
}

#[cfg(unix)]
fn rename_managed_image_no_replace(
    directory: &Dir,
    _held_file: &mut CapabilityFile,
    source_name: &str,
    destination_name: &str,
) -> std::io::Result<()> {
    rename_image_path_no_replace(directory, source_name, destination_name)
}

#[cfg(unix)]
fn rollback_managed_image_name(
    directory: &Dir,
    _held_file: &mut CapabilityFile,
    source_name: &str,
    destination_name: &str,
) -> std::io::Result<()> {
    rename_image_path_no_replace(directory, source_name, destination_name)
}

#[cfg(unix)]
fn rename_image_path_no_replace(
    directory: &Dir,
    source_name: &str,
    destination_name: &str,
) -> std::io::Result<()> {
    use rustix::fs::{RenameFlags, renameat_with};
    renameat_with(
        directory,
        source_name,
        directory,
        destination_name,
        RenameFlags::NOREPLACE,
    )
    .map_err(|error| std::io::Error::from_raw_os_error(error.raw_os_error()))
}

#[cfg(unix)]
fn delete_quarantined_managed_image(
    directory: &Dir,
    _held_file: &mut CapabilityFile,
    quarantine_name: &str,
) -> std::io::Result<()> {
    directory.remove_file(quarantine_name)
}

#[cfg(target_os = "windows")]
fn rename_managed_image_no_replace(
    directory: &Dir,
    held_file: &mut CapabilityFile,
    _source_name: &str,
    destination_name: &str,
) -> std::io::Result<()> {
    rename_open_windows_file_no_replace(directory, held_file, destination_name)
}

#[cfg(target_os = "windows")]
fn rollback_managed_image_name(
    directory: &Dir,
    held_file: &mut CapabilityFile,
    _source_name: &str,
    destination_name: &str,
) -> std::io::Result<()> {
    rename_open_windows_file_no_replace(directory, held_file, destination_name)
}

#[cfg(target_os = "windows")]
fn rename_open_windows_file_no_replace(
    directory: &Dir,
    held_file: &CapabilityFile,
    destination_name: &str,
) -> std::io::Result<()> {
    rename_open_handle_noclobber(held_file, directory, std::ffi::OsStr::new(destination_name))
}

#[cfg(target_os = "windows")]
fn delete_quarantined_managed_image(
    _directory: &Dir,
    held_file: &mut CapabilityFile,
    _quarantine_name: &str,
) -> std::io::Result<()> {
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_DISPOSITION_INFO, FileDispositionInfo, SetFileInformationByHandle,
    };

    let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
    // SAFETY: the handle was opened with DELETE access and the buffer is fully initialized.
    let succeeded = unsafe {
        SetFileInformationByHandle(
            held_file.as_raw_handle() as _,
            FileDispositionInfo,
            (&raw const disposition).cast(),
            size_of::<FILE_DISPOSITION_INFO>() as u32,
        )
    };
    if succeeded == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(all(not(unix), not(target_os = "windows")))]
compile_error!("secure workspace image leases require Unix or Windows filesystem support");

#[cfg(unix)]
fn remove_image_file_if_identity(
    directory: &Dir,
    name: &str,
    expected_identity: StableFileIdentity,
) {
    let Ok(quarantine_name) = random_component(".viva-image-cleanup-", ".tmp") else {
        return;
    };
    if rename_image_path_no_replace(directory, name, &quarantine_name).is_err() {
        return;
    }
    if image_entry_identity_at(directory, &quarantine_name)
        .ok()
        .flatten()
        == Some(expected_identity)
    {
        // POSIX has no unlink-by-handle primitive. The verified object is first
        // moved behind an unpredictable capability-relative name, narrowing the
        // remaining unlink operation to a name that was not observable in advance.
        let _ = directory.remove_file(&quarantine_name);
    } else {
        let _ = rename_image_path_no_replace(directory, &quarantine_name, name);
    }
}

#[cfg(target_os = "windows")]
fn remove_image_file_if_identity(
    directory: &Dir,
    name: &str,
    expected_identity: StableFileIdentity,
) {
    use cap_std::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        DELETE, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, SYNCHRONIZE,
    };

    let mut options = OpenOptions::new();
    options.access_mode(DELETE | FILE_READ_ATTRIBUTES | SYNCHRONIZE);
    options.share_mode(FILE_SHARE_READ);
    let Ok(mut file) = directory.open_with(name, &options) else {
        return;
    };
    if stable_handle_identity(&file).ok() != Some(expected_identity)
        || image_file_identity_at(directory, name).ok().flatten() != Some(expected_identity)
    {
        return;
    }
    let _ = delete_quarantined_managed_image(directory, &mut file, name);
}

fn workspace_image_conflict() -> CommandError {
    CommandError::new(
        ErrorCode::Conflict,
        "The image assets folder changed while Viva was storing this image. Try again.",
    )
}

fn slash_path(path: &Path) -> CommandResult<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        let Component::Normal(value) = component else {
            return Err(CommandError::new(
                ErrorCode::InvalidPath,
                "The image path is not a valid workspace path.",
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
            "The image path cannot be empty.",
        ));
    }
    Ok(parts.join("/"))
}

fn reject_symlink(metadata: &cap_std::fs::Metadata) -> CommandResult<()> {
    if metadata.file_type().is_symlink() {
        Err(CommandError::new(
            ErrorCode::SymlinkNotAllowed,
            "Symbolic links are not available in a Viva workspace.",
        ))
    } else {
        Ok(())
    }
}

fn sync_directory_best_effort(directory: &Dir) {
    if let Ok(clone) = directory.try_clone() {
        let _ = clone.into_std_file().sync_all();
    }
}

fn inspect_image(bytes: &[u8]) -> CommandResult<(ImageKind, u32, u32)> {
    if let Some((width, height)) = png_dimensions(bytes) {
        return Ok((ImageKind::Png, width, height));
    }
    if let Some((width, height)) = jpeg_dimensions(bytes) {
        return Ok((ImageKind::Jpeg, width, height));
    }
    if let Some((width, height)) = webp_dimensions(bytes) {
        return Ok((ImageKind::WebP, width, height));
    }
    if let Some((width, height)) = gif_dimensions(bytes)? {
        return Ok((ImageKind::Gif, width, height));
    }
    Err(invalid_image(
        "Viva could not identify this PNG, JPEG, GIF, or WebP image.",
    ))
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.get(..8)? != PNG_SIGNATURE {
        return None;
    }

    let mut offset = 8usize;
    let mut dimensions = None;
    let mut found_image_data = false;
    while offset.checked_add(12)? <= bytes.len() {
        let chunk_length =
            u32::from_be_bytes(bytes.get(offset..offset + 4)?.try_into().ok()?) as usize;
        let chunk_type = bytes.get(offset + 4..offset + 8)?;
        let data_start = offset + 8;
        let data_end = data_start.checked_add(chunk_length)?;
        let chunk_end = data_end.checked_add(4)?;
        if chunk_end > bytes.len() {
            return None;
        }

        match chunk_type {
            b"IHDR" if offset == 8 && chunk_length == 13 && dimensions.is_none() => {
                dimensions = Some((
                    u32::from_be_bytes(bytes.get(data_start..data_start + 4)?.try_into().ok()?),
                    u32::from_be_bytes(bytes.get(data_start + 4..data_start + 8)?.try_into().ok()?),
                ));
            }
            b"IHDR" | b"acTL" | b"fcTL" | b"fdAT" => return None,
            b"IDAT" => found_image_data = true,
            b"IEND" if chunk_length == 0 => {
                return (chunk_end == bytes.len() && found_image_data)
                    .then_some(dimensions)
                    .flatten();
            }
            b"IEND" => return None,
            _ => {}
        }
        offset = chunk_end;
    }
    None
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 4 || bytes.get(..3)? != [0xff, 0xd8, 0xff] {
        return None;
    }

    let mut offset = 2usize;
    while offset < bytes.len() {
        while bytes.get(offset) == Some(&0xff) {
            offset += 1;
        }
        let marker = *bytes.get(offset)?;
        offset += 1;
        if marker == 0xd9 || marker == 0xda {
            return None;
        }
        if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
            continue;
        }

        let segment_length =
            u16::from_be_bytes(bytes.get(offset..offset + 2)?.try_into().ok()?) as usize;
        if segment_length < 2 || offset.checked_add(segment_length)? > bytes.len() {
            return None;
        }
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) {
            if segment_length < 7 {
                return None;
            }
            let height =
                u16::from_be_bytes(bytes.get(offset + 3..offset + 5)?.try_into().ok()?) as u32;
            let width =
                u16::from_be_bytes(bytes.get(offset + 5..offset + 7)?.try_into().ok()?) as u32;
            return Some((width, height));
        }
        offset += segment_length;
    }
    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 20 || bytes.get(..4)? != b"RIFF" || bytes.get(8..12)? != b"WEBP" {
        return None;
    }

    let riff_length = u32::from_le_bytes(bytes.get(4..8)?.try_into().ok()?) as usize;
    let riff_end = 8usize.checked_add(riff_length)?;
    if riff_end != bytes.len() {
        return None;
    }

    let mut offset = 12usize;
    let mut dimensions = None;
    while offset.checked_add(8)? <= riff_end {
        let chunk = bytes.get(offset..offset + 4)?;
        let chunk_length =
            u32::from_le_bytes(bytes.get(offset + 4..offset + 8)?.try_into().ok()?) as usize;
        let data_start = offset + 8;
        let data_end = data_start.checked_add(chunk_length)?;
        if data_end > riff_end {
            return None;
        }

        if chunk == b"ANIM" || chunk == b"ANMF" {
            return None;
        }
        if chunk == b"VP8X" && chunk_length == 10 {
            let flags = bytes[data_start];
            if flags & 0x02 != 0 || flags & 0xc1 != 0 {
                return None;
            }
            let width = 1 + read_u24_le(bytes.get(data_start + 4..data_start + 7)?)?;
            let height = 1 + read_u24_le(bytes.get(data_start + 7..data_start + 10)?)?;
            dimensions = Some((width, height));
        }
        if chunk == b"VP8 " && chunk_length >= 10 && dimensions.is_none() {
            if bytes.get(data_start + 3..data_start + 6)? != [0x9d, 0x01, 0x2a] {
                return None;
            }
            let width =
                u16::from_le_bytes(bytes.get(data_start + 6..data_start + 8)?.try_into().ok()?)
                    & 0x3fff;
            let height = u16::from_le_bytes(
                bytes
                    .get(data_start + 8..data_start + 10)?
                    .try_into()
                    .ok()?,
            ) & 0x3fff;
            dimensions = Some((u32::from(width), u32::from(height)));
        }
        if chunk == b"VP8L" && chunk_length >= 5 && dimensions.is_none() {
            if bytes.get(data_start) != Some(&0x2f) {
                return None;
            }
            let b1 = u32::from(*bytes.get(data_start + 1)?);
            let b2 = u32::from(*bytes.get(data_start + 2)?);
            let b3 = u32::from(*bytes.get(data_start + 3)?);
            let b4 = u32::from(*bytes.get(data_start + 4)?);
            let width = 1 + b1 + ((b2 & 0x3f) << 8);
            let height = 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10);
            dimensions = Some((width, height));
        }

        offset = data_end.checked_add(chunk_length % 2)?;
        if offset > riff_end {
            return None;
        }
    }
    (offset == riff_end).then_some(dimensions).flatten()
}

fn read_u24_le(bytes: &[u8]) -> Option<u32> {
    Some(
        u32::from(*bytes.first()?)
            | (u32::from(*bytes.get(1)?) << 8)
            | (u32::from(*bytes.get(2)?) << 16),
    )
}

fn gif_dimensions(bytes: &[u8]) -> CommandResult<Option<(u32, u32)>> {
    if bytes.len() < 13 || (bytes.get(..6) != Some(b"GIF87a") && bytes.get(..6) != Some(b"GIF89a"))
    {
        return Ok(None);
    }
    let width = u16::from_le_bytes(
        bytes
            .get(6..8)
            .and_then(|value| value.try_into().ok())
            .ok_or_else(|| invalid_image("This GIF has an invalid header."))?,
    ) as u32;
    let height = u16::from_le_bytes(
        bytes
            .get(8..10)
            .and_then(|value| value.try_into().ok())
            .ok_or_else(|| invalid_image("This GIF has an invalid header."))?,
    ) as u32;
    validate_dimensions(width, height)?;

    let mut offset = 13usize;
    let packed = bytes[10];
    if packed & 0x80 != 0 {
        offset = offset
            .checked_add(gif_color_table_bytes(packed))
            .ok_or_else(|| invalid_image("This GIF is malformed."))?;
    }
    if offset > bytes.len() {
        return Err(invalid_image("This GIF has a truncated color table."));
    }

    let mut frames = 0usize;
    let mut total_frame_pixels = 0u64;
    let mut found_trailer = false;
    while offset < bytes.len() {
        match bytes[offset] {
            0x3b => {
                found_trailer = true;
                break;
            }
            0x21 => {
                offset = offset
                    .checked_add(2)
                    .ok_or_else(|| invalid_image("This GIF is malformed."))?;
                offset = skip_gif_sub_blocks(bytes, offset)?;
            }
            0x2c => {
                let descriptor_end = offset
                    .checked_add(10)
                    .ok_or_else(|| invalid_image("This GIF is malformed."))?;
                let descriptor = bytes
                    .get(offset..descriptor_end)
                    .ok_or_else(|| invalid_image("This GIF has a truncated image descriptor."))?;
                let frame_width = u16::from_le_bytes([descriptor[5], descriptor[6]]) as u32;
                let frame_height = u16::from_le_bytes([descriptor[7], descriptor[8]]) as u32;
                validate_dimensions(frame_width, frame_height)?;
                frames += 1;
                if frames > MAX_GIF_FRAMES {
                    return Err(CommandError::new(
                        ErrorCode::FileTooLarge,
                        "Animated GIFs are limited to 256 frames.",
                    ));
                }
                total_frame_pixels = total_frame_pixels
                    .checked_add(u64::from(frame_width) * u64::from(frame_height))
                    .ok_or_else(|| invalid_image("This GIF has invalid frame dimensions."))?;
                if total_frame_pixels > MAX_GIF_TOTAL_FRAME_PIXELS {
                    return Err(CommandError::new(
                        ErrorCode::FileTooLarge,
                        "This GIF has too many decoded frame pixels to display safely.",
                    ));
                }

                offset = descriptor_end;
                let local_packed = descriptor[9];
                if local_packed & 0x80 != 0 {
                    offset = offset
                        .checked_add(gif_color_table_bytes(local_packed))
                        .ok_or_else(|| invalid_image("This GIF is malformed."))?;
                }
                if offset >= bytes.len() {
                    return Err(invalid_image("This GIF has truncated image data."));
                }
                offset += 1;
                offset = skip_gif_sub_blocks(bytes, offset)?;
            }
            _ => return Err(invalid_image("This GIF contains an invalid block.")),
        }
    }
    if !found_trailer || frames == 0 {
        return Err(invalid_image("This GIF is incomplete."));
    }
    Ok(Some((width, height)))
}

fn gif_color_table_bytes(packed: u8) -> usize {
    3usize * (1usize << (usize::from(packed & 0x07) + 1))
}

fn skip_gif_sub_blocks(bytes: &[u8], mut offset: usize) -> CommandResult<usize> {
    loop {
        let length = usize::from(
            *bytes
                .get(offset)
                .ok_or_else(|| invalid_image("This GIF has a truncated data block."))?,
        );
        offset += 1;
        if length == 0 {
            return Ok(offset);
        }
        offset = offset
            .checked_add(length)
            .filter(|end| *end <= bytes.len())
            .ok_or_else(|| invalid_image("This GIF has a truncated data block."))?;
    }
}

fn validate_dimensions(width: u32, height: u32) -> CommandResult<()> {
    let pixels = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 {
        return Err(invalid_image("This image has invalid dimensions."));
    }
    if width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || pixels > MAX_IMAGE_PIXELS {
        return Err(CommandError::new(
            ErrorCode::FileTooLarge,
            "This image has too many pixels to display safely.",
        ));
    }
    Ok(())
}

fn validate_relative_image_path(path: &str) -> CommandResult<PathBuf> {
    validate_portable_workspace_relative_path(path)?;
    let path = Path::new(path);
    if path.as_os_str().is_empty() || path.is_absolute() {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "Use a non-empty image path relative to the open workspace.",
        ));
    }

    let mut clean = PathBuf::new();
    let components: Vec<_> = path.components().collect();
    if components.is_empty() {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "Choose an image path.",
        ));
    }
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(value) = component else {
            return Err(CommandError::new(
                ErrorCode::InvalidPath,
                "Workspace paths cannot contain parent or absolute components.",
            ));
        };
        let value = value.to_str().ok_or_else(|| {
            CommandError::new(
                ErrorCode::InvalidPath,
                "Workspace paths must be valid Unicode.",
            )
        })?;
        if value.is_empty() || value.starts_with('.') {
            return Err(CommandError::new(
                ErrorCode::InvalidPath,
                "Hidden workspace paths are not available.",
            ));
        }
        if index + 1 < components.len() && is_ignored_directory(value) {
            return Err(CommandError::new(
                ErrorCode::InvalidPath,
                "This folder is intentionally excluded from the workspace.",
            ));
        }
        clean.push(value);
    }
    if ImageKind::from_extension(&clean).is_none() {
        return Err(unsupported_image());
    }
    Ok(clean)
}

fn validate_portable_workspace_relative_path(path: &str) -> CommandResult<()> {
    if path.contains('\\') {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "Workspace paths must use forward slashes between folders.",
        ));
    }
    Ok(())
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

fn invalid_image(message: impl Into<String>) -> CommandError {
    CommandError::new(ErrorCode::InvalidImage, message)
}

fn unsupported_image() -> CommandError {
    CommandError::new(
        ErrorCode::UnsupportedFileType,
        "Viva supports local PNG, JPEG, GIF, and still WebP images.",
    )
}

fn image_too_large() -> CommandError {
    CommandError::new(ErrorCode::FileTooLarge, "Images are limited to 24 MiB.")
}

fn io_error(context: &str, error: std::io::Error) -> CommandError {
    let code = match error.kind() {
        std::io::ErrorKind::NotFound => ErrorCode::NotFound,
        _ => ErrorCode::Io,
    };
    CommandError::new(code, format!("{context}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::sync::atomic::{AtomicU64, Ordering};
    use tempfile::{TempDir, tempdir};

    static NEXT_TEST_LEASE: AtomicU64 = AtomicU64::new(10_000);
    static IMAGE_LEASE_TEST_MUTEX: Mutex<()> = Mutex::new(());

    fn isolated_image_lease_test() -> MutexGuard<'static, ()> {
        let guard = IMAGE_LEASE_TEST_MUTEX
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *lock_image_lease_registry() = ImageLeaseRegistry::default();
        guard
    }

    fn root_string(workspace: &TempDir) -> String {
        workspace.path().to_string_lossy().into_owned()
    }

    fn request(workspace: &TempDir, relative_path: &str) -> ReadWorkspaceImageRequest {
        ReadWorkspaceImageRequest {
            workspace_root: root_string(workspace),
            relative_path: relative_path.to_owned(),
        }
    }

    fn create_request(
        workspace: &TempDir,
        document_relative_path: &str,
        bytes: Vec<u8>,
    ) -> CreateWorkspaceImageRequest {
        use base64::{Engine as _, engine::general_purpose::STANDARD};

        CreateWorkspaceImageRequest {
            workspace_root: root_string(workspace),
            document_relative_path: document_relative_path.to_owned(),
            data_base64: STANDARD.encode(bytes),
            lease_id: format!(
                "test-lease-{}",
                NEXT_TEST_LEASE.fetch_add(1, Ordering::Relaxed)
            ),
            session: 1,
        }
    }

    fn leased_create_request(
        workspace: &TempDir,
        document_relative_path: &str,
        bytes: Vec<u8>,
        session: u64,
        lease_id: &str,
    ) -> CreateWorkspaceImageRequest {
        use base64::{Engine as _, engine::general_purpose::STANDARD};

        CreateWorkspaceImageRequest {
            workspace_root: root_string(workspace),
            document_relative_path: document_relative_path.to_owned(),
            data_base64: STANDARD.encode(bytes),
            lease_id: lease_id.to_owned(),
            session,
        }
    }

    fn settle_request(
        workspace: &TempDir,
        session: u64,
        lease_id: &str,
    ) -> SettleWorkspaceImageRequest {
        SettleWorkspaceImageRequest {
            workspace_root: root_string(workspace),
            lease_id: lease_id.to_owned(),
            session,
        }
    }

    fn next_test_session() -> u64 {
        NEXT_TEST_LEASE.fetch_add(1, Ordering::Relaxed)
    }

    fn create_document_fixture(workspace: &TempDir, relative_path: &str) {
        let path = workspace.path().join(relative_path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"# Note\n").unwrap();
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut header = Vec::with_capacity(13);
        header.extend_from_slice(&width.to_be_bytes());
        header.extend_from_slice(&height.to_be_bytes());
        header.extend_from_slice(&[8, 6, 0, 0, 0]);
        append_png_chunk(&mut bytes, b"IHDR", &header);
        append_png_chunk(&mut bytes, b"IDAT", &[0]);
        append_png_chunk(&mut bytes, b"IEND", &[]);
        bytes
    }

    fn append_png_chunk(bytes: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
        bytes.extend_from_slice(&(data.len() as u32).to_be_bytes());
        bytes.extend_from_slice(kind);
        bytes.extend_from_slice(data);
        bytes.extend_from_slice(&[0; 4]);
    }

    fn webp_lossless(width: u32, height: u32) -> Vec<u8> {
        let width = width - 1;
        let height = height - 1;
        let b1 = (width & 0xff) as u8;
        let b2 = (((height & 0x03) << 6) | ((width >> 8) & 0x3f)) as u8;
        let b3 = ((height >> 2) & 0xff) as u8;
        let b4 = ((height >> 10) & 0x0f) as u8;
        let mut bytes = b"RIFF\x12\0\0\0WEBPVP8L\x05\0\0\0".to_vec();
        bytes.extend_from_slice(&[0x2f, b1, b2, b3, b4, 0]);
        bytes
    }

    fn webp_animated(width: u32, height: u32) -> Vec<u8> {
        let width = width - 1;
        let height = height - 1;
        let mut bytes = b"RIFF\x16\0\0\0WEBPVP8X\x0a\0\0\0".to_vec();
        bytes.extend_from_slice(&[
            0x02,
            0,
            0,
            0,
            (width & 0xff) as u8,
            ((width >> 8) & 0xff) as u8,
            ((width >> 16) & 0xff) as u8,
            (height & 0xff) as u8,
            ((height >> 8) & 0xff) as u8,
            ((height >> 16) & 0xff) as u8,
        ]);
        bytes
    }

    fn gif(width: u16, height: u16) -> Vec<u8> {
        gif_with_frames(width, height, 1)
    }

    fn gif_with_frames(width: u16, height: u16, frames: usize) -> Vec<u8> {
        let mut bytes = b"GIF89a".to_vec();
        bytes.extend_from_slice(&width.to_le_bytes());
        bytes.extend_from_slice(&height.to_le_bytes());
        bytes.extend_from_slice(&[0, 0, 0]);
        for _ in 0..frames {
            bytes.push(0x2c);
            bytes.extend_from_slice(&[0, 0, 0, 0]);
            bytes.extend_from_slice(&width.to_le_bytes());
            bytes.extend_from_slice(&height.to_le_bytes());
            bytes.extend_from_slice(&[0, 2, 2, 0x44, 0x01, 0]);
        }
        bytes.push(0x3b);
        bytes
    }

    #[test]
    fn returns_a_typed_binary_payload_for_a_valid_png() {
        let workspace = tempdir().unwrap();
        fs::create_dir(workspace.path().join("images")).unwrap();
        let source = png(640, 360);
        fs::write(workspace.path().join("images/hero.png"), &source).unwrap();

        let payload = read_workspace_image_core(request(&workspace, "images/hero.png")).unwrap();

        assert_eq!(&payload[..4], PAYLOAD_MAGIC);
        assert_eq!(payload[4], PAYLOAD_VERSION);
        assert_eq!(payload[5], ImageKind::Png as u8);
        assert_eq!(u32::from_be_bytes(payload[6..10].try_into().unwrap()), 640);
        assert_eq!(u32::from_be_bytes(payload[10..14].try_into().unwrap()), 360);
        assert_eq!(&payload[PAYLOAD_HEADER_LEN..], source);
    }

    #[test]
    fn rejects_animated_png_before_exposing_it_to_the_webview() {
        let workspace = tempdir().unwrap();
        let mut source = png(320, 180);
        let mut animation_control = Vec::new();
        append_png_chunk(&mut animation_control, b"acTL", &[0, 0, 0, 2, 0, 0, 0, 0]);
        source.splice(33..33, animation_control);
        fs::write(workspace.path().join("motion.png"), source).unwrap();

        let error = read_workspace_image_core(request(&workspace, "motion.png")).unwrap_err();

        assert_eq!(error.code, ErrorCode::InvalidImage);
    }

    #[test]
    fn reads_dimensions_from_lossless_webp() {
        let bytes = webp_lossless(321, 123);
        assert_eq!(webp_dimensions(&bytes), Some((321, 123)));
    }

    #[test]
    fn rejects_animated_webp() {
        assert_eq!(webp_dimensions(&webp_animated(321, 123)), None);
    }

    #[test]
    fn accepts_a_bounded_gif_and_reports_its_canvas() {
        let workspace = tempdir().unwrap();
        let mut source = gif(320, 180);
        source[..6].copy_from_slice(b"GIF87a");
        fs::write(workspace.path().join("motion.gif"), &source).unwrap();

        let payload = read_workspace_image_core(request(&workspace, "motion.gif")).unwrap();

        assert_eq!(payload[5], ImageKind::Gif as u8);
        assert_eq!(u32::from_be_bytes(payload[6..10].try_into().unwrap()), 320);
        assert_eq!(u32::from_be_bytes(payload[10..14].try_into().unwrap()), 180);
    }

    #[test]
    fn rejects_gifs_with_excessive_frames_or_decode_work() {
        let frame_error = gif_dimensions(&gif_with_frames(1, 1, MAX_GIF_FRAMES + 1)).unwrap_err();
        assert_eq!(frame_error.code, ErrorCode::FileTooLarge);

        let pixel_error = gif_dimensions(&gif_with_frames(6_000, 5_000, 5)).unwrap_err();
        assert_eq!(pixel_error.code, ErrorCode::FileTooLarge);
    }

    #[test]
    fn rejects_traversal_hidden_ignored_and_absolute_paths() {
        let workspace = tempdir().unwrap();
        for path in [
            "../outside.png",
            "/outside.png",
            ".hidden.png",
            "node_modules/image.png",
            r"images\hero.png",
        ] {
            let error = read_workspace_image_core(request(&workspace, path)).unwrap_err();
            assert_eq!(error.code, ErrorCode::InvalidPath, "{path}");
        }
    }

    #[test]
    fn rejects_windows_separators_in_document_paths_before_creating_assets() {
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "notes/daily.md");

        let error = create_workspace_image_unleased_core(create_request(
            &workspace,
            r"notes\daily.md",
            png(32, 18),
        ))
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::InvalidPath);
        assert!(!workspace.path().join("notes/assets").exists());
    }

    #[test]
    fn rejects_unsupported_and_mismatched_content() {
        let workspace = tempdir().unwrap();
        fs::write(workspace.path().join("vector.svg"), b"<svg/>").unwrap();
        fs::write(workspace.path().join("pretend.png"), b"not a png").unwrap();

        let unsupported = read_workspace_image_core(request(&workspace, "vector.svg")).unwrap_err();
        assert_eq!(unsupported.code, ErrorCode::UnsupportedFileType);
        let invalid = read_workspace_image_core(request(&workspace, "pretend.png")).unwrap_err();
        assert_eq!(invalid.code, ErrorCode::InvalidImage);
    }

    #[test]
    fn rejects_excessive_bytes_and_pixels() {
        let workspace = tempdir().unwrap();
        let oversized_path = workspace.path().join("oversized.jpg");
        let oversized = File::create(&oversized_path).unwrap();
        oversized.set_len(MAX_IMAGE_BYTES + 1).unwrap();
        drop(oversized);
        let bytes_error =
            read_workspace_image_core(request(&workspace, "oversized.jpg")).unwrap_err();
        assert_eq!(bytes_error.code, ErrorCode::FileTooLarge);

        fs::write(workspace.path().join("huge.png"), png(8_000, 8_000)).unwrap();
        let pixels_error = read_workspace_image_core(request(&workspace, "huge.png")).unwrap_err();
        assert_eq!(pixels_error.code, ErrorCode::FileTooLarge);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_image_symlinks_and_symlinked_directories() {
        use std::os::unix::fs::symlink;

        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("secret.png"), png(10, 10)).unwrap();
        symlink(
            outside.path().join("secret.png"),
            workspace.path().join("linked.png"),
        )
        .unwrap();
        symlink(outside.path(), workspace.path().join("linked-folder")).unwrap();

        for path in ["linked.png", "linked-folder/secret.png"] {
            let error = read_workspace_image_core(request(&workspace, path)).unwrap_err();
            assert_eq!(error.code, ErrorCode::SymlinkNotAllowed, "{path}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn an_open_workspace_capability_does_not_follow_a_replaced_root_path() {
        use std::os::unix::fs::symlink;

        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::create_dir(workspace.path().join("images")).unwrap();
        fs::create_dir(outside.path().join("images")).unwrap();
        let source = png(640, 360);
        fs::write(workspace.path().join("images/hero.png"), &source).unwrap();
        fs::write(outside.path().join("images/hero.png"), png(1, 1)).unwrap();

        let root = open_workspace_directory(&root_string(&workspace)).unwrap();
        let held_workspace = workspace.path().with_extension("capability-held");
        fs::rename(workspace.path(), &held_workspace).unwrap();
        symlink(outside.path(), workspace.path()).unwrap();

        let result = read_workspace_image_from_directory(&root, Path::new("images/hero.png"));

        fs::remove_file(workspace.path()).unwrap();
        fs::rename(&held_workspace, workspace.path()).unwrap();
        let payload = result.unwrap();
        assert_eq!(&payload[PAYLOAD_HEADER_LEN..], source);
    }

    #[test]
    fn stores_a_content_addressed_image_beside_the_active_document() {
        use sha2::{Digest, Sha256};

        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "notes/daily.md");
        let source = png(640, 360);
        let sha256 = format!("{:x}", Sha256::digest(&source));

        let stored = create_workspace_image_unleased_core(create_request(
            &workspace,
            "notes/daily.md",
            source.clone(),
        ))
        .unwrap();

        let file_name = format!("pasted-{}.png", &sha256[..20]);
        assert_eq!(stored.relative_path, format!("notes/assets/{file_name}"));
        assert_eq!(stored.markdown_path, format!("assets/{file_name}"));
        assert_eq!(stored.format, "png");
        assert_eq!(stored.width, 640);
        assert_eq!(stored.height, 360);
        assert_eq!(stored.size_bytes, source.len() as u64);
        assert!(!stored.deduplicated);
        assert_eq!(
            fs::read(workspace.path().join(&stored.relative_path)).unwrap(),
            source
        );
    }

    #[test]
    fn deduplicates_an_existing_identical_image_without_rewriting_it() {
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let source = png(32, 18);

        let first = create_workspace_image_unleased_core(create_request(
            &workspace,
            "note.md",
            source.clone(),
        ))
        .unwrap();
        let first_modified = fs::metadata(workspace.path().join(&first.relative_path))
            .unwrap()
            .modified()
            .unwrap();
        let second =
            create_workspace_image_unleased_core(create_request(&workspace, "note.md", source))
                .unwrap();

        assert_eq!(second.relative_path, first.relative_path);
        assert!(second.deduplicated);
        assert_eq!(
            fs::metadata(workspace.path().join(&first.relative_path))
                .unwrap()
                .modified()
                .unwrap(),
            first_modified
        );
    }

    #[test]
    fn never_overwrites_a_different_file_with_the_short_hash_name() {
        use sha2::{Digest, Sha256};

        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let source = png(80, 45);
        let sha256 = format!("{:x}", Sha256::digest(&source));
        let assets = workspace.path().join("assets");
        fs::create_dir(&assets).unwrap();
        let short_collision = assets.join(format!("pasted-{}.png", &sha256[..20]));
        let collision = vec![0x5a; source.len()];
        fs::write(&short_collision, &collision).unwrap();

        let stored = create_workspace_image_unleased_core(create_request(
            &workspace,
            "note.md",
            source.clone(),
        ))
        .unwrap();

        assert_eq!(fs::read(short_collision).unwrap(), collision);
        assert_eq!(
            stored.relative_path,
            format!("assets/pasted-{}.png", &sha256[..28])
        );
        assert_eq!(
            fs::read(workspace.path().join(&stored.relative_path)).unwrap(),
            source
        );
    }

    #[test]
    fn concurrent_identical_writes_converge_on_one_file() {
        use std::sync::{Arc, Barrier};
        use std::thread;

        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let workspace_root = root_string(&workspace);
        let source = png(96, 54);
        let barrier = Arc::new(Barrier::new(3));
        let mut handles = Vec::new();

        for _ in 0..2 {
            let workspace_root = workspace_root.clone();
            let source = source.clone();
            let barrier = Arc::clone(&barrier);
            handles.push(thread::spawn(move || {
                barrier.wait();
                create_workspace_image_unleased_core(CreateWorkspaceImageRequest {
                    workspace_root,
                    document_relative_path: "note.md".to_owned(),
                    data_base64: {
                        use base64::{Engine as _, engine::general_purpose::STANDARD};
                        STANDARD.encode(source)
                    },
                    lease_id: format!(
                        "test-lease-{}",
                        NEXT_TEST_LEASE.fetch_add(1, Ordering::Relaxed)
                    ),
                    session: 1,
                })
                .unwrap()
            }));
        }
        barrier.wait();
        let results: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();

        assert_eq!(results[0].relative_path, results[1].relative_path);
        assert_eq!(
            results.iter().filter(|result| result.deduplicated).count(),
            1
        );
        assert_eq!(
            fs::read_dir(workspace.path().join("assets"))
                .unwrap()
                .count(),
            1
        );
    }

    #[test]
    fn image_lease_create_commit_and_cancel_are_idempotent() {
        let _lease_test = isolated_image_lease_test();
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let source = png(64, 36);
        let session = next_test_session();
        let lease_id = "idempotent-create";

        let first = create_workspace_image_core(leased_create_request(
            &workspace,
            "note.md",
            source.clone(),
            session,
            lease_id,
        ))
        .unwrap();
        let retry = create_workspace_image_core(leased_create_request(
            &workspace, "note.md", source, session, lease_id,
        ))
        .unwrap();
        assert_eq!(retry, first);
        assert_eq!(
            fs::read_dir(workspace.path().join("assets"))
                .unwrap()
                .count(),
            1
        );

        commit_workspace_image_core(settle_request(&workspace, session, lease_id)).unwrap();
        commit_workspace_image_core(settle_request(&workspace, session, lease_id)).unwrap();
        cancel_workspace_image_core(settle_request(&workspace, session, lease_id)).unwrap();
        assert!(workspace.path().join(&first.relative_path).is_file());
    }

    #[test]
    fn image_lease_rejects_reuse_for_different_content() {
        let _lease_test = isolated_image_lease_test();
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let session = next_test_session();
        let lease_id = "different-content";
        create_workspace_image_core(leased_create_request(
            &workspace,
            "note.md",
            png(64, 36),
            session,
            lease_id,
        ))
        .unwrap();

        let error = create_workspace_image_core(leased_create_request(
            &workspace,
            "note.md",
            png(65, 36),
            session,
            lease_id,
        ))
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Conflict);

        cancel_workspace_image_core(settle_request(&workspace, session, lease_id)).unwrap();
    }

    #[test]
    fn cancel_before_create_is_a_durable_tombstone_for_the_process() {
        let _lease_test = isolated_image_lease_test();
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let session = next_test_session();
        let lease_id = "cancel-before-create";

        cancel_workspace_image_core(settle_request(&workspace, session, lease_id)).unwrap();
        cancel_workspace_image_core(settle_request(&workspace, session, lease_id)).unwrap();
        let create_error = create_workspace_image_core(leased_create_request(
            &workspace,
            "note.md",
            png(32, 18),
            session,
            lease_id,
        ))
        .unwrap_err();
        let commit_error =
            commit_workspace_image_core(settle_request(&workspace, session, lease_id)).unwrap_err();

        assert_eq!(create_error.code, ErrorCode::Conflict);
        assert_eq!(commit_error.code, ErrorCode::Conflict);
        assert!(!workspace.path().join("assets").exists());
    }

    #[test]
    fn cancelling_the_only_pending_lease_removes_only_its_new_asset() {
        let _lease_test = isolated_image_lease_test();
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let session = next_test_session();
        let lease_id = "single-cancel";
        let stored = create_workspace_image_core(leased_create_request(
            &workspace,
            "note.md",
            png(40, 24),
            session,
            lease_id,
        ))
        .unwrap();
        let target = workspace.path().join(&stored.relative_path);
        assert!(target.is_file());

        cancel_workspace_image_core(settle_request(&workspace, session, lease_id)).unwrap();
        cancel_workspace_image_core(settle_request(&workspace, session, lease_id)).unwrap();
        assert!(!target.exists());
    }

    #[test]
    fn cancelling_a_deduplicated_preexisting_asset_never_deletes_it() {
        let _lease_test = isolated_image_lease_test();
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let source = png(48, 27);
        let preexisting = create_workspace_image_unleased_core(create_request(
            &workspace,
            "note.md",
            source.clone(),
        ))
        .unwrap();
        let session = next_test_session();
        let lease_id = "preexisting-cancel";

        let leased = create_workspace_image_core(leased_create_request(
            &workspace, "note.md", source, session, lease_id,
        ))
        .unwrap();
        assert!(leased.deduplicated);
        cancel_workspace_image_core(settle_request(&workspace, session, lease_id)).unwrap();

        assert!(workspace.path().join(preexisting.relative_path).is_file());
    }

    #[test]
    fn concurrent_cancel_and_commit_for_one_asset_always_preserve_it() {
        let _lease_test = isolated_image_lease_test();
        use std::sync::{Arc, Barrier};
        use std::thread;

        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let source = png(72, 40);
        let first_session = next_test_session();
        let second_session = next_test_session();
        let first = create_workspace_image_core(leased_create_request(
            &workspace,
            "note.md",
            source.clone(),
            first_session,
            "cancel-side",
        ))
        .unwrap();
        let second = create_workspace_image_core(leased_create_request(
            &workspace,
            "note.md",
            source,
            second_session,
            "commit-side",
        ))
        .unwrap();
        assert_eq!(first.relative_path, second.relative_path);

        let root = root_string(&workspace);
        let barrier = Arc::new(Barrier::new(3));
        let cancel_barrier = Arc::clone(&barrier);
        let cancel_root = root.clone();
        let cancel = thread::spawn(move || {
            cancel_barrier.wait();
            cancel_workspace_image_core(SettleWorkspaceImageRequest {
                workspace_root: cancel_root,
                lease_id: "cancel-side".to_owned(),
                session: first_session,
            })
        });
        let commit_barrier = Arc::clone(&barrier);
        let commit = thread::spawn(move || {
            commit_barrier.wait();
            commit_workspace_image_core(SettleWorkspaceImageRequest {
                workspace_root: root,
                lease_id: "commit-side".to_owned(),
                session: second_session,
            })
        });
        barrier.wait();

        cancel.join().unwrap().unwrap();
        commit.join().unwrap().unwrap();
        assert!(workspace.path().join(first.relative_path).is_file());
    }

    #[test]
    fn concurrent_cancellation_of_all_leases_removes_the_new_asset() {
        let _lease_test = isolated_image_lease_test();
        use std::sync::{Arc, Barrier};
        use std::thread;

        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let source = png(73, 41);
        let first_session = next_test_session();
        let second_session = next_test_session();
        let first = create_workspace_image_core(leased_create_request(
            &workspace,
            "note.md",
            source.clone(),
            first_session,
            "cancel-all-a",
        ))
        .unwrap();
        create_workspace_image_core(leased_create_request(
            &workspace,
            "note.md",
            source,
            second_session,
            "cancel-all-b",
        ))
        .unwrap();

        let root = root_string(&workspace);
        let barrier = Arc::new(Barrier::new(3));
        let first_barrier = Arc::clone(&barrier);
        let first_root = root.clone();
        let first_cancel = thread::spawn(move || {
            first_barrier.wait();
            cancel_workspace_image_core(SettleWorkspaceImageRequest {
                workspace_root: first_root,
                lease_id: "cancel-all-a".to_owned(),
                session: first_session,
            })
        });
        let second_barrier = Arc::clone(&barrier);
        let second_cancel = thread::spawn(move || {
            second_barrier.wait();
            cancel_workspace_image_core(SettleWorkspaceImageRequest {
                workspace_root: root,
                lease_id: "cancel-all-b".to_owned(),
                session: second_session,
            })
        });
        barrier.wait();

        first_cancel.join().unwrap().unwrap();
        second_cancel.join().unwrap().unwrap();
        assert!(!workspace.path().join(first.relative_path).exists());
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_never_deletes_a_path_replaced_after_identity_validation() {
        let _lease_test = isolated_image_lease_test();
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let source = png(74, 42);
        let session = next_test_session();
        let lease_id = "replacement-race";
        let stored = create_workspace_image_core(leased_create_request(
            &workspace,
            "note.md",
            source.clone(),
            session,
            lease_id,
        ))
        .unwrap();
        let file_name = Path::new(&stored.relative_path)
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .to_owned();
        let held_name = "held-original.png";

        let error = cancel_workspace_image_core_with_hook(
            settle_request(&workspace, session, lease_id),
            |assets, active_name| {
                assets.rename(active_name, assets, held_name).unwrap();
                assets.write(active_name, b"attacker replacement").unwrap();
            },
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Conflict);
        assert_eq!(
            fs::read(workspace.path().join("assets").join(held_name)).unwrap(),
            source
        );
        assert_eq!(
            fs::read(workspace.path().join("assets").join(&file_name)).unwrap(),
            b"attacker replacement"
        );

        fs::remove_file(workspace.path().join("assets").join(&file_name)).unwrap();
        fs::rename(
            workspace.path().join("assets").join(held_name),
            workspace.path().join("assets").join(&file_name),
        )
        .unwrap();
        cancel_workspace_image_core(settle_request(&workspace, session, lease_id)).unwrap();
        assert!(!workspace.path().join(stored.relative_path).exists());
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_never_unlinks_a_quarantine_name_replaced_after_validation() {
        let _lease_test = isolated_image_lease_test();
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let source = png(75, 43);
        let session = next_test_session();
        let lease_id = "quarantine-replacement-race";
        let stored = create_workspace_image_core(leased_create_request(
            &workspace,
            "note.md",
            source.clone(),
            session,
            lease_id,
        ))
        .unwrap();
        let file_name = Path::new(&stored.relative_path)
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .to_owned();
        let preserved_name = "preserved-quarantined-original.png";
        let mut replaced_quarantine_name = None;

        let error = cancel_workspace_image_core_with_quarantine_hook(
            settle_request(&workspace, session, lease_id),
            |assets, quarantine_name| {
                replaced_quarantine_name = Some(quarantine_name.to_owned());
                assets
                    .rename(quarantine_name, assets, preserved_name)
                    .unwrap();
                assets
                    .write(quarantine_name, b"attacker replacement")
                    .unwrap();
            },
        )
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::Conflict);
        assert_eq!(
            fs::read(workspace.path().join("assets").join(preserved_name)).unwrap(),
            source
        );
        let quarantine_name = replaced_quarantine_name.unwrap();
        assert_eq!(
            fs::read(workspace.path().join("assets").join(&file_name)).unwrap(),
            b"attacker replacement"
        );
        assert!(
            !workspace
                .path()
                .join("assets")
                .join(&quarantine_name)
                .exists()
        );

        fs::remove_file(workspace.path().join("assets").join(&file_name)).unwrap();
        fs::rename(
            workspace.path().join("assets").join(preserved_name),
            workspace.path().join("assets").join(&file_name),
        )
        .unwrap();
        cancel_workspace_image_core(settle_request(&workspace, session, lease_id)).unwrap();
        assert!(!workspace.path().join(stored.relative_path).exists());
    }

    #[test]
    fn renderer_session_reset_releases_only_old_uncommitted_new_assets() {
        let _lease_test = isolated_image_lease_test();
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let old_session = next_test_session();
        let new_session = old_session + 1;

        let pending = create_workspace_image_core(leased_create_request(
            &workspace,
            "note.md",
            png(81, 45),
            old_session,
            "reset-pending",
        ))
        .unwrap();
        let committed = create_workspace_image_core(leased_create_request(
            &workspace,
            "note.md",
            png(82, 46),
            old_session,
            "reset-committed",
        ))
        .unwrap();
        commit_workspace_image_core(settle_request(&workspace, old_session, "reset-committed"))
            .unwrap();
        let preexisting = create_workspace_image_unleased_core(create_request(
            &workspace,
            "note.md",
            png(83, 47),
        ))
        .unwrap();
        let deduplicated = create_workspace_image_core(leased_create_request(
            &workspace,
            "note.md",
            png(83, 47),
            old_session,
            "reset-preexisting",
        ))
        .unwrap();
        assert!(deduplicated.deduplicated);

        reset_frontend_image_session_sync(new_session);

        assert!(!workspace.path().join(pending.relative_path).exists());
        assert!(workspace.path().join(committed.relative_path).is_file());
        assert!(workspace.path().join(preexisting.relative_path).is_file());
        let registry = lock_image_lease_registry();
        assert_eq!(registry.active_session, Some(new_session));
        assert!(registry.leases.keys().all(|key| key.session == new_session));
        assert!(registry.assets.is_empty());
    }

    #[test]
    fn renderer_session_reset_abandons_conflicted_cleanup_without_retaining_handles() {
        let _lease_test = isolated_image_lease_test();
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let old_session = next_test_session();
        let new_session = old_session + 1;
        let source = png(86, 50);
        let stored = create_workspace_image_core(leased_create_request(
            &workspace,
            "note.md",
            source.clone(),
            old_session,
            "reset-conflict",
        ))
        .unwrap();
        let original = workspace.path().join(&stored.relative_path);
        let preserved = original.with_file_name("reset-conflict-preserved.png");
        fs::rename(&original, &preserved).unwrap();
        fs::write(&original, b"attacker replacement").unwrap();

        reset_frontend_image_session_sync(new_session);

        assert_eq!(fs::read(&preserved).unwrap(), source);
        assert_eq!(fs::read(&original).unwrap(), b"attacker replacement");
        let registry = lock_image_lease_registry();
        assert_eq!(registry.active_session, Some(new_session));
        assert!(registry.leases.keys().all(|key| key.session == new_session));
        assert!(registry.assets.is_empty());
    }

    #[test]
    fn stale_renderer_commands_are_rejected_after_session_reset() {
        let _lease_test = isolated_image_lease_test();
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let old_session = next_test_session();
        let new_session = old_session + 1;
        activate_frontend_image_session(old_session);

        let pending = create_workspace_image_core_with_session_check(
            leased_create_request(
                &workspace,
                "note.md",
                png(84, 48),
                old_session,
                "stale-request",
            ),
            true,
        )
        .unwrap();
        reset_frontend_image_session_sync(new_session);
        assert!(!workspace.path().join(pending.relative_path).exists());

        let create_error = create_workspace_image_core_with_session_check(
            leased_create_request(
                &workspace,
                "note.md",
                png(85, 49),
                old_session,
                "late-create",
            ),
            true,
        )
        .unwrap_err();
        let cancel_error = cancel_workspace_image_core_with_session_check(
            settle_request(&workspace, old_session, "late-cancel"),
            true,
        )
        .unwrap_err();
        assert_eq!(create_error.code, ErrorCode::Conflict);
        assert_eq!(cancel_error.code, ErrorCode::Conflict);
        assert_eq!(
            fs::read_dir(workspace.path().join("assets"))
                .unwrap()
                .count(),
            0
        );
    }

    #[test]
    fn active_session_lease_records_are_bounded_and_old_terminal_records_are_pruned() {
        let _lease_test = isolated_image_lease_test();
        let session = next_test_session();
        {
            let mut registry = lock_image_lease_registry();
            registry.active_session = Some(session);
            for index in 0..MAX_IMAGE_LEASES_PER_SESSION {
                registry.leases.insert(
                    ImageLeaseKey {
                        session,
                        lease_id: format!("bounded-{index}"),
                    },
                    ImageLeaseRecord {
                        workspace_root: "/tmp/bounded-workspace".to_owned(),
                        status: ImageLeaseStatus::Cancelled,
                        fingerprint: None,
                        response: None,
                        asset_key: None,
                    },
                );
            }
            assert_eq!(
                ensure_image_lease_capacity(&registry, session)
                    .unwrap_err()
                    .code,
                ErrorCode::WorkspaceTooLarge
            );
        }

        reset_frontend_image_session_sync(session + 1);
        let registry = lock_image_lease_registry();
        assert!(registry.leases.is_empty());
    }

    #[test]
    fn never_publishes_a_temporary_image_replaced_with_different_content() {
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let root = open_workspace_directory(&root_string(&workspace)).unwrap();
        let document_parent = open_document_parent(&root, Path::new("note.md")).unwrap();
        let assets = ensure_assets_directory(&document_parent).unwrap();
        let source = png(48, 27);
        let hash = format!("{:x}", Sha256::digest(&source));
        let expected_name = format!("pasted-{}.png", &hash[..20]);
        let mut replacement_result = None;

        let result = persist_content_addressed_image_with_hook(
            &assets,
            &hash,
            "png",
            &source,
            |assets, temporary_name| {
                replacement_result = Some(
                    assets
                        .remove_file(temporary_name)
                        .and_then(|()| assets.write(temporary_name, b"malicious replacement")),
                );
            },
        );

        let published = workspace.path().join("assets").join(expected_name);
        match replacement_result.expect("the replacement hook must run") {
            Ok(()) => {
                let error = result.unwrap_err();
                assert_eq!(error.code, ErrorCode::Conflict);
                assert!(!published.exists());
            }
            Err(_) => {
                // Windows deliberately keeps the temporary file open without
                // write/delete sharing. If the kernel blocks the replacement,
                // Viva may safely finish publishing only the verified original.
                let stored = result.unwrap();
                assert_eq!(
                    stored.file_name,
                    published.file_name().unwrap().to_str().unwrap()
                );
                assert_eq!(fs::read(published).unwrap(), source);
            }
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_temporary_image_handle_blocks_replacement_and_keeps_the_original() {
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let root = open_workspace_directory(&root_string(&workspace)).unwrap();
        let document_parent = open_document_parent(&root, Path::new("note.md")).unwrap();
        let assets = ensure_assets_directory(&document_parent).unwrap();
        let source = png(49, 28);
        let hash = format!("{:x}", Sha256::digest(&source));
        let mut replacement_was_blocked = false;

        let stored = persist_content_addressed_image_with_hook(
            &assets,
            &hash,
            "png",
            &source,
            |assets, temporary_name| {
                replacement_was_blocked = assets.remove_file(temporary_name).is_err();
            },
        )
        .unwrap();

        assert!(replacement_was_blocked);
        assert_eq!(
            fs::read(workspace.path().join("assets").join(stored.file_name)).unwrap(),
            source
        );
    }

    #[cfg(unix)]
    #[test]
    fn never_publishes_a_temporary_image_replaced_with_a_symlink() {
        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let outside_file = outside.path().join("untouched.png");
        fs::write(&outside_file, b"outside").unwrap();
        let root = open_workspace_directory(&root_string(&workspace)).unwrap();
        let document_parent = open_document_parent(&root, Path::new("note.md")).unwrap();
        let assets = ensure_assets_directory(&document_parent).unwrap();
        let source = png(48, 27);
        let hash = format!("{:x}", Sha256::digest(&source));
        let expected_name = format!("pasted-{}.png", &hash[..20]);

        let error = persist_content_addressed_image_with_hook(
            &assets,
            &hash,
            "png",
            &source,
            |assets, temporary_name| {
                assets.remove_file(temporary_name).unwrap();
                assets
                    .symlink_contents(&outside_file, temporary_name)
                    .unwrap();
            },
        )
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::Conflict);
        assert!(!workspace.path().join("assets").join(expected_name).exists());
        assert_eq!(fs::read(outside_file).unwrap(), b"outside");
    }

    #[test]
    fn validates_the_active_document_before_creating_assets() {
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");

        for document_path in ["missing.md", "../note.md", ".hidden.md"] {
            let error = create_workspace_image_unleased_core(create_request(
                &workspace,
                document_path,
                png(10, 10),
            ))
            .unwrap_err();
            assert!(
                matches!(error.code, ErrorCode::NotFound | ErrorCode::InvalidPath),
                "{document_path}: {:?}",
                error.code
            );
        }
        assert!(!workspace.path().join("assets").exists());
    }

    #[test]
    fn rejects_invalid_or_oversized_image_input_before_creating_assets() {
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");

        let invalid = create_workspace_image_unleased_core(create_request(
            &workspace,
            "note.md",
            b"not an image".to_vec(),
        ))
        .unwrap_err();
        assert_eq!(invalid.code, ErrorCode::InvalidImage);

        let oversized = create_workspace_image_unleased_core(CreateWorkspaceImageRequest {
            workspace_root: root_string(&workspace),
            document_relative_path: "note.md".to_owned(),
            data_base64: "!".repeat(MAX_IMAGE_BASE64_CHARS + 1),
            lease_id: "oversized".to_owned(),
            session: 1,
        })
        .unwrap_err();
        assert_eq!(oversized.code, ErrorCode::FileTooLarge);
        assert!(!workspace.path().join("assets").exists());
    }

    #[test]
    fn rejects_invalid_or_non_canonical_standard_base64() {
        let workspace = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");

        for data_base64 in ["not base64!", "YQ", "____"] {
            let error = create_workspace_image_unleased_core(CreateWorkspaceImageRequest {
                workspace_root: root_string(&workspace),
                document_relative_path: "note.md".to_owned(),
                data_base64: data_base64.to_owned(),
                lease_id: "invalid-base64".to_owned(),
                session: 1,
            })
            .unwrap_err();
            assert_eq!(error.code, ErrorCode::InvalidImage, "{data_base64}");
        }
        assert!(!workspace.path().join("assets").exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_assets_directory() {
        use std::os::unix::fs::symlink;

        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        symlink(outside.path(), workspace.path().join("assets")).unwrap();

        let error = create_workspace_image_unleased_core(create_request(
            &workspace,
            "note.md",
            png(10, 10),
        ))
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::SymlinkNotAllowed);
        assert!(fs::read_dir(outside.path()).unwrap().next().is_none());
    }

    #[cfg(unix)]
    #[test]
    fn an_open_assets_capability_cannot_be_redirected_by_a_replaced_symlink() {
        use std::os::unix::fs::symlink;

        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let root = open_workspace_directory(&root_string(&workspace)).unwrap();
        let document_parent = open_document_parent(&root, Path::new("note.md")).unwrap();
        let assets = ensure_assets_directory(&document_parent).unwrap();
        let source = png(10, 10);
        let hash = format!("{:x}", Sha256::digest(&source));
        let expected_name = format!("pasted-{}.png", &hash[..20]);

        let assets_path = workspace.path().join("assets");
        let held_assets = workspace.path().join("assets-capability-held");
        fs::rename(&assets_path, &held_assets).unwrap();
        symlink(outside.path(), &assets_path).unwrap();

        let result = persist_content_addressed_image(&assets, &hash, "png", &source);
        let outside_is_empty = fs::read_dir(outside.path()).unwrap().next().is_none();
        let stored = fs::read(held_assets.join(&expected_name));

        fs::remove_file(&assets_path).unwrap();
        fs::rename(&held_assets, &assets_path).unwrap();
        let result = result.unwrap();
        assert_eq!(result.file_name, expected_name);
        assert!(!result.deduplicated);
        assert!(outside_is_empty);
        assert_eq!(stored.unwrap(), source);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_at_the_content_addressed_destination() {
        use sha2::{Digest, Sha256};
        use std::os::unix::fs::symlink;

        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        create_document_fixture(&workspace, "note.md");
        let source = png(10, 10);
        let sha256 = format!("{:x}", Sha256::digest(&source));
        let outside_file = outside.path().join("untouched.png");
        fs::write(&outside_file, b"outside").unwrap();
        let assets = workspace.path().join("assets");
        fs::create_dir(&assets).unwrap();
        symlink(
            &outside_file,
            assets.join(format!("pasted-{}.png", &sha256[..20])),
        )
        .unwrap();

        let error =
            create_workspace_image_unleased_core(create_request(&workspace, "note.md", source))
                .unwrap_err();

        assert_eq!(error.code, ErrorCode::SymlinkNotAllowed);
        assert_eq!(fs::read(outside_file).unwrap(), b"outside");
    }
}
