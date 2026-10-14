import { describe, expect, it } from 'vitest';
import { degreesToRadians, parseFleet, radiansToDegrees, serialiseFleet, Rng, type Fleet } from '../sim/index.js';
import { settled } from '../evolution/fleetMutate.js';
import { CORVETTE } from '../scenarios/blueprints.js';

/** A turned fleet read back from its file is the fleet that was turned, to the last bit. */
describe('a turned fleet’s angle', () => {
  it('reads back through degrees as exactly itself', () => {
    const rng = new Rng(11);
    for (let k = 0; k < 2000; k++) {
      const angle = settled(rng.nextRange(-20, 20));
      expect(degreesToRadians(radiansToDegrees(angle))).toBe(angle);
    }
  });

  it('round-trips in a fleet file exactly, where a turn added straight on does not', () => {
    const turned = degreesToRadians(60) + Math.PI / 4;
    const fleet = (angle: number): Fleet => ({
      name: 'Turned',
      designs: { Corvette: CORVETTE },
      ships: [{ design: 'Corvette', x: -10, y: 0, angle }],
    });
    const back = (angle: number): number => parseFleet(JSON.parse(JSON.stringify(serialiseFleet(fleet(angle))))).ships[0]!.angle!;
    expect(back(turned)).not.toBe(turned);
    expect(back(settled(turned))).toBe(settled(turned));
  });
});
