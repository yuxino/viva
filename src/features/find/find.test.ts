import { describe, expect, it } from "vitest";
import {
  MAX_MATERIALIZED_FIND_MATCHES,
  countLiteralMatches,
  findLiteralMatches,
  findLiteralMatchAt,
  findLiteralMatchAtOrAfterOffset,
  findLiteralMatchIndexAtOrAfter,
  findLiteralMatchIndexAtOffset,
  replaceAllLiteralMatches,
  replaceAllMatches,
  replaceOneMatch,
  stepMatchIndex,
  wrapMatchIndex,
} from "./find";

describe("findLiteralMatches", () => {
  it("finds non-overlapping literal matches without interpreting regular expressions", () => {
    const source = "[Viva] and [viva] and [Viva]";

    const matches = findLiteralMatches(source, "[Viva]", {
      caseSensitive: true,
      wholeWord: false,
    });

    expect(matches).toEqual([
      { start: 0, end: 6 },
      { start: 22, end: 28 },
    ]);
  });

  it("supports case-insensitive matching", () => {
    const source = "Viva viva VIVA";
    const matches = findLiteralMatches(source, "viva", {
      caseSensitive: false,
      wholeWord: false,
    });

    expect(matches.map((match) => source.slice(match.start, match.end))).toEqual([
      "Viva",
      "viva",
      "VIVA",
    ]);
  });

  it("uses Unicode-aware whole-word boundaries", () => {
    expect(
      findLiteralMatches("cat concatenate cat", "cat", {
        caseSensitive: true,
        wholeWord: true,
      }),
    ).toEqual([
      { start: 0, end: 3 },
      { start: 16, end: 19 },
    ]);

    const source = "猫 猫咪 A猫 猫。";
    const matches = findLiteralMatches(source, "猫", {
      caseSensitive: true,
      wholeWord: true,
    });

    expect(matches.map((match) => source.slice(match.start, match.end))).toEqual([
      "猫",
      "猫",
    ]);
  });

  it("treats combining marks as part of a Unicode word", () => {
    expect(
      findLiteralMatches("cafe cafe\u0301", "cafe", {
        caseSensitive: true,
        wholeWord: true,
      }),
    ).toEqual([{ start: 0, end: 4 }]);
  });

  it("returns no matches for an empty query", () => {
    expect(
      findLiteralMatches("Viva", "", {
        caseSensitive: false,
        wholeWord: false,
      }),
    ).toEqual([]);
  });

  it("bounds materialized matches while preserving exact count and navigation", () => {
    const source = "a".repeat(MAX_MATERIALIZED_FIND_MATCHES + 17);
    const options = { caseSensitive: true, wholeWord: false };

    expect(findLiteralMatches(source, "a", options)).toHaveLength(
      MAX_MATERIALIZED_FIND_MATCHES,
    );
    expect(countLiteralMatches(source, "a", options)).toBe(source.length);
    expect(
      findLiteralMatchAt(
        source,
        "a",
        options,
        MAX_MATERIALIZED_FIND_MATCHES + 12,
      ),
    ).toEqual({
      start: MAX_MATERIALIZED_FIND_MATCHES + 12,
      end: MAX_MATERIALIZED_FIND_MATCHES + 13,
    });
    expect(
      findLiteralMatchIndexAtOffset(
        source,
        "a",
        options,
        MAX_MATERIALIZED_FIND_MATCHES + 12,
      ),
    ).toBe(MAX_MATERIALIZED_FIND_MATCHES + 12);
    expect(
      findLiteralMatchIndexAtOrAfter(
        source,
        "a",
        options,
        MAX_MATERIALIZED_FIND_MATCHES + 12,
      ),
    ).toEqual({
      count: source.length,
      index: MAX_MATERIALIZED_FIND_MATCHES + 12,
    });
  });

  it("resumes exact Unicode-aware navigation from a sparse checkpoint", () => {
    const source = "猫咪 猫。 猫咪 猫。";
    const options = { caseSensitive: true, wholeWord: true };
    const first = findLiteralMatchAt(source, "猫", options, 0);
    expect(first).toEqual({ start: 3, end: 4 });
    expect(
      findLiteralMatchAtOrAfterOffset(
        source,
        "猫",
        options,
        first!.end,
        0,
      ),
    ).toEqual({ start: 9, end: 10 });
  });
});

describe("match navigation", () => {
  it("wraps arbitrary indexes and reports no active match for an empty result", () => {
    expect(wrapMatchIndex(3, 3)).toBe(0);
    expect(wrapMatchIndex(-1, 3)).toBe(2);
    expect(wrapMatchIndex(27, 0)).toBe(-1);
  });

  it("moves forward and backward with wraparound from an inactive state", () => {
    expect(stepMatchIndex(-1, 3, 1)).toBe(0);
    expect(stepMatchIndex(-1, 3, -1)).toBe(2);
    expect(stepMatchIndex(2, 3, 1)).toBe(0);
    expect(stepMatchIndex(0, 3, -1)).toBe(2);
  });
});

describe("literal replacement", () => {
  it("replaces one match with a direct string splice", () => {
    expect(
      replaceOneMatch("one **one**", { start: 6, end: 9 }, "$&"),
    ).toBe("one **$&**");
  });

  it("replaces all matches without interpreting replacement tokens", () => {
    const source = "Viva + viva + VIVA";
    const matches = findLiteralMatches(source, "viva", {
      caseSensitive: false,
      wholeWord: false,
    });

    expect(replaceAllMatches(source, matches, "$&")).toBe("$& + $& + $&");
  });

  it("leaves the source unchanged when there are no matches", () => {
    expect(replaceAllMatches("# Viva", [], "quiet")).toBe("# Viva");
  });
  it("replaces every literal match without materializing the match set", () => {
    const source = "a".repeat(MAX_MATERIALIZED_FIND_MATCHES + 17);

    expect(
      replaceAllLiteralMatches(
        source,
        "a",
        { caseSensitive: true, wholeWord: false },
        "$&",
      ),
    ).toBe("$&".repeat(source.length));
  });
});
