import { afterEach, expect, it, vi } from "vite-plus/test";

import { readLayoutRect, readLayoutScale } from "./layoutGeometry";

afterEach(() => vi.unstubAllGlobals());

it.each([0.125, 0.5, 1, 2])("measures fractional layout geometry at scale %s", (scale) => {
  const element = {
    getBoundingClientRect: () => ({
      width: 120.375 * scale,
      height: 30.25 * scale,
      top: 100 * scale,
      bottom: 130.25 * scale,
      left: 200 * scale,
      right: 320.375 * scale,
    }),
  } as HTMLElement;
  vi.stubGlobal("getComputedStyle", () => ({ width: "120.375px", boxSizing: "border-box" }));

  expect(readLayoutRect(element)).toEqual({
    width: 120.375,
    height: 30.25,
    top: 100,
    bottom: 130.25,
    left: 200,
    right: 320.375,
  });
});

it("includes padding and borders for content-box hosts", () => {
  const element = { getBoundingClientRect: () => ({ width: 64.125 }) } as HTMLElement;
  vi.stubGlobal("getComputedStyle", () => ({
    width: "100.25px",
    boxSizing: "content-box",
    paddingLeft: "12px",
    paddingRight: "12px",
    borderLeftWidth: "2px",
    borderRightWidth: "2px",
  }));

  expect(readLayoutScale(element)).toBe(0.5);
});

it("keeps hidden hosts at zero size", () => {
  const element = {
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 }),
  } as HTMLElement;
  vi.stubGlobal("getComputedStyle", () => ({ width: "auto", boxSizing: "content-box" }));

  expect(readLayoutRect(element).height).toBe(0);
  expect(readLayoutScale(element)).toBe(1);
});
