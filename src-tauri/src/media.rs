use crate::models::{CommandError, CommandResult, ErrorCode};
use crate::runtime::run_blocking;
use serde::Deserialize;
use std::fs::{self, File};
use std::io::{Read, Take};
use std::path::{Component, Path, PathBuf};

const MAX_IMAGE_BYTES: u64 = 24 * 1024 * 1024;
const MAX_IMAGE_DIMENSION: u32 = 16_384;
const MAX_IMAGE_PIXELS: u64 = 32_000_000;
const MAX_GIF_FRAMES: usize = 256;
const MAX_GIF_TOTAL_FRAME_PIXELS: u64 = 128_000_000;
const PAYLOAD_HEADER_LEN: usize = 14;
const PAYLOAD_MAGIC: &[u8; 4] = b"VIMG";
const PAYLOAD_VERSION: u8 = 1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadWorkspaceImageRequest {
    workspace_root: String,
    relative_path: String,
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
}

#[tauri::command]
pub async fn read_workspace_image(
    request: ReadWorkspaceImageRequest,
) -> CommandResult<tauri::ipc::Response> {
    run_blocking(move || read_workspace_image_core(request).map(tauri::ipc::Response::new)).await
}

fn read_workspace_image_core(request: ReadWorkspaceImageRequest) -> CommandResult<Vec<u8>> {
    let root = canonical_workspace(&request.workspace_root)?;
    let relative = validate_relative_image_path(&request.relative_path)?;
    ensure_no_symlink_components(&root, &relative)?;

    let candidate = root.join(&relative);
    let link_metadata = fs::symlink_metadata(&candidate)
        .map_err(|error| io_error("Could not find this image", error))?;
    if link_metadata.file_type().is_symlink() {
        return Err(CommandError::new(
            ErrorCode::SymlinkNotAllowed,
            "Symbolic links are not available in a Viva workspace.",
        ));
    }
    if !link_metadata.is_file() {
        return Err(CommandError::new(
            ErrorCode::NotFile,
            "The selected image is not a file.",
        ));
    }
    if link_metadata.len() == 0 {
        return Err(invalid_image("This image is empty."));
    }
    if link_metadata.len() > MAX_IMAGE_BYTES {
        return Err(image_too_large());
    }

    let canonical = fs::canonicalize(&candidate)
        .map_err(|error| io_error("Could not open this image", error))?;
    ensure_within_workspace(&root, &canonical)?;

    let kind = ImageKind::from_extension(&canonical).ok_or_else(unsupported_image)?;
    let mut file =
        File::open(&canonical).map_err(|error| io_error("Could not open this image", error))?;
    let mut limited: Take<&mut File> = file.by_ref().take(MAX_IMAGE_BYTES + 1);
    let mut bytes = Vec::with_capacity(link_metadata.len() as usize);
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

fn canonical_workspace(path: &str) -> CommandResult<PathBuf> {
    if path.is_empty() || !Path::new(path).is_absolute() {
        return Err(CommandError::new(
            ErrorCode::InvalidPath,
            "The workspace path must be absolute.",
        ));
    }
    let canonical =
        fs::canonicalize(path).map_err(|error| io_error("Could not open this workspace", error))?;
    if !fs::metadata(&canonical)
        .map_err(|error| io_error("Could not inspect this workspace", error))?
        .is_dir()
    {
        return Err(CommandError::new(
            ErrorCode::NotDirectory,
            "The selected workspace is not a folder.",
        ));
    }
    Ok(canonical)
}

fn validate_relative_image_path(path: &str) -> CommandResult<PathBuf> {
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
    if path.starts_with(root) {
        Ok(())
    } else {
        Err(CommandError::new(
            ErrorCode::OutsideWorkspace,
            "The selected path is outside the open workspace.",
        ))
    }
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
    use std::fs;
    use tempfile::{TempDir, tempdir};

    fn root_string(workspace: &TempDir) -> String {
        workspace.path().to_string_lossy().into_owned()
    }

    fn request(workspace: &TempDir, relative_path: &str) -> ReadWorkspaceImageRequest {
        ReadWorkspaceImageRequest {
            workspace_root: root_string(workspace),
            relative_path: relative_path.to_owned(),
        }
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
        ] {
            let error = read_workspace_image_core(request(&workspace, path)).unwrap_err();
            assert_eq!(error.code, ErrorCode::InvalidPath, "{path}");
        }
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
}
