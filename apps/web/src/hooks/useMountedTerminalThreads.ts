import {
  parseScopedThreadKey,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useComposerDraftStore } from "../composerDraftStore";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { useThreadRefs } from "../state/entities";
import {
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  reconcileMountedTerminalThreadIds,
} from "../components/ChatView.logic";

const noKeys: string[] = [];
const noDrafts: ReturnType<typeof useComposerDraftStore.getState>["draftThreadsByThreadKey"] = {};

export function useMountedTerminalThreads(
  activeThreadKey: string | null,
  activeTerminalPresent: boolean,
  enabled = true,
) {
  const openKeys = useTerminalUiStateStore(
    useShallow((state) =>
      enabled
        ? Object.entries(state.terminalUiStateByThreadKey).flatMap(([key, value]) =>
            value.terminalOpen ? [key] : [],
          )
        : noKeys,
    ),
  );
  const serverRefs = useThreadRefs(enabled);
  const drafts = useComposerDraftStore((state) =>
    enabled ? state.draftThreadsByThreadKey : noDrafts,
  );
  const openExistingKeys = useMemo(() => {
    if (!enabled) return noKeys;
    const existing = new Set([
      ...serverRefs.map(scopedThreadKey),
      ...Object.values(drafts).map((draft) =>
        scopedThreadKey(scopeThreadRef(draft.environmentId, draft.threadId)),
      ),
    ]);
    return openKeys.filter((key) => existing.has(key));
  }, [drafts, enabled, openKeys, serverRefs]);
  const [mounted, setMounted] = useState<string[]>([]);
  const next = useMemo(
    () =>
      enabled
        ? reconcileMountedTerminalThreadIds({
            currentThreadIds: mounted,
            openThreadIds: openExistingKeys,
            activeThreadId: activeThreadKey,
            activeThreadTerminalOpen: activeTerminalPresent,
            maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
          })
        : noKeys,
    [activeTerminalPresent, activeThreadKey, enabled, mounted, openExistingKeys],
  );
  if (mounted.length !== next.length || mounted.some((key, index) => key !== next[index]))
    setMounted(next);
  return useMemo(
    () =>
      (enabled ? mounted : noKeys).flatMap((key) => {
        const threadRef = parseScopedThreadKey(key);
        return threadRef ? [{ key, threadRef }] : [];
      }),
    [enabled, mounted],
  );
}
