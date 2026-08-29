export interface LiveMarkdownBlock {
  end: number;
  raw: string;
  sourceLine: number;
  start: number;
}

function isFence(line: string): { marker: "`" | "~"; length: number } | null {
  const match = /^\s*(`{3,}|~{3,})/.exec(line);
  if (!match?.[1]) return null;
  return {
    marker: match[1][0] as "`" | "~",
    length: match[1].length,
  };
}

export function splitLiveMarkdownBlocks(source: string): LiveMarkdownBlock[] {
  if (!source) return [];
  const blocks: LiveMarkdownBlock[] = [];
  let offset = 0;
  let lineNumber = 1;
  let blockStart: number | null = null;
  let blockLine = 1;
  let fence: { marker: "`" | "~"; length: number } | null = null;

  const lines = source.match(/.*(?:\n|$)/g)?.filter(Boolean) ?? [];
  for (const segment of lines) {
    const line = segment.endsWith("\n") ? segment.slice(0, -1) : segment;
    const lineEnd = offset + segment.length;
    const blank = line.trim().length === 0;

    if (blockStart === null && !blank) {
      blockStart = offset;
      blockLine = lineNumber;
    }

    if (blockStart !== null) {
      const marker = isFence(line);
      if (fence) {
        if (
          marker?.marker === fence.marker &&
          marker.length >= fence.length &&
          line.trim().replaceAll(fence.marker, "").length === 0
        ) {
          fence = null;
        }
      } else if (marker) {
        fence = marker;
      } else if (blank) {
        const end = offset;
        blocks.push({
          start: blockStart,
          end,
          raw: source.slice(blockStart, end),
          sourceLine: blockLine,
        });
        blockStart = null;
      }
    }

    offset = lineEnd;
    lineNumber += 1;
  }

  if (blockStart !== null) {
    blocks.push({
      start: blockStart,
      end: source.length,
      raw: source.slice(blockStart),
      sourceLine: blockLine,
    });
  }
  return blocks;
}

export function replaceLiveMarkdownBlock(
  source: string,
  block: Pick<LiveMarkdownBlock, "start" | "end">,
  replacement: string,
): string {
  const original = source.slice(block.start, block.end);
  const boundary = original.endsWith("\r\n")
    ? "\r\n"
    : original.endsWith("\n")
      ? "\n"
      : "";
  const normalized =
    boundary && !replacement.endsWith("\n")
      ? `${replacement}${boundary}`
      : replacement;
  return `${source.slice(0, block.start)}${normalized}${source.slice(block.end)}`;
}
