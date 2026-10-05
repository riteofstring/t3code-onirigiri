import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserHistory, RouterProvider } from "@tanstack/react-router";
import { prepareProviderAuthDelivery } from "@t3tools/web/src/providerAuthDelivery";
import { AppAtomRegistryProvider } from "@t3tools/web/src/rpc/atomRegistry";

import "./index.css";

import { getRouter } from "./router";

prepareProviderAuthDelivery();

const router = getRouter(createBrowserHistory());

export const startup = router.load().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppAtomRegistryProvider>
        <RouterProvider router={router} />
      </AppAtomRegistryProvider>
    </React.StrictMode>,
  );
});
