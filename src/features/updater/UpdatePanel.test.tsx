import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../i18n";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  UpdatePanel,
  type AppUpdate,
  type UpdaterAdapter,
} from "./UpdatePanel";

function renderPanel(adapter: UpdaterAdapter, platform: "macos" | "windows" = "macos") {
  return render(
    <StrictMode>
      <I18nProvider initialPreference="en" storage={null}>
        <UpdatePanel adapter={adapter} platform={platform} />
      </I18nProvider>
    </StrictMode>,
  );
}

function adapterWith(update: AppUpdate | null): UpdaterAdapter {
  return {
    check: vi.fn().mockResolvedValue(update),
    getCurrentVersion: vi.fn().mockResolvedValue("2.0.6"),
    openReleases: vi.fn().mockResolvedValue(undefined),
    relaunch: vi.fn().mockResolvedValue(undefined),
  };
}

describe("UpdatePanel", () => {
  it("does not install or restart while an open document has unsaved changes", async () => {
    const update: AppUpdate = {
      currentVersion: "2.0.6",
      version: "2.0.7",
      close: vi.fn().mockResolvedValue(undefined),
      download: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = adapterWith(update);
    render(
      <I18nProvider initialPreference="en" storage={null}>
        <UpdatePanel adapter={adapter} platform="windows" hasUnsavedChanges />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    const downloadButton = await screen.findByRole("button", { name: "Download and install" });
    expect(downloadButton).toBeDisabled();
    fireEvent.click(downloadButton);
    expect(update.download).not.toHaveBeenCalled();
    expect(update.install).not.toHaveBeenCalled();
    expect(screen.getByText("Save your open documents before installing an update or restarting Viva.")).toBeVisible();
  });

  it("rechecks draft protection after downloading before Windows can exit", async () => {
    let finishDownload!: () => void;
    const update: AppUpdate = {
      currentVersion: "2.0.6",
      version: "2.0.7",
      close: vi.fn().mockResolvedValue(undefined),
      download: vi.fn(() => new Promise<void>((resolve) => { finishDownload = resolve; })),
      install: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = adapterWith(update);
    const panel = (dirty: boolean) => (
      <I18nProvider initialPreference="en" storage={null}>
        <UpdatePanel adapter={adapter} platform="windows" hasUnsavedChanges={dirty} />
      </I18nProvider>
    );
    const view = render(panel(false));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download and install" }));
    view.rerender(panel(true));
    await act(async () => finishDownload());
    expect(update.install).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
    view.rerender(panel(false));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(update.install).toHaveBeenCalledWith({ restartAfterInstall: true }));
    expect(update.download).toHaveBeenCalledOnce();
  });

  it("preserves a new draft before the explicit macOS restart", async () => {
    const update: AppUpdate = {
      currentVersion: "2.0.6",
      version: "2.0.7",
      close: vi.fn().mockResolvedValue(undefined),
      download: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = adapterWith(update);
    const panel = (dirty: boolean) => (
      <I18nProvider initialPreference="en" storage={null}>
        <UpdatePanel adapter={adapter} platform="macos" hasUnsavedChanges={dirty} />
      </I18nProvider>
    );
    const view = render(panel(false));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download update" }));
    await screen.findByRole("button", { name: "Restart and finish update" });
    view.rerender(panel(true));
    const restartButton = screen.getByRole("button", { name: "Restart and finish update" });
    expect(restartButton).toBeDisabled();
    fireEvent.click(restartButton);
    expect(adapter.relaunch).not.toHaveBeenCalled();
    view.rerender(panel(false));
    fireEvent.click(screen.getByRole("button", { name: "Restart and finish update" }));
    await waitFor(() => expect(adapter.relaunch).toHaveBeenCalledOnce());
  });

  it("reports the installed version when no update exists", async () => {
    renderPanel(adapterWith(null));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Viva 2.0.6 is up to date.")).toBeVisible();
  });

  it("shows notes, downloads with real progress, installs, then waits for an explicit restart", async () => {
    const relaunch = vi.fn().mockResolvedValue(undefined);
    const install = vi.fn().mockResolvedValue(undefined);
    const update: AppUpdate = {
      body: "Security and reliability fixes.",
      currentVersion: "2.0.6",
      version: "2.0.7",
      close: vi.fn().mockResolvedValue(undefined),
      download: vi.fn(async (onEvent) => {
        onEvent({ event: "Started", data: { contentLength: 100 } });
        onEvent({ event: "Progress", data: { chunkLength: 40 } });
        onEvent({ event: "Progress", data: { chunkLength: 60 } });
        onEvent({ event: "Finished" });
      }),
      install,
    };
    const adapter = { ...adapterWith(update), relaunch };
    renderPanel(adapter);

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Viva 2.0.7 is available.")).toBeVisible();
    expect(screen.getByText("Security and reliability fixes.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Download update" }));
    expect(
      await screen.findByRole("button", { name: "Restart and finish update" }),
    ).toBeVisible();
    expect(install).toHaveBeenCalledWith({ restartAfterInstall: false });
    expect(relaunch).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Restart and finish update" }),
    );
    await waitFor(() => expect(relaunch).toHaveBeenCalledTimes(1));
  });

  it("renders indeterminate progress when the response omits content length", async () => {
    let finishDownload!: () => void;
    const update: AppUpdate = {
      body: "",
      currentVersion: "2.0.6",
      version: "2.0.7",
      close: vi.fn().mockResolvedValue(undefined),
      download: vi.fn(async (onEvent) => {
        onEvent({ event: "Started", data: {} });
        onEvent({ event: "Progress", data: { chunkLength: 64 } });
        await new Promise<void>((resolve) => {
          finishDownload = resolve;
        });
      }),
      install: vi.fn().mockResolvedValue(undefined),
    };
    renderPanel(adapterWith(update));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await screen.findByText("Viva 2.0.7 is available.");
    fireEvent.click(screen.getByRole("button", { name: "Download update" }));

    const progress = await screen.findByRole("progressbar", {
      name: "Update download progress",
    });
    expect(progress).not.toHaveAttribute("value");
    expect(screen.getByText("Downloaded 64 B")).toBeVisible();
    finishDownload();
  });

  it("offers retry and GitHub recovery after a signature-shaped failure", async () => {
    const download = vi
      .fn()
      .mockRejectedValueOnce(new Error("signature verification failed"))
      .mockResolvedValueOnce(undefined);
    const update: AppUpdate = {
      body: "",
      currentVersion: "2.0.6",
      version: "2.0.7",
      close: vi.fn().mockResolvedValue(undefined),
      download,
      install: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = adapterWith(update);
    renderPanel(adapter);
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await screen.findByText("Viva 2.0.7 is available.");
    fireEvent.click(screen.getByRole("button", { name: "Download update" }));

    expect(
      await screen.findByText("The update could not be downloaded or verified."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Open GitHub Releases" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
  });

  it("recovers from a network check failure without opening a browser", async () => {
    const adapter = adapterWith(null);
    vi.mocked(adapter.check)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(null);
    renderPanel(adapter);
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Viva could not check for updates.")).toBeVisible();
    expect(adapter.openReleases).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Viva 2.0.6 is up to date.")).toBeVisible();
    expect(adapter.check).toHaveBeenCalledTimes(2);
  });

  it("keeps recovery actions available if GitHub Releases cannot be opened", async () => {
    const adapter = adapterWith(null);
    vi.mocked(adapter.check).mockRejectedValue(new Error("offline"));
    vi.mocked(adapter.openReleases).mockRejectedValue(new Error("browser unavailable"));
    renderPanel(adapter);
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Viva could not check for updates.")).toBeVisible();

    fireEvent.click(screen.getByRole("link", { name: "Open GitHub Releases" }));

    await waitFor(() => expect(adapter.openReleases).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open GitHub Releases" })).toBeVisible();
  });

  it("retries installation without downloading the verified bytes again", async () => {
    const install = vi
      .fn()
      .mockRejectedValueOnce(new Error("installer busy"))
      .mockResolvedValueOnce(undefined);
    const update: AppUpdate = {
      body: "",
      currentVersion: "2.0.6",
      version: "2.0.7",
      close: vi.fn().mockResolvedValue(undefined),
      download: vi.fn(async (onEvent) => {
        onEvent({ event: "Finished" });
      }),
      install,
    };
    renderPanel(adapterWith(update));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await screen.findByText("Viva 2.0.7 is available.");
    fireEvent.click(screen.getByRole("button", { name: "Download update" }));
    expect(
      await screen.findByText("The verified update could not be installed."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("button", { name: "Restart and finish update" }),
    ).toBeVisible();
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(2);
  });

  it("can postpone an available update and check again without overlapping requests", async () => {
    const update: AppUpdate = {
      body: "",
      currentVersion: "2.0.6",
      version: "2.0.7",
      close: vi.fn().mockResolvedValue(undefined),
      download: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = adapterWith(update);
    renderPanel(adapter);
    const checkButton = screen.getByRole("button", { name: "Check for updates" });
    fireEvent.click(checkButton);
    fireEvent.click(checkButton);
    await screen.findByText("Viva 2.0.7 is available.");
    expect(adapter.check).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(update.close).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() => expect(adapter.check).toHaveBeenCalledTimes(2));
  });

  it("explains that Windows closes for its installer and never promises an in-app restart state", async () => {
    const update: AppUpdate = {
      body: "",
      currentVersion: "2.0.6",
      version: "2.0.7",
      close: vi.fn().mockResolvedValue(undefined),
      download: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
    };
    renderPanel(adapterWith(update), "windows");
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(
      await screen.findByText(
        "Viva will close after verification. The Windows installer will finish the update and reopen Viva.",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Download and install" }));
    await waitFor(() =>
      expect(update.install).toHaveBeenCalledWith({ restartAfterInstall: true }),
    );
    expect(
      screen.queryByRole("button", { name: "Restart and finish update" }),
    ).not.toBeInTheDocument();
  });
});
