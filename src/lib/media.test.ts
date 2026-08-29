import { describe, expect, it, vi } from "vitest";
import {
  resolveLocalImagePath,
  WorkspaceImageCache,
  type WorkspaceImageLease,
} from "./media";

function payload(
  body: number[],
  kind = 2,
  width = 640,
  height = 360,
): Uint8Array {
  const bytes = new Uint8Array(14 + body.length);
  bytes.set([0x56, 0x49, 0x4d, 0x47, 1, kind]);
  const view = new DataView(bytes.buffer);
  view.setUint32(6, width);
  view.setUint32(10, height);
  bytes.set(body, 14);
  return bytes;
}

describe("resolveLocalImagePath", () => {
  it("resolves document-relative, parent, encoded, and workspace-root paths", () => {
    expect(resolveLocalImagePath("notes/day.md", "./images/hero.png")).toBe(
      "notes/images/hero.png",
    );
    expect(resolveLocalImagePath("notes/day.md", "../art/cover%20one.webp#hero")).toBe(
      "art/cover one.webp",
    );
    expect(resolveLocalImagePath("notes/day.md", "/shared/cover.jpg?v=2")).toBe(
      "shared/cover.jpg",
    );
    expect(resolveLocalImagePath("notes/day.md", "../art/motion.gif")).toBe(
      "art/motion.gif",
    );
  });

  it("rejects remote, embedded, unsupported, malformed, and escaping sources", () => {
    for (const source of [
      "https://example.com/a.png",
      "//example.com/a.png",
      "data:image/png;base64,AA==",
      "javascript:alert(1)",
      "../../../outside.png",
      "./vector.svg",
      "%E0%A4%A.png",
    ]) {
      expect(resolveLocalImagePath("notes/day.md", source), source).toBeNull();
    }
  });
});

describe("WorkspaceImageCache", () => {
  it("deduplicates binary reads and revokes only after the final active lease", async () => {
    const invokeBinary = vi.fn().mockResolvedValue(payload([1, 2, 3]));
    const createObjectURL = vi.fn().mockReturnValue("blob:viva-image");
    const revokeObjectURL = vi.fn();
    const cache = new WorkspaceImageCache({
      createObjectURL,
      invokeBinary,
      maxBytes: 2,
      maxEntries: 1,
      revokeObjectURL,
    });

    const leases: WorkspaceImageLease[] = await Promise.all([
      cache.acquire("/workspace", "images/hero.png"),
      cache.acquire("/workspace", "images/hero.png"),
    ]);
    const first = leases[0]!;
    const second = leases[1]!;

    expect(invokeBinary).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      height: 360,
      mediaType: "image/png",
      relativePath: "images/hero.png",
      sizeBytes: 3,
      url: "blob:viva-image",
      width: 640,
    });
    first.release();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    cache.clear();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    second.release();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:viva-image");
  });

  it("rejects malformed native payloads without retaining a failed entry", async () => {
    const invokeBinary = vi
      .fn()
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
      .mockResolvedValueOnce(payload([4]));
    const cache = new WorkspaceImageCache({
      createObjectURL: () => "blob:valid",
      invokeBinary,
      revokeObjectURL: vi.fn(),
    });

    await expect(cache.acquire("/workspace", "image.png")).rejects.toThrow(
      "invalid image response",
    );
    await expect(cache.acquire("/workspace", "image.png")).resolves.toMatchObject({
      url: "blob:valid",
    });
    expect(invokeBinary).toHaveBeenCalledTimes(2);
  });

  it("maps a validated GIF payload to a GIF Blob", async () => {
    const cache = new WorkspaceImageCache({
      createObjectURL: (blob) => `blob:${blob.type}`,
      invokeBinary: vi.fn().mockResolvedValue(payload([1], 4, 320, 180)),
      revokeObjectURL: vi.fn(),
    });

    const lease = await cache.acquire("/workspace", "motion.gif");
    expect(lease).toMatchObject({
      height: 180,
      mediaType: "image/gif",
      url: "blob:image/gif",
      width: 320,
    });
    lease.release();
  });
});
