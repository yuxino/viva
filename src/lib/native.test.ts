import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  revealItemInDir: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: nativeMocks.invoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
  revealItemInDir: nativeMocks.revealItemInDir,
}));

describe("native quit state protocol", () => {
  beforeEach(() => {
    vi.resetModules();
    nativeMocks.invoke.mockReset();
    nativeMocks.revealItemInDir.mockReset().mockResolvedValue(undefined);
  });

  it("reveals a workspace item with the platform path separator", async () => {
    const native = await import("./native");

    await native.revealWorkspaceItem("C:\\Notes", "drafts/today.md");

    expect(nativeMocks.revealItemInDir).toHaveBeenCalledWith(
      "C:\\Notes\\drafts\\today.md",
    );
  });

  it("sends the document line ending through write and Save As", async () => {
    nativeMocks.invoke.mockResolvedValue(undefined);
    const native = await import("./native");
    const revision = {
      modifiedAtMs: 7,
      sizeBytes: 15,
      contentSha256: "a".repeat(64),
    };
    const document = {
      relativePath: "windows.md",
      name: "windows.md",
      content: "first\nsecond\n",
      lineEnding: "crlf" as const,
      revision,
    };

    await native.writeDocument("C:\\Notes", document);
    await native.saveDocumentAs(
      "C:\\Notes",
      "C:\\Notes\\copy.md",
      document.content,
      document.lineEnding,
      revision,
    );

    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(1, "write_document", {
      request: {
        workspaceRoot: "C:\\Notes",
        relativePath: "windows.md",
        content: "first\nsecond\n",
        lineEnding: "crlf",
        expectedRevision: revision,
      },
    });
    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(2, "save_document_as", {
      request: {
        workspaceRoot: "C:\\Notes",
        destinationPath: "C:\\Notes\\copy.md",
        content: "first\nsecond\n",
        lineEnding: "crlf",
        expectedDestinationRevision: revision,
      },
    });
  });

  it("uses one native-issued session and monotonic renderer sequences", async () => {
    nativeMocks.invoke.mockImplementation((command: string) => {
      if (command === "get_quit_guard_session") return Promise.resolve(17);
      return Promise.resolve(true);
    });
    const native = await import("./native");

    await native.setQuitGuardReady(true);
    await native.setHasUnsavedChanges(true);
    await native.setHasUnsavedChanges(false);

    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(
      1,
      "get_quit_guard_session",
    );
    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(
      2,
      "set_quit_guard_ready",
      { ready: true, session: 17, sequence: 1 },
    );
    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(
      3,
      "set_has_unsaved_changes",
      { dirty: true, session: 17, sequence: 2 },
    );
    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(
      4,
      "set_has_unsaved_changes",
      { dirty: false, session: 17, sequence: 3 },
    );
  });

  it("refreshes the native session after a renderer-session rejection", async () => {
    let sessionRequestCount = 0;
    nativeMocks.invoke.mockImplementation(
      (command: string, payload?: { session?: number }) => {
        if (command === "get_quit_guard_session") {
          sessionRequestCount += 1;
          return Promise.resolve(sessionRequestCount === 1 ? 23 : 24);
        }
        if (payload?.session === 23) {
          return Promise.reject(new Error("session changed"));
        }
        return Promise.resolve(true);
      },
    );
    const native = await import("./native");

    await expect(native.setQuitGuardReady(true)).rejects.toThrow(
      "session changed",
    );
    await expect(native.setQuitGuardReady(true)).resolves.toBe(true);

    expect(sessionRequestCount).toBe(2);
    expect(nativeMocks.invoke).toHaveBeenLastCalledWith(
      "set_quit_guard_ready",
      { ready: true, session: 24, sequence: 2 },
    );
  });

  it("maps structured native error codes through the active language", async () => {
    const native = await import("./native");
    const translate = vi.fn((key: string) => `localized:${key}`);

    expect(
      native.describeNativeError(
        { code: "CONFLICT", message: "The document changed on disk." },
        translate,
      ),
    ).toBe(
      "localized:This file changed outside Viva. Review it and try again.",
    );
    expect(translate).toHaveBeenCalledOnce();
  });

  it("creates documents and directories with exact workspace payloads", async () => {
    nativeMocks.invoke.mockResolvedValue({});
    const native = await import("./native");

    await native.createDocument("/资料/写作", "随笔/今天.md", "# 今天");
    await native.createWorkspaceDirectory("/资料/写作", "随笔", "素材");

    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(1, "create_document", {
      request: {
        workspaceRoot: "/资料/写作",
        relativePath: "随笔/今天.md",
        content: "# 今天",
      },
    });
    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(
      2,
      "create_workspace_directory",
      {
        request: {
          workspaceRoot: "/资料/写作",
          parentRelativePath: "随笔",
          name: "素材",
        },
      },
    );
  });

  it("renames duplicates and trashes entries with revision-safe payloads", async () => {
    nativeMocks.invoke.mockResolvedValue({});
    const native = await import("./native");
    const revision = {
      modifiedAtMs: 42,
      sizeBytes: 7,
      contentSha256: "abc",
    };
    const expectedDocuments = [
      { relativePath: "随笔/今天.md", revision },
    ];

    await native.renameWorkspaceEntry(
      "/资料/写作",
      "随笔",
      "日记",
      expectedDocuments,
    );
    await native.duplicateWorkspaceEntry(
      "/资料/写作",
      "日记/今天.md",
      revision,
    );
    await native.trashWorkspaceEntry(
      "/资料/写作",
      "日记",
      expectedDocuments,
    );

    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(
      1,
      "rename_workspace_entry",
      {
        request: {
          workspaceRoot: "/资料/写作",
          relativePath: "随笔",
          newName: "日记",
          expectedDocuments,
        },
      },
    );
    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(
      2,
      "duplicate_workspace_entry",
      {
        request: {
          workspaceRoot: "/资料/写作",
          relativePath: "日记/今天.md",
          expectedRevision: revision,
        },
      },
    );
    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(
      3,
      "trash_workspace_entry",
      {
        request: {
          workspaceRoot: "/资料/写作",
          relativePath: "日记",
          expectedDocuments,
        },
      },
    );
  });

  it("keeps the native detail for an unknown structured error", async () => {
    const native = await import("./native");

    expect(
      native.describeNativeError(
        { code: "NEW_NATIVE_CODE", message: "Specific failure" },
        (key) => key,
      ),
    ).toBe("Specific failure");
  });

  it("encodes image bytes with canonical standard base64 padding", async () => {
    const native = await import("./native");

    expect(native.encodeStandardBase64(new Uint8Array())).toBe("");
    expect(native.encodeStandardBase64(Uint8Array.of(0))).toBe("AA==");
    expect(native.encodeStandardBase64(Uint8Array.of(0, 1))).toBe("AAE=");
    expect(native.encodeStandardBase64(Uint8Array.of(0, 1, 2))).toBe("AAEC");
    expect(native.encodeStandardBase64(Uint8Array.of(251, 255, 239))).toBe(
      "+//v",
    );
  });

  it("keeps base64 canonical across encoder chunk boundaries", async () => {
    const native = await import("./native");
    const bytes = Uint8Array.from(
      { length: 73_731 },
      (_, index) => (index * 37 + 11) % 256,
    );

    const encoded = native.encodeStandardBase64(bytes);
    const decoded = atob(encoded);

    expect(encoded.slice(0, -2)).not.toContain("=");
    expect(decoded).toHaveLength(bytes.length);
    for (let index = 0; index < bytes.length; index += 1) {
      expect(decoded.charCodeAt(index)).toBe(bytes[index]);
    }
  });

  it("accepts the 24 MiB image boundary and rejects larger input", async () => {
    const native = await import("./native");

    expect(() =>
      native.assertWorkspaceImageSize(native.MAX_WORKSPACE_IMAGE_BYTES),
    ).not.toThrow();
    expect(() =>
      native.assertWorkspaceImageSize(native.MAX_WORKSPACE_IMAGE_BYTES + 1),
    ).toThrow("24 MiB");
  });

  it("creates a workspace image with an exact camel-case API payload", async () => {
    const response = {
      relativePath: "assets/viva-abc.png",
      markdownPath: "../assets/viva-abc.png",
      format: "png",
      width: 640,
      height: 480,
      sizeBytes: 5,
      deduplicated: false,
    };
    nativeMocks.invoke.mockImplementation((command: string) =>
      command === "get_quit_guard_session"
        ? Promise.resolve(41)
        : Promise.resolve(response),
    );
    const native = await import("./native");
    const leaseId = "bd187dc0-d068-452f-90a2-c4d7316fd87d";

    await expect(
      native.createWorkspaceImage(
        "/资料/写作",
        "随笔/今天.md",
        Uint8Array.of(0, 1, 2, 253, 254),
        leaseId,
      ),
    ).resolves.toEqual(response);

    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(2, "create_workspace_image", {
      request: {
        workspaceRoot: "/资料/写作",
        documentRelativePath: "随笔/今天.md",
        dataBase64: "AAEC/f4=",
        leaseId,
        session: 41,
      },
    });
  });

  it("commits and cancels image leases in the native renderer session", async () => {
    nativeMocks.invoke.mockImplementation((command: string) =>
      Promise.resolve(command === "get_quit_guard_session" ? 43 : undefined),
    );
    const native = await import("./native");
    const leaseId = "6d499d5e-dc82-430f-a587-3b9a3757381d";

    await native.commitWorkspaceImage("/notes", leaseId);
    await native.cancelWorkspaceImage("/notes", leaseId);

    const request = { workspaceRoot: "/notes", leaseId, session: 43 };
    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(
      2,
      "commit_workspace_image",
      { request },
    );
    expect(nativeMocks.invoke).toHaveBeenNthCalledWith(
      3,
      "cancel_workspace_image",
      { request },
    );
  });

  it("rejects oversized image bytes before invoking native code", async () => {
    const native = await import("./native");
    const oversized = new Uint8Array(native.MAX_WORKSPACE_IMAGE_BYTES + 1);

    await expect(
      native.createWorkspaceImage(
        "/notes",
        "today.md",
        oversized,
        "d39456b0-a8ee-4ecb-8201-67051f758ec5",
      ),
    ).rejects.toThrow("24 MiB");
    expect(nativeMocks.invoke).not.toHaveBeenCalled();
  });
});
