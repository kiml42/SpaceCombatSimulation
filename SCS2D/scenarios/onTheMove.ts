import { compileBlueprint, DAMAGE_ENERGY_PER_KG, math, type Blueprint, type Doctrine, type ShipDesign } from '../sim/index.js';
import type { Battle } from './types.js';
import { makeBattle } from './battle.js';
import { CORVETTE, DINKY, Y_WING } from './blueprints.js';

/** The pass speeds the Dinky is set to, m/s. */
const PASS_MIN = 60;
const PASS_MAX = 100;

/** How far apart the two fights are, metres, so neither fighter is in the other's way. */
const APART = 6000;

/**
 * Two fighters attacking on the move (`tangentialMin`, `tangentialMax`), each
 * at a Corvette of its own whose engines are shot out, so it holds still. The
 * Dinky is set faster than its thrust can hold a turn at, so it makes passes;
 * the Y-wing fights from far enough out to hold the turn, so it circles.
 * Nobody can be hurt, so what this shows is the flying.
 */
export function onTheMove(seed = 20261012): Battle & {
  readonly passer: number;
  readonly circler: number;
  /** The Corvette each is after, by its index. */
  readonly targets: readonly [number, number];
} {
  // Neither escorts the other, which would hold the Dinky to the Y-wing's pace.
  const alone = (blueprint: Blueprint, approach: Partial<Doctrine['approach']> = {}): ShipDesign => {
    const doctrine = compileBlueprint(blueprint).doctrine;
    return compileBlueprint({
      ...blueprint,
      doctrine: { targeting: { ...doctrine.targeting, escortWeight: 0 }, approach: { ...doctrine.approach, ...approach } },
    });
  };
  const dinky = alone(DINKY, { tangentialMin: PASS_MIN, tangentialMax: PASS_MAX });
  const yWing = alone(Y_WING);
  return makeBattle({ seed, projectiles: 512, beams: 64 }, (ships, world) => {
    const corvette = compileBlueprint(CORVETTE);
    const hulk = (x: number): number => {
      const c = ships.spawn(world, { design: corvette, x, y: 0, angle: 0, team: 1 });
      const body = world.bodies.indexOf(ships.body(c));
      corvette.modules.forEach((m, k) => {
        if (m.spec.kind === 'engine') ships.damage.absorb(body, k, m.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
      });
      ships.damage.protect(body);
      return c;
    };
    const targets = [hulk(-APART / 2), hulk(APART / 2)] as const;
    const passer = ships.spawn(world, { design: dinky, x: -APART / 2 - 2500, y: 300, angle: 0, team: 0, invulnerable: true });
    const circler = ships.spawn(world, {
      design: yWing,
      x: APART / 2 + 2500,
      y: -300,
      angle: math.PI,
      team: 0,
      invulnerable: true,
    });
    return { passer, circler, targets };
  });
}
