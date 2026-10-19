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
  duel: '5dd4e7a7',
  beamDuel: 'f1f2cdb3',
  swarm: 'e41ed06d',
  torpedoes: 'f4a9425f',
  fractal: '03dc3d63',
  ordering: 'ea89d8aa',
  split: '97ffb003',
  column: '39cfc26f',
  standoff: 'c944911d',
  ram: '2c9d16bf',
  torchRun: 'f1abd183',
  hooked: '10c219ba',
  broadside: '3af6d849',
  salvageRun: '8a833239',
  mending: '4ec98f7f',
  refitting: 'c89fc3a1',
  scavenge: '8c2741e7',
  padRebuild: '4d7483f3',
  factory: 'cd7ff97c',
  shipyard: '117dc93a',
  rearm: '2f7c9e4f',
  tanker: '0a3feac4',
  beamCarrier: 'f0c54356',
  passes: 'abc83885',
  circling: 'd02a9959',
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
