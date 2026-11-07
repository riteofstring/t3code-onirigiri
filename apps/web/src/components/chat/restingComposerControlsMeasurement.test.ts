import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  resolveRestingComposerControlsLayout,
  resolveRestingComposerControlsNaturalWidth,
} from "../composerFooterLayout";
import { measureRestingComposerControls } from "./restingComposerControlsMeasurement";

function measurePicker(input: {
  clientWidth: number;
  flexGrow: string;
  scale?: number;
  pickerWidth?: number;
}) {
  const scale = input.scale ?? 1;
  const label = { clientWidth: input.clientWidth, scrollWidth: 160 };
  const picker = {
    getBoundingClientRect: () => ({ width: (input.pickerWidth ?? 52) * scale }),
    querySelector: () => label,
  };
  const controls = {
    getBoundingClientRect: () => ({ width: 400 * scale }),
    querySelector: (selector: string) => {
      if (selector === "[data-chat-provider-model-picker]") return picker;
      if (selector === "[data-resting-controls-overflow]") {
        return { getBoundingClientRect: () => ({ width: 24 * scale }) };
      }
      return null;
    },
    querySelectorAll: () => [
      {
        dataset: {},
        querySelectorAll: () => [],
        getBoundingClientRect: () => ({ width: 140 * scale }),
      },
    ],
  };
  vi.stubGlobal("getComputedStyle", (element: unknown) => {
    if (element === controls) return { width: "400px", boxSizing: "border-box", columnGap: "4px" };
    if (element === label) return { flexGrow: input.flexGrow };
    if (element === picker) return { minWidth: "52px", maxWidth: "none" };
    return { columnGap: "4px" };
  });
  return measureRestingComposerControls(controls as unknown as HTMLElement)!;
}

afterEach(() => vi.unstubAllGlobals());

describe("measureRestingComposerControls", () => {
  it.each([0.125, 1, 2])("preserves fractional control widths at camera scale %s", (scale) => {
    const measurement = measurePicker({
      clientWidth: 0,
      flexGrow: "0",
      pickerWidth: 52.375,
      scale,
    });

    expect(measurement.naturalFixedWidth).toBe(52.375);
    expect(resolveRestingComposerControlsNaturalWidth(measurement)).toBe(196.375);
  });

  it.each([0.125, 0.5, 1, 2])("keeps overflow choices unchanged at camera scale %s", (scale) => {
    const measurement = measurePicker({ clientWidth: 20, flexGrow: "1", scale });

    expect(resolveRestingComposerControlsLayout({ ...measurement, hostWidth: 200 })).toEqual({
      hiddenCount: 1,
      iconOnlyCount: 1,
      visible: true,
    });
  });
});
