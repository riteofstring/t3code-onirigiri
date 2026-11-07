import { createContext, type ReactNode } from "react";

import type { ThreadRouteTarget } from "../threadRoutes";

export interface ChatSurfaceProps {
  readonly target: ThreadRouteTarget | null;
  /** Settings or Usage covers the surface, which must not take input meanwhile. */
  readonly background: boolean;
  readonly children: ReactNode;
}

export const ChatSurfaceContext = createContext<((props: ChatSurfaceProps) => ReactNode) | null>(
  null,
);
