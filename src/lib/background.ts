export const BUILTIN_BACKGROUND_URL = "/art/viva-editor-background.jpg";
export const BACKGROUND_SETTINGS_KEY = "viva.background.settings.v1";

export const MAX_SOURCE_IMAGE_BYTES = 24 * 1024 * 1024;
export const MAX_STORED_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_PIXELS = 64_000_000;
export const MAX_SOURCE_IMAGE_DIMENSION = 16_384;
export const MAX_BACKGROUND_PIXELS = 12_000_000;
export const MAX_BACKGROUND_DIMENSION = 3_840;
export const MAX_BACKGROUND_OPACITY = 0.28;
export const MAX_BACKGROUND_BLUR = 24;

const DATABASE_NAME = "viva-appearance";
const DATABASE_VERSION = 1;
const IMAGE_STORE_NAME = "background-images";
const CUSTOM_IMAGE_KEY = "active-custom-background";

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type BackgroundSource = "none" | "viva" | "custom";
export type BackgroundFit = "cover" | "contain";
export type BackgroundPosition =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

export interface BackgroundImageMetadata {
  bytes: number;
  height: number;
  id: string;
  mediaType: "image/jpeg" | "image/webp";
  name: string;
  updatedAt: number;
  width: number;
}

export interface BackgroundSettings {
  blur: number;
  customImage: BackgroundImageMetadata | null;
  fit: BackgroundFit;
  opacity: number;
  position: BackgroundPosition;
  source: BackgroundSource;
  version: 1;
}

export interface BackgroundAsset {
  revoke: () => void;
  url: string;
}

export interface ProcessedBackgroundImage {
  blob: Blob;
  metadata: BackgroundImageMetadata;
}

export interface ImageSize {
  height: number;
  width: number;
}

export type BackgroundErrorCode =
  | "empty-file"
  | "unsupported-type"
  | "source-too-large"
  | "unsafe-dimensions"
  | "invalid-image"
  | "encoded-too-large"
  | "storage-unavailable"
  | "storage-failed"
  | "image-missing";

export class BackgroundError extends Error {
  readonly code: BackgroundErrorCode;

  constructor(code: BackgroundErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BackgroundError";
    this.code = code;
  }
}

export type SettingsStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

interface StoredBackgroundRecord {
  blob: Blob;
  key: string;
  metadata: BackgroundImageMetadata;
}

interface DecodedImage {
  close: () => void;
  height: number;
  source: CanvasImageSource;
  width: number;
}

export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = Object.freeze({
  blur: 0,
  customImage: null,
  fit: "cover",
  opacity: 0.12,
  position: "center",
  source: "viva",
  version: 1,
});

function browserStorage(): SettingsStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function browserIndexedDb(): IDBFactory | null {
  try {
    return typeof indexedDB === "undefined" ? null : indexedDB;
  } catch {
    return null;
  }
}

function browserObjectUrlFactory(): Pick<
  typeof URL,
  "createObjectURL" | "revokeObjectURL"
> | null {
  return typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
    ? URL
    : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isSource(value: unknown): value is BackgroundSource {
  return value === "none" || value === "viva" || value === "custom";
}

function isFit(value: unknown): value is BackgroundFit {
  return value === "cover" || value === "contain";
}

function isPosition(value: unknown): value is BackgroundPosition {
  return (
    value === "top-left" ||
    value === "top" ||
    value === "top-right" ||
    value === "left" ||
    value === "center" ||
    value === "right" ||
    value === "bottom-left" ||
    value === "bottom" ||
    value === "bottom-right"
  );
}

function normalizeMetadata(value: unknown): BackgroundImageMetadata | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<BackgroundImageMetadata>;
  if (
    typeof input.id !== "string" ||
    !input.id ||
    typeof input.name !== "string" ||
    (input.mediaType !== "image/webp" && input.mediaType !== "image/jpeg")
  ) {
    return null;
  }

  const width = Math.round(finiteNumber(input.width, 0));
  const height = Math.round(finiteNumber(input.height, 0));
  const bytes = Math.round(finiteNumber(input.bytes, 0));
  const updatedAt = Math.round(finiteNumber(input.updatedAt, 0));
  if (width <= 0 || height <= 0 || bytes <= 0 || updatedAt <= 0) return null;

  return {
    bytes,
    height,
    id: input.id.slice(0, 96),
    mediaType: input.mediaType,
    name: input.name.slice(0, 160),
    updatedAt,
    width,
  };
}

