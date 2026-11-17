import { create } from "zustand";

import type { BrowserSurfaceProjection } from "./browserSurfaceProjection";

export interface BrowserSurfaceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BrowserSurfacePresentation {
  readonly rect: BrowserSurfaceRect | null;
  readonly projection: BrowserSurfaceProjection | null;
  readonly visible: boolean;
  readonly zIndex: number;
  readonly content: BrowserSurfaceContentPresentation | null;
  readonly fittedSourceContent: BrowserSurfaceContentPresentation | null;
  readonly fitSourceContent: boolean;
  readonly cornerRadius: number;
  readonly updatedAt: number;
  readonly owner: symbol | null;
}

export interface BrowserSurfaceContentPresentation {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
}

interface BrowserSurfaceStoreState {
  readonly activityByTabId: Record<string, number>;
  readonly byTabId: Record<string, BrowserSurfacePresentation>;
  readonly acquireActivity: (tabId: string) => () => void;
  readonly claim: (tabId: string, owner: symbol, fitSourceContent: boolean) => void;
  readonly present: (
    tabId: string,
    owner: symbol,
    rect: BrowserSurfaceRect,
    visible: boolean,
    cornerRadius: number,
    zIndex: number,
    projection?: BrowserSurfaceProjection | null,
  ) => void;
  readonly presentContent: (tabId: string, content: BrowserSurfaceContentPresentation) => void;
  readonly release: (tabId: string, owner: symbol) => void;
}

export interface BrowserSurfaceLease {
  readonly present: (
    rect: BrowserSurfaceRect,
    visible: boolean,
    cornerRadius?: number,
    zIndex?: number,
    projection?: BrowserSurfaceProjection | null,
  ) => boolean;
  readonly release: () => void;
}

const rectEquals = (left: BrowserSurfaceRect | null, right: BrowserSurfaceRect): boolean =>
  left !== null &&
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height;

const projectionEquals = (
  left: BrowserSurfaceProjection | null,
  right: BrowserSurfaceProjection | null,
): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.width === right.width &&
    left.height === right.height &&
    left.scaleX === right.scaleX &&
    left.scaleY === right.scaleY &&
    left.clipPath === right.clipPath &&
    left.interactive === right.interactive &&
    left.keyboard === right.keyboard &&
    left.onFocus === right.onFocus);

export const useBrowserSurfaceStore = create<BrowserSurfaceStoreState>()((set) => ({
  activityByTabId: {},
  byTabId: {},
  acquireActivity: (tabId) => {
    let released = false;
    set((state) => ({
      activityByTabId: {
        ...state.activityByTabId,
        [tabId]: (state.activityByTabId[tabId] ?? 0) + 1,
      },
    }));
    return () => {
      if (released) return;
      released = true;
      set((state) => {
        const count = state.activityByTabId[tabId] ?? 0;
        const activityByTabId = { ...state.activityByTabId };
        if (count <= 1) delete activityByTabId[tabId];
        else activityByTabId[tabId] = count - 1;
        return { activityByTabId };
      });
    };
  },
  claim: (tabId, owner, fitSourceContent) =>
    set((state) => {
      const current = state.byTabId[tabId];
      if (current?.owner === owner) return state;
      return {
        byTabId: {
          ...state.byTabId,
          [tabId]: {
            rect: current?.rect ?? null,
            projection: null,
            visible: false,
            zIndex: current?.zIndex ?? 30,
            content: current?.content ?? null,
            fittedSourceContent: fitSourceContent ? (current?.content ?? null) : null,
            fitSourceContent,
            cornerRadius: current?.cornerRadius ?? 0,
            updatedAt: Date.now(),
            owner,
          },
        },
      };
    }),
  present: (tabId, owner, rect, visible, cornerRadius, zIndex, projection = null) =>
    set((state) => {
      const current = state.byTabId[tabId];
      if (current?.owner !== owner) return state;
      if (
        current &&
        current.visible === visible &&
        current.cornerRadius === cornerRadius &&
        current.zIndex === zIndex &&
        rectEquals(current.rect, rect) &&
        projectionEquals(current.projection, projection)
      ) {
        return state;
      }
      return {
        byTabId: {
          ...state.byTabId,
          [tabId]: {
            ...current,
            rect,
            projection,
            visible,
            cornerRadius,
            zIndex,
            updatedAt: Date.now(),
          },
        },
      };
    }),
  presentContent: (tabId, content) =>
    set((state) => {
      const current = state.byTabId[tabId];
      if (!current) {
        return {
          byTabId: {
            ...state.byTabId,
            [tabId]: {
              rect: null,
              projection: null,
              visible: false,
              zIndex: 30,
              content,
              fittedSourceContent: null,
              fitSourceContent: false,
              cornerRadius: 0,
              updatedAt: Date.now(),
              owner: null,
            },
          },
        };
      }
      const previous = current.content;
      if (
        previous &&
        previous.x === content.x &&
        previous.y === content.y &&
        previous.width === content.width &&
        previous.height === content.height &&
        previous.scale === content.scale &&
        previous.scrollLeft === content.scrollLeft &&
        previous.scrollTop === content.scrollTop
      ) {
        return state;
      }
      return {
        byTabId: {
          ...state.byTabId,
          [tabId]: {
            ...current,
            content,
            fittedSourceContent:
              current.fitSourceContent && current.fittedSourceContent === null
                ? content
                : current.fittedSourceContent,
            updatedAt: Date.now(),
          },
        },
      };
    }),
  release: (tabId, owner) =>
    set((state) => {
      const current = state.byTabId[tabId];
      if (current?.owner !== owner) return state;
      return {
        byTabId: {
          ...state.byTabId,
          [tabId]: {
            ...current,
            visible: false,
            fittedSourceContent: null,
            fitSourceContent: false,
            updatedAt: Date.now(),
            owner: null,
          },
        },
      };
    }),
}));

export const acquireBrowserSurfaceActivity = (tabId: string): (() => void) =>
  useBrowserSurfaceStore.getState().acquireActivity(tabId);

export function acquireBrowserSurface(
  tabId: string,
  fitSourceContent = false,
): BrowserSurfaceLease {
  const owner = Symbol(`browser-surface:${tabId}`);
  let released = false;
  useBrowserSurfaceStore.getState().claim(tabId, owner, fitSourceContent);

  return {
    present: (rect, visible, cornerRadius = 0, zIndex = 30, projection = null) => {
      if (released) return false;
      if (useBrowserSurfaceStore.getState().byTabId[tabId]?.owner !== owner) return false;
      useBrowserSurfaceStore
        .getState()
        .present(tabId, owner, rect, visible, cornerRadius, zIndex, projection);
      return true;
    },
    release: () => {
      if (released) return;
      released = true;
      useBrowserSurfaceStore.getState().release(tabId, owner);
    },
  };
}
