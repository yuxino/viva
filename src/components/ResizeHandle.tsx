import { useRef, type KeyboardEvent, type PointerEvent } from "react";

export interface ResizeHandleProps {
  label: string;
  onDelta: (delta: number) => void;
  orientation?: "horizontal" | "vertical";
  step?: number;
}

export function ResizeHandle({
  label,
  onDelta,
  orientation = "vertical",
  step = 12,
}: ResizeHandleProps) {
  const lastPositionRef = useRef(0);

  const coordinate = (event: PointerEvent) =>
    orientation === "vertical" ? event.clientX : event.clientY;

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    lastPositionRef.current = coordinate(event);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const next = coordinate(event);
    onDelta(next - lastPositionRef.current);
    lastPositionRef.current = next;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const backwards = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
    const forwards = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
    if (event.key === backwards) {
      event.preventDefault();
      onDelta(-step);
    } else if (event.key === forwards) {
      event.preventDefault();
      onDelta(step);
    }
  };

  return (
    <div
      aria-label={label}
      aria-orientation={orientation}
      className="resize-handle"
      data-orientation={orientation}
      onDoubleClick={() => onDelta(Number.POSITIVE_INFINITY)}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      role="separator"
      tabIndex={0}
    />
  );
}