export function normalizeBackgroundSettings(
  value: unknown,
): BackgroundSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_BACKGROUND_SETTINGS };
  }

  const input = value as Partial<BackgroundSettings>;
  const customImage = normalizeMetadata(input.customImage);
  const requestedSource = isSource(input.source)
    ? input.source
    : DEFAULT_BACKGROUND_SETTINGS.source;

  return {
    blur: clamp(
      finiteNumber(input.blur, DEFAULT_BACKGROUND_SETTINGS.blur),
      0,
      MAX_BACKGROUND_BLUR,
    ),
    customImage,
    fit: isFit(input.fit) ? input.fit : DEFAULT_BACKGROUND_SETTINGS.fit,
    opacity: clamp(
      finiteNumber(input.opacity, DEFAULT_BACKGROUND_SETTINGS.opacity),
      0,
      MAX_BACKGROUND_OPACITY,
    ),
    position: isPosition(input.position)
      ? input.position
      : DEFAULT_BACKGROUND_SETTINGS.position,
    source: requestedSource === "custom" && !customImage ? "none" : requestedSource,
    version: 1,
  };
}

export function loadBackgroundSettings(
  storage: SettingsStorage | null = browserStorage(),
): BackgroundSettings {
  if (!storage) return { ...DEFAULT_BACKGROUND_SETTINGS };
  try {
    const serialized = storage.getItem(BACKGROUND_SETTINGS_KEY);
    if (!serialized) return { ...DEFAULT_BACKGROUND_SETTINGS };
    return normalizeBackgroundSettings(JSON.parse(serialized) as unknown);
  } catch {
    return { ...DEFAULT_BACKGROUND_SETTINGS };
  }
}

export function saveBackgroundSettings(
  settings: BackgroundSettings,
  storage: SettingsStorage | null = browserStorage(),
): BackgroundSettings {
  const normalized = normalizeBackgroundSettings(settings);
  if (!storage) {
    throw new BackgroundError(
      "storage-unavailable",
      "Appearance preferences cannot be saved in this environment.",
    );
  }
  try {
    storage.setItem(BACKGROUND_SETTINGS_KEY, JSON.stringify(normalized));
    return normalized;
  } catch (error) {
    throw new BackgroundError(
      "storage-failed",
      "Viva could not save the background settings.",
      { cause: error },
    );
  }
}

export function clearBackgroundSettings(
  storage: SettingsStorage | null = browserStorage(),
): void {
  if (!storage) {
    throw new BackgroundError(
      "storage-unavailable",
      "Appearance preferences cannot be reset in this environment.",
    );
  }
  try {
    storage.removeItem(BACKGROUND_SETTINGS_KEY);
  } catch (error) {
    throw new BackgroundError(
      "storage-failed",
      "Viva could not reset the background settings.",
      { cause: error },
    );
  }
}

function mimeTypeFromFile(file: Pick<File, "name" | "type">): string {
  const declared = file.type.toLocaleLowerCase();
  if (declared) return declared;
  const extension = file.name.split(".").pop()?.toLocaleLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "";
}

export function validateBackgroundFile(
  file: Pick<File, "name" | "size" | "type">,
): string {
  if (file.size <= 0) {
    throw new BackgroundError("empty-file", "Choose a non-empty image file.");
  }
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new BackgroundError(
      "source-too-large",
      "The image is larger than 24 MiB. Choose a smaller image.",
    );
  }
  const mediaType = mimeTypeFromFile(file);
  if (!SUPPORTED_IMAGE_TYPES.has(mediaType)) {
    throw new BackgroundError(
      "unsupported-type",
      "Use a JPEG, PNG, or WebP image.",
    );
  }
  return mediaType;
}

