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
  duel: '8f46a8a3',
  beamDuel: 'a2ab71d5',
  beamVGun: 'b0bb0de1',
  swarm: '5a4f47ac',
  superSwarm: 'f923f6b5',
  torpedoes: '5ef524b2',
  fractal: '38689419',
  ordering: '343f130d',
  split: '82a6157b',
  column: '39cfc26f',
  standoff: '7240af25',
  ram: '2c9d16bf',
  torchRun: 'f1abd183',
  hooked: 'fe64fa99',
  broadside: 'b478d6b8',
  salvage: '4b6e4a3f',
  scrapyard: '07368ab2',
  salvageRun: '8a833239',
  mending: '4ec98f7f',
  rebuilding: '8c08e28f',
  refitting: 'c89fc3a1',
  scavenge: '8c2741e7',
  carrier: '2f7e8c50',
  padRebuild: '4d7483f3',
  factory: 'fe2c167b',
  shipyard: '117dc93a',
  rearm: '9ef32130',
  tanker: '0a3feac4',
  beamCarrier: 'bba36b57',
  passes: '7d637f8d',
  circling: 'b4eaccd0',
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
