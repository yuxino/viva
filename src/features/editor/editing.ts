export type SelectionDirection = "forward" | "backward" | "none";

export interface TextSelection {
  start: number;
  end: number;
  direction?: SelectionDirection;
}

export interface EditorPosition {
  line: number;
  column: number;
}

export interface TextEdit {
  value: string;
  selection: TextSelection;
}

export type MarkdownFormat = "bold" | "italic" | "inlineCode";

function clampOffset(value: string, offset: number): number {
  return Math.max(0, Math.min(value.length, offset));
}

export function normalizeSelection(
  value: string,
  selection: TextSelection,
): Required<TextSelection> {
  const start = clampOffset(value, Math.min(selection.start, selection.end));
  const end = clampOffset(value, Math.max(selection.start, selection.end));
  return {
    start,
    end,
    direction: selection.direction ?? "none",
  };
}

export function positionAtOffset(
  value: string,
  rawOffset: number,
): EditorPosition {
  const offset = clampOffset(value, rawOffset);
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (value.charCodeAt(index) !== 10) continue;
    line += 1;
    lineStart = index + 1;
  }
  return {
    line,
    column: Array.from(value.slice(lineStart, offset)).length + 1,
  };
}

export function offsetAtPosition(
  value: string,
  rawLine: number,
  rawColumn: number,
): number {
  const targetLine = Math.max(1, Math.floor(rawLine));
  const targetColumn = Math.max(1, Math.floor(rawColumn));
  let lineStart = 0;

  for (let line = 1; line < targetLine; line += 1) {
    const lineEnd = value.indexOf("\n", lineStart);
    if (lineEnd === -1) return value.length;
    lineStart = lineEnd + 1;
  }

  const lineEnd = value.indexOf("\n", lineStart);
  const lineValue = value.slice(
    lineStart,
    lineEnd === -1 ? value.length : lineEnd,
  );
  const prefix = Array.from(lineValue).slice(0, targetColumn - 1).join("");
  return lineStart + prefix.length;
}

function lineStartAt(value: string, offset: number): number {
  return value.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function replaceSelection(
  value: string,
  selection: Required<TextSelection>,
  replacement: string,
  nextStart: number,
  nextEnd: number,
): TextEdit {
  return {
    value: `${value.slice(0, selection.start)}${replacement}${value.slice(selection.end)}`,
    selection: {
      start: nextStart,
      end: nextEnd,
      direction: selection.direction,
    },
  };
}

export function formatMarkdownSelection(
  value: string,
  rawSelection: TextSelection,
  format: MarkdownFormat,
): TextEdit {
  const selection = normalizeSelection(value, rawSelection);
  const markers = {
    bold: { prefix: "**", suffix: "**", placeholder: "bold text" },
    italic: { prefix: "*", suffix: "*", placeholder: "emphasis" },
    inlineCode: { prefix: "`", suffix: "`", placeholder: "code" },
  } as const;
  const { prefix, suffix, placeholder } = markers[format];
  const selected = value.slice(selection.start, selection.end);
  const wrappedBefore = value.slice(
    Math.max(0, selection.start - prefix.length),
    selection.start,
  );
  const wrappedAfter = value.slice(
    selection.end,
    selection.end + suffix.length,
  );

  if (
    selected &&
    wrappedBefore === prefix &&
    wrappedAfter === suffix
  ) {
    const replacementStart = selection.start - prefix.length;
    return {
      value: `${value.slice(0, replacementStart)}${selected}${value.slice(
        selection.end + suffix.length,
      )}`,
      selection: {
        start: replacementStart,
        end: replacementStart + selected.length,
        direction: selection.direction,
      },
    };
  }

  const content = selected || placeholder;
  const replacement = `${prefix}${content}${suffix}`;
  const contentStart = selection.start + prefix.length;
  return replaceSelection(
    value,
    selection,
    replacement,
    contentStart,
    contentStart + content.length,
  );
}

export function continueMarkdownLine(
  value: string,
  rawSelection: TextSelection,
): TextEdit | null {
  const selection = normalizeSelection(value, rawSelection);
  if (selection.start !== selection.end) return null;

  const cursor = selection.start;
  const start = lineStartAt(value, cursor);
  const beforeCursor = value.slice(start, cursor);

  const task = beforeCursor.match(/^(\s*)([-+*])\s+\[([ xX])\]\s+(.*)$/);
  if (task) {
    const [, indent = "", marker = "-", , content = ""] = task;
    if (!content.trim()) {
      return replaceSelection(value, { ...selection, start }, indent, start + indent.length, start + indent.length);
    }
    const continuation = `\n${indent}${marker} [ ] `;
    return replaceSelection(value, selection, continuation, cursor + continuation.length, cursor + continuation.length);
  }

  const ordered = beforeCursor.match(/^(\s*)(\d+)([.)])\s+(.*)$/);
  if (ordered) {
    const [, indent = "", rawNumber = "1", punctuation = ".", content = ""] = ordered;
    if (!content.trim()) {
      return replaceSelection(value, { ...selection, start }, indent, start + indent.length, start + indent.length);
    }
    const nextNumber = Number.parseInt(rawNumber, 10) + 1;
    const continuation = `\n${indent}${nextNumber}${punctuation} `;
    return replaceSelection(value, selection, continuation, cursor + continuation.length, cursor + continuation.length);
  }

  const bullet = beforeCursor.match(/^(\s*)([-+*])\s+(.*)$/);
  if (bullet) {
    const [, indent = "", marker = "-", content = ""] = bullet;
    if (!content.trim()) {
      return replaceSelection(value, { ...selection, start }, indent, start + indent.length, start + indent.length);
    }
    const continuation = `\n${indent}${marker} `;
    return replaceSelection(value, selection, continuation, cursor + continuation.length, cursor + continuation.length);
  }

  const quote = beforeCursor.match(/^(\s*>+\s?)(.*)$/);
  if (quote) {
    const [, prefix = "> ", content = ""] = quote;
    if (!content.trim()) {
      return replaceSelection(value, { ...selection, start }, "", start, start);
    }
    const continuation = `\n${prefix}`;
    return replaceSelection(value, selection, continuation, cursor + continuation.length, cursor + continuation.length);
  }

  const indentation = beforeCursor.match(/^(\s+)\S/)?.[1];
  if (indentation) {
    const continuation = `\n${indentation}`;
    return replaceSelection(value, selection, continuation, cursor + continuation.length, cursor + continuation.length);
  }

  return null;
}

