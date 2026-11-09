import { createContext, type ButtonHTMLAttributes, type ReactNode } from "react";
import { vi } from "vite-plus/test";

import { useToolPanes } from "./useToolPanes";

export const bindWorkspace = vi.fn<(target: { focusPane: (id: string) => void } | null) => void>();
export const pictureLayoutChanged = vi.fn();

const pictures = {
  getPanePresentation: () => "dom",
  onLayoutChange: pictureLayoutChanged,
  pictureFor: () => null,
  displayedPictureFor: () => null,
  preparedPictureUrl: () => null,
  pictureUrl: () => "",
  hasFreshPicture: () => false,
  canBackgroundPicture: () => false,
  picturesLoaded: true,
  paneSnapshots: {},
  setCaptureActivity: vi.fn(),
  stageRef: vi.fn(),
  stageViewport: { width: 1200, height: 900, compact: false },
};

export const savedPictures = {
  PaneSnapshotContext: createContext(null),
  useSavedPanePictures: () => pictures,
};

export const controller = {
  useSpatialController: () => ({ controller: useToolPanes(), bindWorkspace }),
};

export const tooltips = {
  WorkspaceTooltips: ({ children }: { children: ReactNode }) => children,
  WorkspaceControlButton: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
};

export function stubWorkspaceFrames() {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) =>
    window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0),
  );
  vi.stubGlobal("cancelIdleCallback", (id: number) => window.clearTimeout(id));
}
