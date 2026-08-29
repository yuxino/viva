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
    expect(rendered.html).toContain(
      'data-image-src="https://example.com/pixel.png"',
    );
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
    expect(rendered.html).toContain('data-image-alt=""');
    expect(rendered.html).not.toContain(">Image<");
  });

  it("emits inert metadata for local images without assigning a browser src", () => {
    const rendered = renderMarkdown('![Cover](../art/cover%20one.png "Draft")');

    expect(rendered.html).toContain('data-viva-image="viva-image-1"');
    expect(rendered.html).toContain('data-image-src="../art/cover%20one.png"');
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
});

describe("countWords", () => {
  it("counts visible prose instead of Markdown punctuation", () => {
    expect(countWords("# A quiet tool\n\n**returns** attention.")).toBe(5);
  });
});
