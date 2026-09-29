import { describe, expect, it } from 'vitest';
import { NEUTRAL, shipColours } from '../render/teams.js';
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
});
