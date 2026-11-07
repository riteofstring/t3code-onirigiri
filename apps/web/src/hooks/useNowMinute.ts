import { minuteTick } from "@t3tools/client-runtime/clock";
import { useMemo, useSyncExternalStore } from "react";

import type { ChatViewActivity } from "../components/chatViewActivity";

export function useNowMinute(activity?: ChatViewActivity): string {
  const clock = useMemo(() => {
    if (!activity) return minuteTick;
    let minute = minuteTick.getSnapshot();
    return {
      getSnapshot: () => minute,
      subscribe: (listener: () => void) => {
        const update = () => {
          if (!(activity.isVisible?.() ?? activity.isActive())) return;
          minute = minuteTick.getSnapshot();
          listener();
        };
        const unsubscribeClock = minuteTick.subscribe(update);
        const unsubscribeActivity = activity.subscribe(update);
        update();
        return () => {
          unsubscribeClock();
          unsubscribeActivity();
        };
      },
    };
  }, [activity]);
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
}