export function calculateBackgroundSize(
  width: number,
  height: number,
): ImageSize {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_SOURCE_IMAGE_DIMENSION ||
    height > MAX_SOURCE_IMAGE_DIMENSION ||
    width * height > MAX_SOURCE_IMAGE_PIXELS
  ) {
    throw new BackgroundError(
      "unsafe-dimensions",
      "The image dimensions are too large to use safely.",
    );
  }

  const dimensionScale = Math.min(1, MAX_BACKGROUND_DIMENSION / Math.max(width, height));
  const pixelScale = Math.min(1, Math.sqrt(MAX_BACKGROUND_PIXELS / (width * height)));
  const scale = Math.min(dimensionScale, pixelScale);

  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
}

async function decodeWithImageElement(file: Blob): Promise<DecodedImage> {
  const urlFactory = browserObjectUrlFactory();
  if (!urlFactory || typeof Image === "undefined") {
    throw new BackgroundError(
      "invalid-image",
      "This environment cannot decode the selected image.",
    );
  }

  const url = urlFactory.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image decoding failed."));
      image.src = url;
    });
  } catch (error) {
    urlFactory.revokeObjectURL(url);
    throw new BackgroundError(
      "invalid-image",
      "Viva could not decode the selected image.",
      { cause: error },
    );
  }

  return {
    close: () => urlFactory.revokeObjectURL(url),
    height: image.naturalHeight,
    source: image,
    width: image.naturalWidth,
  };
}

async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        close: () => bitmap.close(),
        height: bitmap.height,
        source: bitmap,
        width: bitmap.width,
      };
    } catch {
      // WebKit may support the source format through <img> but not ImageBitmap.
    }
  }
  return decodeWithImageElement(file);
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mediaType: "image/jpeg" | "image/webp",
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas encoding returned no data."));
      },
      mediaType,
      quality,
    );
  });
}

function encodedName(
  name: string,
  mediaType: BackgroundImageMetadata["mediaType"],
): string {
  const base = name.replace(/\.[^.]+$/, "").trim() || "Viva background";
  const extension = mediaType === "image/webp" ? "webp" : "jpg";
  return `${base.slice(0, 154)}.${extension}`;
}

function drawDecodedImage(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  decoded: DecodedImage,
  width: number,
  height: number,
): void {
  canvas.width = width;
  canvas.height = height;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, width, height);
  context.drawImage(decoded.source, 0, 0, width, height);
}

async function encodeCanvas(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
): Promise<{ blob: Blob; mediaType: BackgroundImageMetadata["mediaType"] }> {
  const webp = await canvasToBlob(canvas, "image/webp", 0.86);
  if (webp.type.toLocaleLowerCase() === "image/webp") {
    if (webp.size <= MAX_STORED_IMAGE_BYTES) {
      return { blob: webp, mediaType: "image/webp" };
    }
    const compressed = await canvasToBlob(canvas, "image/webp", 0.7);
    if (compressed.type.toLocaleLowerCase() === "image/webp") {
      return { blob: compressed, mediaType: "image/webp" };
    }
  }

  context.save();
  context.globalCompositeOperation = "destination-over";
  context.fillStyle = "#f7f3ec";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
  let jpeg = await canvasToBlob(canvas, "image/jpeg", 0.86);
  if (jpeg.type.toLocaleLowerCase() !== "image/jpeg") {
    throw new Error("Canvas JPEG encoding is unavailable.");
  }
  if (jpeg.size > MAX_STORED_IMAGE_BYTES) {
    jpeg = await canvasToBlob(canvas, "image/jpeg", 0.68);
  }
  if (jpeg.type.toLocaleLowerCase() !== "image/jpeg") {
    throw new Error("Canvas JPEG encoding is unavailable.");
  }
  return { blob: jpeg, mediaType: "image/jpeg" };
}

