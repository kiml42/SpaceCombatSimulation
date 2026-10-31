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
    /**
     * How far shadows fall, as a share of their full length: 1, or left out, for
     * a light low in the sky; nearer 0 as it comes from overhead.
     */
    readonly slant?: number;
}

/** White, from the top left, with shadows a little under half dark. */
export const DEFAULT_LIGHT: Light = { from: (3 * Math.PI) / 4, colour: "#ffffff", ambient: 0.55 };

/**
 * The light a ship is seen in as it is built, in the editors and fleet
 * pictures: white, from nearly overhead, so its shadows are short.
 */
export const BUILDER_LIGHT: Light = { from: (3 * Math.PI) / 4, colour: "#ffffff", ambient: 0.6, slant: 0.35 };

/** How far a thick module's shadow falls across the thin hull beside it, metres. */
export const THICK_SHADOW_M = 1.5;
/** How far a turret's barrel's shadow falls across the thin hull, metres: it stands on the dome, as high as a thick module. */
export const BARREL_SHADOW_M = THICK_SHADOW_M;
/**
 * How high a small asteroid's thin rock stands, as the length of its shadow
 * on a ship beside it, metres: twice a thick module's. A larger asteroid
 * stands higher, `ROCK_RISE` of its radius, so its steps still show.
 */
export const ROCK_SHADOW_M = 2 * THICK_SHADOW_M;
/** How high an asteroid's thin rock stands, as a share of its radius, where that is more than `ROCK_SHADOW_M`. */
export const ROCK_RISE = 0.08;
/** How high an asteroid's thick rock stands, as a multiple of its thin rock's height; on thin rock, the difference. */
export const THICK_ROCK_RISE = 2;
/** How high an asteroid's kernel stands, as a multiple of its thin rock's height; on its rock, above the thick. */
export const KERNEL_RISE = 3;

/** How high an asteroid's thin rock stands, metres, as the length of the shadow it casts on a ship's hull. */
export function rockHeight(radius: number): number {
    return Math.max(ROCK_SHADOW_M, radius * ROCK_RISE);
}
/** How far a flying fighter's shadow falls on the hull below it, metres: further, as it is higher. */
export const FIGHTER_SHADOW_M = 2.5;
/**
 * How far the shadow falls of a fighter on its carrier's pad, being built,
 * mended or filled, metres: nearer, as it sits on the deck. A stop-gap
 * step from one to the other until a fighter's height is drawn as it lands
 * and lifts off.
 */
export const LANDED_SHADOW_M = 0.75;
