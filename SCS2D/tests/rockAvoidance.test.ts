import { expect, it } from 'vitest';
import { asteroidBlueprint, compileBlueprint, NEUTRAL_TEAM } from '../sim/index.js';
import { Rng } from '../sim/rng.js';
import { makeBattle } from '../scenarios/battle.js';
import { RIVAL_WELLS } from '../scenarios/rivalMines.js';
import { DINKY } from '../scenarios/blueprints.js';

it('keeps a fighter off a rock between it and its target, timed by when it would touch the rock, not pass its middle', () => {
  const run = makeBattle({ seed: 1, wells: [RIVAL_WELLS[0]!] }, (ships, world, wells) => {
    const rock = asteroidBlueprint('A', { radius: 250, kernel: true, ore: 0.35, ice: 0.25 }, new Rng(5));
    ships.spawn(world, { design: compileBlueprint(rock), rides: wells[0]!, team: NEUTRAL_TEAM });
    const fighter = ships.spawn(world, { design: compileBlueprint(DINKY), x: -300, y: 0, angle: 0, team: 0 });
    ships.spawn(world, { design: compileBlueprint(DINKY), x: 900, y: 0, angle: Math.PI, team: 1 });
    return { fighter };
  });
  const b = run.world.bodies;
  const c = run.collisions.contacts;
  for (let t = 0; t < 30 * 60; t++) {
    run.step();
    const fb = b.indexOf(run.ships.body(run.fighter));
    for (let k = 0; k < c.count; k++) expect(c.a[k] === fb || c.b[k] === fb).toBe(false);
  }
});
