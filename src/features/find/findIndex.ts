import {
  findLiteralMatchAt,
  findLiteralMatchAtOrAfterOffset,
  visitLiteralMatches,
  wrapMatchIndex,
  type FindMatch,
  type FindOptions,
} from "./find";

const CHECKPOINT_INTERVAL = 1_024;

interface FindCheckpoint extends FindMatch {
  index: number;
}

export interface LiteralFindIndex {
  count: number;
  offsetIndex: number;
  select: (activeIndex: number) => {
    activeIndex: number;
    match?: FindMatch;
  };
}

export function buildLiteralFindIndex(
  source: string,
  query: string,
  options: FindOptions,
  selectionOffset?: number,
): LiteralFindIndex {
  const checkpoints: FindCheckpoint[] = [];
  let offsetIndex = -1;
  const count = visitLiteralMatches(
    source,
    query,
    options,
    (start, end, index) => {
      if (
        offsetIndex < 0 &&
        selectionOffset !== undefined &&
        start >= selectionOffset
      ) {
        offsetIndex = index;
      }
      if (index % CHECKPOINT_INTERVAL === 0) {
        checkpoints.push({ end, index, start });
      }
    },
  );

  return {
    count,
    offsetIndex,
    select(activeIndex) {
      if (count === 0) return { activeIndex: -1 };
      const normalizedIndex = wrapMatchIndex(activeIndex, count);
      const checkpoint =
        checkpoints[Math.floor(normalizedIndex / CHECKPOINT_INTERVAL)];
      if (!checkpoint) {
        return {
          activeIndex: normalizedIndex,
          match: findLiteralMatchAt(source, query, options, normalizedIndex),
        };
      }
      if (checkpoint.index === normalizedIndex) {
        return {
          activeIndex: normalizedIndex,
          match: { end: checkpoint.end, start: checkpoint.start },
        };
      }
      return {
        activeIndex: normalizedIndex,
        match: findLiteralMatchAtOrAfterOffset(
          source,
          query,
          options,
          checkpoint.end,
          normalizedIndex - checkpoint.index - 1,
        ),
      };
    },
  };
}
