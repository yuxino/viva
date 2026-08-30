import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  DocumentSnapshot,
  FileKind,
  FileRevision,
  WorkspaceTree,
} from "../domain/workspace";
import type { TranslationKey } from "../i18n";

export interface SearchMatch {
  relativePath: string;
  line: number;
  column: number;
  preview: string;
}

export interface DocumentHistoryEntry {
  versionId: string;
  createdAtMs: number;
  sizeBytes: number;
}

export interface DocumentHistorySnapshot extends DocumentHistoryEntry {
  relativePath: string;
  name: string;
  content: string;
}

interface OpenWorkspaceRequest {
  path: string;
}

interface DocumentRequest {
  workspaceRoot: string;
  relativePath: string;
}

interface WriteDocumentRequest extends DocumentRequest {
  content: string;
  expectedRevision: FileRevision;
}

interface CreateDocumentRequest extends DocumentRequest {
  content?: string;
}

interface CreateWorkspaceDirectoryRequest {
  workspaceRoot: string;
  parentRelativePath: string;
  name: string;
}

export interface ExpectedDocumentRevision {
  relativePath: string;
  revision: FileRevision;
}

interface RenameWorkspaceEntryRequest extends DocumentRequest {
  newName: string;
  expectedDocuments: ExpectedDocumentRevision[];
}

interface DuplicateWorkspaceEntryRequest extends DocumentRequest {
  expectedRevision?: FileRevision;
}

interface TrashWorkspaceEntryRequest extends DocumentRequest {
  expectedDocuments: ExpectedDocumentRevision[];
}

export interface WorkspaceEntryMutation {
  kind: FileKind;
  sourceRelativePath?: string;
  destinationRelativePath?: string;
  recoverable: boolean;
  historyWarningCode?: "HISTORY_UNAVAILABLE";
}

interface SaveDocumentAsRequest {
  workspaceRoot: string;
  destinationPath: string;
  content: string;
  expectedDestinationRevision?: FileRevision;
}

interface InspectSaveDestinationRequest {
  workspaceRoot: string;
  destinationPath: string;
}

export interface SaveDestinationState {
  relativePath: string;
  revision?: FileRevision;
}

interface SearchWorkspaceRequest {
  workspaceRoot: string;
  query: string;
  maxResults?: number;
}

interface CreateWorkspaceImageRequest {
  workspaceRoot: string;
  documentRelativePath: string;
  dataBase64: string;
  leaseId: string;
  session: number;
}

interface SettleWorkspaceImageRequest {
  workspaceRoot: string;
  leaseId: string;
  session: number;
}

export interface CreatedWorkspaceImage {
  relativePath: string;
  markdownPath: string;
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
  deduplicated: boolean;
}

interface ReadDocumentHistoryRequest extends DocumentRequest {
  versionId: string;
}

export function hasNativeShell(): boolean {
  return isTauri();
}

let lastNativeStateSequence = 0;
let nativeStateSessionPromise: Promise<number> | undefined;

function nextNativeStateSequence(): number {
  if (lastNativeStateSequence >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Viva's native state sequence is exhausted.");
  }
  lastNativeStateSequence += 1;
  return lastNativeStateSequence;
}

function getNativeStateSession(): Promise<number> {
  nativeStateSessionPromise ??= invoke<number>("get_quit_guard_session");
  return nativeStateSessionPromise;
}

async function withNativeStateSession<T>(
  operation: (session: number) => Promise<T>,
): Promise<T> {
  const sessionPromise = getNativeStateSession();
  try {
    return await operation(await sessionPromise);
  } catch (error) {
    if (nativeStateSessionPromise === sessionPromise) {
      nativeStateSessionPromise = undefined;
    }
    throw error;
  }
}

async function setNativeBooleanState(
  command: "set_quit_guard_ready" | "set_has_unsaved_changes",
  key: "ready" | "dirty",
  value: boolean,
): Promise<boolean> {
  const sequence = nextNativeStateSequence();
  return withNativeStateSession((session) =>
    invoke<boolean>(command, {
      [key]: value,
      session,
      sequence,
    }),
  );
}

export function setQuitGuardReady(ready: boolean): Promise<boolean> {
  return setNativeBooleanState("set_quit_guard_ready", "ready", ready);
}

export function confirmApplicationQuit(): Promise<void> {
  return invoke("confirm_application_quit");
}

export function cancelApplicationQuit(): Promise<void> {
  return invoke("cancel_application_quit");
}

export function setHasUnsavedChanges(dirty: boolean): Promise<boolean> {
  return setNativeBooleanState("set_has_unsaved_changes", "dirty", dirty);
}

export function openNewWindow(): Promise<void> {
  return invoke("open_new_window");
}

export function isFreshWindow(): Promise<boolean> {
  return invoke("is_fresh_window");
}

export function setNativeMenuLanguage(
  language: "en" | "zh-Hans",
): Promise<void> {
  return invoke("set_menu_language", { language });
}

