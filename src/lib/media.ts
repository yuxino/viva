import { invoke } from "@tauri-apps/api/core";

const PAYLOAD_HEADER_LENGTH = 14;
const PAYLOAD_MAGIC = [0x56, 0x49, 0x4d, 0x47] as const;
const PAYLOAD_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 48;
const DEFAULT_MAX_BYTES = 96 * 1024 * 1024;

const mediaTypes = {
  1: "image/jpeg",
  2: "image/png",
  3: "image/webp",
  4: "image/gif",
} as const;

const supportedExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

export type WorkspaceImageMediaType = (typeof mediaTypes)[keyof typeof mediaTypes];

export interface WorkspaceImageAsset {
  height: number;
  mediaType: WorkspaceImageMediaType;
  relativePath: string;
  sizeBytes: number;
  url: string;
  width: number;
}

export interface WorkspaceImageLease extends WorkspaceImageAsset {
  release: () => void;
}

export interface RenderedWorkspaceImageReference {
  alt: string;
  remote: boolean;
  source: string;
  title?: string;
}

export interface WorkspaceImageCacheLike {
  acquire: (
    workspaceRoot: string,
    relativePath: string,
  ) => Promise<WorkspaceImageLease>;
}

interface CacheEntry {
  asset?: WorkspaceImageAsset;
  evictWhenUnused: boolean;
  lastUsed: number;
  promise: Promise<WorkspaceImageAsset>;
  references: number;
}

interface WorkspaceImageCacheOptions {
  createObjectURL?: (blob: Blob) => string;
  invokeBinary?: (workspaceRoot: string, relativePath: string) => Promise<unknown>;
  maxBytes?: number;
  maxEntries?: number;
  revokeObjectURL?: (url: string) => void;
}

function bytesFromNative(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (
    Array.isArray(value) &&
    value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)
  ) {
    return Uint8Array.from(value);
  }
  throw new Error("Viva received an invalid image response.");
}

function parseWorkspaceImagePayload(
  payload: unknown,
  relativePath: string,
  createObjectURL: (blob: Blob) => string,
): WorkspaceImageAsset {
  const bytes = bytesFromNative(payload);
  if (
    bytes.length <= PAYLOAD_HEADER_LENGTH ||
    !PAYLOAD_MAGIC.every((value, index) => bytes[index] === value) ||
    bytes[4] !== PAYLOAD_VERSION
  ) {
    throw new Error("Viva received an invalid image response.");
  }

  const kind = bytes[5] as keyof typeof mediaTypes;
  const mediaType = mediaTypes[kind];
  if (!mediaType) throw new Error("Viva received an unsupported image response.");

  const view = new DataView(bytes.buffer, bytes.byteOffset, PAYLOAD_HEADER_LENGTH);
  const width = view.getUint32(6);
  const height = view.getUint32(10);
  if (!width || !height) throw new Error("Viva received invalid image dimensions.");

  const body = Uint8Array.from(bytes.subarray(PAYLOAD_HEADER_LENGTH));
  const blob = new Blob([body.buffer], { type: mediaType });
  return {
    height,
    mediaType,
    relativePath,
    sizeBytes: body.byteLength,
    url: createObjectURL(blob),
    width,
  };
}

async function invokeWorkspaceImage(
  workspaceRoot: string,
  relativePath: string,
): Promise<unknown> {
  return invoke<ArrayBuffer>("read_workspace_image", {
    request: { workspaceRoot, relativePath },
  });
}

function cacheKey(workspaceRoot: string, relativePath: string): string {
  return `${workspaceRoot}\u0000${relativePath}`;
}

