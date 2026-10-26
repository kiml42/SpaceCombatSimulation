import type { RouteObject } from "react-router";
import { Shell } from "./Shell";
import { BattlePage } from "./routes/battle/BattlePage";
import { EvolutionPage } from "./routes/evolution/EvolutionPage";
import { FleetPage } from "./routes/fleet/FleetPage";
import { ShipPage } from "./routes/ship/ShipPage";
import { SkirmishRoute } from "./routes/skirmish/SkirmishPage";
import { Home } from "./routes/home/Home";
import { LibraryPage } from "./routes/library/LibraryPage";
import { NotFound } from "./routes/NotFound";

/**
 * Every screen, by its path after the `#`: a hash route, since the app is one
 * file opened from disk as often as served, and `file://` has no server to ask
 * for any other path.
 */
export const ROUTES: RouteObject[] = [
    {
        element: <Shell />,
        children: [
            { index: true, element: <Home /> },
            { path: "battle", element: <BattlePage /> },
            { path: "fleet", element: <FleetPage /> },
            { path: "ship", element: <ShipPage /> },
            { path: "skirmish", element: <SkirmishRoute /> },
            { path: "evolution", element: <EvolutionPage /> },
            { path: "library", element: <LibraryPage /> },
            { path: "*", element: <NotFound /> },
        ],
    },
];
