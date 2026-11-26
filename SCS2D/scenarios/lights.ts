import { math, Rng } from "../sim/index.js";
import type { Light } from "../render/light.js";
import type { Battle } from "./types.js";

/** A battle, seen in `light`. Only drawn, so it never changes a result. */
export function lit<B extends Battle>(battle: B, light: Light): B {
    return Object.assign(battle, { light });
}

const degrees = (d: number): number => (d * math.PI) / 180;

/**
 * The lights the scenes are seen in, from plain white to deeply tinted suns,
 * and from shadows near black to soft. Chosen by eye, not held to a rule.
 */
export const LIGHTS = {
    /** White, from the top left: the default. */
    daylight: { from: degrees(135), colour: "#ffffff", ambient: 0.2 },
    /** A yellow sun, high overhead. */
    noon: { from: degrees(90), colour: "#fff2d0", ambient: 0.2, slant: 15 },
    /** Low and orange, from the left. */
    dusk: { from: degrees(185), colour: "#915f43", ambient: 0.1 },
    /** A red dwarf, dim, from the bottom left. */
    redDwarf: { from: degrees(225), colour: "#ffb8a8", ambient: 0.2 },
    /** A blue giant, harsh, from the top right. */
    blueGiant: { from: degrees(40), colour: "#c8dcff", ambient: 0.15 },
    /** Cold and pale, from below. */
    ice: { from: degrees(275), colour: "#d8f4ff", ambient: 0.3, slant: 3 },
    /** Inside a green nebula: soft, from the right. */
    nebula: { from: degrees(350), colour: "#5a6c5d", ambient: 0.9, slant: 0.5 },
    /** Violet, from the bottom right. */
    violet: { from: degrees(315), colour: "#e4d0ff", ambient: 0.25 },
    /** Gold, from the top left, steep. */
    gold: { from: degrees(120), colour: "#fff0b0", ambient: 0.2 },
    /**
     * A sun all but eclipsed: dim and cold, from the top left, and nothing at
     * all in shadow, so what ships light by themselves — their engines, beams
     * and hits — is most of what is seen of them.
     */
    eclipse: { from: degrees(150), colour: "#3c4250", ambient: 0 },
} as const satisfies Record<string, Light>;

/** Most of a drawn light's ambient: its least is 0, black shadows. */
const MOST_AMBIENT = 0.8;
/** How far a drawn light's tint is from white at most, as HSV saturation. */
const MOST_TINT = 0.5;
/** How far an ambient light's tint is from white at most: deeper than the sun's, as a nebula's glow may be. */
const MOST_AMBIENT_TINT = 0.7;
/** How dim a drawn light is at least, as HSV value. */
const LEAST_BRIGHTNESS = 0.55;
/** How dim the sun wanders at least: never so dark that the ships cannot be seen by it. */
const LEAST_WANDERED_BRIGHTNESS = 0.1;
/** How long shadows fall, as `Light.slant`: from a sun well up to one well down, never overhead or on the horizon. */
const LEAST_SLANT = 0.4;
const MOST_SLANT = 1.4;

/**
 * A skirmish's light as it stands, in the terms it wanders in: the sun's
 * bearing, height, hue, tint and brightness, and the ambient light's hue, tint
 * and strength. Hues are 0 to 6 round the wheel.
 */
export interface Lighting {
    readonly from: number;
    readonly slant: number;
    readonly hue: number;
    readonly tint: number;
    readonly brightness: number;
    readonly ambient: number;
    readonly ambientHue: number;
    readonly ambientTint: number;
}

/**
 * The light a skirmish round is seen in, drawn from its seed, so a round
 * replayed looks as it did and each new one is somewhere else. Ambient is
 * drawn squared, so dark shadows are the more common.
 */
export function roundLight(seed: number, scale = 1): Light {
    const draw = new Rng(seed ^ 0x6c6974);
    const from = draw.nextRange(0, math.TAU);
    const hue = draw.nextRange(0, 6);
    const tint = draw.nextRange(0, MOST_TINT);
    // Drawn whatever the scale, so a scale leaves the rest of the draw as it was.
    const ambient = MOST_AMBIENT * draw.nextRange(0, 1) ** 2 * scale;
    const brightness = math.min(1, draw.nextRange(LEAST_BRIGHTNESS, 1) * scale);
    return { from, colour: hsvHex(hue, tint, brightness), ambient: math.min(1, ambient) };
}

/**
 * The lighting a skirmish starts in, drawn from its seed: the light
 * `roundLight` draws, with the ambient light the sun's own colour, as there.
 */
export function startLighting(seed: number): Lighting {
    const draw = new Rng(seed ^ 0x6c6974);
    const from = draw.nextRange(0, math.TAU);
    const hue = draw.nextRange(0, 6);
    const tint = draw.nextRange(0, MOST_TINT);
    const ambient = MOST_AMBIENT * draw.nextRange(0, 1) ** 2;
    const brightness = draw.nextRange(LEAST_BRIGHTNESS, 1);
    return { from, slant: 1, hue, tint, brightness, ambient: ambient * brightness, ambientHue: hue, ambientTint: tint };
}

/**
 * The lighting moved a random step from `lighting`: the sun turned, raised or
 * lowered, tinted and dimmed or brightened a little, and the ambient light
 * likewise, so a skirmish's light wanders rather than jumping. Each stays in
 * its range: the sun no dimmer than `LEAST_WANDERED_BRIGHTNESS` nor further
 * from overhead than its slant allows, the ambient light as dark as black.
 */
export function wander(lighting: Lighting, draw: Rng): Lighting {
    const step = (value: number, by: number, least: number, most: number): number =>
        math.min(most, math.max(least, value + draw.nextRange(-by, by)));
    const turn = (hue: number, by: number): number => (((hue + draw.nextRange(-by, by)) % 6) + 6) % 6;
    return {
        from: (((lighting.from + draw.nextRange(-0.6, 0.6)) % math.TAU) + math.TAU) % math.TAU,
        slant: step(lighting.slant, 0.25, LEAST_SLANT, MOST_SLANT),
        hue: turn(lighting.hue, 0.5),
        tint: step(lighting.tint, 0.12, 0, MOST_TINT),
        brightness: step(lighting.brightness, 0.15, LEAST_WANDERED_BRIGHTNESS, 1),
        ambient: step(lighting.ambient, 0.1, 0, MOST_AMBIENT),
        ambientHue: turn(lighting.ambientHue, 0.8),
        ambientTint: step(lighting.ambientTint, 0.15, 0, MOST_AMBIENT_TINT),
    };
}

/** The light `lighting` is seen as, `scale` times as bright, sun and shadows alike. */
export function lightOf(lighting: Lighting, scale = 1): Light {
    return {
        from: lighting.from,
        colour: hsvHex(lighting.hue, lighting.tint, math.min(1, lighting.brightness * scale)),
        ambient: math.min(1, lighting.ambient * scale),
        ambientColour: hsvHex(lighting.ambientHue, lighting.ambientTint, 1),
        slant: lighting.slant,
    };
}

/** A colour of `hue` (0 to 6 round the wheel), `tint` saturation and `brightness` value, as CSS hex. */
function hsvHex(hue: number, tint: number, brightness: number): string {
    const channel = (n: number): string => {
        const k = (n + hue) % 6;
        const v = brightness * (1 - tint * math.max(0, math.min(k, 4 - k, 1)));
        return math
            .round(v * 255)
            .toString(16)
            .padStart(2, "0");
    };
    return `#${channel(5)}${channel(3)}${channel(1)}`;
}
