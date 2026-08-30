import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("keeps its accessible name while loading", () => {
    render(<Button loading>Save changes</Button>);

    const button = screen.getByRole("button", { name: "Save changes" });
    expect(button).toHaveAccessibleName("Save changes");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
  });
});
