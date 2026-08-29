import { describe, expect, it, vi } from "vitest";
import { initialWorkspaceState } from "../domain/workspace";
import { emptySession, loadSession, saveSession } from "./session";

function memoryStorage(initial?: string): Storage {
  let value = initial ?? null;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(),
    get length() {
      return value ? 1 : 0;
    },
  };
}

describe("session persistence", () => {
  it("recovers safely from invalid data", () => {
    expect(loadSession(memoryStorage("not json"))).toEqual(emptySession);
  });

  it("stores workspace metadata without document contents", () => {
    const storage = memoryStorage();
    const session = saveSession(
      {
        ...initialWorkspaceState,
        workspace: { rootPath: "/notes", name: "Notes", children: [] },
        documentOrder: ["private.md"],
        activeDocumentId: "private.md",
      },
      emptySession,
      storage,
    );

    expect(session.openDocuments).toEqual(["private.md"]);
    expect(storage.setItem).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("document body"),
    );
  });
});
