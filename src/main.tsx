import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "./i18n";
import { getVivaPlatform } from "./lib/keyboard";
import "./styles/index.css";

const root = document.getElementById("root");

document.documentElement.dataset.platform = getVivaPlatform();

try {
  const savedTheme = localStorage.getItem("viva.theme");
  if (savedTheme === "light" || savedTheme === "dark") {
    document.documentElement.dataset.theme = savedTheme;
  }
} catch {
  // The system theme remains available when storage is unavailable.
}

if (!root) {
  throw new Error("Viva could not find its application root.");
}

async function renderApplication() {
  const fixture =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("fixture") === "workspace";
  const Application = fixture
    ? (await import("./dev/FixturePreviewApp")).FixturePreviewApp
    : (await import("./App")).App;

  createRoot(root as HTMLElement).render(
    <StrictMode>
      <I18nProvider>
        <Application />
      </I18nProvider>
    </StrictMode>,
  );
}

void renderApplication();
