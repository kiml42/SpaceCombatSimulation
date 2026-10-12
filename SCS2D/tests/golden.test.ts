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
  duel: '2d3e37a4',
  beamDuel: '761a9107',
  beamVGun: '8790a9a0',
  swarm: '58431387',
  superSwarm: '4b6ebead',
  torpedoes: '65bda3c3',
  fractal: 'c4d7de55',
  ordering: 'b54dda36',
  split: '482f5d1e',
  column: '839c07c9',
  standoff: '20280a2e',
  ram: '5e17fcad',
  torchRun: 'beed0f2c',
  hooked: '85699c7c',
  broadside: 'c8455755',
  salvage: '0e391d9a',
  scavenge: '2d7f7d1f',
  carrier: 'f2e5ef2f',
  rearm: '670fd368',
  tanker: '11648a70',
  beamCarrier: '9795005e',
  passes: '7607fb2c',
  circling: '49c38346',
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