export async function chooseWorkspace(
  title = "Open a Markdown folder",
): Promise<string | null> {
  const result = await open({
    directory: true,
    multiple: false,
    title,
  });
  return typeof result === "string" ? result : null;
}

export async function chooseSavePath(
  workspaceRoot: string,
  suggestedName: string,
  title = "Save Markdown as",
  filterName = "Markdown",
): Promise<string | null> {
  const separator = workspaceRoot.includes("\\") ? "\\" : "/";
  return save({
    title,
    defaultPath: `${workspaceRoot}${separator}${suggestedName}`,
    filters: [{ name: filterName, extensions: ["md", "markdown", "mdx"] }],
  });
}

export function openWorkspace(path: string): Promise<WorkspaceTree> {
  const request: OpenWorkspaceRequest = { path };
  return invoke("open_workspace", { request });
}

export function readDocument(
  workspaceRoot: string,
  relativePath: string,
): Promise<DocumentSnapshot> {
  const request: DocumentRequest = { workspaceRoot, relativePath };
  return invoke("read_document", { request });
}

export function writeDocument(
  workspaceRoot: string,
  document: DocumentSnapshot,
): Promise<DocumentSnapshot> {
  const request: WriteDocumentRequest = {
    workspaceRoot,
    relativePath: document.relativePath,
    content: document.content,
    expectedRevision: document.revision,
  };
  return invoke("write_document", { request });
}

export function createDocument(
  workspaceRoot: string,
  relativePath: string,
  content?: string,
): Promise<DocumentSnapshot> {
  const request: CreateDocumentRequest = { workspaceRoot, relativePath };
  if (content !== undefined) request.content = content;
  return invoke("create_document", { request });
}

export function createWorkspaceDirectory(
  workspaceRoot: string,
  parentRelativePath: string,
  name: string,
): Promise<WorkspaceEntryMutation> {
  const request: CreateWorkspaceDirectoryRequest = {
    workspaceRoot,
    parentRelativePath,
    name,
  };
  return invoke("create_workspace_directory", { request });
}

export function renameWorkspaceEntry(
  workspaceRoot: string,
  relativePath: string,
  newName: string,
  expectedDocuments: readonly ExpectedDocumentRevision[] = [],
): Promise<WorkspaceEntryMutation> {
  const request: RenameWorkspaceEntryRequest = {
    workspaceRoot,
    relativePath,
    newName,
    expectedDocuments: [...expectedDocuments],
  };
  return invoke("rename_workspace_entry", { request });
}

export function duplicateWorkspaceEntry(
  workspaceRoot: string,
  relativePath: string,
  expectedRevision?: FileRevision,
): Promise<WorkspaceEntryMutation> {
  const request: DuplicateWorkspaceEntryRequest = {
    workspaceRoot,
    relativePath,
  };
  if (expectedRevision !== undefined) request.expectedRevision = expectedRevision;
  return invoke("duplicate_workspace_entry", { request });
}

export function trashWorkspaceEntry(
  workspaceRoot: string,
  relativePath: string,
  expectedDocuments: readonly ExpectedDocumentRevision[] = [],
): Promise<WorkspaceEntryMutation> {
  const request: TrashWorkspaceEntryRequest = {
    workspaceRoot,
    relativePath,
    expectedDocuments: [...expectedDocuments],
  };
  return invoke("trash_workspace_entry", { request });
}

export function saveDocumentAs(
  workspaceRoot: string,
  destinationPath: string,
  content: string,
  expectedDestinationRevision?: FileRevision,
): Promise<DocumentSnapshot> {
  const request: SaveDocumentAsRequest = {
    workspaceRoot,
    destinationPath,
    content,
    expectedDestinationRevision,
  };
  return invoke("save_document_as", { request });
}

export function inspectSaveDestination(
  workspaceRoot: string,
  destinationPath: string,
): Promise<SaveDestinationState> {
  const request: InspectSaveDestinationRequest = {
    workspaceRoot,
    destinationPath,
  };
  return invoke("inspect_save_destination", { request });
}

export function searchWorkspace(
  workspaceRoot: string,
  query: string,
  maxResults = 100,
): Promise<SearchMatch[]> {
  const request: SearchWorkspaceRequest = { workspaceRoot, query, maxResults };
  return invoke("search_workspace", { request });
}

export const MAX_WORKSPACE_IMAGE_BYTES = 24 * 1024 * 1024;

// A multiple of three keeps padding exclusive to the final Base64 chunk.
const BASE64_CHUNK_BYTES = 3 * 8_192;

export function assertWorkspaceImageSize(sizeBytes: number): void {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new RangeError("The pasted image size is not valid.");
  }
  if (sizeBytes > MAX_WORKSPACE_IMAGE_BYTES) {
    throw new RangeError("Pasted images are limited to 24 MiB.");
  }
}

