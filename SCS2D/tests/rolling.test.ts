import { describe, expect, it } from 'vitest';
import { nextRolling } from '../host/rolling.js';

/**
 * Picking the next match for the rolling replay.
 *
 * The case worth having a test for is the list getting shorter under it: a
 * generation closes while a battle is being watched, and the matches it was
 * being picked from are replaced by the handful the new generation has fought
 * so far.
 */

describe('the rolling replay', () => {
  it('watches the newest match when one has arrived', () => {
    expect(nextRolling(4, 0, 3)).toBe(3);
    expect(nextRolling(1, 0, 0)).toBe(0);
  });

  it('works back through the generation when none has', () => {
    expect(nextRolling(4, 3, 4)).toBe(2);
    expect(nextRolling(4, 2, 4)).toBe(1);
    expect(nextRolling(4, 1, 4)).toBe(0);
  });

  it('starts again at the newest once it reaches the oldest', () => {
    expect(nextRolling(4, 0, 4)).toBe(3);
  });

  it('starts again at the newest when the generation it was watching closes', () => {
    // Three matches into a generation of four, and the next generation has
    // fought one: there is no match three to put on.
    expect(nextRolling(1, 3, 4)).toBe(0);
    expect(nextRolling(2, 3, 4)).toBe(1);
  });

  it('has nothing to put on in a generation that has not fought yet', () => {
    expect(nextRolling(0, 3, 4)).toBe(-1);
  });
});
