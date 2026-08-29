import {
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cx } from "./utils";
import "./ui.css";

export interface SegmentedOption<T extends string> {
  ariaLabel?: string;
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  value: T;
}

export interface SegmentedControlProps<T extends string> {
  className?: string;
  disabled?: boolean;
  iconOnly?: boolean;
  label: string;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  size?: "small" | "medium";
  value: T;
}

export function SegmentedControl<T extends string>({
  className,
  disabled = false,
  iconOnly = false,
  label,
  onChange,
  options,
  size = "medium",
  value,
}: SegmentedControlProps<T>) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const moveSelection = (
    currentIndex: number,
    direction: 1 | -1,
  ) => {
    if (!options.length) return;

    for (let offset = 1; offset <= options.length; offset += 1) {
      const index =
        (currentIndex + direction * offset + options.length) % options.length;
      const option = options[index];
      if (!disabled && option && !option.disabled) {
        onChange(option.value);
        itemRefs.current[index]?.focus();
        return;
      }
    }
  };

  const selectBoundary = (fromEnd: boolean) => {
    const indexes = options.map((_, index) => index);
    if (fromEnd) indexes.reverse();
    const index = indexes.find(
      (candidate) => !disabled && !options[candidate]?.disabled,
    );
    if (index === undefined) return;
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    itemRefs.current[index]?.focus();
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(index, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(index, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectBoundary(false);
    } else if (event.key === "End") {
      event.preventDefault();
      selectBoundary(true);
    }
  };

  return (
    <div
      aria-disabled={disabled || undefined}
      aria-label={label}
      aria-orientation="horizontal"
      className={cx("viva-segmented", className)}
      data-size={size}
      role="radiogroup"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            aria-checked={selected}
            aria-label={
              iconOnly ? (option.ariaLabel ?? option.label) : option.ariaLabel
            }
            className="viva-segmented__item"
            data-selected={selected || undefined}
            disabled={disabled || option.disabled}
            key={option.value}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            role="radio"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {option.icon ? (
              <span aria-hidden="true" className="viva-segmented__icon">
                {option.icon}
              </span>
            ) : null}
            {iconOnly ? (
              <span className="visually-hidden">{option.label}</span>
            ) : (
              <span>{option.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
