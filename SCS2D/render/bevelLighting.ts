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
 * How much more light a bevel facing `(nx, ny)` takes than the deck does,
 * each channel 0 to 1, from light whose colour sums to `light` (each channel's
 * sum, in the buffer's units) coming from `(tx, ty)` across the deck, summed
 * by how bright it is: in the light's colour, by how squarely the bevel
 * faces it. Nothing for one turned from it.
 */
export function bevelGain(light: readonly number[], tx: number, ty: number, nx: number, ny: number, headroom: number, out: number[]): void {
    const luminance = 0.2126 * light[0]! + 0.7152 * light[1]! + 0.0722 * light[2]!;
    const facing = Math.max(0, nx * tx + ny * ty) * BEVEL_SLOPE;
    for (let c = 0; c < 3; c++) {
        const colour = (light[c]! + CHROMA_FLOOR) / (luminance + CHROMA_FLOOR);
        out[c] = 1 - Math.exp(-colour * facing * headroom);
    }
}
