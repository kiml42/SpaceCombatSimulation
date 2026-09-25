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
  gunnery: 'cf408adc',
  duel: 'd40ccad7',
  beamDuel: '9cd8006a',
  beamVGun: '33969658',
  swarm: 'e2f0f5b5',
  superSwarm: '07f239c0',
  fractal: '7792fbe7',
  ordering: 'f6d23006',
  split: '187021e0',
  column: '5ccce348',
  standoff: 'e9268f50',
  ram: '1506ce58',
  torchRun: 'c54c1289',
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
