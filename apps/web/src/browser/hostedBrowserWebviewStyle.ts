import type { BrowserSurfaceRect } from "./browserSurfaceStore";
import type { BrowserSurfaceProjection } from "./browserSurfaceProjection";

export interface HostedBrowserWebviewSize {
  readonly width: number;
  readonly height: number;
}

export interface HostedBrowserWebviewWrapperStyle {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly zIndex: number;
  readonly pointerEvents: "auto" | "none";
  readonly borderRadius?: number;
  readonly visibility?: "hidden" | "visible";
  readonly transform?: string;
  readonly transformOrigin?: string;
  readonly clipPath?: string;
}

export const HIDDEN_BROWSER_WEBVIEW_OFFSET = -100_000;

export function resolveHostedBrowserWebviewWrapperStyle(input: {
  readonly active: boolean;
  readonly renderingActive: boolean;
  readonly keepPaintableWhenInactive?: boolean;
  readonly cornerRadius?: number;
  readonly zIndex?: number;
  readonly rect: BrowserSurfaceRect | null;
  readonly hiddenSize: HostedBrowserWebviewSize;
  readonly projection?: BrowserSurfaceProjection | null;
}): HostedBrowserWebviewWrapperStyle {
  const {
    active,
    cornerRadius = 0,
    hiddenSize,
    keepPaintableWhenInactive = false,
    rect,
    projection,
    renderingActive,
    zIndex = 30,
  } = input;
  if (active && rect) {
    return {
      left: projection ? 0 : rect.x,
      top: projection ? 0 : rect.y,
      width: projection?.width ?? rect.width,
      height: projection?.height ?? rect.height,
      zIndex,
      pointerEvents: projection?.interactive === false ? "none" : "auto",
      ...(projection
        ? {
            transform: `translate3d(${rect.x}px, ${rect.y}px, 0px) scale(${projection.scaleX}, ${projection.scaleY})`,
            transformOrigin: "0px 0px",
            clipPath: projection.clipPath,
          }
        : {}),
      ...(cornerRadius > 0 ? { borderRadius: cornerRadius } : {}),
    };
  }

  if (renderingActive) {
    // Electron stops compositing a guest that is fully outside the window, even
    // when background throttling is disabled. Keep capture-active guests inside
    // the viewport but behind the app so recordings receive complete frames.
    return {
      left: 0,
      top: 0,
      width: hiddenSize.width,
      height: hiddenSize.height,
      zIndex: -1,
      pointerEvents: "none",
      visibility: "visible",
    };
  }

  return {
    left: HIDDEN_BROWSER_WEBVIEW_OFFSET,
    top: HIDDEN_BROWSER_WEBVIEW_OFFSET,
    width: hiddenSize.width,
    height: hiddenSize.height,
    zIndex: -1,
    pointerEvents: "none",
    visibility: keepPaintableWhenInactive ? "visible" : "hidden",
  };
}

export function applyHostedBrowserWebviewWrapperStyle(
  element: HTMLElement,
  style: HostedBrowserWebviewWrapperStyle,
): void {
  const properties = {
    left: `${style.left}px`,
    top: `${style.top}px`,
    width: `${style.width}px`,
    height: `${style.height}px`,
    "z-index": String(style.zIndex),
    "pointer-events": style.pointerEvents,
    "border-radius": style.borderRadius === undefined ? "" : `${style.borderRadius}px`,
    visibility: style.visibility ?? "",
    transform: style.transform ?? "",
    "transform-origin": style.transformOrigin ?? "",
    "clip-path": style.clipPath ?? "",
  };
  for (const [property, value] of Object.entries(properties)) {
    if (element.style.getPropertyValue(property) !== value)
      element.style.setProperty(property, value);
  }
}
