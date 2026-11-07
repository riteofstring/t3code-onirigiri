import { minuteTick } from "@t3tools/client-runtime/clock";
import { useSyncExternalStore } from "react";

import type { ChatViewActivity } from "../components/chatViewActivity";

function activityMinuteClock(activity: ChatViewActivity) {
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
}

export function useNowMinute(activity?: ChatViewActivity): string {
  const clock = activity ? activityMinuteClock(activity) : minuteTick;
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
}
