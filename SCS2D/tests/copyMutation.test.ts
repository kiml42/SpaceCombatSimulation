import { describe, expect, it } from 'vitest';
import { mutate } from '../evolution/mutate.js';
import { Rng } from '../sim/rng.js';
import { compileBlueprint, type Blueprint } from '../sim/index.js';
import { BLUEPRINTS } from '../scenarios/blueprints.js';

/** How many of a layout's engines have nothing of their own in their flame. */
function clear(blueprint: Blueprint): number {
  return compileBlueprint(blueprint).engines.filter((t) => (t.escaping ?? 1) === 1).length;
}

describe('copying an engine', () => {
  it('puts the copy beside it, firing the same way, so no clear flame is ever blocked by it', { timeout: 240_000 }, () => {
    // A copy bolted on pointing out of a face sat in its original's flame when
    // that face was the bell's: most copied engines stacked up end to end.
    let copies = 0;
    for (const name of ['corvette', 'gunship', 'beamCorvette', 'catamaran', 'torch'] as const) {
      // Enough seeds that the count does not hang on which kinds a run can draw.
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const rng = new Rng(seed * 7919 + name.length);
        let held: Blueprint = BLUEPRINTS[name];
        for (let g = 0; g < 300; g++) {
          const child = mutate(held, rng);
          if (child.edits.length === 1 && /engine: copied onto/.test(child.edits[0]!)) {
            copies++;
            expect(clear(child.blueprint)).toBeGreaterThanOrEqual(clear(held));
          }
          held = child.blueprint;
        }
      }
    }
    expect(copies).toBeGreaterThan(5);
  });
});
