import { describe, expect, it } from "vite-plus/test";

import {
  HIDDEN_BROWSER_WEBVIEW_OFFSET,
  resolveHostedBrowserWebviewWrapperStyle,
} from "./hostedBrowserWebviewStyle";

describe("resolveHostedBrowserWebviewWrapperStyle", () => {
  it("scales the displayed guest while preserving its logical viewport and input shield", () => {
    const style = resolveHostedBrowserWebviewWrapperStyle({
      active: true,
      renderingActive: true,
      rect: { x: 100.25, y: 30, width: 200, height: 150 },
      hiddenSize: { width: 400, height: 300 },
      projection: {
        width: 400,
        height: 300,
        scaleX: 0.5,
        scaleY: 0.5,
        clipPath: "inset(0 40px 0 0)",
        interactive: false,
        onFocus: () => {},
      },
    });
    expect(style).toMatchObject({
      left: 100.25,
      width: 400,
      height: 300,
      transform: "scale(0.5, 0.5)",
      transformOrigin: "0 0",
      clipPath: "inset(0 40px 0 0)",
      pointerEvents: "none",
    });
  });
  it("places an active webview on its presented surface", () => {
    expect(
      resolveHostedBrowserWebviewWrapperStyle({
        active: true,
        renderingActive: true,
        rect: { x: 12, y: 34, width: 800, height: 600 },
        hiddenSize: { width: 1280, height: 800 },
      }),
    ).toEqual({
      left: 12,
      top: 34,
      width: 800,
      height: 600,
      zIndex: 30,
      pointerEvents: "auto",
    });
  });

  it("clips a floating webview to the mini-player frame", () => {
    expect(
      resolveHostedBrowserWebviewWrapperStyle({
        active: true,
        renderingActive: true,
        cornerRadius: 12,
        zIndex: 48,
        rect: { x: 12, y: 34, width: 360, height: 203 },
        hiddenSize: { width: 1280, height: 800 },
      }),
    ).toMatchObject({
      left: 12,
      top: 34,
      width: 360,
      height: 203,
      borderRadius: 12,
      zIndex: 48,
    });
  });

  it("suspends painting for an inactive webview", () => {
    const style = resolveHostedBrowserWebviewWrapperStyle({
      active: false,
      renderingActive: false,
      rect: { x: 12, y: 34, width: 800, height: 600 },
      hiddenSize: { width: 393, height: 852 },
    });

    expect(style).toEqual({
      left: HIDDEN_BROWSER_WEBVIEW_OFFSET,
      top: HIDDEN_BROWSER_WEBVIEW_OFFSET,
      width: 393,
      height: 852,
      zIndex: -1,
      pointerEvents: "none",
      visibility: "hidden",
    });
  });

  it("keeps an active background task paintable behind the app", () => {
    const style = resolveHostedBrowserWebviewWrapperStyle({
      active: false,
      renderingActive: true,
      rect: null,
      hiddenSize: { width: 1280, height: 800 },
    });

    expect(style).toEqual({
      left: 0,
      top: 0,
      width: 1280,
      height: 800,
      zIndex: -1,
      pointerEvents: "none",
      visibility: "visible",
    });
  });

  it("keeps an inactive webview paintable without marking it as rendering-active", () => {
    const style = resolveHostedBrowserWebviewWrapperStyle({
      active: false,
      renderingActive: false,
      keepPaintableWhenInactive: true,
      rect: null,
      hiddenSize: { width: 1280, height: 800 },
    });

    expect(style).toEqual({
      left: HIDDEN_BROWSER_WEBVIEW_OFFSET,
      top: HIDDEN_BROWSER_WEBVIEW_OFFSET,
      width: 1280,
      height: 800,
      zIndex: -1,
      pointerEvents: "none",
      visibility: "visible",
    });
  });
});
