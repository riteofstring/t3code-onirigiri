import { createContext, type ReactNode } from "react";

export const ChatViewHostContext = createContext<{
  deferTimeline: boolean;
  timelineFallback: ReactNode;
  onComposerReady: (ready: boolean) => void;
} | null>(null);

export function DeferredChatTimeline() {
  return null;
}
