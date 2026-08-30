use serde::{Deserialize, Serialize};
use std::fmt;

pub(crate) type CommandResult<T> = Result<T, CommandError>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenWorkspaceRequest {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentPathRequest {
    pub workspace_root: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteDocumentRequest {
    pub workspace_root: String,
    pub relative_path: String,
    pub content: String,
    pub line_ending: LineEnding,
    pub expected_revision: FileRevision,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateDocumentRequest {
    pub workspace_root: String,
    pub relative_path: String,
    #[serde(default)]
    pub content: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateWorkspaceDirectoryRequest {
    pub workspace_root: String,
    #[serde(default)]
    pub parent_relative_path: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExpectedDocumentRevision {
    pub relative_path: String,
    pub revision: FileRevision,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameWorkspaceEntryRequest {
    pub workspace_root: String,
    pub relative_path: String,
    pub new_name: String,
    #[serde(default)]
    pub expected_documents: Vec<ExpectedDocumentRevision>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DuplicateWorkspaceEntryRequest {
    pub workspace_root: String,
    pub relative_path: String,
    #[serde(default)]
    pub expected_revision: Option<FileRevision>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrashWorkspaceEntryRequest {
    pub workspace_root: String,
    pub relative_path: String,
    #[serde(default)]
    pub expected_documents: Vec<ExpectedDocumentRevision>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveDocumentAsRequest {
    pub workspace_root: String,
    pub destination_path: String,
    pub content: String,
    pub line_ending: LineEnding,
    #[serde(default)]
    pub expected_destination_revision: Option<FileRevision>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InspectSaveDestinationRequest {
    pub workspace_root: String,
    pub destination_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDestinationState {
    pub relative_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<FileRevision>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchWorkspaceRequest {
    pub workspace_root: String,
    pub query: String,
    #[serde(default)]
    pub max_results: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListDocumentHistoryRequest {
    pub workspace_root: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadDocumentHistoryRequest {
    pub workspace_root: String,
    pub relative_path: String,
    pub version_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTree {
    pub root_path: String,
    pub name: String,
    pub children: Vec<WorkspaceEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub name: String,
    pub relative_path: String,
    pub kind: WorkspaceEntryKind,
    pub children: Vec<WorkspaceEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceEntryKind {
    Directory,
    File,
    Image,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntryMutation {
    pub kind: WorkspaceEntryKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_relative_path: Option<String>,
    pub recoverable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history_warning_code: Option<HistoryWarningCode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRevision {
    pub modified_at_ms: u64,
    pub size_bytes: u64,
    #[serde(default)]
    pub content_sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub relative_path: String,
    pub name: String,
    pub content: String,
    pub line_ending: LineEnding,
    pub revision: FileRevision,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history_warning_code: Option<HistoryWarningCode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
}

impl LineEnding {
    pub(crate) fn detect(content: &str) -> Self {
        let bytes = content.as_bytes();
        let mut saw_line_break = false;
        let mut index = 0;
        while index < bytes.len() {
            match bytes[index] {
                b'\r' if bytes.get(index + 1) == Some(&b'\n') => {
                    saw_line_break = true;
                    index += 2;
                }
                b'\r' | b'\n' => return Self::Lf,
                _ => index += 1,
            }
        }
        if saw_line_break { Self::Crlf } else { Self::Lf }
    }

    pub(crate) fn normalize(content: &str) -> String {
        if !content.contains('\r') {
            return content.to_owned();
        }

        let mut normalized = String::with_capacity(content.len());
        let mut characters = content.chars().peekable();
        while let Some(character) = characters.next() {
            if character == '\r' {
                if characters.peek() == Some(&'\n') {
                    characters.next();
                }
                normalized.push('\n');
            } else {
                normalized.push(character);
            }
        }
        normalized
    }

    pub(crate) fn encode(self, content: &str) -> String {
        let normalized = Self::normalize(content);
        match self {
            Self::Lf => normalized,
            Self::Crlf => normalized.replace('\n', "\r\n"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HistoryWarningCode {
    HistoryUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentHistoryEntry {
    pub version_id: String,
    pub created_at_ms: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentHistorySnapshot {
    pub version_id: String,
    pub relative_path: String,
    pub name: String,
    pub content: String,
    pub line_ending: LineEnding,
    pub created_at_ms: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub relative_path: String,
    pub line: usize,
    pub column: usize,
    pub preview: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidPath,
    OutsideWorkspace,
    SymlinkNotAllowed,
    UnsupportedFileType,
    NotFound,
    NotDirectory,
    NotFile,
    FileTooLarge,
    InvalidUtf8,
    AlreadyExists,
    Conflict,
    WorkspaceTooLarge,
    InvalidQuery,
    InvalidVersionId,
    HistoryCorrupt,
    InvalidImage,
    Io,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: ErrorCode,
    pub message: String,
}

impl CommandError {
    pub(crate) fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CommandError {}
