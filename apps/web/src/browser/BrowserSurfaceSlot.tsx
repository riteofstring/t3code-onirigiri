"use client";

import { useContext, useLayoutEffect, useRef } from "react";

import { acquireBrowserSurface, type BrowserSurfaceRect } from "./browserSurfaceStore";
import { observeResize } from "../lib/observeResize";
import {
  BrowserSurfaceProjectionContext,
  browserSurfaceAncestors,
  measureBrowserSurfaceProjection,
} from "./browserSurfaceProjection";

export function BrowserSurfaceSlot(props: {
  readonly tabId: string;
  readonly visible: boolean;
  readonly cornerRadius?: number;
  readonly zIndex?: number;
  readonly layoutVersion?: string | number;
  readonly className?: string;
  readonly fitSourceContent?: boolean;
}) {
  const {
    tabId,
    visible,
    cornerRadius = 0,
    zIndex = 30,
    layoutVersion,
    className,
    fitSourceContent = false,
  } = props;
  const elementRef = useRef<HTMLDivElement | null>(null);
  const presentationRef = useRef({ visible, cornerRadius, zIndex });
  const updateRef = useRef<(() => void) | null>(null);
  const projectionPolicy = useContext(BrowserSurfaceProjectionContext);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let lease = acquireBrowserSurface(tabId, fitSourceContent);
    let disposed = false;
    let mutationQueued = false;
    let projectionNodes: readonly HTMLElement[] = [];
    let lastBounds: BrowserSurfaceRect | null = null;
    let lastProjection: ReturnType<typeof measureBrowserSurfaceProjection>["projection"] | null =
      null;
    const onFocus = () => projectionPolicy?.focus(element);
    const keyboard = projectionPolicy?.keyboard
      ? {
          shortcuts: projectionPolicy.keyboard.shortcuts,
          keyDown: (event: KeyboardEvent) => projectionPolicy.keyboard?.keyDown(element, event),
        }
      : undefined;
    let stopObserving = () => {};
    // Camera transforms do not resize the slot. Observe presented ancestor
    // writes, including moves that do not affect the focused pane.
    const transforms = projectionPolicy
      ? new MutationObserver(() => {
          if (disposed || mutationQueued) return;
          mutationQueued = true;
          // Let pending React commits apply pane visibility before reading layout.
          queueMicrotask(() => {
            mutationQueued = false;
            if (disposed) return;
            transforms?.takeRecords();
            update("mutation");
          });
        })
      : null;
    const update = (source: "geometry" | "mutation" | "presentation" = "geometry") => {
      const presentation = presentationRef.current;
      const ancestors = projectionPolicy ? browserSurfaceAncestors(element) : [];
      const nextObserved = projectionPolicy
        ? [...ancestors, ...projectionPolicy.occluders(element)]
        : projectionNodes;
      if (
        nextObserved.length !== projectionNodes.length ||
        nextObserved.some((node, i) => node !== projectionNodes[i])
      ) {
        stopObserving();
        transforms?.disconnect();
        for (const node of nextObserved) {
          transforms?.observe(node, { attributes: true, childList: true });
        }
        projectionNodes = nextObserved;
        stopObserving = observeResize(projectionNodes, () => update());
      }
      if (
        source === "mutation" &&
        lastBounds !== null &&
        projectionPolicy?.canPresent(element) === false
      ) {
        lease.present(
          lastBounds,
          false,
          presentation.cornerRadius,
          presentation.zIndex,
          lastProjection,
        );
        return;
      }
      const rect = element.getBoundingClientRect();
      const projected = projectionPolicy
        ? measureBrowserSurfaceProjection(
            element,
            rect,
            ancestors,
            projectionPolicy,
            onFocus,
            keyboard,
          )
        : null;
      if (
        projected &&
        (projected.visible ||
          (lastProjection === null && element.clientWidth > 0 && element.clientHeight > 0))
      ) {
        lastProjection = projected.projection;
      }
      const projection = projected?.visible ? projected.projection : lastProjection;
      const bounds = projected
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
          };
      const showing =
        presentation.visible && (projected?.visible ?? (rect.width > 0 && rect.height > 0));
      lastBounds = bounds;
      const presented = lease.present(
        bounds,
        showing,
        presentation.cornerRadius,
        presentation.zIndex,
        projection,
      );
      if (source === "presentation" && presentation.visible && !presented) {
        lease.release();
        lease = acquireBrowserSurface(tabId, fitSourceContent);
        lease.present(bounds, showing, presentation.cornerRadius, presentation.zIndex, projection);
      }
    };
    const present = () => update("presentation");
    updateRef.current = present;
    update();
    const measure = () => update();
    const observed: Element[] = [element];
    // Inline panels animate their outer width while keeping the content at
    // full width. The slot moves without resizing, so measure on shell resizes too.
    const panel = element.closest('[data-preview-panel-mode="inline"]');
    if (panel) observed.push(panel);
    // A sidebar opening or closing shifts the whole column, so a slot that keeps
    // its size and its offset inside the column (the mini player on the left)
    // still moves on screen. The gap element carries the sidebar's width.
    observed.push(...document.querySelectorAll('[data-slot="sidebar-gap"]'));
    if (!projectionPolicy) stopObserving = observeResize(observed, measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      disposed = true;
      stopObserving();
      transforms?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      if (updateRef.current === present) updateRef.current = null;
      lease.release();
    };
  }, [fitSourceContent, projectionPolicy, tabId]);

  useLayoutEffect(() => {
    presentationRef.current = { visible, cornerRadius, zIndex };
    updateRef.current?.();
  }, [cornerRadius, layoutVersion, visible, zIndex]);

  return <div ref={elementRef} className={className} data-browser-surface-slot={tabId} />;
}
