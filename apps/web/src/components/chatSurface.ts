import { createContext, type ReactNode } from "react";

import type { ThreadRouteTarget } from "../threadRoutes";

export interface ChatSurfaceProps {
  readonly target: ThreadRouteTarget | null;
  readonly children: ReactNode;
}

export const ChatSurfaceContext = createContext<((props: ChatSurfaceProps) => ReactNode) | null>(
  null,
);
