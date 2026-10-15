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
  duel: 'c298fdbc',
  beamDuel: '3f5fb549',
  beamVGun: '8c20fce4',
  swarm: 'ab1b3268',
  superSwarm: 'd5ff26d7',
  torpedoes: 'e80c05c4',
  fractal: '39a6bdab',
  ordering: '1104d47e',
  split: '7487ebac',
  column: 'ced5a2ce',
  standoff: 'a380bd63',
  ram: 'e84d52c7',
  torchRun: 'f1e0e036',
  hooked: '2d7ec6a8',
  broadside: '7f54e3d0',
  salvage: 'a1000a1a',
  scrapyard: '76e14208',
  mending: '4ec98f7f',
  rebuilding: '8c08e28f',
  scavenge: '0f9c53da',
  carrier: '1d583ea7',
  padRebuild: '4f9155f7',
  rearm: '8409487a',
  tanker: '9a42cb7b',
  beamCarrier: 'd15b50cd',
  passes: '024ae9ee',
  circling: '9f08e25c',
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
