import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_SETTINGS_KEY,
  BUILTIN_BACKGROUND_URL,
  DEFAULT_BACKGROUND_SETTINGS,
  MAX_BACKGROUND_DIMENSION,
  MAX_BACKGROUND_OPACITY,
  MAX_BACKGROUND_PIXELS,
  MAX_SOURCE_IMAGE_BYTES,
  BackgroundError,
  backgroundPositionToCss,
  calculateBackgroundSize,
  formatBackgroundBytes,
  loadBackgroundSettings,
  normalizeBackgroundSettings,
  processBackgroundImage,
  resolveBackgroundAsset,
  saveBackgroundSettings,
  validateBackgroundFile,
  type BackgroundImageMetadata,
  type SettingsStorage,
} from "./background";

afterEach(() => {
  vi.unstubAllGlobals();
});

class MemoryStorage implements SettingsStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const metadata: BackgroundImageMetadata = {
  bytes: 180_000,
  height: 1080,
  id: "custom-1",
  mediaType: "image/webp",
  name: "field-notes.webp",
  updatedAt: 1_777_777_777,
  width: 1920,
};

describe("background settings", () => {
  it("uses the built-in Viva illustration for a fresh install", () => {
    const storage = new MemoryStorage();
    expect(loadBackgroundSettings(storage)).toEqual(DEFAULT_BACKGROUND_SETTINGS);
    expect(DEFAULT_BACKGROUND_SETTINGS.source).toBe("viva");
    expect(DEFAULT_BACKGROUND_SETTINGS.opacity).toBeLessThanOrEqual(0.12);
  });

  it("falls back safely when persisted JSON is corrupt", () => {
    const storage = new MemoryStorage();
    storage.setItem(BACKGROUND_SETTINGS_KEY, "{not-json");
    expect(loadBackgroundSettings(storage)).toEqual(DEFAULT_BACKGROUND_SETTINGS);
  });

  it("normalizes fields and refuses a custom source without metadata", () => {
    const normalized = normalizeBackgroundSettings({
      blur: 500,
      fit: "stretch",
      opacity: 1,
      position: "somewhere",
      source: "custom",
    });

    expect(normalized.blur).toBe(24);
    expect(normalized.opacity).toBe(MAX_BACKGROUND_OPACITY);
    expect(normalized.fit).toBe(DEFAULT_BACKGROUND_SETTINGS.fit);
    expect(normalized.position).toBe(DEFAULT_BACKGROUND_SETTINGS.position);
    expect(normalized.source).toBe("none");
  });

  it("round-trips metadata without storing image bytes in localStorage", () => {
    const storage = new MemoryStorage();
    const saved = saveBackgroundSettings(
      {
        ...DEFAULT_BACKGROUND_SETTINGS,
        customImage: metadata,
        source: "custom",
      },
      storage,
    );

    expect(loadBackgroundSettings(storage)).toEqual(saved);
    const serialized = storage.getItem(BACKGROUND_SETTINGS_KEY) ?? "";
    expect(serialized).toContain("field-notes.webp");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("blob:");
  });
});

describe("background image limits", () => {
  it("rejects unsupported and oversized source files before decoding", () => {
    expect(() =>
      validateBackgroundFile({ name: "notes.gif", size: 100, type: "image/gif" }),
    ).toThrow(BackgroundError);
    expect(() =>
      validateBackgroundFile({
        name: "future.avif",
        size: 100,
        type: "image/avif",
      }),
    ).toThrow(/JPEG, PNG, or WebP/);
    expect(() =>
      validateBackgroundFile({
        name: "large.png",
        size: MAX_SOURCE_IMAGE_BYTES + 1,
        type: "image/png",
      }),
    ).toThrow(/24 MiB/);
  });

  it("recognizes an image extension when the platform omits its MIME type", () => {
    expect(
      validateBackgroundFile({ name: "quiet.WEBP", size: 100, type: "" }),
    ).toBe("image/webp");
  });

  it("scales large but safe images into the storage envelope", () => {
    const size = calculateBackgroundSize(8000, 4000);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(
      MAX_BACKGROUND_DIMENSION,
    );
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_BACKGROUND_PIXELS);
    expect(size.width / size.height).toBeCloseTo(2, 2);
  });

  it("rejects dimensions that could cause excessive decode memory", () => {
    expect(() => calculateBackgroundSize(16_000, 16_000)).toThrow(
      /too large to use safely/,
    );
  });

  it("uses a truthful JPEG fallback when WebKit returns PNG for WebP", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ close, height: 720, width: 1280 }),
    );
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
      globalCompositeOperation: "source-over",
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      restore: vi.fn(),
      save: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback, requestedType) => {
        const actualType =
          requestedType === "image/webp" ? "image/png" : "image/jpeg";
        callback(new Blob(["encoded"], { type: actualType }));
      },
    );

    const result = await processBackgroundImage(
      new File(["source"], "quiet.png", { type: "image/png" }),
    );

    expect(result.blob.type).toBe("image/jpeg");
    expect(result.metadata.mediaType).toBe("image/jpeg");
    expect(result.metadata.name).toBe("quiet.jpg");
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("background presentation helpers", () => {
  it("maps every anchor to a CSS background position", () => {
    expect(backgroundPositionToCss("top-left")).toBe("left top");
    expect(backgroundPositionToCss("center")).toBe("center center");
    expect(backgroundPositionToCss("bottom-right")).toBe("right bottom");
  });

  it("resolves the built-in asset without opening IndexedDB", async () => {
    await expect(
      resolveBackgroundAsset(DEFAULT_BACKGROUND_SETTINGS, null, null),
    ).resolves.toMatchObject({ url: BUILTIN_BACKGROUND_URL });
  });

  it("formats compact file metadata", () => {
    expect(formatBackgroundBytes(900)).toBe("900 B");
    expect(formatBackgroundBytes(2048)).toBe("2 KiB");
    expect(formatBackgroundBytes(2.5 * 1024 * 1024)).toBe("2.5 MiB");
  });
});
