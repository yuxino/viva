export type HistoryLineDiffKind = "unchanged" | "added" | "removed";

export interface HistoryLineDiffRow {
  kind: HistoryLineDiffKind;
  historicalLine: number | null;
  currentLine: number | null;
  text: string;
}

export interface HistoryLineDiffSummary {
  additions: number;
  removals: number;
  unchanged: number;
}

export interface HistoryLineDiffResult {
  rows: HistoryLineDiffRow[];
  summary: HistoryLineDiffSummary;
}

const MAX_LCS_MATRIX_CELLS = 400_000;

function splitLines(content: string): string[] {
  return content ? content.split(/\r\n|\n|\r/) : [];
}

function unchangedRow(
  text: string,
  historicalLine: number,
  currentLine: number,
): HistoryLineDiffRow {
  return {
    kind: "unchanged",
    historicalLine,
    currentLine,
    text,
  };
}

function removedRow(text: string, line: number): HistoryLineDiffRow {
  return {
    kind: "removed",
    historicalLine: line,
    currentLine: null,
    text,
  };
}

function addedRow(text: string, line: number): HistoryLineDiffRow {
  return {
    kind: "added",
    historicalLine: null,
    currentLine: line,
    text,
  };
}

function diffMiddleWithLcs(
  historical: readonly string[],
  current: readonly string[],
  historicalOffset: number,
  currentOffset: number,
): HistoryLineDiffRow[] {
  const width = current.length + 1;
  const matrix = new Uint32Array((historical.length + 1) * width);

  for (let historicalIndex = historical.length - 1; historicalIndex >= 0; historicalIndex -= 1) {
    for (let currentIndex = current.length - 1; currentIndex >= 0; currentIndex -= 1) {
      const cell = historicalIndex * width + currentIndex;
      matrix[cell] =
        historical[historicalIndex] === current[currentIndex]
          ? (matrix[(historicalIndex + 1) * width + currentIndex + 1] ?? 0) + 1
          : Math.max(
              matrix[(historicalIndex + 1) * width + currentIndex] ?? 0,
              matrix[historicalIndex * width + currentIndex + 1] ?? 0,
            );
    }
  }

  const rows: HistoryLineDiffRow[] = [];
  let historicalIndex = 0;
  let currentIndex = 0;

  while (historicalIndex < historical.length && currentIndex < current.length) {
    const historicalLine = historical[historicalIndex];
    const currentLine = current[currentIndex];
    if (historicalLine === currentLine) {
      rows.push(
        unchangedRow(
          historicalLine ?? "",
          historicalOffset + historicalIndex + 1,
          currentOffset + currentIndex + 1,
        ),
      );
      historicalIndex += 1;
      currentIndex += 1;
      continue;
    }

    const removeScore =
      matrix[(historicalIndex + 1) * width + currentIndex] ?? 0;
    const addScore = matrix[historicalIndex * width + currentIndex + 1] ?? 0;
    if (removeScore >= addScore) {
      rows.push(
        removedRow(
          historicalLine ?? "",
          historicalOffset + historicalIndex + 1,
        ),
      );
      historicalIndex += 1;
    } else {
      rows.push(
        addedRow(currentLine ?? "", currentOffset + currentIndex + 1),
      );
      currentIndex += 1;
    }
  }

  while (historicalIndex < historical.length) {
    rows.push(
      removedRow(
        historical[historicalIndex] ?? "",
        historicalOffset + historicalIndex + 1,
      ),
    );
    historicalIndex += 1;
  }

  while (currentIndex < current.length) {
    rows.push(
      addedRow(current[currentIndex] ?? "", currentOffset + currentIndex + 1),
    );
    currentIndex += 1;
  }

  return rows;
}

function diffMiddleCoarsely(
  historical: readonly string[],
  current: readonly string[],
  historicalOffset: number,
  currentOffset: number,
): HistoryLineDiffRow[] {
  return [
    ...historical.map((line, index) =>
      removedRow(line, historicalOffset + index + 1),
    ),
    ...current.map((line, index) => addedRow(line, currentOffset + index + 1)),
  ];
}

export function createHistoryLineDiff(
  historicalContent: string,
  currentContent: string,
): HistoryLineDiffResult {
  const historicalLines = splitLines(historicalContent);
  const currentLines = splitLines(currentContent);
  const rows: HistoryLineDiffRow[] = [];

  let prefixLength = 0;
  while (
    prefixLength < historicalLines.length &&
    prefixLength < currentLines.length &&
    historicalLines[prefixLength] === currentLines[prefixLength]
  ) {
    rows.push(
      unchangedRow(
        historicalLines[prefixLength] ?? "",
        prefixLength + 1,
        prefixLength + 1,
      ),
    );
    prefixLength += 1;
  }

  let historicalEnd = historicalLines.length;
  let currentEnd = currentLines.length;
  while (
    historicalEnd > prefixLength &&
    currentEnd > prefixLength &&
    historicalLines[historicalEnd - 1] === currentLines[currentEnd - 1]
  ) {
    historicalEnd -= 1;
    currentEnd -= 1;
  }

  const historicalMiddle = historicalLines.slice(prefixLength, historicalEnd);
  const currentMiddle = currentLines.slice(prefixLength, currentEnd);
  const matrixCells =
    (historicalMiddle.length + 1) * (currentMiddle.length + 1);
  rows.push(
    ...(matrixCells <= MAX_LCS_MATRIX_CELLS
      ? diffMiddleWithLcs(
          historicalMiddle,
          currentMiddle,
          prefixLength,
          prefixLength,
        )
      : diffMiddleCoarsely(
          historicalMiddle,
          currentMiddle,
          prefixLength,
          prefixLength,
        )),
  );

  for (let index = historicalEnd; index < historicalLines.length; index += 1) {
    const currentIndex = currentEnd + (index - historicalEnd);
    rows.push(
      unchangedRow(
        historicalLines[index] ?? "",
        index + 1,
        currentIndex + 1,
      ),
    );
  }

  const summary: HistoryLineDiffSummary = {
    additions: 0,
    removals: 0,
    unchanged: 0,
  };
  for (const row of rows) {
    if (row.kind === "added") summary.additions += 1;
    else if (row.kind === "removed") summary.removals += 1;
    else summary.unchanged += 1;
  }

  return { rows, summary };
}