export async function processBackgroundImage(
  file: File,
): Promise<ProcessedBackgroundImage> {
  validateBackgroundFile(file);
  const decoded = await decodeImage(file);

  try {
    const size = calculateBackgroundSize(decoded.width, decoded.height);
    if (typeof document === "undefined") {
      throw new BackgroundError(
        "invalid-image",
        "This environment cannot prepare the selected image.",
      );
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      throw new BackgroundError(
        "invalid-image",
        "Viva could not prepare the selected image.",
      );
    }

    let width = size.width;
    let height = size.height;
    let encoded:
      | { blob: Blob; mediaType: BackgroundImageMetadata["mediaType"] }
      | undefined;
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        drawDecodedImage(canvas, context, decoded, width, height);
        encoded = await encodeCanvas(canvas, context);
        if (encoded.blob.size <= MAX_STORED_IMAGE_BYTES) break;
        width = Math.max(1, Math.round(width * 0.78));
        height = Math.max(1, Math.round(height * 0.78));
      }
    } catch (error) {
      throw new BackgroundError(
        "invalid-image",
        "Viva could not compress the selected image.",
        { cause: error },
      );
    }

    if (!encoded || encoded.blob.size > MAX_STORED_IMAGE_BYTES) {
      throw new BackgroundError(
        "encoded-too-large",
        "The prepared background is still larger than 8 MiB. Choose a simpler image.",
      );
    }

    const updatedAt = Date.now();
    const uniqueId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${updatedAt}-${Math.random().toString(36).slice(2, 10)}`;
    return {
      blob: encoded.blob,
      metadata: {
        bytes: encoded.blob.size,
        height,
        id: `custom-${uniqueId}`,
        mediaType: encoded.mediaType,
        name: encodedName(file.name, encoded.mediaType),
        updatedAt,
        width,
      },
    };
  } finally {
    decoded.close();
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function openBackgroundDatabase(factory: IDBFactory | null): Promise<IDBDatabase> {
  if (!factory) {
    throw new BackgroundError(
      "storage-unavailable",
      "Local image storage is not available in this environment.",
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        database.createObjectStore(IMAGE_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("Could not open background storage."));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("Background storage is blocked by another window."));
    };
  });
}

async function withBackgroundDatabase<T>(
  factory: IDBFactory | null,
  operation: (database: IDBDatabase) => Promise<T>,
): Promise<T> {
  let database: IDBDatabase | null = null;
  try {
    database = await openBackgroundDatabase(factory);
    return await operation(database);
  } catch (error) {
    if (error instanceof BackgroundError) throw error;
    throw new BackgroundError(
      "storage-failed",
      "Viva could not access the saved background image.",
      { cause: error },
    );
  } finally {
    database?.close();
  }
}

export async function saveCustomBackgroundImage(
  file: File,
  factory: IDBFactory | null = browserIndexedDb(),
): Promise<BackgroundImageMetadata> {
  const processed = await processBackgroundImage(file);
  await withBackgroundDatabase(factory, async (database) => {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    const completed = transactionComplete(transaction);
    const record: StoredBackgroundRecord = {
      blob: processed.blob,
      key: processed.metadata.id,
      metadata: processed.metadata,
    };
    await Promise.all([
      requestResult(transaction.objectStore(IMAGE_STORE_NAME).put(record)),
      completed,
    ]);
  });
  return processed.metadata;
}

export async function loadCustomBackgroundImage(
  imageId: string,
  factory: IDBFactory | null = browserIndexedDb(),
): Promise<ProcessedBackgroundImage | null> {
  return withBackgroundDatabase(factory, async (database) => {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readonly");
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(IMAGE_STORE_NAME);
    const [record, legacyRecord] = await Promise.all([
      requestResult(store.get(imageId)),
      imageId === CUSTOM_IMAGE_KEY
        ? Promise.resolve(undefined)
        : requestResult(store.get(CUSTOM_IMAGE_KEY)),
      completed,
    ]);
    const stored = (record ?? legacyRecord) as StoredBackgroundRecord | undefined;
    const metadata = normalizeMetadata(stored?.metadata);
    return stored?.blob instanceof Blob && metadata
      ? { blob: stored.blob, metadata }
      : null;
  });
}

export async function deleteCustomBackgroundImage(
  imageId: string | null = null,
  factory: IDBFactory | null = browserIndexedDb(),
): Promise<void> {
  await withBackgroundDatabase(factory, async (database) => {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(IMAGE_STORE_NAME);
    const requests = imageId
      ? [requestResult(store.delete(imageId)), requestResult(store.delete(CUSTOM_IMAGE_KEY))]
      : [requestResult(store.clear())];
    await Promise.all([...requests, completed]);
  });
}

export async function pruneCustomBackgroundImages(
  activeImageId: string | null,
  factory: IDBFactory | null = browserIndexedDb(),
): Promise<void> {
  if (!factory) return;
  await withBackgroundDatabase(factory, async (database) => {
    const read = database.transaction(IMAGE_STORE_NAME, "readonly");
    const readCompleted = transactionComplete(read);
    const [keys] = await Promise.all([
      requestResult(read.objectStore(IMAGE_STORE_NAME).getAllKeys()),
      readCompleted,
    ]);
    const hasVersionedActive =
      activeImageId !== null && keys.includes(activeImageId);
    const staleKeys = keys.filter(
      (key) =>
        key !== activeImageId &&
        !(
          key === CUSTOM_IMAGE_KEY &&
          activeImageId !== null &&
          !hasVersionedActive
        ),
    );
    if (staleKeys.length === 0) return;
    const write = database.transaction(IMAGE_STORE_NAME, "readwrite");
    const writeCompleted = transactionComplete(write);
    const store = write.objectStore(IMAGE_STORE_NAME);
    await Promise.all([
      ...staleKeys.map((key) => requestResult(store.delete(key))),
      writeCompleted,
    ]);
  });
}

export async function resolveBackgroundAsset(
  settings: BackgroundSettings,
  factory: IDBFactory | null = browserIndexedDb(),
  urlFactory: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> | null =
    browserObjectUrlFactory(),
): Promise<BackgroundAsset | null> {
  if (settings.source === "none") return null;
  if (settings.source === "viva") {
    return { revoke: () => undefined, url: BUILTIN_BACKGROUND_URL };
  }
  if (!urlFactory) {
    throw new BackgroundError(
      "storage-unavailable",
      "The saved image cannot be displayed in this environment.",
    );
  }

  const stored = await loadCustomBackgroundImage(settings.customImage!.id, factory);
  if (!stored) {
    throw new BackgroundError(
      "image-missing",
      "The saved custom background is no longer available. Choose it again.",
    );
  }
  const url = urlFactory.createObjectURL(stored.blob);
  return { revoke: () => urlFactory.revokeObjectURL(url), url };
}

export async function resetBackgroundStorage(
  storage: SettingsStorage | null = browserStorage(),
  factory: IDBFactory | null = browserIndexedDb(),
): Promise<void> {
  const previous = loadBackgroundSettings(storage);
  saveBackgroundSettings(DEFAULT_BACKGROUND_SETTINGS, storage);
  try {
    if (factory) await deleteCustomBackgroundImage(null, factory);
    else if (previous.customImage) {
      throw new BackgroundError(
        "storage-unavailable",
        "The saved custom background could not be removed.",
      );
    }
  } catch (error) {
    try {
      saveBackgroundSettings(previous, storage);
    } catch (rollbackError) {
      throw new BackgroundError(
        "storage-failed",
        "Viva could not reset the background or restore its previous settings.",
        { cause: rollbackError },
      );
    }
    throw error;
  }
}

export function backgroundPositionToCss(position: BackgroundPosition): string {
  const positions: Record<BackgroundPosition, string> = {
    "bottom-left": "left bottom",
    "bottom-right": "right bottom",
    "top-left": "left top",
    "top-right": "right top",
    bottom: "center bottom",
    center: "center center",
    left: "left center",
    right: "right center",
    top: "center top",
  };
  return positions[position];
}

export function formatBackgroundBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
