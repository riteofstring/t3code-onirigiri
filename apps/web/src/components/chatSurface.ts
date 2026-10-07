import { createContext, type ComponentType, type ReactNode } from "react";

import type { ThreadRouteTarget } from "../threadRoutes";

export interface ChatSurfaceProps {
  /** The thread the chat route points at, or null on routes without one. */
  readonly target: ThreadRouteTarget | null;
  /** The chat route's own outlet, for routes that are not a thread. */
  readonly children: ReactNode;
}

/**
 * Lets a host replace how the chat route presents threads, keeping the rest of
 * the app shell (sidebar, settings, global shortcuts) unchanged. Without a
 * provider the chat route renders one `ThreadRouteView` for the routed thread.
 */
export const ChatSurfaceContext = createContext<ComponentType<ChatSurfaceProps> | null>(null);