export function resolveLocalImagePath(
  documentRelativePath: string,
  source: string,
): string | null {
  const raw = source.trim();
  if (
    !raw ||
    raw.startsWith("#") ||
    raw.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(raw)
  ) {
    return null;
  }

  const pathOnly = raw.split(/[?#]/, 1)[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly).replaceAll("\\", "/");
  } catch {
    return null;
  }
  if (
    !decoded ||
    decoded.includes("\u0000") ||
    decoded.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(decoded)
  ) {
    return null;
  }

  const parts = decoded.startsWith("/")
    ? []
    : documentRelativePath.replaceAll("\\", "/").split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  const relativePath = parts.join("/");
  const extension = relativePath.split(".").pop()?.toLocaleLowerCase() ?? "";
  return relativePath && supportedExtensions.has(extension) ? relativePath : null;
}

export function isRemoteOrEmbeddedImage(source: string): boolean {
  const raw = source.trim();
  return raw.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(raw);
}

export function readRenderedWorkspaceImageReference(
  element: HTMLElement,
): RenderedWorkspaceImageReference | null {
  const source = element.dataset.imageSrc;
  if (source === undefined) return null;
  const title = element.dataset.imageTitle;
  return {
    alt: element.dataset.imageAlt ?? "",
    remote: isRemoteOrEmbeddedImage(source),
    source,
    ...(title === undefined ? {} : { title }),
  };
}

export class WorkspaceImageCache implements WorkspaceImageCacheLike {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #createObjectURL: (blob: Blob) => string;
  readonly #invokeBinary: (
    workspaceRoot: string,
    relativePath: string,
  ) => Promise<unknown>;
  readonly #maxBytes: number;
  readonly #maxEntries: number;
  readonly #revokeObjectURL: (url: string) => void;
  #clock = 0;

  constructor(options: WorkspaceImageCacheOptions = {}) {
    this.#createObjectURL =
      options.createObjectURL ?? ((blob) => URL.createObjectURL(blob));
    this.#invokeBinary = options.invokeBinary ?? invokeWorkspaceImage;
    this.#maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_MAX_BYTES);
    this.#maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.#revokeObjectURL =
      options.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url));
  }

  async acquire(
    workspaceRoot: string,
    relativePath: string,
  ): Promise<WorkspaceImageLease> {
    if (!workspaceRoot || !relativePath) {
      throw new Error("Choose a workspace image.");
    }

    const key = cacheKey(workspaceRoot, relativePath);
    let entry = this.#entries.get(key);
    if (!entry) {
      const promise = this.#invokeBinary(workspaceRoot, relativePath).then((payload) =>
        parseWorkspaceImagePayload(payload, relativePath, this.#createObjectURL),
      );
      entry = {
        evictWhenUnused: false,
        lastUsed: ++this.#clock,
        promise,
        references: 0,
      };
      this.#entries.set(key, entry);
      void promise
        .then((asset) => {
          entry!.asset = asset;
          this.#trim();
        })
        .catch(() => {
          if (this.#entries.get(key) === entry) this.#entries.delete(key);
        });
    }

    entry.references += 1;
    entry.lastUsed = ++this.#clock;
    let asset: WorkspaceImageAsset;
    try {
      asset = await entry.promise;
    } catch (error) {
      entry.references = Math.max(0, entry.references - 1);
      throw error;
    }

    let released = false;
    return {
      ...asset,
      release: () => {
        if (released) return;
        released = true;
        entry!.references = Math.max(0, entry!.references - 1);
        entry!.lastUsed = ++this.#clock;
        if (entry!.evictWhenUnused && entry!.references === 0) {
          this.#revoke(entry!);
        } else {
          this.#trim();
        }
      },
    };
  }

  clear(workspaceRoot?: string): void {
    const prefix = workspaceRoot ? `${workspaceRoot}\u0000` : null;
    for (const [key, entry] of this.#entries) {
      if (prefix && !key.startsWith(prefix)) continue;
      this.#entries.delete(key);
      entry.evictWhenUnused = true;
      if (entry.references === 0 && entry.asset) this.#revoke(entry);
    }
  }

  invalidate(workspaceRoot: string, relativePath: string): void {
    const key = cacheKey(workspaceRoot, relativePath);
    const entry = this.#entries.get(key);
    if (!entry) return;
    this.#entries.delete(key);
    entry.evictWhenUnused = true;
    if (entry.references === 0 && entry.asset) this.#revoke(entry);
  }

  #revoke(entry: CacheEntry): void {
    if (!entry.asset) return;
    this.#revokeObjectURL(entry.asset.url);
    entry.asset = undefined;
  }

  #trim(): void {
    const liveEntries = [...this.#entries.entries()];
    let totalBytes = liveEntries.reduce(
      (total, [, entry]) => total + (entry.asset?.sizeBytes ?? 0),
      0,
    );
    let totalEntries = liveEntries.length;
    if (totalEntries <= this.#maxEntries && totalBytes <= this.#maxBytes) return;

    const candidates = liveEntries
      .filter(([, entry]) => entry.references === 0 && entry.asset)
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
    for (const [key, entry] of candidates) {
      if (totalEntries <= this.#maxEntries && totalBytes <= this.#maxBytes) break;
      this.#entries.delete(key);
      totalEntries -= 1;
      totalBytes -= entry.asset?.sizeBytes ?? 0;
      this.#revoke(entry);
    }
  }
}

export const workspaceImageCache = new WorkspaceImageCache();
