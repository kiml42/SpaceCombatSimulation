import { Navigate, useLocation, type RouteObject } from "react-router";
import { Shell } from "./Shell";
import { BattlePage } from "./routes/battle/BattlePage";
import { EffectsPage } from "./routes/effects/EffectsPage";
import { EvolutionPage } from "./routes/evolution/EvolutionPage";
import { FleetPage } from "./routes/fleet/FleetPage";
import { ShipPage } from "./routes/ship/ShipPage";
import { SkirmishRoute } from "./routes/skirmish/SkirmishPage";
import { Home } from "./routes/home/Home";
import { LibraryPage } from "./routes/library/LibraryPage";
import { NotFound } from "./routes/NotFound";

/** The Simulator, keeping whatever battle or fleet the address hands it. */
function ToSimulator() {
    const { search } = useLocation();
    return <Navigate to={`/simulator${search}`} replace />;
}

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
            { path: "simulator", element: <BattlePage /> },
            // Its old address, which links made before it was the Simulator carry.
            { path: "battle", element: <ToSimulator /> },
            { path: "fleet", element: <FleetPage /> },
            { path: "ship", element: <ShipPage /> },
            { path: "skirmish", element: <SkirmishRoute /> },
            { path: "evolution", element: <EvolutionPage /> },
            { path: "library", element: <LibraryPage /> },
            { path: "effects", element: <EffectsPage /> },
            { path: "*", element: <NotFound /> },
        ],
    },
];
