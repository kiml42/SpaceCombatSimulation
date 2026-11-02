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
} as const satisfies Record<string, Light>;

/** Most of a drawn light's ambient: its least is 0, black shadows. */
const MOST_AMBIENT = 0.8;
/** How far a drawn light's tint is from white at most, as HSV saturation. */
const MOST_TINT = 0.5;
/** How dim a drawn light is at least, as HSV value. */
const LEAST_BRIGHTNESS = 0.55;

/**
 * The light a skirmish round is seen in, drawn from its seed, so a round
 * replayed looks as it did and each new one is somewhere else. Ambient is
 * drawn squared, so dark shadows are the more common.
 */
export function roundLight(seed: number): Light {
    const draw = new Rng(seed ^ 0x6c6974);
    const from = draw.nextRange(0, math.TAU);
    const hue = draw.nextRange(0, 6);
    const tint = draw.nextRange(0, MOST_TINT);
    const ambient = MOST_AMBIENT * draw.nextRange(0, 1) ** 2;
    const brightness = draw.nextRange(LEAST_BRIGHTNESS, 1);
    return { from, colour: hsvHex(hue, tint, brightness), ambient };
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
