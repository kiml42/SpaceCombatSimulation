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
  mining: 'dc104e7a',
  swarm: '7fcf2b1d',
  superSwarm: 'b081dd09',
  torpedoes: '7691d858',
  ordering: '40f2221a',
  split: '866d4aec',
  column: '12f4d125',
  standoff: '62e04869',
  torchRun: '1f3a5920',
  hooked: 'dc2d5baf',
  broadside: '61790eb4',
  salvageRun: 'd0304a2d',
  mending: 'f63e907e',
  refitting: '052760e4',
  catamaranRefits: 'eb579586',
  scavenge: '47f04173',
  padRebuild: 'dd0dc6f0',
  factory: '4088bd10',
  shipyard: '4b069157',
  rearm: '038014cb',
  tanker: 'b262ee58',
  beamCarrier: 'e0c8af01',
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
