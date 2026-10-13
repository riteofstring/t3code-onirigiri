import { createContext } from "react";

export interface ChatPaneControls {
  readonly maximized: boolean;
  readonly addPane: () => void;
  readonly closePane: () => void;
  readonly toggleMaximized: () => void;
}

export const ChatPaneControlsContext = createContext<ChatPaneControls | null>(null);
