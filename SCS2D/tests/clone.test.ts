import { describe, expect, it } from 'vitest';
import { checksumWorld } from '../sim/checksum.js';
import type { Battle } from '../scenarios/types.js';
import { cloneBattle } from '../scenarios/clone.js';
import { duel } from '../scenarios/duel.js';
import { beamDuel } from '../scenarios/beamDuel.js';
import { starWars } from '../scenarios/starWars.js';
import { swarm } from '../scenarios/swarm.js';
import { torpedoes } from '../scenarios/torpedoes.js';
import { standoff } from '../scenarios/standoff.js';
import { column } from '../scenarios/column.js';
import { split } from '../scenarios/split.js';
import { torchRun } from '../scenarios/torchRun.js';
import { broadside } from '../scenarios/broadside.js';
import { hooked } from '../scenarios/hooked.js';
import { salvageRun } from '../scenarios/salvage.js';
import { mending, refitting } from '../scenarios/mending.js';
import { scavenge } from '../scenarios/scavenge.js';
import { factory, padRebuild } from '../scenarios/carrier.js';
import { shipyard } from '../scenarios/shipyard.js';
import { beamCarrier } from '../scenarios/beamCarrier.js';
import { circling, passes } from '../scenarios/passes.js';
import { rearm } from '../scenarios/rearm.js';
import { tanker } from '../scenarios/tanker.js';

const SEED = 20260905;
/** The viewer's scenes, which are what a rewind copies. */
const SCENES: Record<string, () => Battle> = {
  duel: () => duel(SEED),
  beamDuel: () => beamDuel(SEED),
  starWars: () => starWars(SEED),
  swarm: () => swarm(SEED),
  torpedoes: () => torpedoes(SEED),
  standoff: () => standoff(SEED),
  column: () => column(SEED),
  split: () => split(SEED),
  torchRun: () => torchRun(SEED),
  hooked: () => hooked(SEED),
  broadside: () => broadside(SEED),
  salvageRun: () => salvageRun(SEED),
  mending: () => mending(SEED),
  refitting: () => refitting(SEED),
  scavenge: () => scavenge(SEED),
  padRebuild: () => padRebuild(SEED),
  factory: () => factory(SEED),
  shipyard: () => shipyard(SEED),
  rearm: () => rearm(SEED),
  tanker: () => tanker(SEED),
  beamCarrier: () => beamCarrier(SEED),
  passes: () => passes(SEED),
  circling: () => circling(SEED),
};

const BEFORE = 240;
const AFTER = 240;

const run = (battle: Battle, steps: number): Battle => {
  for (let i = 0; i < steps; i++) battle.step();
  return battle;
};

describe('a copied battle', () => {
  for (const [name, create] of Object.entries(SCENES)) {
    it(`${name} steps on exactly as its original, and leaves it alone`, () => {
      const expected = checksumWorld(run(create(), BEFORE + AFTER).world);
      const original = run(create(), BEFORE);
      const copy = run(cloneBattle(original), AFTER);
      expect(checksumWorld(copy.world)).toBe(expected);
      // The copy having gone on, the original still goes on from where it was.
      expect(checksumWorld(run(original, AFTER).world)).toBe(expected);
    }, 120_000);
  }
});
