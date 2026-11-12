import { createContext } from "react";

export interface ChatPaneControls {
  readonly maximized: boolean;
  /** The pane accepts typing, but its messages are not interactive yet. */
  readonly loading?: boolean;
  readonly addPane: () => void;
  readonly closePane: () => void;
  readonly toggleMaximized: () => void;
}

export const ChatPaneControlsContext = createContext<ChatPaneControls | null>(null);
