import { compileBlueprint, exactTurn, expandFleet, math, type Fleet, type ShipDesign } from '../sim/index.js';
import { type Battle } from './types.js';
import { makeBattle, type BattleOptions } from './battle.js';

export interface FleetBattleOptions extends BattleOptions {
  /** Across the ring the fleets start on: for two, the distance between them. */
  readonly range: number;
  /** Each fleet's own speed towards the centre. */
  readonly closingSpeed?: number;
  /** Each fleet's own speed to its left. */
  readonly crossingSpeed?: number;
}

/**
 * Fleets evenly round a ring, each facing the centre, each its own team, and
 * no orders: what happens is down to the ships' doctrine.
 *
 * Ships spawn taking turns between fleets rather than fleet by fleet, so no
 * side is always first in the order ships act within a step.
 */
export function fleetBattle(
  fleets: readonly Fleet[],
  options: FleetBattleOptions,
): Battle & { readonly slots: readonly (readonly number[])[] } {
  return makeBattle(options, (ships, world) => {
    const radius = options.range / 2;
    const closing = options.closingSpeed ?? 0;
    const crossing = options.crossingSpeed ?? 0;

    const placed = fleets.map((fleet) => {
      const designs = new Map<string, ShipDesign>();
      for (const [name, blueprint] of Object.entries(fleet.designs)) designs.set(name, compileBlueprint(blueprint));
      return expandFleet(fleet).map((ship) => ({ ...ship, compiled: designs.get(ship.design)! }));
    });

    const slots: number[][] = fleets.map(() => []);
    const longest = placed.reduce((most, list) => math.max(most, list.length), 0);
    for (let k = 0; k < longest; k++) {
      for (let team = 0; team < fleets.length; team++) {
        const ship = placed[team]![k];
        if (ship === undefined) continue;
        const heading = (math.TAU * team) / fleets.length;
        const [c, s] = exactTurn(heading);
        const vx = closing * c - crossing * s;
        const vy = closing * s + crossing * c;
        slots[team]!.push(
          ships.spawn(world, {
            design: ship.compiled,
            x: -radius * c + ship.x * c - ship.y * s,
            y: -radius * s + ship.x * s + ship.y * c,
            angle: foldAngle(heading + ship.angle),
            team,
            ...(vx !== 0 || vy !== 0 ? { vx, vy } : {}),
          }),
        );
      }
    }
    return { slots };
  });
}

function foldAngle(a: number): number {
  let r = math.normalizeAngle(a);
  if (r <= -math.PI) r += math.TAU;
  else if (r > math.PI) r -= math.TAU;
  return r === 0 ? 0 : r;
}
