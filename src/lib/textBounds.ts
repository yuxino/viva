export interface BoundedText {
  lineCount: number;
  text: string;
  truncated: boolean;
}

export function boundTextPrefix(
  source: string,
  maxCharacters: number,
  maxLines: number,
): BoundedText {
  const characterLimit = Math.max(0, Math.floor(maxCharacters));
  const lineLimit = Math.max(0, Math.floor(maxLines));
  if (!source || characterLimit === 0 || lineLimit === 0) {
    return {
      lineCount: 0,
      text: "",
      truncated: source.length > 0,
    };
  }

  const scanEnd = Math.min(source.length, characterLimit);
  let end = scanEnd;
  let lineCount = 1;

  for (let index = 0; index < scanEnd; index += 1) {
    const character = source[index];
    const isLineBreak =
      character === "\n" ||
      (character === "\r" && source[index + 1] !== "\n");
    if (!isLineBreak) continue;
    if (lineCount >= lineLimit) {
      end = index;
      break;
    }
    lineCount += 1;
  }

  if (
    end > 0 &&
    end < source.length &&
    /[\uD800-\uDBFF]/.test(source[end - 1] ?? "") &&
    /[\uDC00-\uDFFF]/.test(source[end] ?? "")
  ) {
    end -= 1;
  }

  return {
    lineCount,
    text: source.slice(0, end),
    truncated: end < source.length,
  };
}
