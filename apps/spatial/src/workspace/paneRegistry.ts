import type { ChatViewActivity } from "@t3tools/web/src/components/chatViewActivity";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";

const PASSIVE_UPDATE_TIMEOUT_MS = 500;
const PASSIVE_UPDATE_MIN_IDLE_MS = 4;

const waitingPanes = new Set<() => void>();
let idle: number | null = null;

const deliverWhileIdle = (deadline: IdleDeadline) => {
  idle = null;
  for (const deliver of waitingPanes) {
    waitingPanes.delete(deliver);
    deliver();
    if (deadline.timeRemaining() < PASSIVE_UPDATE_MIN_IDLE_MS) break;
  }
  if (waitingPanes.size > 0) scheduleDelivery();
};

function scheduleDelivery() {
  idle ??= requestIdleCallback(deliverWhileIdle, { timeout: PASSIVE_UPDATE_TIMEOUT_MS });
}

/**
 * A pane's view of the app's atom registry. A passive pane hears changes during idle
 * time, one pane after another, so a change every pane reads, such as a provider status
 * push, does not re-render every mounted conversation in one task. The active pane
 * hears changes at once, and becoming active delivers anything still waiting.
 */
export function createPaneRegistry(registry: AtomRegistry, activity: ChatViewActivity) {
  const waiting = new Set<() => void>();
  const deliver = () => {
    waitingPanes.delete(deliver);
    const listeners = [...waiting];
    waiting.clear();
    for (const listener of listeners) listener();
  };
  const stopFollowingActivity = activity.subscribe(() => {
    if (activity.isActive()) deliver();
  });
  const subscribe: AtomRegistry["subscribe"] = (atom, listener, options) => {
    let latest: Parameters<typeof listener>[0];
    const notify = () => listener(latest);
    const unsubscribe = registry.subscribe(
      atom,
      (value) => {
        latest = value;
        if (activity.isActive()) {
          waiting.delete(notify);
          listener(value);
          return;
        }
        waiting.add(notify);
        waitingPanes.add(deliver);
        scheduleDelivery();
      },
      options,
    );
    return () => {
      waiting.delete(notify);
      unsubscribe();
    };
  };
  const paneRegistry = new Proxy(registry, {
    get(target, property) {
      if (property === "subscribe") return subscribe;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const dispose = () => {
    stopFollowingActivity();
    waiting.clear();
    waitingPanes.delete(deliver);
  };
  return { registry: paneRegistry, dispose };
}
