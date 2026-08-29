import { describe, expect, it } from "vitest";
import { boundTextPrefix } from "./textBounds";

describe("boundTextPrefix", () => {
  it("stops before line and character limits without splitting Unicode pairs", () => {
    expect(boundTextPrefix("one\ntwo\nthree", 100, 2)).toEqual({
      lineCount: 2,
      text: "one\ntwo",
      truncated: true,
    });
    expect(boundTextPrefix("a🙂b", 2, 10)).toEqual({
      lineCount: 1,
      text: "a",
      truncated: true,
    });
  });
});
