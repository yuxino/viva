import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import { highlightCode } from "./syntaxHighlight";

export interface OutlineItem {
  id: string;
  level: number;
  text: string;
  sourceLine: number;
}

export interface RenderedMarkdown {
  html: string;
  outline: OutlineItem[];
  images?: MarkdownImageReference[];
  safeMdx?: boolean;
}

export interface MarkdownImageReference {
  alt: string;
  id: string;
  remote: boolean;
  source: string;
  title?: string;
}

export interface RenderMarkdownOptions {
  format?: "markdown" | "mdx";
}

export interface RenderedMarkdownBlock {
  end: number;
  html: string;
  images: MarkdownImageReference[];
  raw: string;
  sourceLine: number;
  start: number;
}

export interface RenderedMarkdownDocument {
  blocks: RenderedMarkdownBlock[];
  outline: OutlineItem[];
  safeMdx: boolean;
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
});

type Token = ReturnType<typeof markdown.parse>[number];

type RenderEnvironment = Record<PropertyKey, unknown> & {
  images: MarkdownImageReference[];
};

const sourceMappedTokens = new Set([
  "heading_open",
  "paragraph_open",
  "blockquote_open",
  "bullet_list_open",
  "ordered_list_open",
  "list_item_open",
  "fence",
  "code_block",
  "table_open",
  "hr",
]);

markdown.core.ruler.after("inline", "viva_task_lists", (state) => {
  for (let index = 0; index < state.tokens.length; index += 1) {
    const token = state.tokens[index];
    if (token?.type !== "inline") continue;
    const match = /^\[([ xX])\]\s+/.exec(token.content);
    if (!match || !token.children?.length) continue;

    const firstText = token.children.find((child) => child.type === "text");
    if (!firstText || !/^\[([ xX])\]\s+/.test(firstText.content)) continue;
    firstText.content = firstText.content.replace(/^\[([ xX])\]\s+/, "");
    const checkbox = new state.Token("viva_task_checkbox", "input", 0);
    checkbox.meta = { checked: match[1]?.toLocaleLowerCase() === "x" };
    token.children.unshift(checkbox);

    for (let parent = index - 1; parent >= 0; parent -= 1) {
      const candidate = state.tokens[parent];
      if (candidate?.type === "list_item_close") break;
      if (candidate?.type === "list_item_open") {
        candidate.attrJoin("class", "task-list-item");
        break;
      }
    }
  }
});

markdown.renderer.rules.viva_task_checkbox = (tokens, index) => {
  const checked = Boolean(tokens[index]?.meta?.checked);
  return `<input type="checkbox" disabled${checked ? " checked" : ""} aria-hidden="true">`;
};

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function assignSourceLines(tokens: Token[]): void {
  const ancestorSourceLines: number[] = [];

  for (const token of tokens) {
    ancestorSourceLines.length = Math.min(
      ancestorSourceLines.length,
      token.level,
    );
    if (!token.map || !sourceMappedTokens.has(token.type)) continue;

    const sourceLine = token.map[0] + 1;
    if (!ancestorSourceLines.includes(sourceLine)) {
      token.attrSet("data-source-line", String(sourceLine));
    }
    if (token.nesting > 0) {
      ancestorSourceLines[token.level] = sourceLine;
    }
  }
}

