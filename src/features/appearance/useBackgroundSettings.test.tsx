import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundSettings } from "../../lib/background";

const backgroundMocks = vi.hoisted(() => ({
  deleteImage: vi.fn(),
  initial: null as BackgroundSettings | null,
  pruneImages: vi.fn(),
  resetStorage: vi.fn(),
  resolveAsset: vi.fn(),
  saveImage: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("../../lib/background", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/background")>();
  return {
    ...actual,
    deleteCustomBackgroundImage: backgroundMocks.deleteImage,
    loadBackgroundSettings: () => backgroundMocks.initial,
    pruneCustomBackgroundImages: backgroundMocks.pruneImages,
    resetBackgroundStorage: backgroundMocks.resetStorage,
    resolveBackgroundAsset: backgroundMocks.resolveAsset,
    saveCustomBackgroundImage: backgroundMocks.saveImage,
    saveBackgroundSettings: backgroundMocks.saveSettings,
  };
});

import { DEFAULT_BACKGROUND_SETTINGS } from "../../lib/background";
import { useBackgroundSettings } from "./useBackgroundSettings";

const previousImage = {
  bytes: 100,
  height: 720,
  id: "previous",
  mediaType: "image/jpeg" as const,
  name: "previous.jpg",
  updatedAt: 1,
  width: 1280,
};

beforeEach(() => {
  backgroundMocks.initial = {
    ...DEFAULT_BACKGROUND_SETTINGS,
    customImage: previousImage,
    source: "custom",
  };
  backgroundMocks.deleteImage.mockReset().mockResolvedValue(undefined);
  backgroundMocks.pruneImages.mockReset().mockResolvedValue(undefined);
  backgroundMocks.resetStorage.mockReset().mockResolvedValue(undefined);
  backgroundMocks.resolveAsset.mockReset().mockResolvedValue(null);
  backgroundMocks.saveImage.mockReset();
  backgroundMocks.saveSettings
    .mockReset()
    .mockImplementation((settings: BackgroundSettings) => settings);
});

describe("useBackgroundSettings storage recovery", () => {
  it("keeps custom metadata visible when removing its blob fails", async () => {
    backgroundMocks.deleteImage.mockRejectedValueOnce(new Error("delete failed"));
    const { result } = renderHook(() => useBackgroundSettings());

    await act(async () => result.current.removeCustomImage());

    expect(result.current.settings.customImage).toEqual(previousImage);
    expect(result.current.settings.source).toBe("custom");
    expect(result.current.error).toBe("delete failed");
    expect(backgroundMocks.saveSettings).toHaveBeenCalledTimes(2);
  });

  it("does not hide the cleanup controls when reset fails", async () => {
    backgroundMocks.resetStorage.mockRejectedValueOnce(new Error("reset failed"));
    const { result } = renderHook(() => useBackgroundSettings());

    await act(async () => result.current.reset());

    expect(result.current.settings.customImage).toEqual(previousImage);
    expect(result.current.error).toBe("reset failed");
  });

  it("rolls back an uncommitted new blob and reports cleanup failure", async () => {
    const nextImage = { ...previousImage, id: "next", name: "next.jpg" };
    backgroundMocks.saveImage.mockResolvedValue(nextImage);
    backgroundMocks.saveSettings.mockImplementationOnce(() => {
      throw new Error("preferences failed");
    });
    backgroundMocks.deleteImage.mockRejectedValueOnce(new Error("cleanup failed"));
    const { result } = renderHook(() => useBackgroundSettings());

    await act(async () =>
      result.current.selectCustomImage(
        new File(["image"], "next.jpg", { type: "image/jpeg" }),
      ),
    );

    await waitFor(() => expect(result.current.operation).toBe("idle"));
    expect(result.current.settings.customImage).toEqual(previousImage);
    expect(result.current.error).toContain("Use Reset to retry local cleanup");
  });
});
