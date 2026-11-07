import React from "react";
import ReactDOM from "react-dom/client";
import { startAppServices } from "@t3tools/web/src/appInit";
import { AppRoot } from "@t3tools/web/src/AppRoot";
import { ChatSurfaceContext } from "@t3tools/web/src/components/chatSurface";
import { SidebarPresentationContext } from "@t3tools/web/src/components/sidebar/sidebarPresentation";
import {
  clearChunkReloadGuard,
  reloadOnceForChunkLoadError,
} from "@t3tools/web/src/lib/chunkReloadGuard";

import "./index.css";

import { renderSpatialChatSurface } from "./workspace/SpatialChatSurface";
import { SpatialSurfaceProvider } from "./workspace/SpatialSurfaceProvider";

const router = startAppServices();

let chunkLoadFailed = false;
let reloadScheduled = false;
window.addEventListener("vite:preloadError", (event) => {
  chunkLoadFailed = true;
  if (reloadOnceForChunkLoadError()) {
    reloadScheduled = true;
    event.preventDefault();
  }
});

export const startup = router.load().then(() => {
  if (reloadScheduled) return;
  if (!chunkLoadFailed) clearChunkReloadGuard();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ChatSurfaceContext value={renderSpatialChatSurface}>
        <SidebarPresentationContext value="all-conversations">
          <SpatialSurfaceProvider router={router}>
            <AppRoot router={router} />
          </SpatialSurfaceProvider>
        </SidebarPresentationContext>
      </ChatSurfaceContext>
    </React.StrictMode>,
  );
});