export function encodeStandardBase64(bytes: Uint8Array): string {
  assertWorkspaceImageSize(bytes.byteLength);
  const encodedChunks: string[] = [];

  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_CHUNK_BYTES) {
    const chunk = bytes.subarray(
      offset,
      Math.min(offset + BASE64_CHUNK_BYTES, bytes.byteLength),
    );
    let binary = "";
    for (let index = 0; index < chunk.byteLength; index += 1) {
      binary += String.fromCharCode(chunk[index] ?? 0);
    }
    encodedChunks.push(btoa(binary));
  }

  return encodedChunks.join("");
}

export async function createWorkspaceImage(
  workspaceRoot: string,
  documentRelativePath: string,
  bytes: Uint8Array,
  leaseId: string,
): Promise<CreatedWorkspaceImage> {
  assertWorkspaceImageSize(bytes.byteLength);
  const dataBase64 = encodeStandardBase64(bytes);
  return withNativeStateSession((session) => {
    const request: CreateWorkspaceImageRequest = {
      workspaceRoot,
      documentRelativePath,
      dataBase64,
      leaseId,
      session,
    };
    return invoke("create_workspace_image", { request });
  });
}

function settleWorkspaceImage(
  command: "commit_workspace_image" | "cancel_workspace_image",
  workspaceRoot: string,
  leaseId: string,
): Promise<void> {
  return withNativeStateSession((session) => {
    const request: SettleWorkspaceImageRequest = {
      workspaceRoot,
      leaseId,
      session,
    };
    return invoke(command, { request });
  });
}

export function commitWorkspaceImage(
  workspaceRoot: string,
  leaseId: string,
): Promise<void> {
  return settleWorkspaceImage("commit_workspace_image", workspaceRoot, leaseId);
}

export function cancelWorkspaceImage(
  workspaceRoot: string,
  leaseId: string,
): Promise<void> {
  return settleWorkspaceImage("cancel_workspace_image", workspaceRoot, leaseId);
}

export function listDocumentHistory(
  workspaceRoot: string,
  relativePath: string,
): Promise<DocumentHistoryEntry[]> {
  const request: DocumentRequest = { workspaceRoot, relativePath };
  return invoke("list_document_history", { request });
}

export function readDocumentHistory(
  workspaceRoot: string,
  relativePath: string,
  versionId: string,
): Promise<DocumentHistorySnapshot> {
  const request: ReadDocumentHistoryRequest = {
    workspaceRoot,
    relativePath,
    versionId,
  };
  return invoke("read_document_history", { request });
}

export async function openExternalUrl(href: string): Promise<void> {
  const url = new URL(href);
  if (!["https:", "http:", "mailto:"].includes(url.protocol)) {
    throw new Error("Viva only opens web and email links.");
  }
  await openUrl(url.toString());
}

export function revealWorkspaceItem(
  workspaceRoot: string,
  relativePath: string,
): Promise<void> {
  const separator = workspaceRoot.includes("\\") ? "\\" : "/";
  const normalizedRelativePath = relativePath
    .split(/[\\/]+/u)
    .filter(Boolean)
    .join(separator);
  return revealItemInDir(
    `${workspaceRoot.replace(/[\\/]+$/u, "")}${separator}${normalizedRelativePath}`,
  );
}

type NativeErrorTranslator = (key: TranslationKey) => string;

const nativeErrorMessages: Readonly<Record<string, TranslationKey>> = {
  INVALID_PATH: "Choose a valid path inside the open workspace.",
  OUTSIDE_WORKSPACE: "That path is outside the open workspace.",
  SYMLINK_NOT_ALLOWED: "Symbolic links are not available in a Viva workspace.",
  UNSUPPORTED_FILE_TYPE: "This file type is not supported.",
  NOT_FOUND: "That file could not be found.",
  NOT_DIRECTORY: "Choose a folder.",
  NOT_FILE: "Choose a file.",
  FILE_TOO_LARGE: "This file is too large.",
  INVALID_UTF8: "Viva can only open UTF-8 text documents.",
  ALREADY_EXISTS: "A file already exists at this location.",
  CONFLICT: "This file changed outside Viva. Review it and try again.",
  WORKSPACE_TOO_LARGE: "This workspace is too large to open safely.",
  INVALID_QUERY: "Enter a valid search.",
  INVALID_VERSION_ID: "That saved version is not valid.",
  HISTORY_CORRUPT: "This local history entry is damaged.",
  INVALID_IMAGE:
    "This image is not valid or uses an unsupported animation format.",
  IO: "Viva could not complete the file operation.",
};

export function describeNativeError(
  error: unknown,
  translate?: NativeErrorTranslator,
): string {
  if (translate && error && typeof error === "object" && "code" in error) {
    const code = typeof error.code === "string" ? error.code : "";
    const key = nativeErrorMessages[code];
    if (key) return translate(key);
  }
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return translate
    ? translate("Viva could not complete that action.")
    : "Viva could not complete that action.";
}
