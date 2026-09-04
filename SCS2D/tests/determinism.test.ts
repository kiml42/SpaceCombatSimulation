import { describe, expect, it } from 'vitest';
import { checksumWorld } from '../sim/checksum.js';
import { World } from '../sim/index.js';
import { orbitScenario, SCENARIOS, tumbleScenario } from './fixtures/scenarios.js';

function runSteps(scenario: (typeof SCENARIOS)[keyof typeof SCENARIOS], steps: number): number {
  const run = scenario.build();
  for (let i = 0; i < steps; i++) run.step();
  return run.checksum();
}

/**
 * Self-checking determinism: these need no baked constants, so they cannot be
 * silently "fixed" by re-recording an expected value. They assert only that
 * the simulation is a pure function of its inputs.
 *
 * The golden tests, which do bake constants, catch a different thing:
 * behaviour changing when it was not meant to.
 */

describe('determinism', () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    it(`${name} produces an identical result on a rerun`, () => {
      expect(runSteps(scenario, scenario.steps)).toBe(runSteps(scenario, scenario.steps));
    });

    it(`${name} reaches the same state part way through, twice`, () => {
      const half = Math.floor(scenario.steps / 2);
      expect(runSteps(scenario, half)).toBe(runSteps(scenario, half));
    });
  }

  it('the gunnery scenario actually fires and connects', () => {
    // A determinism suite over a scenario that silently does nothing would
    // pass forever while testing nothing.
    const run = SCENARIOS.gunnery.build();
    for (let i = 0; i < SCENARIOS.gunnery.steps; i++) run.step();
    expect(run.totalHits).toBeGreaterThan(10);
  });

  it('diverges when the seed changes', () => {
    const a = tumbleScenario(1);
    const b = tumbleScenario(2);
    a.run(500);
    b.run(500);
    expect(checksumWorld(a)).not.toBe(checksumWorld(b));
  });

  it('diverges after a perturbation of a few ulps', () => {
    const a = orbitScenario();
    const b = orbitScenario();
    // ~2e-13 on a position of 1000. A checksum that missed this would be
    // useless for catching real determinism bugs.
    b.bodies.x[0] = b.bodies.x[0]! * (1 + Number.EPSILON);
    a.run(200);
    b.run(200);
    expect(checksumWorld(a)).not.toBe(checksumWorld(b));
  });

  it('checksums the tick count, so time is part of the state', () => {
    const a = orbitScenario();
    const before = checksumWorld(a);
    a.run(1);
    expect(checksumWorld(a)).not.toBe(before);
  });

  it('is unaffected by unrelated bodies being created and destroyed', () => {
    // Generation counters mean recycled slots produce fresh handles, but the
    // live state must be identical either way.
    const a = orbitScenario();
    const b = orbitScenario();

    const scratch = b.spawn({ x: 1e9, y: 1e9, mass: 1, inertia: 1 });
    b.destroy(scratch);

    a.run(100);
    b.run(100);

    const bodiesA = a.bodies;
    const bodiesB = b.bodies;
    expect(bodiesA.x[0]).toBe(bodiesB.x[0]);
    expect(bodiesA.y[0]).toBe(bodiesB.y[0]);
    expect(bodiesA.vx[0]).toBe(bodiesB.vx[0]);
    expect(bodiesA.vy[0]).toBe(bodiesB.vy[0]);
  });

  it('normalises negative zero in the checksum', () => {
    const a = new World({ dt: 0.1, seed: 1 });
    const b = new World({ dt: 0.1, seed: 1 });
    a.spawn({ x: 0, mass: 1, inertia: 1 });
    b.spawn({ x: -0, mass: 1, inertia: 1 });
    expect(checksumWorld(a)).toBe(checksumWorld(b));
  });
});
