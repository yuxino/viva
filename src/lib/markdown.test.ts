import { describe, expect, it } from "vitest";
import {
  countWords,
  renderMarkdown,
  renderMarkdownDocument,
} from "./markdown";

describe("renderMarkdown", () => {
  it("creates stable unique heading anchors and source lines", () => {
    const rendered = renderMarkdown("# Quiet work\n\nText\n\n## Quiet work");
    expect(rendered.outline).toEqual([
      { id: "quiet-work", level: 1, text: "Quiet work", sourceLine: 1 },
      { id: "quiet-work-2", level: 2, text: "Quiet work", sourceLine: 5 },
    ]);
    expect(rendered.html).toContain('data-source-line="1"');
  });

  it("does not load remote images or raw HTML", () => {
    const rendered = renderMarkdown(
      '<script>alert("no")</script>\n\n![private](https://example.com/pixel.png)',
    );
    expect(rendered.html).not.toContain("<script");
    expect(rendered.html).not.toContain("<img");
    expect(rendered.html).not.toContain("data-image-");
    expect(rendered.html).toContain('aria-label="private"');
    expect(rendered.images).toEqual([
      {
        alt: "private",
        id: "viva-image-1",
        remote: true,
        source: "https://example.com/pixel.png",
        title: undefined,
      },
    ]);
  });

  it("preserves an empty image alt for the localized React layer", () => {
    const rendered = renderMarkdown("![](art/room.png)");

    expect(rendered.images?.[0]?.alt).toBe("");
    expect(rendered.html).not.toContain("data-image-");
    expect(rendered.html).not.toContain(">Image<");
  });

  it("emits an inert placeholder and a separate trusted local image reference", () => {
    const rendered = renderMarkdown('![Cover](../art/cover%20one.png "Draft")');

    expect(rendered.html).toContain('class="markdown-image-placeholder"');
    expect(rendered.html).not.toContain("data-viva-image");
    expect(rendered.html).not.toContain("data-image-");
    expect(rendered.html).not.toContain("<img");
    expect(rendered.images).toEqual([
      {
        alt: "Cover",
        id: "viva-image-1",
        remote: false,
        source: "../art/cover%20one.png",
        title: "Draft",
      },
    ]);
  });

  it("renders MDX as an explicitly inert static preview", () => {
    const rendered = renderMarkdown(
      [
        'import Callout from "./Callout"',
        "",
        '<Callout onClick={() => steal()}>Readable **Markdown** {danger()}</Callout>',
        "",
        "export const answer = dangerous()",
      ].join("\n"),
      { format: "mdx" },
    );

    expect(rendered.safeMdx).toBe(true);
    expect(rendered.html).toContain("<strong>Markdown</strong>");
    expect(rendered.html).toContain("{danger()}");
    expect(rendered.html).not.toContain("<Callout");
    const template = document.createElement("template");
    template.innerHTML = rendered.html;
    expect(template.content.querySelector("[onclick]")).toBeNull();
    expect(rendered.html).not.toContain("<script");
  });

  it("renders live blocks from one shared full-document parse", () => {
    const source = "[Viva][site]\n\n[site]: https://example.com";
    const rendered = renderMarkdownDocument(source);

    expect(rendered.blocks.map((block) => block.raw).join("\n")).toContain(
      "[Viva][site]",
    );
    expect(rendered.blocks[0]?.html).toContain('href="https://example.com"');
  });

  it("renders local task-list checkboxes as inert controls", () => {
    const rendered = renderMarkdown("- [x] Done\n- [ ] Next");
    const template = document.createElement("template");
    template.innerHTML = rendered.html;
    const checkboxes = template.content.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );

    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]?.checked).toBe(true);
    expect(checkboxes[1]?.checked).toBe(false);
    expect([...checkboxes].every((checkbox) => checkbox.disabled)).toBe(true);
  });

  it("highlights fenced Dart and TypeScript with visible language labels", () => {
    const rendered = renderMarkdown(
      [
        "```dart",
        "final answer = 42;",
        "```",
        "",
        "```ts",
        "const greeting: string = 'hello';",
        "```",
      ].join("\n"),
    );
    const template = document.createElement("template");
    template.innerHTML = rendered.html;

    expect(
      template.content.querySelector('[data-language="dart"]')?.textContent,
    ).toContain("Dart");
    expect(
      template.content.querySelector('[data-language="typescript"]')?.textContent,
    ).toContain("TypeScript");
    expect(template.content.querySelectorAll(".hljs-keyword").length).toBeGreaterThan(1);
  });

  it("renders unknown fenced languages as escaped plaintext", () => {
    const rendered = renderMarkdown(
      "```unknown-lang\n<script>alert('no')</script>\n```",
    );

    expect(rendered.html).toContain("unknown-lang");
    expect(rendered.html).toContain("language-plaintext");
    expect(rendered.html).not.toContain("<script>");
  });

  it("maps fenced code, indented code, tables, and dividers to source lines", () => {
    const rendered = renderMarkdown(
      [
        "```ts",
        "const answer = 42;",
        "```",
        "",
        "    indented()",
        "",
        "| Name | Value |",
        "| --- | --- |",
        "| Viva | Quiet |",
        "",
        "---",
      ].join("\n"),
    );
    const template = document.createElement("template");
    template.innerHTML = rendered.html;

    expect(
      template.content
        .querySelector("figure.markdown-code-block")
        ?.getAttribute("data-source-line"),
    ).toBe("1");
    expect(
      template.content
        .querySelector("pre[data-source-line]")
        ?.getAttribute("data-source-line"),
    ).toBe("5");
    expect(
      template.content.querySelector("table")?.getAttribute("data-source-line"),
    ).toBe("7");
    expect(
      template.content.querySelector("hr")?.getAttribute("data-source-line"),
    ).toBe("11");
  });

  it("keeps one source mapping when nested blocks begin on the same line", () => {
    const rendered = renderMarkdown(
      [
        "> ```ts",
        "> const answer = 42;",
        "> ```",
        "",
        "- Parent",
        "  - Child",
      ].join("\n"),
    );
    const template = document.createElement("template");
    template.innerHTML = rendered.html;

    expect(
      template.content.querySelectorAll('[data-source-line="1"]'),
    ).toHaveLength(1);
    expect(
      template.content.querySelectorAll('[data-source-line="5"]'),
    ).toHaveLength(1);
    expect(
      template.content.querySelectorAll('[data-source-line="6"]'),
    ).toHaveLength(1);
  });
});

describe("countWords", () => {
  it("counts visible prose instead of Markdown punctuation", () => {
    expect(countWords("# A quiet tool\n\n**returns** attention.")).toBe(5);
  });

  it("counts CJK characters alongside Latin words", () => {
    expect(countWords("今天用 Viva 写 Markdown。")).toBe(6);
    expect(countWords("静かな文章")).toBe(5);
  });

  it("counts link labels without counting destinations or fenced code", () => {
    expect(
      countWords(
        [
          "[Viva writer](https://example.com/private/path)",
          "https://example.com/not-prose",
          "",
          "```ts",
          "const hidden = 42;",
          "```",
        ].join("\n"),
      ),
    ).toBe(2);
  });
});
