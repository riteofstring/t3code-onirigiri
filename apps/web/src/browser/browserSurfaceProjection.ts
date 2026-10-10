import { createContext } from "react";

import type { BrowserSurfaceRect } from "./browserSurfaceStore";

export interface BrowserSurfaceProjection {
  readonly width: number;
  readonly height: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly clipPath: string;
  readonly interactive: boolean;
  readonly onFocus: () => void;
}

export interface BrowserSurfaceProjectionPolicy {
  readonly occluders: (slot: HTMLElement) => readonly HTMLElement[];
  readonly interactive: (slot: HTMLElement) => boolean;
  readonly focus: (slot: HTMLElement) => void;
}

export const BrowserSurfaceProjectionContext = createContext<BrowserSurfaceProjectionPolicy | null>(
  null,
);

function intersect(a: BrowserSurfaceRect, b: BrowserSurfaceRect): BrowserSurfaceRect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

function subtract(rect: BrowserSurfaceRect, hole: BrowserSurfaceRect): BrowserSurfaceRect[] {
  const cut = intersect(rect, hole);
  if (!cut.width || !cut.height) return [rect];
  return [
    { x: rect.x, y: rect.y, width: rect.width, height: cut.y - rect.y },
    {
      x: rect.x,
      y: cut.y + cut.height,
      width: rect.width,
      height: rect.y + rect.height - cut.y - cut.height,
    },
    { x: rect.x, y: cut.y, width: cut.x - rect.x, height: cut.height },
    {
      x: cut.x + cut.width,
      y: cut.y,
      width: rect.x + rect.width - cut.x - cut.width,
      height: cut.height,
    },
  ].filter((piece) => piece.width > 0 && piece.height > 0);
}

export function browserSurfaceClipPath(
  rect: BrowserSurfaceRect,
  size: { readonly width: number; readonly height: number },
  clip: BrowserSurfaceRect,
  occluders: readonly BrowserSurfaceRect[],
): string {
  let pieces = [intersect(rect, clip)];
  for (const occluder of occluders) pieces = pieces.flatMap((piece) => subtract(piece, occluder));
  const scaleX = rect.width / size.width;
  const scaleY = rect.height / size.height;
  const paths = pieces
    .filter((piece) => piece.width > 0 && piece.height > 0)
    .map((piece) => {
      const x = (piece.x - rect.x) / scaleX;
      const y = (piece.y - rect.y) / scaleY;
      const right = x + piece.width / scaleX;
      const bottom = y + piece.height / scaleY;
      return `M${x} ${y}H${right}V${bottom}H${x}Z`;
    });
  return paths.length ? `path("${paths.join(" ")}")` : "inset(50%)";
}

export function browserSurfaceAncestors(slot: HTMLElement): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  for (let element: HTMLElement | null = slot; element; element = element.parentElement) {
    ancestors.push(element);
  }
  return ancestors;
}

export function measureBrowserSurfaceProjection(
  slot: HTMLElement,
  rect: BrowserSurfaceRect,
  ancestors: readonly HTMLElement[],
  policy: BrowserSurfaceProjectionPolicy,
  onFocus: () => void,
): { readonly projection: BrowserSurfaceProjection; readonly visible: boolean } {
  const width = Math.max(1, slot.clientWidth);
  const height = Math.max(1, slot.clientHeight);
  let clip: BrowserSurfaceRect = { x: 0, y: 0, width: innerWidth, height: innerHeight };
  const visible =
    slot.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
    rect.width > 0 &&
    rect.height > 0 &&
    !ancestors.some((element) => element.tagName === "CANVAS");
  for (const ancestor of ancestors) {
    const style = getComputedStyle(ancestor);
    const clipsX = /^(hidden|clip|auto|scroll)$/.test(style.overflowX);
    const clipsY = /^(hidden|clip|auto|scroll)$/.test(style.overflowY);
    if (!clipsX && !clipsY) continue;
    const box = ancestor.getBoundingClientRect();
    const sx = ancestor.offsetWidth ? box.width / ancestor.offsetWidth : 1;
    const sy = ancestor.offsetHeight ? box.height / ancestor.offsetHeight : 1;
    clip = intersect(clip, {
      x: clipsX ? box.x + ancestor.clientLeft * sx : clip.x,
      y: clipsY ? box.y + ancestor.clientTop * sy : clip.y,
      width: clipsX ? ancestor.clientWidth * sx : clip.width,
      height: clipsY ? ancestor.clientHeight * sy : clip.height,
    });
  }
  return {
    visible,
    projection: {
      width,
      height,
      scaleX: rect.width / width,
      scaleY: rect.height / height,
      clipPath: browserSurfaceClipPath(
        rect,
        { width, height },
        clip,
        policy.occluders(slot).map((element) => element.getBoundingClientRect()),
      ),
      interactive: !slot.closest("[inert]") && policy.interactive(slot),
      onFocus,
    },
  };
}
