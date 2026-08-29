import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistoryEntry } from "../features";
import { useI18n, type I18nContextValue } from "../i18n";
import {
  describeNativeError,
  listDocumentHistory,
  readDocumentHistory,
  type DocumentHistoryEntry,
} from "../lib/native";

interface HistoryScope {
  workspaceRoot: string;
  relativePath: string;
}

export interface DocumentHistoryController {
  entries: HistoryEntry[];
  error: string | null;
  loading: boolean;
  previewLoading: boolean;
  refresh: () => Promise<void>;
  select: (versionId: string) => Promise<void>;
  selectedEntry: HistoryEntry | null;
  selectedId: string | null;
}

function formatVersionTime(
  timestamp: number,
  i18n: Pick<I18nContextValue, "fmt" | "formatDateTime" | "t">,
): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return i18n.t("Saved version");

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfVersionDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const dayDifference = Math.round(
    (startOfToday - startOfVersionDay) / 86_400_000,
  );
  const time = i18n.formatDateTime(date, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (dayDifference === 0) return i18n.fmt("Today, %@", time);
  if (dayDifference === 1) return i18n.fmt("Yesterday, %@", time);
  return i18n.formatDateTime(date, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatVersionSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function toHistoryEntry(
  entry: DocumentHistoryEntry,
  i18n: Pick<I18nContextValue, "fmt" | "formatDateTime" | "t">,
): HistoryEntry {
  return {
    id: entry.versionId,
    label: formatVersionTime(entry.createdAtMs, i18n),
    createdAt: new Date(entry.createdAtMs).toISOString(),
    description: i18n.fmt(
      "%@ · saved locally",
      formatVersionSize(entry.sizeBytes),
    ),
  };
}

export function useDocumentHistory(
  scope: HistoryScope | null,
): DocumentHistoryController {
  const { fmt, formatDateTime, t } = useI18n();
  const i18n = useMemo(
    () => ({ fmt, formatDateTime, t }),
    [fmt, formatDateTime, t],
  );
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const scopeKey = scope
    ? `${scope.workspaceRoot}\u0000${scope.relativePath}`
    : null;

  useEffect(() => {
    requestIdRef.current += 1;
    setEntries([]);
    setSelectedId(null);
    setLoading(false);
    setPreviewLoading(false);
    setError(null);
  }, [scopeKey]);

  const loadVersion = useCallback(
    async (versionId: string, requestId: number): Promise<void> => {
      const activeScope = scopeRef.current;
      if (!activeScope) return;
      setPreviewLoading(true);
      try {
        const snapshot = await readDocumentHistory(
          activeScope.workspaceRoot,
          activeScope.relativePath,
          versionId,
        );
        if (requestIdRef.current !== requestId) return;
        setEntries((current) =>
          current.map((entry) =>
            entry.id === snapshot.versionId
              ? { ...entry, content: snapshot.content }
              : entry.content === undefined
                ? entry
                : { ...entry, content: undefined },
          ),
        );
      } catch (historyError) {
        if (requestIdRef.current === requestId) {
          setError(describeNativeError(historyError, t));
        }
      } finally {
        if (requestIdRef.current === requestId) setPreviewLoading(false);
      }
    },
    [t],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const activeScope = scopeRef.current;
    if (!activeScope) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setPreviewLoading(false);
    setError(null);
    try {
      const metadata = await listDocumentHistory(
        activeScope.workspaceRoot,
        activeScope.relativePath,
      );
      if (requestIdRef.current !== requestId) return;
      const nextEntries = metadata.map((entry) => toHistoryEntry(entry, i18n));
      const nextSelectedId = nextEntries[0]?.id ?? null;
      setEntries(nextEntries);
      setSelectedId(nextSelectedId);
      setLoading(false);
      if (nextSelectedId) await loadVersion(nextSelectedId, requestId);
    } catch (historyError) {
      if (requestIdRef.current === requestId) {
        setError(describeNativeError(historyError, t));
      }
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [i18n, loadVersion]);

  const select = useCallback(
    async (versionId: string): Promise<void> => {
      const existing = entries.find((entry) => entry.id === versionId);
      if (!existing) return;
      setSelectedId(versionId);
      setEntries((current) =>
        current.map((entry) =>
          entry.id === versionId || entry.content === undefined
            ? entry
            : { ...entry, content: undefined },
        ),
      );
      setError(null);
      if (existing.content !== undefined) return;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      await loadVersion(versionId, requestId);
    },
    [entries, loadVersion],
  );

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? null,
    [entries, selectedId],
  );

  return {
    entries,
    error,
    loading,
    previewLoading,
    refresh,
    select,
    selectedEntry,
    selectedId,
  };
}
