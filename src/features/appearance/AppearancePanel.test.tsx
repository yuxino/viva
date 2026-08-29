import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BACKGROUND_SETTINGS } from "../../lib/background";
import { AppearancePanel } from "./AppearancePanel";
import type { BackgroundSettingsController } from "./useBackgroundSettings";

function createController(
  overrides: Partial<BackgroundSettingsController> = {},
): BackgroundSettingsController {
  return {
    assetUrl: null,
    clearError: vi.fn(),
    error: null,
    operation: "idle",
    removeCustomImage: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    selectCustomImage: vi.fn().mockResolvedValue(undefined),
    settings: { ...DEFAULT_BACKGROUND_SETTINGS },
    setBlur: vi.fn(),
    setFit: vi.fn(),
    setOpacity: vi.fn(),
    setPosition: vi.fn(),
    setSource: vi.fn().mockReturnValue(true),
    update: vi.fn(),
    ...overrides,
  };
}

describe("AppearancePanel", () => {
  it("offers None, the built-in illustration, and a custom local image", () => {
    render(<AppearancePanel controller={createController()} />);

    expect(screen.getByRole("radio", { name: /None/ })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Viva illustration/ }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /Custom local image/ }),
    ).toBeInTheDocument();
  });

  it("updates source and restrained visual controls", () => {
    const controller = createController();
    render(<AppearancePanel controller={controller} />);

    fireEvent.click(screen.getByRole("radio", { name: /None/ }));
    expect(controller.setSource).toHaveBeenCalledWith("none");

    fireEvent.change(screen.getByLabelText("Opacity"), {
      target: { value: "0.2" },
    });
    expect(controller.setOpacity).toHaveBeenCalledWith(0.2);

    fireEvent.change(screen.getByLabelText("Blur"), {
      target: { value: "8" },
    });
    expect(controller.setBlur).toHaveBeenCalledWith(8);

    fireEvent.click(screen.getByRole("radio", { name: "Top left" }));
    expect(controller.setPosition).toHaveBeenCalledWith("top-left");
  });

  it("passes a selected local file to the IndexedDB-backed controller", async () => {
    const controller = createController();
    const { container } = render(<AppearancePanel controller={controller} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["image"], "quiet.png", { type: "image/png" });
    expect(input).not.toBeNull();

    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() =>
      expect(controller.selectCustomImage).toHaveBeenCalledWith(file),
    );
  });

  it("announces storage errors and lets the user dismiss them", () => {
    const clearError = vi.fn();
    render(
      <AppearancePanel
        controller={createController({
          clearError,
          error: "The saved custom background is no longer available.",
        })}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The saved custom background is no longer available.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(clearError).toHaveBeenCalledOnce();
  });

  it("disables controls and announces image processing", () => {
    render(
      <AppearancePanel
        controller={createController({ operation: "processing" })}
      />,
    );

    expect(
      screen.getByRole("status", { name: "Background status" }),
    ).toHaveTextContent("Preparing and saving the image…");
    expect(screen.getByRole("button", { name: "Choose image" })).toBeDisabled();
  });
});
