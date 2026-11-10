import { useAtomMount } from "@effect/atom-react";
import { environmentThreadDetails } from "@t3tools/web/src/state/threads";

import type { ThreadPaneThread } from "./ThreadPane";

export function ThreadDataReady({ thread }: { thread: ThreadPaneThread }) {
  useAtomMount(environmentThreadDetails.threadAtom(thread));
  return null;
}
