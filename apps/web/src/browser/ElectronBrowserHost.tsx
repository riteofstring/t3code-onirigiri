"use client";

import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  AuthPreviewOperateScope,
  FILL_PREVIEW_VIEWPORT,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { type ComponentProps, useEffect, useMemo, useRef, useState } from "react";

import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";

import { usePreviewSession } from "~/components/preview/usePreviewSession";
import { isElectron } from "~/env";
import { useClientSettingsHydrated } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { useActivePreviewSessions, type ThreadPreviewState } from "~/previewStateStore";
import { previewEnvironment } from "~/state/preview";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { useSurfaceNavigation } from "~/surfaceNavigation";

import { readPreviewAnnotationTheme } from "./annotationTheme";
import { useBrowserDefaults } from "./browserDefaults";
import { useBrowserPointerStore } from "./browserPointerStore";
import { HostedBrowserWebview } from "./HostedBrowserWebview";
import { openUrlInPreview } from "./openFileInPreview";
import { rendersServerTabNatively } from "./previewRuntime";
import { previewRuntimeTabId } from "./previewRuntimeTabId";

export function ElectronBrowserHost() {
  const { resolvedTheme } = useTheme();
  const surfaceNavigation = useSurfaceNavigation();
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

  // A `target="_blank"` link inside a hosted page opens as another tab of the
  // same thread, so the page that held the link stays where it is.
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: true });
  const sessionByRuntimeTabId = useRef(
    new Map<
      string,
      {
        threadRef: ScopedThreadRef;
        snapshot: ThreadPreviewState["sessions"][string];
      }
    >(),
  );
  useEffect(() => {
    sessionByRuntimeTabId.current = new Map(
      threads.flatMap(({ threadRef, previewState }) =>
        previewState.serverEpoch === null
          ? []
          : Object.values(previewState.sessions).map(
              (snapshot) =>
                [
                  previewRuntimeTabId(threadRef, previewState.serverEpoch, snapshot.tabId),
                  { threadRef, snapshot },
                ] as const,
            ),
      ),
    );
  }, [threads]);
  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onOpenLink(({ tabId, url, background }) => {
      const source = sessionByRuntimeTabId.current.get(tabId);
      if (!source) return;
      // The new tab keeps the source tab's profile so its cookies carry over.
      void openUrlInPreview({
        threadRef: source.threadRef,
        url,
        openPreview,
        openBrowser: surfaceNavigation.openBrowser,
        profileId: source.snapshot.profileId,
        background,
      });
    });
  }, [openPreview, surfaceNavigation]);

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
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  // Opening a tab returns its snapshot before the first list/event can identify
  // the server. Creating a guest under that temporary identity would replace it.
  if (previewState.serverEpoch === null) return null;

  return (
    <>
      {Object.values(previewState.sessions)
        .filter(
          (snapshot) =>
            snapshot.runtime !== "server" ||
            rendersServerTabNatively(threadRef.environmentId, primaryEnvironmentId, snapshot),
        )
        .map((snapshot) => {
          const runtimeTabId = previewRuntimeTabId(
            threadRef,
            previewState.serverEpoch,
            snapshot.tabId,
          );
          const overlay = previewState.desktopByTabId[snapshot.tabId];
          const url = snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
          return (
            <AuthorizedBrowserWebview
              key={runtimeTabId}
              threadRef={threadRef}
              tabId={snapshot.tabId}
              runtimeTabId={runtimeTabId}
              initialUrl={url}
              viewport={snapshot.viewport ?? FILL_PREVIEW_VIEWPORT}
              pictureInPicture={overlay?.pictureInPicture ?? false}
              profileId={snapshot.profileId}
              zoomFactor={overlay?.zoomFactor ?? 1}
              serverDriven={snapshot.runtime === "server"}
              {...(snapshot.runtime === "server"
                ? {
                    serverRendering: {
                      colorScheme: snapshot.colorScheme ?? "system",
                      zoomFactor: snapshot.zoomFactor ?? 1,
                    },
                  }
                : {})}
            />
          );
        })}
    </>
  );
}

function AuthorizedBrowserWebview(props: ComponentProps<typeof HostedBrowserWebview>) {
  const canOperatePreview = useEnvironmentScope(
    props.threadRef.environmentId,
    AuthPreviewOperateScope,
  );
  const profileId = useTabProfileId(props.profileId);
  return canOperatePreview ? <HostedBrowserWebview {...props} profileId={profileId} /> : null;
}

/**
 * Agent `preview_open` normally carries the profile clients reported (see
 * BrowserProfileReporter). An agent tab opened before any client reported has
 * none, so it falls back to the configured default here. It is latched once
 * settings load: Electron fixes the partition when the guest attaches, so a
 * later settings change must not move a live tab.
 */
function useTabProfileId(profileId: string | undefined): string | undefined {
  const hydrated = useClientSettingsHydrated();
  const defaultProfileId = useBrowserDefaults().profileId;
  const [fallback, setFallback] = useState<string | undefined>(undefined);
  if (profileId === undefined && hydrated && fallback === undefined) {
    setFallback(defaultProfileId);
  }
  return profileId ?? fallback;
}
