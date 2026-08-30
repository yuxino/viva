import { describe, expect, it } from "vitest";
import { buildLiteralFindIndex } from "./findIndex";

describe("buildLiteralFindIndex", () => {
  it("resolves arbitrary matches through sparse checkpoints", () => {
    const source = "a".repeat(25_000);
    const index = buildLiteralFindIndex(source, "a", {
      caseSensitive: true,
      wholeWord: false,
    });

    expect(index.count).toBe(source.length);
    expect(index.select(19_237)).toEqual({
      activeIndex: 19_237,
      match: { end: 19_238, start: 19_237 },
    });
    expect(index.select(source.length)).toEqual({
      activeIndex: 0,
      match: { end: 1, start: 0 },
    });
  });

  it("preserves whole-word boundaries after a checkpoint", () => {
    const source = `${"猫咪 ".repeat(1_100)}猫。`;
    const index = buildLiteralFindIndex(source, "猫", {
      caseSensitive: true,
      wholeWord: true,
    });

    expect(index.count).toBe(1);
    expect(index.select(0).match).toEqual({
      start: source.length - 2,
      end: source.length - 1,
    });
  });
});
