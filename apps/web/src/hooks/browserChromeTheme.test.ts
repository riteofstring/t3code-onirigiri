// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import {
  applyThemeColorPreview,
  applyThemePalette,
  getThemeColorsForMode,
  getThemeDefinition,
} from "../themePalette";
import { syncBrowserChromeTheme } from "./useTheme";

beforeEach(() => {
  document.head.innerHTML =
    '<meta name="theme-color" content="old"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="old-dark">';
  document.body.innerHTML = '<main data-slot="sidebar-inset"></main>';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme-id");
  document.documentElement.removeAttribute("class");
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.body.removeAttribute("style");
});

function normalizeCssColor(color: string) {
  const reference = document.createElement("div");
  reference.style.backgroundColor = color;
  expect(reference.style.backgroundColor).not.toBe("");
  return reference.style.backgroundColor;
}

function expectChrome(color: string) {
  const expected = normalizeCssColor(color);
  expect(document.documentElement.style.backgroundColor).toBe(expected);
  expect(document.body.style.backgroundColor).toBe(expected);
  const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  expect(metas.length).toBeGreaterThan(0);
  expect(metas.map((meta) => normalizeCssColor(meta.content))).toEqual(metas.map(() => expected));
}

it.each(["light", "dark"] as const)(
  "keeps the applied %s palette and live preview in browser chrome without measuring the document",
  (appearance) => {
    const theme = getThemeDefinition("t3-chat")!;
    const colors = getThemeColorsForMode(theme, appearance)!;
    applyThemePalette("t3-chat", appearance);
    // jsdom does not resolve the stylesheet's var(--app-theme-chrome) alias.
    document.documentElement.style.setProperty("--app-chrome-background", colors.chrome);
    const reads = vi.spyOn(window, "getComputedStyle");

    syncBrowserChromeTheme();
    expectChrome(colors.chrome);

    applyThemeColorPreview({ ...colors, chrome: "#123456" }, appearance);
    document.documentElement.style.setProperty("--app-chrome-background", "#123456");
    syncBrowserChromeTheme();
    expectChrome("#123456");
    expect(reads).not.toHaveBeenCalled();
  },
);

it("resolves a themed document whose chrome color comes from a stylesheet", () => {
  document.documentElement.dataset.themeId = "stylesheet";
  const style = document.createElement("style");
  style.textContent = ":root { --app-chrome-background: rgb(10, 20, 30); }";
  document.head.append(style);

  syncBrowserChromeTheme();

  expectChrome("rgb(10, 20, 30)");
});

it("uses the current visible surface without a palette", () => {
  document.querySelector<HTMLElement>("main")!.style.backgroundColor = "rgb(30, 40, 50)";
  document.body.style.backgroundColor = "rgb(60, 70, 80)";

  syncBrowserChromeTheme();

  expectChrome("rgb(30, 40, 50)");
});

it("falls back from transparent surfaces and creates a missing theme-color meta", () => {
  document.documentElement.dataset.themeId = "transparent";
  document.documentElement.style.setProperty("--app-chrome-background", "transparent");
  document.querySelector<HTMLElement>("main")!.style.backgroundColor = "transparent";
  document.body.style.backgroundColor = "rgb(60, 70, 80)";
  document.head.replaceChildren();

  syncBrowserChromeTheme();

  expectChrome("rgb(60, 70, 80)");
  expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
});

it("preserves existing metadata when every source is transparent", () => {
  document.body.style.backgroundColor = "transparent";

  syncBrowserChromeTheme();

  expect(
    [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map(
      (meta) => meta.content,
    ),
  ).toEqual(["old", "old-dark"]);
});
