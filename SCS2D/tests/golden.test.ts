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
  duel: '7f45e3fe',
  beamDuel: '71d29c9b',
  beamVGun: '09f03b50',
  swarm: 'eab8c262',
  superSwarm: '6ddde4b9',
  torpedoes: 'fb46113d',
  fractal: '44c7de4d',
  ordering: '1bd86b64',
  split: 'b022d25c',
  column: '9c0e5b21',
  standoff: 'b0c25ed8',
  ram: '5e17fcad',
  torchRun: 'c4ff13fa',
  hooked: '0a4e23a3',
  broadside: '9875d91c',
  salvage: '0e391d9a',
  mending: '094e9673',
  rebuilding: '677526a0',
  scavenge: '2893a5d1',
  carrier: 'fdfee56a',
  padRebuild: '0d5c94a9',
  rearm: '40346193',
  tanker: '69af14c4',
  beamCarrier: 'd6b6d44a',
  passes: 'd5f0d5e1',
  circling: '5640052f',
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
