import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PreviewListInput,
  PreviewListResult,
  ScopedThreadRef,
} from "@t3tools/contracts";

import { acquireDesktopTab } from "~/browser/desktopTabLifetime";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import {
  readThreadPreviewState,
  reconcilePreviewServerSessions,
  rememberPreviewUrl,
} from "~/previewStateStore";

import { previewBridge } from "./previewBridge";

export async function navigatePreviewSession<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly tabId: string;
  readonly url: string;
  readonly listPreviews: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: PreviewListInput;
  }) => Promise<AtomCommandResult<PreviewListResult, E>>;
}): Promise<boolean> {
  const { threadRef, tabId, url } = input;
  const bridge = previewBridge;
  if (!bridge) return false;
  let state = readThreadPreviewState(threadRef);
  if (!state.sessions[tabId]) return false;
  if (state.serverEpoch === null) {
    const result = await input.listPreviews({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
    if (result._tag === "Failure") return false;
    state = readThreadPreviewState(threadRef);
    if (
      !state.sessions[tabId] ||
      (state.serverEpoch !== null && state.serverEpoch !== result.value.serverEpoch)
    ) {
      return false;
    }
    reconcilePreviewServerSessions(threadRef, result.value);
    state = readThreadPreviewState(threadRef);
  }
  if (!state.sessions[tabId] || state.serverEpoch === null) return false;
  const runtimeTabId = previewRuntimeTabId(threadRef, state.serverEpoch, tabId);
  const isCurrent = () => {
    const current = readThreadPreviewState(threadRef);
    return (
      current.sessions[tabId] !== undefined &&
      previewRuntimeTabId(threadRef, current.serverEpoch, tabId) === runtimeTabId
    );
  };
  const lease = acquireDesktopTab(
    runtimeTabId,
    state.sessions[tabId]?.runtime === "server"
      ? { threadId: threadRef.threadId, tabId }
      : undefined,
  );
  try {
    await lease.ready;
    if (!isCurrent()) return false;
    // The bridge mirrors the resolved URL back to the server.
    await bridge.navigate(runtimeTabId, url);
    if (!isCurrent()) return false;
    rememberPreviewUrl(threadRef, url);
    return true;
  } finally {
    lease.release();
  }
}
