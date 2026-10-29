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
/** How far an asteroid's rock's shadow falls on a ship beside it, metres: twice a thick module's, as rock stands taller. */
export const ROCK_SHADOW_M = 2 * THICK_SHADOW_M;
/** How high an asteroid's kernel stands, as a shadow's length on the hull below, metres: taller again; on its own rock, the difference. */
export const KERNEL_SHADOW_M = 3 * THICK_SHADOW_M;
/** How far a flying fighter's shadow falls on the hull below it, metres: further, as it is higher. */
export const FIGHTER_SHADOW_M = 2.5;
/**
 * How far the shadow falls of a fighter aboard a carrier, on a pad being
 * built, mended or filled, metres: nearer, as it sits on the deck. A stop-gap
 * step from one to the other until a fighter's height is drawn as it lands
 * and lifts off.
 */
export const LANDED_SHADOW_M = 0.75;
