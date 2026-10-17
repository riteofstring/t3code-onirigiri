import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserHistory } from "@tanstack/react-router";
import { AppRoot } from "@t3tools/web/src/AppRoot";
import { ChatSurfaceContext } from "@t3tools/web/src/components/chatSurface";
import { SidebarPresentationContext } from "@t3tools/web/src/components/sidebar/sidebarPresentation";
import { prepareProviderAuthDelivery } from "@t3tools/web/src/providerAuthDelivery";
import { getRouter } from "@t3tools/web/src/router";

import "./index.css";

import { renderSpatialChatSurface } from "./workspace/SpatialChatSurface";
import { SpatialSurfaceProvider } from "./workspace/SpatialSurfaceProvider";

prepareProviderAuthDelivery();

const router = getRouter(createBrowserHistory());

export const startup = router.load().then(() => {
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
