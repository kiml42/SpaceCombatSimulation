import { expect, it } from 'vitest';
import { asteroidBlueprint, compileBlueprint, NEUTRAL_TEAM } from '../sim/index.js';
import { Rng } from '../sim/rng.js';
import { makeBattle } from '../scenarios/battle.js';
import { PROSPECTOR, RIVAL_WELLS } from '../scenarios/rivalMines.js';
import { DINKY } from '../scenarios/blueprints.js';

it('a fighter lands on a carrier anchored to a rock, holding itself up against the rock’s pull', () => {
  const empty = { ...PROSPECTOR, modules: PROSPECTOR.modules.map((m) => ('kind' in m && m.kind === 'pad' ? { ...m, keep: 0 } : m)) };
  const thirsty = { ...DINKY, doctrine: { ...DINKY.doctrine!, approach: { ...DINKY.doctrine!.approach, refuelBelow: 0.99 } } };
  const run = makeBattle({ seed: 1, wells: [RIVAL_WELLS[0]!] }, (ships, world, wells) => {
    const rock = asteroidBlueprint('A', { radius: 250, kernel: true, ore: 0.35, ice: 0.25 }, new Rng(5));
    ships.spawn(world, { design: compileBlueprint(rock), rides: wells[0]!, team: NEUTRAL_TEAM });
    const carrier = ships.spawn(world, { design: compileBlueprint(empty), x: -320, y: 0, angle: 0, team: 0 });
    const fighter = ships.spawn(world, { design: compileBlueprint(thirsty), x: -1500, y: 1200, angle: 0, team: 0 });
    return { carrier, fighter };
  });
  for (let t = 0; t < 60 * 60; t++) run.step();
  expect(run.ships.isMoored(run.carrier)).toBe(true);
  expect(run.ships.parkedCarrier(run.fighter)).toBe(run.carrier);
});
