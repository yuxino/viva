import { describe, expect, it } from "vitest";
import {
  createImagePasteId,
  createImagePasteToken,
  hasImagePasteToken,
  insertImagePasteToken,
  removeImagePasteToken,
  resolveImagePasteToken,
} from "./imagePaste";

const FIRST_TOKEN =
  "[](#viva-image-paste-00000000-0000-4000-8000-000000000001)";
const SECOND_TOKEN =
  "[](#viva-image-paste-00000000-0000-4000-8000-000000000002)";

describe("clipboard image paste placeholders", () => {
  it("creates unique invisible Markdown tokens", () => {
    const firstId = createImagePasteId();
    const secondId = createImagePasteId();
    const first = createImagePasteToken(firstId);
    const second = createImagePasteToken(secondId);

    expect(firstId).not.toBe(secondId);
    expect(first).toMatch(/^\[\]\(#viva-image-paste-[a-zA-Z0-9-]+\)$/u);
    expect(second).toMatch(/^\[\]\(#viva-image-paste-[a-zA-Z0-9-]+\)$/u);
    expect(first).not.toBe(second);
  });

  it("recognizes only the exact registered token", () => {
    const value = `${FIRST_TOKEN}\n[visible](#viva-image-paste-nope)\n${SECOND_TOKEN}`;

    expect(hasImagePasteToken(value, SECOND_TOKEN)).toBe(true);
    expect(hasImagePasteToken(value, "[](#viva-image-paste-missing)")).toBe(
      false,
    );
  });

  it("inserts and resolves an image token inside Chinese text", () => {
    const pending = insertImagePasteToken(
      "你好，世界",
      { start: 3, end: 3, direction: "none" },
      FIRST_TOKEN,
    );

    expect(pending).toEqual({
      value: `你好，${FIRST_TOKEN}世界`,
      token: FIRST_TOKEN,
      selection: {
        start: 3 + FIRST_TOKEN.length,
        end: 3 + FIRST_TOKEN.length,
        direction: "none",
      },
    });

    const markdown = "![截图](../assets/截图.png)";
    expect(
      resolveImagePasteToken(
        pending.value,
        pending.selection,
        pending.token,
        markdown,
      ),
    ).toEqual({
      value: `你好，${markdown}世界`,
      applied: true,
      selection: {
        start: 3 + markdown.length,
        end: 3 + markdown.length,
        direction: "none",
      },
    });
  });

  it("preserves later typing and adjusts a moved selection by the length delta", () => {
    const pending = insertImagePasteToken(
      "开头 结尾",
      { start: 3, end: 3, direction: "forward" },
      FIRST_TOKEN,
    );
    const valueAfterTyping = `新增：${pending.value} 后来输入`;
    const selectionAfterTyping = {
      start: valueAfterTyping.length - 4,
      end: valueAfterTyping.length,
      direction: "backward" as const,
    };
    const markdown = "![图](assets/a.png)";

    const resolved = resolveImagePasteToken(
      valueAfterTyping,
      selectionAfterTyping,
      pending.token,
      markdown,
    );

    const expectedValue = valueAfterTyping.replace(FIRST_TOKEN, markdown);
    const delta = markdown.length - FIRST_TOKEN.length;
    expect(resolved).toEqual({
      value: expectedValue,
      applied: true,
      selection: {
        start: selectionAfterTyping.start + delta,
        end: selectionAfterTyping.end + delta,
        direction: "backward",
      },
    });
  });

  it("does not insert an image when the user deleted its token", () => {
    const pending = insertImagePasteToken(
      "正文",
      { start: 2, end: 2 },
      FIRST_TOKEN,
    );
    const valueWithoutToken = pending.value.replace(FIRST_TOKEN, "");

    expect(
      resolveImagePasteToken(
        valueWithoutToken,
        { start: 2, end: 2 },
        pending.token,
        "![图](assets/a.png)",
      ),
    ).toEqual({
      value: "正文",
      applied: false,
      selection: { start: 2, end: 2, direction: "none" },
    });
  });

  it("removes only the failed paste token and preserves later edits", () => {
    const pending = insertImagePasteToken(
      "正文",
      { start: 0, end: 0 },
      FIRST_TOKEN,
    );
    const valueAfterTyping = `${pending.value}，继续写`;
    const caret = valueAfterTyping.length;

    expect(
      removeImagePasteToken(
        valueAfterTyping,
        { start: caret, end: caret },
        pending.token,
      ),
    ).toEqual({
      value: "正文，继续写",
      applied: true,
      selection: {
        start: caret - FIRST_TOKEN.length,
        end: caret - FIRST_TOKEN.length,
        direction: "none",
      },
    });
  });

  it("settles concurrent image pastes independently in reverse order", () => {
    const first = insertImagePasteToken(
      "A B",
      { start: 1, end: 1 },
      FIRST_TOKEN,
    );
    const second = insertImagePasteToken(
      first.value,
      { start: first.value.length, end: first.value.length },
      SECOND_TOKEN,
    );

    const resolvedSecond = resolveImagePasteToken(
      second.value,
      second.selection,
      SECOND_TOKEN,
      "![二](assets/2.png)",
    );
    const resolvedFirst = resolveImagePasteToken(
      resolvedSecond.value,
      resolvedSecond.selection,
      FIRST_TOKEN,
      "![一](assets/1.png)",
    );

    expect(resolvedFirst.value).toBe(
      "A![一](assets/1.png) B![二](assets/2.png)",
    );
    expect(resolvedFirst.applied).toBe(true);
    expect(resolvedFirst.selection.start).toBe(resolvedFirst.value.length);
    expect(resolvedFirst.selection.end).toBe(resolvedFirst.value.length);
  });
});
