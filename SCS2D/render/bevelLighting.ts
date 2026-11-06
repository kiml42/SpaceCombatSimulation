/**
 * What lights a bevel from the side it faces, as `render/litBevels.ts` draws
 * it on the GPU: the data each lit bevel is drawn from, and the rule, here so
 * that it is unit-tested. DOM-free.
 */

/**
 * How steeply a bevel slopes away from the face it edges: 45°, so it takes
 * as much of a light across the deck as from above.
 */
export const BEVEL_SLOPE = Math.SQRT1_2;

/**
 * Added to the light's colour, each channel and its luminance, in the buffer's
 * units, before the colour is told from it: where the light shining down is
 * faint, as beside a light on the deck itself, its colour is a few levels of
 * an 8-bit buffer, and dividing by them would turn their rounding into pure
 * red or green. Light that faint is taken to be white.
 */
export const CHROMA_FLOOR = 0.03;

/** Floats a lit bevel takes: its quad's four corners, its outward normal across the deck, and its colour, each channel 0 to 1. */
export const BEVEL_QUAD_STRIDE = 13;

/** Add a bevel to `out`: `quad`, its corners in the hull layer's frame, facing `(nx, ny)`, a unit, in `colour`. */
export function pushLitBevel(out: number[], quad: readonly number[], nx: number, ny: number, colour: readonly number[]): void {
    for (let v = 0; v < 8; v++) out.push(quad[v]!);
    out.push(nx, ny, colour[0]! / 255, colour[1]! / 255, colour[2]! / 255);
}

/**
 * How squarely what faces `(nx, ny)` across the deck faces the light coming
 * `from` it, as the direction buffer holds it: towards +x, -x, +y and -y, each
 * summed by how bright it is. Each half of each axis is faced on its own, so
 * what lies between two lights is lit on both its sides, rather than their
 * directions cancelling.
 */
export function facing(from: readonly number[], nx: number, ny: number): number {
    return Math.max(nx, 0) * from[0]! + Math.max(-nx, 0) * from[1]! + Math.max(ny, 0) * from[2]! + Math.max(-ny, 0) * from[3]!;
}

/** `facing` in GLSL, of the direction buffer's texel `from` and a normal `n`. */
export const FACING_GLSL = `
float facing(vec4 from, vec2 n)
{
    return dot(max(vec4(n.x, -n.x, n.y, -n.y), 0.0), from);
}
`;

/**
 * How much more light a bevel facing `(nx, ny)` takes than the deck does,
 * each channel 0 to 1, from light whose colour sums to `light` (each channel's
 * sum, in the buffer's units) coming `from` across the deck (`facing`): in
 * the light's colour, by how squarely the bevel faces it. Nothing for one
 * turned from it.
 */
export function bevelGain(
    light: readonly number[],
    from: readonly number[],
    nx: number,
    ny: number,
    headroom: number,
    out: number[],
): void {
    const luminance = 0.2126 * light[0]! + 0.7152 * light[1]! + 0.0722 * light[2]!;
    const faced = facing(from, nx, ny) * BEVEL_SLOPE;
    for (let c = 0; c < 3; c++) {
        const colour = (light[c]! + CHROMA_FLOOR) / (luminance + CHROMA_FLOOR);
        out[c] = 1 - Math.exp(-colour * faced * headroom);
    }
}
