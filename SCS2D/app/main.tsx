import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router";
import { browserStorage } from "~/features/storage/observedStorage";
import { StorageProvider } from "~/features/storage/StorageProvider";
import "~/ui/tokens/tokens.css";
import { routeOfLegacyHash } from "./legacyLinks";
import { ROUTES } from "./routes";

const legacy = routeOfLegacyHash(window.location.hash);
if (legacy !== null) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${legacy}`);
const router = createHashRouter(ROUTES);

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <StorageProvider storage={browserStorage()}>
            <RouterProvider router={router} />
        </StorageProvider>
    </StrictMode>,
);
