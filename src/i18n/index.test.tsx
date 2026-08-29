import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SearchPanel } from "../features/search/SearchPanel";
import { StatusBar } from "../features/workspace/StatusBar";
import en from "./en";
import zhHans from "./zh-Hans";
import {
  I18nProvider,
  LANGUAGE_STORAGE_KEY,
  detectLanguage,
  interpolate,
  loadLanguagePreference,
  type LanguageStorage,
  useI18n,
} from ".";

function memoryStorage(initial?: Record<string, string>): LanguageStorage {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

function LanguageProbe() {
  const { fmt, language, preference, setPreference, t } = useI18n();
  return (
    <div>
      <output aria-label="language">{language}</output>
      <output aria-label="preference">{preference}</output>
      <output aria-label="message">{fmt("Ln %d, Col %d", 1200, 4)}</output>
      <button onClick={() => setPreference("en")} type="button">
        {t("English")}
      </button>
      <button onClick={() => setPreference("zh-Hans")} type="button">
        {t("简体中文")}
      </button>
      <button onClick={() => setPreference("system")} type="button">
        {t("System")}
      </button>
    </div>
  );
}

describe("i18n", () => {
  beforeEach(() => {
    document.documentElement.lang = "en";
    delete document.documentElement.dataset.language;
  });

  it("detects Chinese language tags and otherwise falls back to English", () => {
    expect(detectLanguage(["zh-CN"])).toBe("zh-Hans");
    expect(detectLanguage(["zh-Hant", "en-US"])).toBe("zh-Hans");
    expect(detectLanguage(["ja-JP", "en-GB"])).toBe("en");
  });

  it("keeps every catalog key and interpolation marker in parity", () => {
    expect(Object.keys(zhHans).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(zhHans[key].match(/%@|%d/g) ?? [], key).toEqual(
        en[key].match(/%@|%d/g) ?? [],
      );
    }
  });

  it("falls back to the system preference when storage is missing or invalid", () => {
    expect(loadLanguagePreference(null)).toBe("system");
    expect(
      loadLanguagePreference(
        memoryStorage({ [LANGUAGE_STORAGE_KEY]: "unsupported" }),
      ),
    ).toBe("system");
  });

  it("preserves missing interpolation markers and formats supplied numbers", () => {
    expect(interpolate("en", "%d versions · %@ · %% · %d", [1200, "local"]))
      .toBe("1,200 versions · local · % · %d");
    expect(interpolate("zh-Hans", "%d versions", [1200])).toBe(
      "1,200 versions",
    );
  });

  it("detects, switches, persists, and restores the selected language", () => {
    const storage = memoryStorage();
    const { unmount } = render(
      <I18nProvider storage={storage} systemLanguages={["zh-CN"]}>
        <LanguageProbe />
      </I18nProvider>,
    );

    expect(screen.getByLabelText("language")).toHaveTextContent("zh-Hans");
    expect(screen.getByLabelText("message")).toHaveTextContent(
      "第 1,200 行，第 4 列",
    );
    expect(document.documentElement.lang).toBe("zh-Hans");

    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByLabelText("language")).toHaveTextContent("en");
    expect(storage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    unmount();

    render(
      <I18nProvider storage={storage} systemLanguages={["zh-CN"]}>
        <LanguageProbe />
      </I18nProvider>,
    );
    expect(screen.getByLabelText("preference")).toHaveTextContent("en");
    expect(screen.getByLabelText("language")).toHaveTextContent("en");
  });

  it("updates leaf UI copy, accessibility labels, plurals, and numbers", () => {
    render(
      <I18nProvider initialPreference="zh-Hans" storage={null}>
        <StatusBar column={4} line={1200} readingMinutes={2} wordCount={8} />
        <SearchPanel
          onOpenResult={() => undefined}
          onQueryChange={() => undefined}
          query="viva"
          results={[
            { relativePath: "one.md", line: 1, column: 1, preview: "one" },
            { relativePath: "two.md", line: 2, column: 1, preview: "two" },
          ]}
        />
      </I18nProvider>,
    );

    expect(screen.getByLabelText("文档状态")).toHaveTextContent(
      "第 1,200 行，第 4 列",
    );
    expect(screen.getByLabelText("文档状态")).toHaveTextContent("8 个词");
    expect(
      screen.getByRole("searchbox", { name: "搜索工作区" }),
    ).toHaveAttribute("placeholder", "搜索文件");
    expect(screen.getByText("2 个匹配项")).toBeVisible();
  });
});
