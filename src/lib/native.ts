import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  DocumentSnapshot,
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

async function setNativeBooleanState(
  command: "set_quit_guard_ready" | "set_has_unsaved_changes",
  key: "ready" | "dirty",
  value: boolean,
): Promise<boolean> {
  const sessionPromise = getNativeStateSession();
  const sequence = nextNativeStateSequence();
  try {
    const session = await sessionPromise;
    return await invoke<boolean>(command, {
      [key]: value,
      session,
      sequence,
    });
  } catch (error) {
    if (nativeStateSessionPromise === sessionPromise) {
      nativeStateSessionPromise = undefined;
    }
    throw error;
  }
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
