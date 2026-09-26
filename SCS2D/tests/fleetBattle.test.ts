import { describe, expect, it } from 'vitest';
import { math, type Fleet } from '../sim/index.js';
import { fleetBattle } from '../scenarios/fleetBattle.js';
import { DINKY, GUNSHIP } from '../scenarios/blueprints.js';

const pair: Fleet = {
  name: 'Pair',
  designs: { Dinky: DINKY },
  ships: [
    { design: 'Dinky', x: 0, y: 20 },
    { design: 'Dinky', x: 0, y: -20 },
  ],
};
const lone: Fleet = { name: 'Lone', designs: { Gunship: GUNSHIP }, ships: [{ design: 'Gunship', x: 0, y: 0 }] };

describe('a battle built from fleets', () => {
  const run = fleetBattle([pair, lone, pair], { seed: 1, range: 1000, closingSpeed: 10, crossingSpeed: 5 });
  const { ships, world, slots } = run;
  const at = (id: number) => world.bodies.indexOf(ships.body(id));

  it('takes turns between fleets when spawning', () => {
    expect(slots).toEqual([[0, 3], [1], [2, 4]]);
  });

  it('gives each fleet its own team', () => {
    slots.forEach((ids, team) => ids.forEach((id) => expect(ships.teamOf(id)).toBe(team)));
  });

  it('sets fleets evenly round the ring, facing the centre', () => {
    const b = world.bodies;
    const i = at(slots[1]![0]!);
    const bearing = (math.TAU * 1) / 3;
    expect(b.x[i]).toBeCloseTo(-500 * Math.cos(bearing), 9);
    expect(b.y[i]).toBeCloseTo(-500 * Math.sin(bearing), 9);
    expect(b.angle[i]).toBeCloseTo(bearing, 9);
  });

  it("places ships in their fleet's own frame", () => {
    const b = world.bodies;
    // Fleet 0 faces +x, so its left (+y) stays +y.
    expect(b.x[at(0)]).toBe(-500);
    expect(b.y[at(0)]).toBe(20);
  });

  it('moves each fleet towards the centre and to its own left', () => {
    const b = world.bodies;
    expect(b.vx[at(0)]).toBe(10);
    expect(b.vy[at(0)]).toBe(5);
  });
});
