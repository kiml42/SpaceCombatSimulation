import { describe, expect, it } from 'vitest';
import { formatChecksum } from '../sim/checksum.js';
import { SCENARIO_TIMEOUT, SCENARIOS, type ScenarioName } from './fixtures/scenarios.js';

/**
 * Golden tests: the simulation's behaviour, pinned.
 *
 * The determinism tests prove the simulation is reproducible. These prove it
 * still does the *same thing* it did before — which is the check that makes it
 * safe to refactor the physics after months away. Run `npm test` from a cold
 * checkout: if these pass, the simulation is intact.
 *
 * WHEN ONE FAILS, that means simulated behaviour changed. Either:
 *
 *   - You did not mean to change it. Find out what you broke. Do not touch
 *     this file.
 *   - You did mean to change it. Say so in the commit message, run
 *     `npm run golden`, and paste the new constants in. Never copy a value out
 *     of a test failure without understanding what moved: doing that turns a
 *     regression into the new expected behaviour, permanently.
 *
 * Generated with: npm run golden
 */

const GOLDEN: Record<ScenarioName, string> = {
  orbit: '0441a895',
  tumble: '52118178',
  gunnery: 'b2054d50',
  duel: 'f5558b88',
  beamDuel: '49f26cc5',
  binary: '1bf85068',
  kernels: '798e4dd3',
  asteroidField: '9792c6cf',
  mining: '2d686fb7',
  rivalMines: '64d0480b',
  swarm: 'f39dd5bf',
  superSwarm: '04411af1',
  torpedoes: '53d200cc',
  ordering: '40f2221a',
  split: 'b6611b87',
  column: '073a0629',
  standoff: 'a5f89b8c',
  torchRun: '50953cc8',
  hooked: 'd88cd28a',
  broadside: '61790eb4',
  salvageRun: '71384bbb',
  mending: 'f63e907e',
  refitting: '052760e4',
  catamaranRefits: 'eb579586',
  scavenge: 'fde3de85',
  padRebuild: 'dd0dc6f0',
  factory: '4088bd10',
  shipyard: '4b069157',
  rearm: 'cabf675d',
  tanker: 'b262ee58',
  beamCarrier: 'c35b96ca',
  passes: '816d4617',
  circling: '17cb902a',
};

describe('golden scenarios', () => {
  for (const name of Object.keys(GOLDEN) as ScenarioName[]) {
    const scenario = SCENARIOS[name];

    it(
      `${name} matches its recorded checksum after ${scenario.steps} steps`,
      () => {
        const run = scenario.build();
        for (let i = 0; i < scenario.steps; i++) run.step();
        expect(formatChecksum(run.checksum())).toBe(GOLDEN[name]);
      },
      SCENARIO_TIMEOUT,
    );
  }

  it('covers every fixture scenario', () => {
    // A new scenario without a golden constant would otherwise go unnoticed.
    expect(Object.keys(GOLDEN).sort()).toEqual(Object.keys(SCENARIOS).sort());
  });
});