function selectedBlockEnd(value: string, start: number, end: number): number {
  const selectionEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const newline = value.indexOf("\n", selectionEnd);
  return newline < 0 ? value.length : newline;
}

function leadingIndentLength(line: string, tabSize: number): number {
  if (line.startsWith("\t")) return 1;
  const spaces = line.match(/^ +/)?.[0].length ?? 0;
  return Math.min(spaces, tabSize);
}

export function indentText(
  value: string,
  rawSelection: TextSelection,
  tabSize = 2,
  outdent = false,
): TextEdit {
  const selection = normalizeSelection(value, rawSelection);
  const safeTabSize = Math.max(1, Math.floor(tabSize));

  if (!outdent && selection.start === selection.end) {
    const startOfLine = lineStartAt(value, selection.start);
    const column = selection.start - startOfLine;
    const spaces = " ".repeat(safeTabSize - (column % safeTabSize));
    const nextOffset = selection.start + spaces.length;
    return {
      value: `${value.slice(0, selection.start)}${spaces}${value.slice(selection.end)}`,
      selection: {
        start: nextOffset,
        end: nextOffset,
        direction: selection.direction,
      },
    };
  }

  const blockStart = lineStartAt(value, selection.start);
  const blockEnd = selectedBlockEnd(value, selection.start, selection.end);
  const lines = value.slice(blockStart, blockEnd).split("\n");

  if (!outdent) {
    const indent = " ".repeat(safeTabSize);
    const replacement = lines.map((line) => `${indent}${line}`).join("\n");
    return {
      value: `${value.slice(0, blockStart)}${replacement}${value.slice(blockEnd)}`,
      selection: {
        start: selection.start + safeTabSize,
        end: selection.end + safeTabSize * lines.length,
        direction: selection.direction,
      },
    };
  }

  const removals = lines.map((line) => leadingIndentLength(line, safeTabSize));
  if (removals.every((amount) => amount === 0)) {
    return { value, selection };
  }

  const replacement = lines
    .map((line, index) => line.slice(removals[index] ?? 0))
    .join("\n");
  const firstRemoval = removals[0] ?? 0;
  const removedBeforeStart = Math.min(
    firstRemoval,
    Math.max(0, selection.start - blockStart),
  );
  const totalRemoved = removals.reduce((total, amount) => total + amount, 0);

  return {
    value: `${value.slice(0, blockStart)}${replacement}${value.slice(blockEnd)}`,
    selection: {
      start: selection.start - removedBeforeStart,
      end: selection.end - totalRemoved,
      direction: selection.direction,
    },
  };
}

export function sourceLineFromScroll(
  value: string,
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  let lineCount = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) lineCount += 1;
  }
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  if (lineCount === 1 || maxScroll === 0) return 1;
  const progress = Math.max(0, Math.min(1, scrollTop / maxScroll));
  return Math.round(progress * (lineCount - 1)) + 1;
}

export function scrollTopForSourceLine(
  value: string,
  sourceLine: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  let lineCount = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) lineCount += 1;
  }
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  if (lineCount === 1 || maxScroll === 0) return 0;
  const clampedLine = Math.max(1, Math.min(lineCount, sourceLine));
  return ((clampedLine - 1) / (lineCount - 1)) * maxScroll;
}
