import { useState, useSyncExternalStore, type ReactNode } from "react";

import { useChatViewActivity, type ChatViewActivity } from "./chatViewActivity";

const alwaysUpdate = () => true;

export function DeferredChatContent({ children }: { children: ReactNode }) {
  const activity = useChatViewActivity();
  return activity.shouldUpdateContent ? (
    <RetainedContent activity={activity}>{children}</RetainedContent>
  ) : (
    children
  );
}

function RetainedContent({
  activity,
  children,
}: {
  activity: ChatViewActivity;
  children: ReactNode;
}) {
  const warm = useSyncExternalStore(
    activity.subscribe,
    activity.shouldUpdateContent ?? alwaysUpdate,
    alwaysUpdate,
  );
  const [shown, setShown] = useState(children);
  if (warm && shown !== children) setShown(children);
  // Retaining the element leaves the transcript mounted, including its scroll state.
  // The parent continues receiving data and running effects; reactivation uses its latest props.
  return warm ? children : shown;
}
