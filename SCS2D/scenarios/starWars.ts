import { compileBlueprint, math, Ships, World, type ShipDesign } from '../sim/index.js';
import { type Battle } from './types.js';
import { makeBattle } from './battle.js';
import { STAR_DESTROYER, TIE, X_WING, GHOST } from './blueprints.js';
import { Rng } from '../sim/rng.js';

/**
 * A fleet action with nobody flying it.
 *
 * Every craft in it carries its own doctrine and nothing issues an order:
 * the fighters go for each other's guns and engines, the freighters take
 * whatever is nearest, the Star Destroyer's batteries work down from the
 * biggest thing on the board, and its close-in beams fight their own battle
 * against whatever has got inside them. What the battle does is therefore a
 * property of four blueprints rather than of this file.
 */
export function starWars(seed = 20260905, tieFighterCount = 8, xWingCount = 30): Battle {
  return makeBattle({ seed }, (ships, world) => {
    const xWingBlueprint = compileBlueprint(X_WING);
    const ghostBlueprint = compileBlueprint(GHOST);

    const tieBlueprint = compileBlueprint(TIE);
    const isdBlueprint = compileBlueprint(STAR_DESTROYER);

    const rng = new Rng(seed);
    const randomRadius = 1000;

    spawnMany(1, rng, randomRadius, ships, world, isdBlueprint, 10_000, 0, 0);
    spawnMany(tieFighterCount, rng, randomRadius, ships, world, tieBlueprint, 1200, 0, 0);

    spawnMany(xWingCount, rng, randomRadius, ships, world, xWingBlueprint, -2400, 0, 1);
    spawnMany(2, rng, randomRadius, ships, world, ghostBlueprint, -4000, 0, 1);
  });
}

function spawnMany(count: number,
  rng: Rng,
  randomRadius: number,
  ships: Ships,
  world: World,
  blueprint: ShipDesign,
  xStart: number,
  yStart: number,
  team: number): number[] {
  const shipIndices = [];
  for (let i = 0; i < count; i++) {
    const angle = rng.nextRange(0, 2 * math.PI);
    const radius = math.sqrt(rng.nextRange(0, 1)) * randomRadius;
    const x = xStart + radius * math.cos(angle);
    const y = yStart + radius * math.sin(angle);
    let vx = rng.nextRange(20, 50);
    if (xStart > 0) {
      vx = -vx;
    }
    const vy = rng.nextRange(-20, 20);

    const a = ships.spawn(world, {
      design: blueprint,
      x: x,
      y: y,
      angle: xStart > 0 ? math.PI : 0,
      vx: vx,
      vy: 90 + vy,
      team: team,
    });
    shipIndices.push(a);
  }
  return shipIndices;
}
