import { compileBlueprint } from '../sim/index.js';
import { NO_TARGET, OrderCancelCondition } from '../sim/ships.js';
import type { Battle } from './types.js';
import { CROSSING, SIDE_WELL, makeBattle } from './battle.js';
import { CORVETTE, FLAT_GUNSHIP, FLAT_GUNSHIP_GROUPED, GUNSHIP } from './blueprints.js';


/**
 * What listing a ship's modules in a different order costs, flown two ways.
 *
 * Module order reaches the simulation twice: thrusters are allocated in it and
 * guns fire in it. The three layouts here are the same eighteen modules in the
 * same places, differing only in the list — flat in expansion order (the
 * control, which should track the assembled ship exactly), flat listed kind by
 * kind (the variable), and built from assemblies.
 *
 * `soloOrdering` flies one layout in a battle of its own against a mark that
 * is given no order, and so neither manoeuvres nor shoots back. Three runs
 * give three ships the identical problem with nothing between them, and what
 * is compared is the figures that matter about a battle rather than a distance:
 * final position and velocity, shots fired, hits scored.
 *
 * **There was a stacked scene, and the damage model took it.** All three flew
 * from one spot so the drift could be read straight off the range between two
 * ships that had started on top of each other — which was only honest while a
 * hit did nothing, because they also ate each other's rounds. Now that a hit
 * damages what it lands on, three ships in a line are three different problems
 * and a mark under three ships' fire is not the mark one of them faces. The
 * comparison moved to where it always had to go, which is this one.
 */
export interface OrderingBattle extends Battle {
  /** The ships under test, with the ordering each one represents. */
  readonly contenders: readonly { readonly name: string; readonly ship: number }[];
  /** The mark they are shooting at. */
  readonly target: number;
}

/**
 * The layouts under test, in the order the contenders are reported: the
 * control, the variable, and the assembled ship the control is a copy of.
 */
export const ORDERINGS = [
  { name: 'flat, expansion order', blueprint: FLAT_GUNSHIP },
  { name: 'flat, kinds together', blueprint: FLAT_GUNSHIP_GROUPED },
  { name: 'assemblies', blueprint: GUNSHIP },
] as const;

/**
 * One layout in a battle of its own, so three runs can be compared without the
 * ships ever sharing a world.
 */
export function soloOrdering(which: number, seed = 20260905): OrderingBattle {
  const entry = ORDERINGS[which];
  if (entry === undefined) throw new Error(`no ordering ${which}`);
  return battle([which], seed);
}

function battle(which: readonly number[], seed: number): OrderingBattle {
  return makeBattle({ seed, wells: [SIDE_WELL] }, (ships, world) => {
    // Facing across the engagement with a crossing velocity, as the duel does.
    // A ship flying straight down a bearing barely uses its manoeuvring
    // thrusters, and thruster allocation is half of what is being measured.
    const contenders = which.map((i) => ({
      name: ORDERINGS[i]!.name,
      ship: ships.spawn(world, {
        design: compileBlueprint(ORDERINGS[i]!.blueprint),
        ...CROSSING.west,
        team: 0,
      }),
    }));

    // A corvette rather than another gunship, so a contender is never mistaken
    // for the mark on screen.
    const target = ships.spawn(world, {
      design: compileBlueprint(CORVETTE),
      ...CROSSING.east,
      team: 1,
    });

    // The mark is under orders to do nothing, and that is deliberate rather
    // than incidental: it is the controlled variable of the whole rig, and a
    // mark that fought back would turn the round-off this measures into chaos.
    // An order with no target holds heading and holds fire, and being *under*
    // an order is what keeps its doctrine out of it.
    ships.pushOrder(target, NO_TARGET, 0, 0, 0, OrderCancelCondition.None);

    for (const contender of contenders) ships.pushOrder(contender.ship, target, 300, 500, 120);

    return { contenders, target };
  });
}
