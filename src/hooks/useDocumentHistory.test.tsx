import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentHistory } from "./useDocumentHistory";

const nativeMocks = vi.hoisted(() => ({
  listDocumentHistory: vi.fn(),
  readDocumentHistory: vi.fn(),
}));

vi.mock("../i18n", () => ({
  useI18n: () => ({
    fmt: (message: string, value: unknown) => `${value} ${message}`,
    formatDateTime: () => "10:00",
    t: (message: string) => message,
  }),
}));

vi.mock("../lib/native", () => ({
  describeNativeError: (error: unknown) => String(error),
  listDocumentHistory: nativeMocks.listDocumentHistory,
  readDocumentHistory: nativeMocks.readDocumentHistory,
}));

describe("useDocumentHistory", () => {
  beforeEach(() => {
    nativeMocks.listDocumentHistory.mockReset().mockResolvedValue([
      { versionId: "version", createdAtMs: 1, sizeBytes: 15 },
    ]);
    nativeMocks.readDocumentHistory.mockReset().mockResolvedValue({
      versionId: "version",
      relativePath: "windows.md",
      name: "windows.md",
      content: "first\nsecond\n",
      lineEnding: "crlf",
      createdAtMs: 1,
      sizeBytes: 15,
    });
  });

  it("keeps a history version's line ending with its normalized content", async () => {
    const result = renderHook(() =>
      useDocumentHistory({
        workspaceRoot: "C:\\Notes",
        relativePath: "windows.md",
      }),
    );

    await act(async () => {
      await result.result.current.refresh();
    });

    expect(result.result.current.selectedEntry).toEqual(
      expect.objectContaining({
        id: "version",
        content: "first\nsecond\n",
        lineEnding: "crlf",
      }),
    );
  });
});
