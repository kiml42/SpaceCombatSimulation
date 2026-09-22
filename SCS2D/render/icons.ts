/**
 * The ship icon: how strongly it shows, and what shape it is.
 *
 * Zoomed out far enough to see a battle, a corvette is a couple of pixels of
 * hull and is indistinguishable from a round in flight — so past that point
 * each ship is also drawn as a marker of a fixed size on screen, which keeps
 * it findable however far out the camera goes. The marker is an arrowhead
 * rather than a dot, because in two dimensions the thing lost with the hull is
 * not only where a ship is but which way it is pointing.
 *
 * Here rather than in `canvas2d.ts` for the same reason `strokes.ts` is its
 * own file: it is arithmetic over numbers with no canvas in it, and the only
 * symptom of getting the ramp wrong is somebody sitting in front of the screen
 * saying the icons pop.
 */

/** Nose-to-tail length of an icon on screen, pixels. */
export const ICON_PX = 18;

/**
 * Opacity of an icon once it has fully faded in. Short of solid, so the hull
 * underneath is still readable at the zooms where both are drawn.
 */
export const ICON_MAX_ALPHA = 0.85;

/**
 * The on-screen widths, in pixels, between which an icon fades in: absent
 * while the ship is larger than `ICON_FADE_START_PX` across, full once it is
 * smaller than `ICON_FADE_FULL_PX`.
 *
 * The ramp is over the ship's *drawn* size rather than over the camera's
 * scale, so a frigate keeps its hull at a zoom where a fighter alongside it
 * has already become an icon. That is the behaviour worth having: the icon
 * stands in for detail that has stopped being legible, and when it stops being
 * legible is a property of the ship, not of the camera.
 *
 * The far end is well above a pixel because the hull is unreadable long before
 * it is invisible — at twelve pixels a ship is a smudge whose facing cannot be
 * made out, which is exactly what the icon is there to replace.
 */
export const ICON_FADE_START_PX = 48;
export const ICON_FADE_FULL_PX = 12;

/**
 * How solid a ship's icon is, for a hull drawn `shipPx` across on screen.
 * Zero while the hull speaks for itself, so nothing is drawn at all close up.
 */
export function iconAlpha(shipPx: number): number {
  if (!(shipPx < ICON_FADE_START_PX)) return 0;
  if (shipPx <= ICON_FADE_FULL_PX) return ICON_MAX_ALPHA;
  const t = (ICON_FADE_START_PX - shipPx) / (ICON_FADE_START_PX - ICON_FADE_FULL_PX);
  return ICON_MAX_ALPHA * t;
}

/**
 * The arrowhead, as points in a frame where the nose is at +x and the whole
 * shape is one unit long.
 *
 * Notched at the tail rather than a plain triangle: a triangle's base is as
 * straight as its sides and reads as a wedge pointing either way at a glance,
 * where the notch makes the nose unambiguous. Kept as data so the shape is
 * fixed once and the drawing merely scales it — and so a test can check the
 * thing is actually pointed.
 */
export const ICON_OUTLINE: readonly (readonly [number, number])[] = [
  [0.5, 0],
  [-0.5, 0.42],
  [-0.24, 0],
  [-0.5, -0.42],
];
