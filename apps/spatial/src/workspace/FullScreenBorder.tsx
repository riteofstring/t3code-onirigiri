import { useLayoutEffect, useRef, type Ref } from "react";

import {
  FULL_SCREEN_FADE_OUT_MS,
  FULL_SCREEN_SETTLE_MS,
  type FullScreenPhase,
} from "./useFullScreenTransition";

const PIECES = [
  "top-left",
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
] as const;
type Piece = (typeof PIECES)[number];

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EDGE_PX = 100;
const GROW_MS = 420;
const EASING = "cubic-bezier(0.65, 0, 0.35, 1)";

function pieceTransform(piece: Piece, box: Box, radius: number, line: number) {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const across = Math.max(0, box.width - 2 * radius) / EDGE_PX;
  const down = Math.max(0, box.height - 2 * radius) / EDGE_PX;
  switch (piece) {
    case "top-left":
      return `translate(${box.x}px, ${box.y}px)`;
    case "top-right":
      return `translate(${right - radius}px, ${box.y}px)`;
    case "bottom-left":
      return `translate(${box.x}px, ${bottom - radius}px)`;
    case "bottom-right":
      return `translate(${right - radius}px, ${bottom - radius}px)`;
    case "top":
      return `translate(${box.x + radius}px, ${box.y}px) scaleX(${across})`;
    case "bottom":
      return `translate(${box.x + radius}px, ${bottom - line}px) scaleX(${across})`;
    case "left":
      return `translate(${box.x}px, ${box.y + radius}px) scaleY(${down})`;
    case "right":
      return `translate(${right - line}px, ${box.y + radius}px) scaleY(${down})`;
  }
}

function relativeBox(element: Element, origin: DOMRect): Box {
  const rect = element.getBoundingClientRect();
  return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height };
}

function focusBox(border: HTMLElement, origin: DOMRect) {
  const target = border.parentElement?.querySelector(
    '[data-onirigiri-slot="pane"][data-focused="true"]',
  );
  return target ? relativeBox(target, origin) : null;
}

function currentBox(border: HTMLElement, origin: DOMRect): Box | null {
  const start = border.querySelector('[data-piece="top-left"]');
  const end = border.querySelector('[data-piece="bottom-right"]');
  if (!border.dataset.motion || !start || !end) return null;
  const a = relativeBox(start, origin);
  const b = relativeBox(end, origin);
  return { x: a.x, y: a.y, width: b.x + b.width - a.x, height: b.y + b.height - a.y };
}

function move(
  border: HTMLElement,
  motion: "grow" | "edge" | "shrink",
  target: (origin: DOMRect, radius: number) => Box | null,
  duration: number,
  opacity: (from: number | null) => Keyframe[],
) {
  const workspace = border.parentElement?.querySelector(".onirigiri-workspace");
  if (!workspace) return;
  const style = getComputedStyle(workspace);
  const radius = parseFloat(style.getPropertyValue("--onirigiri-pane-radius")) || 0;
  const line = parseFloat(style.getPropertyValue("--onirigiri-focus-border-width")) || 1;
  const origin = border.getBoundingClientRect();
  const stage = { x: 0, y: 0, width: origin.width, height: origin.height };
  const from = currentBox(border, origin) ?? (motion === "grow" ? focusBox(border, origin) : stage);
  const to = target(origin, radius);
  const fromOpacity = border.dataset.motion ? Number(getComputedStyle(border).opacity) : null;
  stop(border);
  if (!from || !to) return;
  border.dataset.motion = motion;
  border.style.setProperty("--spatial-border-color", style.getPropertyValue("--onirigiri-focus"));
  border.style.setProperty("--spatial-border-line", `${line}px`);
  border.style.setProperty("--spatial-border-radius", `${radius}px`);
  const timing = { duration, easing: EASING, fill: "forwards" } as const;
  for (const piece of border.children) {
    const name = (piece as HTMLElement).dataset.piece as Piece;
    piece.animate(
      [
        { transform: pieceTransform(name, from, radius, line) },
        { transform: pieceTransform(name, to, radius, line) },
      ],
      timing,
    );
  }
  const fade = border.animate(opacity(fromOpacity), { duration, fill: "forwards" });
  if (motion !== "edge")
    fade.finished.then(
      () => stop(border),
      () => {},
    );
}

function stop(border: HTMLElement) {
  for (const animation of border.getAnimations({ subtree: true })) animation.cancel();
  delete border.dataset.motion;
}

function grow(border: HTMLElement) {
  move(
    border,
    "grow",
    (origin, radius) => {
      const margin = radius + 48;
      return {
        x: -margin,
        y: -margin,
        width: origin.width + margin * 2,
        height: origin.height + margin * 2,
      };
    },
    GROW_MS,
    (from) => [{ opacity: from ?? 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }],
  );
}

export function useFullScreenBorder(
  phase: FullScreenPhase | null,
  fullScreen: boolean,
  requested: boolean,
) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const border = ref.current;
    if (!border) return;
    if (phase === null) {
      if (border.dataset.motion === "edge") stop(border);
      return;
    }
    if (phase === "out" && requested) grow(border);
    if (phase === "out" && !requested)
      move(
        border,
        "edge",
        (origin) => ({ x: 0, y: 0, width: origin.width, height: origin.height }),
        FULL_SCREEN_FADE_OUT_MS,
        (from) => [{ opacity: from ?? 0 }, { opacity: 1 }],
      );
    if (phase === "in" && !fullScreen)
      move(
        border,
        "shrink",
        (origin) => focusBox(border, origin),
        FULL_SCREEN_SETTLE_MS,
        (from) => [{ opacity: from ?? 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1 }],
      );
    if (phase === "in" && fullScreen && border.dataset.motion === "edge") grow(border);
  }, [fullScreen, phase, requested]);
  return ref;
}

export function FullScreenBorder({ ref }: { ref: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="spatial-full-screen-border" aria-hidden="true">
      {PIECES.map((piece) => (
        <span key={piece} data-piece={piece} />
      ))}
    </div>
  );
}
