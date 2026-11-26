import type { ShipStanding } from "~/scenarios/decision";
import { Unarmed } from "~/sim/index";

/** What stopped a ship shooting, as the defeat box says it. */
const UNARMED: Record<Unarmed, string> = {
    [Unarmed.None]: "",
    [Unarmed.Gone]: "destroyed",
    [Unarmed.NoCore]: "its core is out",
    [Unarmed.Unfitted]: "built with no guns",
    [Unarmed.Wrecked]: "its guns are wrecked",
    [Unarmed.NoAmmunition]: "out of ammunition",
    [Unarmed.NoCharge]: "out of charge",
    [Unarmed.NoFuel]: "out of fuel",
};

/** What stopped it moving, after what stopped it shooting; empty where that says it already. */
function engines(standing: ShipStanding): string {
    switch (standing.immobile) {
        case Unarmed.Wrecked:
            return "its engines are wrecked";
        case Unarmed.NoFuel:
            return "its engines are dry";
        default:
            return "";
    }
}

function rounds(n: number): string {
    return n === 1 ? "1 round" : `${n} rounds`;
}

function metres(m: number): string {
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m.toFixed(0)} m`;
}

/** Why one ship is out of the fight, as a line of the defeat box. */
export function outLine(standing: ShipStanding): string {
    const why = UNARMED[standing.unarmed];
    if (standing.unarmed === Unarmed.Gone || standing.unarmed === Unarmed.NoCore) return why;
    const parts = [why];
    // Casings with nothing to fire them is the case worth spelling out.
    if (standing.unarmed !== Unarmed.NoAmmunition && standing.rounds > 0) {
        const aboard = `casings for ${rounds(standing.rounds)} aboard`;
        // Fuel is a round's propellant and bursting charge, which is why a gun needs it at all.
        parts.push(standing.unarmed === Unarmed.NoFuel ? `${aboard}, but no fuel to fire them` : aboard);
    }
    const moving = engines(standing);
    if (moving !== "") parts.push(moving);
    return parts.join("; ");
}

/** Why a ship that could still shoot was not firing, for a battle lost by going quiet. */
export function quietLine(standing: ShipStanding): string {
    const since = standing.quietFor === null ? "never fired" : `last fired ${standing.quietFor.toFixed(0)} s ago`;
    const nearest = Number.isFinite(standing.nearest) ? `; nearest enemy ${metres(standing.nearest)} away` : "";
    return `${since}${nearest}`;
}

/** What a ship still able to fight has, for the side that won. */
export function ableLine(standing: ShipStanding): string {
    const since = standing.quietFor === null ? "never fired" : `last fired ${standing.quietFor.toFixed(0)} s ago`;
    return standing.rounds > 0 ? `${rounds(standing.rounds)} aboard; ${since}` : since;
}
