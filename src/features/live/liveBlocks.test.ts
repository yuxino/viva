import { describe, expect, it } from "vitest";
import {
  replaceLiveMarkdownBlock,
  splitLiveMarkdownBlocks,
} from "./liveBlocks";

describe("splitLiveMarkdownBlocks", () => {
  it("maps prose blocks back to exact source ranges", () => {
    const source = "\n# Title\n\nFirst paragraph.\nSecond line.\n\n- one\n- two\n";
    const blocks = splitLiveMarkdownBlocks(source);

    expect(blocks.map((block) => block.raw)).toEqual([
      "# Title\n",
      "First paragraph.\nSecond line.\n",
      "- one\n- two\n",
    ]);
    expect(blocks.map((block) => block.sourceLine)).toEqual([2, 4, 7]);
    for (const block of blocks) {
      expect(source.slice(block.start, block.end)).toBe(block.raw);
    }
  });

  it("keeps blank lines inside fenced code in one editable block", () => {
    const source = "```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter";
    expect(splitLiveMarkdownBlocks(source).map((block) => block.raw)).toEqual([
      "```ts\nconst a = 1;\n\nconst b = 2;\n```\n",
      "After",
    ]);
  });

  it("replaces only the activated source range", () => {
    const source = "One\n\nTwo\n\nThree";
    const block = splitLiveMarkdownBlocks(source)[1];
    expect(block).toBeDefined();
    expect(replaceLiveMarkdownBlock(source, block!, "Changed")).toBe(
      "One\n\nChanged\n\nThree",
    );
  });
});
