import { describe, expect, it } from 'vitest';
import { fighterColours, NEUTRAL, shipColours } from '../render/teams.js';
import { NEUTRAL_TEAM } from '../sim/index.js';
import { NO_TEAM } from '../editor/preview.js';

describe('side colours', () => {
  it('gives the first four sides four different hues', () => {
    const hulls = [0, 1, 2, 3].map((team) => shipColours(team).hull);
    expect(new Set(hulls).size).toBe(4);
    expect(hulls).not.toContain(NEUTRAL.hull);
  });

  it('comes round again past four, rather than going grey', () => {
    for (let team = 4; team < 12; team++) expect(shipColours(team)).toBe(shipColours(team % 4));
  });

  it('keeps grey for nobody’s side', () => {
    expect(shipColours(NEUTRAL_TEAM)).toBe(NEUTRAL);
    expect(shipColours(NO_TEAM)).toBe(NEUTRAL);
  });

  it('draws a fighter a shade darker than its side, in the same hue', () => {
    const luma = (hex: string): number => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    const strongest = (hex: string): number =>
      [1, 3, 5].reduce((best, k) => (parseInt(hex.slice(k, k + 2), 16) > parseInt(hex.slice(best, best + 2), 16) ? k : best), 1);
    for (const team of [NEUTRAL_TEAM, 0, 1, 2, 3]) {
      const ship = shipColours(team);
      const fighter = fighterColours(team);
      for (const tone of ['hull', 'trim', 'pivot'] as const) {
        expect(luma(fighter[tone])).toBeLessThan(luma(ship[tone]));
        if (team >= 0) expect(strongest(fighter[tone])).toBe(strongest(ship[tone]));
      }
    }
  });
});
