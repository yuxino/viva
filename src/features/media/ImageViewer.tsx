import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { useI18n } from "../../i18n";
import {
  workspaceImageCache,
  type WorkspaceImageCacheLike,
  type WorkspaceImageLease,
} from "../../lib/media";
import { constrainImagePan } from "./imagePan";
import "./media.css";

export interface ImageViewerSource {
  alt?: string;
  relativePath: string;
  workspaceRoot: string;
}

export interface ImageViewerLabels {
  close: string;
  decodeError: string;
  loading: string;
  resetZoom: string;
  title: string;
  zoomIn: string;
  zoomLevel: string;
  zoomOut: string;
}

export interface ImageViewerProps {
  cache?: WorkspaceImageCacheLike;
  labels?: Partial<ImageViewerLabels>;
  onClose: () => void;
  source: ImageViewerSource | null;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

interface PanPosition {
  x: number;
  y: number;
}

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function fileName(path: string): string {
  return path.split("/").at(-1) || path;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function ImageViewer({
  cache = workspaceImageCache,
  labels: providedLabels,
  onClose,
  source,
}: ImageViewerProps) {
  const { t } = useI18n();
  const labels: ImageViewerLabels = {
    close: t("Close image viewer"),
    decodeError: t("This image could not be displayed."),
    loading: t("Loading image…"),
    resetZoom: t("Fit image"),
    title: t("Image viewer"),
    zoomIn: t("Zoom in"),
    zoomLevel: t("Zoom level"),
    zoomOut: t("Zoom out"),
    ...providedLabels,
  };
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startPanX: number;
    startPanY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [asset, setAsset] = useState<WorkspaceImageLease | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const constrainPan = useCallback(
    (candidate: PanPosition, nextZoom: number): PanPosition => {
      const stage = stageRef.current;
      const image = imageRef.current;
      if (!stage || !image) {
        return nextZoom <= MIN_ZOOM ? { x: 0, y: 0 } : candidate;
      }
      return constrainImagePan(
        candidate,
        nextZoom,
        { height: stage.clientHeight, width: stage.clientWidth },
        { height: image.offsetHeight, width: image.offsetWidth },
      );
    },
    [],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (source && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!source && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [source]);

  useEffect(() => {
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
    setAsset(null);
    setError(null);
    if (!source) return;

    let current = true;
    let lease: WorkspaceImageLease | null = null;
    void cache
      .acquire(source.workspaceRoot, source.relativePath)
      .then((nextLease) => {
        lease = nextLease;
        if (!current) {
          nextLease.release();
          lease = null;
          return;
        }
        setAsset(nextLease);
      })
      .catch(() => {
        if (current) setError(labels.decodeError);
      });

    return () => {
      current = false;
      lease?.release();
    };
  }, [cache, labels.decodeError, source]);

  function setNextZoom(value: number): void {
    const next = clampZoom(value);
    setZoom(next);
    setPan((current) => constrainPan(current, next));
  }

  useEffect(() => {
    if (!asset) return;
    const handleResize = () => {
      setPan((current) => constrainPan(current, zoom));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [asset, constrainPan, zoom]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (zoom === MIN_ZOOM || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startPanX: pan.x,
      startPanY: pan.y,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan(
      constrainPan(
        {
          x: drag.startPanX + event.clientX - drag.startX,
          y: drag.startPanY + event.clientY - drag.startY,
        },
        zoom,
      ),
    );
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>): void {
    if (!asset) return;
    event.preventDefault();
    setNextZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>): void {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setNextZoom(zoom + ZOOM_STEP);
    } else if (event.key === "-") {
      event.preventDefault();
      setNextZoom(zoom - ZOOM_STEP);
    } else if (event.key === "0") {
      event.preventDefault();
      setNextZoom(MIN_ZOOM);
    }
  }

  function handleStageBackdrop(event: MouseEvent<HTMLDivElement>): void {
    if (
      zoom === MIN_ZOOM &&
      event.button === 0 &&
      event.target === event.currentTarget
    ) {
      onClose();
    }
  }

  const imageStyle = {
    transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
  } as CSSProperties;
  const title = source ? fileName(source.relativePath) : labels.title;

  return (
    <dialog
      aria-label={labels.title}
      className="image-viewer"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={handleKeyDown}
      ref={dialogRef}
    >
      <div className="image-viewer__surface">
        <header className="image-viewer__header">
          <div className="image-viewer__heading">
            <strong>{title}</strong>
            {asset ? (
              <span>
                {asset.width} × {asset.height} · {formatBytes(asset.sizeBytes)}
              </span>
            ) : null}
          </div>
          <div className="image-viewer__controls">
            <button
              aria-label={labels.zoomOut}
              disabled={!asset || zoom === MIN_ZOOM}
              onClick={() => setNextZoom(zoom - ZOOM_STEP)}
              type="button"
            >
              −
            </button>
            <button
              aria-label={labels.resetZoom}
              disabled={!asset}
              onClick={() => setNextZoom(MIN_ZOOM)}
              type="button"
            >
              <output aria-label={labels.zoomLevel}>{Math.round(zoom * 100)}%</output>
            </button>
            <button
              aria-label={labels.zoomIn}
              disabled={!asset || zoom === MAX_ZOOM}
              onClick={() => setNextZoom(zoom + ZOOM_STEP)}
              type="button"
            >
              +
            </button>
            <span aria-hidden="true" className="image-viewer__separator" />
            <button aria-label={labels.close} onClick={onClose} type="button">
              ×
            </button>
          </div>
        </header>
        <div
          className={`image-viewer__stage${zoom > MIN_ZOOM ? " is-zoomed" : ""}`}
          onDoubleClick={() => setNextZoom(zoom === MIN_ZOOM ? 2 : MIN_ZOOM)}
          onMouseDown={handleStageBackdrop}
          onPointerCancel={finishPointer}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onWheel={handleWheel}
          ref={stageRef}
        >
          {asset && source && !error ? (
            <img
              alt={source.alt || title}
              decoding="async"
              draggable={false}
              onError={() => setError(labels.decodeError)}
              onLoad={() => setPan((current) => constrainPan(current, zoom))}
              ref={imageRef}
              src={asset.url}
              style={imageStyle}
            />
          ) : (
            <div className={`image-viewer__message${error ? " is-error" : ""}`} role="status">
              {error ?? labels.loading}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
