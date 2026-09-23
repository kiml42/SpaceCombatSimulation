/**
 * Which match the rolling replay puts on next.
 *
 * Arithmetic over a list length, and unit-tested for the reason
 * `render/chart.ts` is: what it decides is which match is watched, and a
 * choice one past the end is not a picture that looks wrong — it is an
 * exception out of the frame loop, which stops the run.
 */

/**
 * The newest match when one has arrived since the last choice, and the one
 * before it otherwise — so a generation is watched newest first and then back
 * through, which is a sample of it rather than a queue.
 *
 * `-1` for a generation with nothing to watch yet.
 *
 * **The list can get shorter as well as longer.** A generation closing, or a
 * seek to another one, replaces the matches wholesale, and where the roll had
 * got to is then past the end of what there is: whichever end it falls off,
 * the newest is where it starts again.
 */
export function nextRolling(count: number, at: number, seen: number): number {
  if (count <= 0) return -1;
  const next = count > seen ? count - 1 : at - 1;
  return next < 0 || next >= count ? count - 1 : next;
}
