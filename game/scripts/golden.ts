/**
 * Prints the golden checksum for each fixture scenario, plus how long it took.
 *
 * Run this when a deliberate simulation change has moved the checksums, and
 * paste the new values into tests/golden.test.ts. Never paste values straight
 * out of a test failure without first understanding what moved — that is how a
 * regression gets blessed.
 *
 *   npm run golden
 */

import { checksumWorld, formatChecksum } from '../sim/checksum.js';
import { SCENARIOS } from '../tests/fixtures/scenarios.js';

for (const [name, scenario] of Object.entries(SCENARIOS)) {
  const world = scenario.build();
  const started = process.hrtime.bigint();
  world.run(scenario.steps);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  const checksum = formatChecksum(checksumWorld(world));
  const perStepUs = (elapsedMs * 1000) / scenario.steps;

  console.log(
    `${name.padEnd(8)} bodies=${String(world.bodies.count).padStart(3)} ` +
      `steps=${String(scenario.steps).padStart(6)} ` +
      `checksum=0x${checksum} ` +
      `${elapsedMs.toFixed(1)}ms (${perStepUs.toFixed(2)}us/step)`,
  );
}
