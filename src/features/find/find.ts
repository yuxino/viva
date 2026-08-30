export interface FindMatch {
  end: number;
  start: number;
}

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

export type MatchDirection = -1 | 1;

export const MAX_MATERIALIZED_FIND_MATCHES = 10_000;

const UNICODE_WORD_CHARACTER = /[\p{L}\p{M}\p{N}_]/u;

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function characterBefore(value: string, index: number) {
  if (index <= 0) return "";

  const trailingCodeUnit = value.charCodeAt(index - 1);
  if (
    trailingCodeUnit >= 0xdc00 &&
    trailingCodeUnit <= 0xdfff &&
    index >= 2
  ) {
    const leadingCodeUnit = value.charCodeAt(index - 2);
    if (leadingCodeUnit >= 0xd800 && leadingCodeUnit <= 0xdbff) {
      return value.slice(index - 2, index);
    }
  }

  return value[index - 1] ?? "";
}

function characterAfter(value: string, index: number) {
  if (index >= value.length) return "";

  const codePoint = value.codePointAt(index);
  return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
}

function isUnicodeWordCharacter(value: string) {
  return value !== "" && UNICODE_WORD_CHARACTER.test(value);
}

function hasWholeWordBoundaries(source: string, start: number, end: number) {
  return (
    !isUnicodeWordCharacter(characterBefore(source, start)) &&
    !isUnicodeWordCharacter(characterAfter(source, end))
  );
}

function literalExpression(query: string, caseSensitive: boolean) {
  return new RegExp(
    escapeRegularExpression(query),
    caseSensitive ? "gu" : "giu",
  );
}

export function visitLiteralMatches(
  source: string,
  query: string,
  options: FindOptions,
  visit?: (start: number, end: number, index: number) => boolean | void,
  startOffset = 0,
) {
  if (query.length === 0) return 0;

  const expression = literalExpression(query, options.caseSensitive);
  expression.lastIndex = Math.min(
    source.length,
    Math.max(0, Math.trunc(startOffset)),
  );
  let count = 0;
  for (;;) {
    const result = expression.exec(source);
    if (!result) break;
    if (result.index === undefined || result[0].length === 0) continue;
    const start = result.index;
    const end = start + result[0].length;
    if (options.wholeWord && !hasWholeWordBoundaries(source, start, end)) {
      continue;
    }
    const keepScanning = visit?.(start, end, count);
    count += 1;
    if (keepScanning === false) break;
  }
  return count;
}

export function findLiteralMatches(
  source: string,
  query: string,
  options: FindOptions,
): FindMatch[] {
  const matches: FindMatch[] = [];
  visitLiteralMatches(source, query, options, (start, end) => {
    matches.push({ end, start });
    return matches.length < MAX_MATERIALIZED_FIND_MATCHES;
  });
  return matches;
}

export function countLiteralMatches(
  source: string,
  query: string,
  options: FindOptions,
) {
  return visitLiteralMatches(source, query, options);
}

export function findLiteralMatchAt(
  source: string,
  query: string,
  options: FindOptions,
  index: number,
): FindMatch | undefined {
  if (!Number.isSafeInteger(index) || index < 0) return undefined;
  let match: FindMatch | undefined;
  visitLiteralMatches(source, query, options, (start, end, matchIndex) => {
    if (matchIndex !== index) return true;
    match = { end, start };
    return false;
  });
  return match;
}

export function findLiteralMatchAtOrAfterOffset(
  source: string,
  query: string,
  options: FindOptions,
  startOffset: number,
  relativeIndex: number,
): FindMatch | undefined {
  if (
    !Number.isSafeInteger(startOffset) ||
    startOffset < 0 ||
    !Number.isSafeInteger(relativeIndex) ||
    relativeIndex < 0
  ) {
    return undefined;
  }
  let match: FindMatch | undefined;
  visitLiteralMatches(
    source,
    query,
    options,
    (start, end, matchIndex) => {
      if (matchIndex !== relativeIndex) return true;
      match = { end, start };
      return false;
    },
    startOffset,
  );
  return match;
}

export function findLiteralMatchIndexAtOffset(
  source: string,
  query: string,
  options: FindOptions,
  offset: number,
) {
  if (!Number.isSafeInteger(offset) || offset < 0) return -1;
  let found = -1;
  visitLiteralMatches(source, query, options, (start, _end, index) => {
    if (start < offset) return true;
    if (start === offset) found = index;
    return false;
  });
  return found;
}

export function findLiteralMatchIndexAtOrAfter(
  source: string,
  query: string,
  options: FindOptions,
  offset: number,
) {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return { count: countLiteralMatches(source, query, options), index: -1 };
  }
  let index = -1;
  const count = visitLiteralMatches(
    source,
    query,
    options,
    (start, _end, matchIndex) => {
      if (index < 0 && start >= offset) index = matchIndex;
    },
  );
  return { count, index };
}

export function replaceAllLiteralMatches(
  source: string,
  query: string,
  options: FindOptions,
  replacement: string,
) {
  if (query.length === 0) return source;
  const expression = literalExpression(query, options.caseSensitive);
  return source.replace(expression, (value, offset: number) => {
    const end = offset + value.length;
    if (options.wholeWord && !hasWholeWordBoundaries(source, offset, end)) {
      return value;
    }
    return replacement;
  });
}

export function wrapMatchIndex(index: number, matchCount: number) {
  const count = Math.trunc(matchCount);
  if (!Number.isFinite(index) || !Number.isFinite(count) || count <= 0) return -1;

  const normalizedIndex = Math.trunc(index);
  return ((normalizedIndex % count) + count) % count;
}

export function stepMatchIndex(
  activeIndex: number,
  matchCount: number,
  direction: MatchDirection,
) {
  const count = Math.trunc(matchCount);
  if (!Number.isFinite(count) || count <= 0) return -1;
  if (!Number.isFinite(activeIndex) || activeIndex < 0) {
    return direction === -1 ? count - 1 : 0;
  }
  return wrapMatchIndex(activeIndex + direction, count);
}

function isValidMatch(source: string, match: FindMatch) {
  return (
    Number.isInteger(match.start) &&
    Number.isInteger(match.end) &&
    match.start >= 0 &&
    match.end >= match.start &&
    match.end <= source.length
  );
}

export function replaceOneMatch(
  source: string,
  match: FindMatch,
  replacement: string,
) {
  if (!isValidMatch(source, match)) return source;
  return source.slice(0, match.start) + replacement + source.slice(match.end);
}

export function replaceAllMatches(
  source: string,
  matches: readonly FindMatch[],
  replacement: string,
) {
  const orderedMatches = [...matches]
    .filter((match) => isValidMatch(source, match))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  if (orderedMatches.length === 0) return source;

  let cursor = 0;
  let result = "";
  for (const match of orderedMatches) {
    if (match.start < cursor) continue;
    result += source.slice(cursor, match.start) + replacement;
    cursor = match.end;
  }

  return result + source.slice(cursor);
}
