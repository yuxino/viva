import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FindBar, type FindBarLabels, type FindBarProps } from "./FindBar";

afterEach(cleanup);

const labels: FindBarLabels = {
  close: "Close find and replace",
  find: "Find in document",
  hideReplace: "Hide replace",
  matchCase: "Match case",
  nextMatch: "Next match",
  previousMatch: "Previous match",
  replace: "Replace",
  replaceAll: "Replace all",
  replaceInput: "Replace with",
  showReplace: "Show replace",
  wholeWord: "Whole word",
};

function renderFindBar(overrides: Partial<FindBarProps> = {}) {
  const props: FindBarProps = {
    activeIndex: 1,
    caseSensitive: false,
    labels,
    matchCount: 4,
    onCaseSensitiveChange: vi.fn(),
    onClose: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onQueryChange: vi.fn(),
    onReplace: vi.fn(),
    onReplaceAll: vi.fn(),
    onReplaceVisibleChange: vi.fn(),
    onReplacementChange: vi.fn(),
    onWholeWordChange: vi.fn(),
    query: "Viva",
    replacement: "Viva Writer",
    replaceVisible: true,
    wholeWord: false,
    ...overrides,
  };

  render(<FindBar {...props} />);
  return props;
}

describe("FindBar", () => {
  it("focuses the query, exposes the result count, and reports controlled edits", () => {
    const props = renderFindBar();
    const query = screen.getByRole("searchbox", { name: labels.find });
    const replacement = screen.getByRole("textbox", {
      name: labels.replaceInput,
    });

    expect(query).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("2 / 4");

    fireEvent.change(query, { target: { value: "quiet" } });
    fireEvent.change(replacement, { target: { value: "calm" } });

    expect(props.onQueryChange).toHaveBeenCalledWith("quiet");
    expect(props.onReplacementChange).toHaveBeenCalledWith("calm");
  });

  it("keeps ordinary Find on one line and asks to expand Replace", () => {
    const props = renderFindBar({ replaceVisible: false });

    expect(
      screen.queryByRole("textbox", { name: labels.replaceInput }),
    ).not.toBeInTheDocument();

    const expand = screen.getByRole("button", { name: labels.showReplace });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expand);
    expect(props.onReplaceVisibleChange).toHaveBeenCalledWith(true);
  });

  it("focuses the replacement input when it is the requested target", () => {
    renderFindBar({ focusTarget: "replacement", replaceVisible: true });

    expect(
      screen.getByRole("textbox", { name: labels.replaceInput }),
    ).toHaveFocus();
    expect(
      screen.getByRole("button", { name: labels.hideReplace }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("navigates, replaces, toggles options, and closes through buttons", () => {
    const props = renderFindBar();

    fireEvent.click(screen.getByRole("button", { name: labels.previousMatch }));
    fireEvent.click(screen.getByRole("button", { name: labels.nextMatch }));
    fireEvent.click(screen.getByRole("button", { name: labels.replace }));
    fireEvent.click(screen.getByRole("button", { name: labels.replaceAll }));
    fireEvent.click(screen.getByRole("button", { name: labels.matchCase }));
    fireEvent.click(screen.getByRole("button", { name: labels.wholeWord }));
    fireEvent.click(screen.getByRole("button", { name: labels.close }));

    expect(props.onPrevious).toHaveBeenCalledOnce();
    expect(props.onNext).toHaveBeenCalledOnce();
    expect(props.onReplace).toHaveBeenCalledOnce();
    expect(props.onReplaceAll).toHaveBeenCalledOnce();
    expect(props.onCaseSensitiveChange).toHaveBeenCalledWith(true);
    expect(props.onWholeWordChange).toHaveBeenCalledWith(true);
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("preserves the DOM hooks used to wrap narrow-split actions", () => {
    renderFindBar();
    const query = screen.getByRole("searchbox", { name: labels.find });
    const queryRow = query.closest(".find-bar__row--query");
    const replacement = screen.getByRole("textbox", {
      name: labels.replaceInput,
    });
    const replaceRow = replacement.closest(".find-bar__row--replace");

    expect(queryRow).not.toBeNull();
    expect(queryRow?.querySelector(".find-bar__separator")).not.toBeNull();
    expect(
      within(queryRow as HTMLElement)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      labels.hideReplace,
      labels.matchCase,
      labels.wholeWord,
      labels.previousMatch,
      labels.nextMatch,
      labels.close,
    ]);
    expect(replaceRow).not.toBeNull();
    expect(within(replaceRow as HTMLElement).getAllByRole("button")).toHaveLength(
      2,
    );
  });

  it("uses Enter and Shift+Enter for next and previous match", () => {
    const props = renderFindBar();
    const query = screen.getByRole("searchbox", { name: labels.find });

    fireEvent.keyDown(query, { key: "Enter" });
    fireEvent.keyDown(query, { key: "Enter", shiftKey: true });

    expect(props.onNext).toHaveBeenCalledOnce();
    expect(props.onPrevious).toHaveBeenCalledOnce();
  });

  it("closes with Escape from either input", () => {
    const props = renderFindBar();
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: labels.replaceInput }),
      { key: "Escape" },
    );

    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it.each([
    { isComposing: true, key: "Enter", keyCode: 13 },
    { isComposing: false, key: "Enter", keyCode: 229 },
    { isComposing: true, key: "Escape", keyCode: 27 },
  ])("does not act on an IME key event %#", (native) => {
    const props = renderFindBar();
    fireEvent.keyDown(screen.getByRole("searchbox", { name: labels.find }), {
      ...native,
    });

    expect(props.onNext).not.toHaveBeenCalled();
    expect(props.onPrevious).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("disables match actions and reports zero when there are no matches", () => {
    renderFindBar({ activeIndex: -1, matchCount: 0 });

    expect(screen.getByRole("status")).toHaveTextContent("0 / 0");
    expect(
      screen.getByRole("button", { name: labels.previousMatch }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: labels.nextMatch })).toBeDisabled();
    expect(screen.getByRole("button", { name: labels.replace })).toBeDisabled();
    expect(screen.getByRole("button", { name: labels.replaceAll })).toBeDisabled();
  });
});
