import { describe, expect, it } from "vite-plus/test";

import { browserSurfaceClipPath } from "./browserSurfaceProjection";

describe("browserSurfaceClipPath", () => {
  const rect = { x: 100, y: 50, width: 200, height: 150 };
  const size = { width: 400, height: 300 };

  it("clips screen edges in the guest's unscaled coordinates", () => {
    expect(browserSurfaceClipPath(rect, size, { x: 120, y: 60, width: 160, height: 120 }, [])).toBe(
      'path("M40 20H360V260H40Z")',
    );
  });

  it("cuts out overlapping chrome without reopening the overlap", () => {
    expect(
      browserSurfaceClipPath(rect, size, rect, [
        { x: 200, y: 50, width: 100, height: 150 },
        { x: 250, y: 50, width: 100, height: 150 },
      ]),
    ).toBe('path("M0 0H200V300H0Z")');
  });

  it("closes hit testing when the entire guest is outside the viewport", () => {
    expect(browserSurfaceClipPath(rect, size, { x: 0, y: 0, width: 80, height: 100 }, [])).toBe(
      "inset(50%)",
    );
  });
});
