"use client";

import { useContext, useLayoutEffect, useRef } from "react";

import { acquireBrowserSurface, type BrowserSurfaceRect } from "./browserSurfaceStore";
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
    let observed: readonly HTMLElement[] = [];
    let lastBounds: BrowserSurfaceRect | null = null;
    let lastProjection: ReturnType<typeof measureBrowserSurfaceProjection>["projection"] | null =
      null;
    const onFocus = () => projectionPolicy?.focus(element);
    const observer = new ResizeObserver(() => update());
    // Camera transforms do not resize the slot. Observe presented ancestor
    // writes, including moves that do not affect the focused pane.
    const transforms = projectionPolicy ? new MutationObserver(() => update("mutation")) : null;
    const update = (source: "geometry" | "mutation" | "presentation" = "geometry") => {
      const presentation = presentationRef.current;
      const ancestors = projectionPolicy ? browserSurfaceAncestors(element) : [];
      const panel = element.closest<HTMLElement>('[data-preview-panel-mode="inline"]');
      const nextObserved = projectionPolicy
        ? [...ancestors, ...projectionPolicy.occluders(element)]
        : [element, ...(panel ? [panel] : [])];
      if (
        nextObserved.length !== observed.length ||
        nextObserved.some((node, i) => node !== observed[i])
      ) {
        observer.disconnect();
        transforms?.disconnect();
        for (const node of nextObserved) {
          observer.observe(node);
          transforms?.observe(node, { attributes: true, childList: true });
        }
        observed = nextObserved;
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
        ? measureBrowserSurfaceProjection(element, rect, ancestors, projectionPolicy, onFocus)
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
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
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