function assignHeadingIds(tokens: Token[]): OutlineItem[] {
  const outline: OutlineItem[] = [];
  const seen = new Map<string, number>();

  for (let index = 0; index < tokens.length; index += 1) {
    const opening = tokens[index];
    if (!opening || opening.type !== "heading_open") continue;
    const inline = tokens[index + 1];
    const text = inline?.type === "inline" ? inline.content.trim() : "Section";
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count + 1}`;
    opening.attrSet("id", id);
    outline.push({
      id,
      level: Number(opening.tag.slice(1)),
      text,
      sourceLine: (opening.map?.[0] ?? 0) + 1,
    });
  }

  return outline;
}

function sanitizeMarkdown(raw: string): string {
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["img", "iframe", "object", "embed", "video", "audio"],
    FORBID_ATTR: ["style"],
    ADD_ATTR: [
      "checked",
      "data-source-line",
      "data-viva-image",
      "data-image-src",
      "data-image-alt",
      "data-image-title",
      "disabled",
      "rel",
    ],
  });
}

function prepareMarkdown(source: string): {
  environment: RenderEnvironment;
  outline: OutlineItem[];
  tokens: Token[];
} {
  const environment: RenderEnvironment = { images: [] };
  const tokens = markdown.parse(source, environment);
  assignSourceLines(tokens);
  return {
    environment,
    outline: assignHeadingIds(tokens),
    tokens,
  };
}

function lineOffsets(source: string): number[] {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") offsets.push(index + 1);
  }
  return offsets;
}

function rootTokenGroups(tokens: Token[]): Token[][] {
  const groups: Token[][] = [];
  let start = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.level !== 0) continue;
    if (token.nesting < 0 || token.nesting === 0) {
      groups.push(tokens.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < tokens.length) groups.push(tokens.slice(start));
  return groups.filter((group) => group.length > 0);
}

markdown.renderer.rules.image = (tokens, index, _options, environment) => {
  const token = tokens[index];
  const source = String(token?.attrGet("src") ?? "");
  const alt = token?.content ?? "";
  const titleValue = token?.attrGet("title");
  const title = titleValue == null ? undefined : String(titleValue);
  const renderEnvironment = environment as unknown as RenderEnvironment;
  const id = `viva-image-${renderEnvironment.images.length + 1}`;
  const remote = source.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(source);
  renderEnvironment.images.push({ alt, id, remote, source, title });

  const label = alt || source;
  return [
    `<span class="markdown-image-placeholder${remote ? " is-remote" : ""}"`,
    ` role="img" aria-label="${markdown.utils.escapeHtml(label)}">`,
    `<span class="markdown-image-placeholder__label">${markdown.utils.escapeHtml(label)}</span>`,
    "</span>",
  ].join("");
};

markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  const token = tokens[index];
  token?.attrSet("rel", "noreferrer");
  token?.attrJoin("class", "markdown-link");
  return renderer.renderToken(tokens, index, options);
};

markdown.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const highlighted = highlightCode(token?.content ?? "", token?.info ?? "");
  const sourceLine = token?.attrGet("data-source-line");
  const sourceLineAttribute = sourceLine
    ? ` data-source-line="${markdown.utils.escapeHtml(String(sourceLine))}"`
    : "";
  const label = highlighted.label
    ? `<figcaption class="markdown-code-block__language">${markdown.utils.escapeHtml(highlighted.label)}</figcaption>`
    : "";

  return [
    `<figure class="markdown-code-block"${sourceLineAttribute}${highlighted.language ? ` data-language="${highlighted.language}"` : ""}>`,
    label,
    `<pre><code class="${highlighted.className}">${highlighted.html}</code></pre>`,
    "</figure>",
  ].join("");
};

export function renderMarkdown(
  source: string,
  options: RenderMarkdownOptions = {},
): RenderedMarkdown {
  const { environment, outline, tokens } = prepareMarkdown(source);
  const raw = markdown.renderer.render(tokens, markdown.options, environment);
  const html = sanitizeMarkdown(raw);
  return {
    html,
    images: environment.images,
    outline,
    safeMdx: options.format === "mdx",
  };
}

export function renderMarkdownDocument(
  source: string,
  options: RenderMarkdownOptions = {},
): RenderedMarkdownDocument {
  const { environment, outline, tokens } = prepareMarkdown(source);
  const offsets = lineOffsets(source);
  const blocks: RenderedMarkdownBlock[] = [];

  for (const group of rootTokenGroups(tokens)) {
    const mapped = group.flatMap((token) => (token.map ? [token.map] : []));
    if (!mapped.length) continue;
    const startLine = Math.min(...mapped.map((map) => map[0]));
    const endLine = Math.max(...mapped.map((map) => map[1]));
    const start = offsets[startLine] ?? source.length;
    const end = offsets[endLine] ?? source.length;
    const imageStart = environment.images.length;
    const rawHtml = markdown.renderer.render(group, markdown.options, environment);
    blocks.push({
      end,
      html: sanitizeMarkdown(rawHtml),
      images: environment.images.slice(imageStart),
      raw: source.slice(start, end),
      sourceLine: startLine + 1,
      start,
    });
  }

  return {
    blocks,
    outline,
    safeMdx: options.format === "mdx",
  };
}

export function countWords(source: string): number {
  const visibleProse = source
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/^\s{0,3}\[[^\]\n]+\]:[^\n]*$/gm, " ")
    .replace(/!\[([^\]]*)\]\([^\n)]*\)/g, " $1 ")
    .replace(/\[([^\]]+)\]\([^\n)]*\)/g, " $1 ")
    .replace(/<https?:\/\/[^>]+>/gi, " ")
    .replace(/\bhttps?:\/\/[^\s<>)\]]+/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[>#*_~\-\[\]()!]/g, " ")
    .trim();
  if (!visibleProse) return 0;

  const cjkCharacters =
    visibleProse.match(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u30fc]/gu,
    ) ?? [];
  const withoutCjk = visibleProse.replace(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u30fc]/gu,
    " ",
  );
  const words =
    withoutCjk.match(
      /[\p{Letter}\p{Mark}\p{Number}]+(?:['’][\p{Letter}\p{Mark}\p{Number}]+)*/gu,
    ) ?? [];
  return cjkCharacters.length + words.length;
}

export function readingMinutes(source: string): number {
  return Math.max(1, Math.ceil(countWords(source) / 220));
}
