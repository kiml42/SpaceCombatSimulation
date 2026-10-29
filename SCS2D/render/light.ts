/**
 * The light a battle is seen in, so each place can feel like somewhere
 * different. Only drawn: it never touches the simulation.
 */
export interface Light {
    /** The bearing it comes from, in radians in the world, anticlockwise from +x. */
    readonly from: number;
    /** Its colour, as CSS hex. */
    readonly colour: string;
    /** How much of it reaches a surface in shadow, from 0 to 1. */
    readonly ambient: number;
}

/** White, from the top left, with shadows a little under half dark. */
export const DEFAULT_LIGHT: Light = { from: (3 * Math.PI) / 4, colour: "#ffffff", ambient: 0.55 };

/** How far a thick module's shadow falls across the thin hull beside it, metres. */
export const THICK_SHADOW_M = 1.5;
/** How far a fighter's shadow falls on the hull below it, metres: further, as it is higher. */
export const FIGHTER_SHADOW_M = 4;
