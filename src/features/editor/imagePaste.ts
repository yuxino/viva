import { normalizeSelection } from "./editing";
import type { TextSelection } from "./editing";

export interface PendingImagePasteEdit {
  value: string;
  selection: Required<TextSelection>;
  token: string;
}

export interface SettledImagePasteEdit {
  value: string;
  selection: Required<TextSelection>;
  applied: boolean;
}

let fallbackTokenSequence = 0;

function createFallbackTokenId(): string {
  fallbackTokenSequence += 1;
  const randomValues = new Uint32Array(4);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(randomValues);
  } else {
    for (let index = 0; index < randomValues.length; index += 1) {
      randomValues[index] = Math.floor(Math.random() * 0x1_0000_0000);
    }
  }
  const random = Array.from(randomValues, (value) =>
    value.toString(16).padStart(8, "0"),
  ).join("");
  return `${Date.now().toString(36)}-${fallbackTokenSequence.toString(36)}-${random}`;
}

export function createImagePasteId(): string {
  return (
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : createFallbackTokenId()
  );
}

export function createImagePasteToken(id = createImagePasteId()): string {
  return `[](#viva-image-paste-${id})`;
}

export function hasImagePasteToken(value: string, token: string): boolean {
  return token.length > 0 && value.includes(token);
}

export function insertImagePasteToken(
  value: string,
  rawSelection: TextSelection,
  token = createImagePasteToken(),
): PendingImagePasteEdit {
  const selection = normalizeSelection(value, rawSelection);
  const caret = selection.start + token.length;
  return {
    value: `${value.slice(0, selection.start)}${token}${value.slice(selection.end)}`,
    token,
    selection: {
      start: caret,
      end: caret,
      direction: selection.direction,
    },
  };
}

function adjustedOffset(
  offset: number,
  tokenStart: number,
  tokenEnd: number,
  replacementLength: number,
): number {
  if (offset <= tokenStart) return offset;
  if (offset >= tokenEnd) {
    return offset + replacementLength - (tokenEnd - tokenStart);
  }
  return tokenStart + replacementLength;
}

function settleImagePasteToken(
  value: string,
  rawSelection: TextSelection,
  token: string,
  replacement: string,
): SettledImagePasteEdit {
  const selection = normalizeSelection(value, rawSelection);
  const tokenStart = value.indexOf(token);
  if (tokenStart < 0) {
    return { value, selection, applied: false };
  }

  const tokenEnd = tokenStart + token.length;
  return {
    value: `${value.slice(0, tokenStart)}${replacement}${value.slice(tokenEnd)}`,
    applied: true,
    selection: {
      start: adjustedOffset(
        selection.start,
        tokenStart,
        tokenEnd,
        replacement.length,
      ),
      end: adjustedOffset(
        selection.end,
        tokenStart,
        tokenEnd,
        replacement.length,
      ),
      direction: selection.direction,
    },
  };
}

export function resolveImagePasteToken(
  value: string,
  selection: TextSelection,
  token: string,
  imageMarkdown: string,
): SettledImagePasteEdit {
  return settleImagePasteToken(value, selection, token, imageMarkdown);
}

export function removeImagePasteToken(
  value: string,
  selection: TextSelection,
  token: string,
): SettledImagePasteEdit {
  return settleImagePasteToken(value, selection, token, "");
}
