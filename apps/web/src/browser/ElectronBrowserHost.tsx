"use client";

import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { FILL_PREVIEW_VIEWPORT, type ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useMemo } from "react";

import { usePreviewSession } from "~/components/preview/usePreviewSession";
import { isElectron } from "~/env";
import { useTheme } from "~/hooks/useTheme";
import { useActivePreviewSessions, type ThreadPreviewState } from "~/previewStateStore";

import { readPreviewAnnotationTheme } from "./annotationTheme";
import { useBrowserPointerStore } from "./browserPointerStore";
import { HostedBrowserWebview } from "./HostedBrowserWebview";
import { previewRuntimeTabId } from "./previewRuntimeTabId";

export function ElectronBrowserHost() {
  const { resolvedTheme } = useTheme();
  const previewByThreadKey = useActivePreviewSessions();
  const threads = useMemo(
    () =>
      Object.entries(previewByThreadKey).flatMap(([threadKey, previewState]) => {
        const threadRef = parseScopedThreadKey(threadKey);
        return threadRef ? [{ threadKey, threadRef, previewState }] : [];
      }),
    [previewByThreadKey],
  );

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;

    let lastSerializedTheme = "";
    const syncTheme = () => {
      const theme = readPreviewAnnotationTheme();
      const serializedTheme = JSON.stringify(theme);
      if (serializedTheme === lastSerializedTheme) return;
      lastSerializedTheme = serializedTheme;
      void preview.setAnnotationTheme(theme).catch(() => {
        lastSerializedTheme = "";
      });
    };
    const frameId = window.requestAnimationFrame(syncTheme);
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    const headObserver = new MutationObserver(syncTheme);
    headObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      headObserver.disconnect();
    };
  }, [resolvedTheme]);

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onPointerEvent((event) => {
      useBrowserPointerStore.getState().apply(event);
    });
  }, []);

  if (!isElectron) return null;
  return (
    <div className="contents" data-electron-browser-host>
      {threads.map(({ threadKey, threadRef, previewState }) => (
        <ThreadBrowserHost key={threadKey} threadRef={threadRef} previewState={previewState} />
      ))}
    </div>
  );
}

function ThreadBrowserHost({
  threadRef,
  previewState,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly previewState: ThreadPreviewState;
}) {
  usePreviewSession(threadRef);
  // Opening a tab returns its snapshot before the first list/event can identify
  // the server. Creating a guest under that temporary identity would replace it.
  if (previewState.serverEpoch === null) return null;

  return (
    <>
      {Object.values(previewState.sessions).map((snapshot) => {
        const runtimeTabId = previewRuntimeTabId(
          threadRef,
          previewState.serverEpoch,
          snapshot.tabId,
        );
        const overlay = previewState.desktopByTabId[snapshot.tabId];
        const url = snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
        return (
          <HostedBrowserWebview
            key={runtimeTabId}
            threadRef={threadRef}
            tabId={snapshot.tabId}
            runtimeTabId={runtimeTabId}
            initialUrl={url}
            viewport={snapshot.viewport ?? FILL_PREVIEW_VIEWPORT}
            pictureInPicture={overlay?.pictureInPicture ?? false}
            profileId={snapshot.profileId}
            zoomFactor={overlay?.zoomFactor ?? 1}
          />
        );
      })}
    </>
  );
}
