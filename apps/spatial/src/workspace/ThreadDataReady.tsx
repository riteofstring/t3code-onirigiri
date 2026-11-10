import { useAtomMount } from "@effect/atom-react";
import { environmentThreadDetails } from "@t3tools/web/src/state/threads";

import type { ThreadPaneThread } from "./ThreadPane";

// Keeps a thread's detail loaded without rendering any of it.
export function ThreadDataReady({ thread }: { thread: ThreadPaneThread }) {
  useAtomMount(environmentThreadDetails.threadAtom(thread));
  return null;
}
