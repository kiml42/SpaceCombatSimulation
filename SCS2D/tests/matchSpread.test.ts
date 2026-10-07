import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH, drawnMatch, runMatch } from '../evolution/match.js';
import { parseRunConfig, runConfigFileProblem, serialiseRunConfig } from '../evolution/configFile.js';
import { DINKY } from '../scenarios/blueprints.js';

/**
 * A match's arena and starting speeds drawn about the figures set, so a run can
 * breed against a spread of them rather than one.
 */
describe('a spread on the arena and the starting speeds', () => {
  const spread = { ...DEFAULT_MATCH, radius: 500, closingSpeed: 20, crossingSpeed: 0, radiusSpread: 200, closingSpread: 10, crossingSpread: 5 };

  it('is nothing at all where none is set', () => {
    expect(drawnMatch(DEFAULT_MATCH)).toBe(DEFAULT_MATCH);
  });

  it('draws within the spread, the same for the same seed and differently for another', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 50; seed++) {
      const drawn = drawnMatch({ ...spread, seed });
      expect(drawn.radius).toBeGreaterThanOrEqual(300);
      expect(drawn.radius).toBeLessThanOrEqual(700);
      expect(Math.abs(drawn.closingSpeed - 20)).toBeLessThanOrEqual(10);
      expect(Math.abs(drawn.crossingSpeed)).toBeLessThanOrEqual(5);
      expect(drawnMatch({ ...spread, seed })).toEqual(drawn);
      seen.add(drawn.radius);
    }
    expect(seen.size).toBeGreaterThan(40);
  });

  it('never draws an arena too small to stand in', () => {
    expect(drawnMatch({ ...spread, radius: 20, radiusSpread: 1000, seed: 3 }).radius).toBeGreaterThanOrEqual(10);
  });

  it('fights a match in the arena it drew', () => {
    const settings = { ...spread, seed: 7, duration: 2 };
    const held = runMatch([DINKY, DINKY], { ...settings, radiusSpread: 0, closingSpread: 0, crossingSpread: 0 });
    const varied = runMatch([DINKY, DINKY], settings);
    expect(varied.seed).toBe(held.seed);
    expect(varied.scores).not.toEqual(held.scores);
  });

  it('is kept by the config file, and left out of it where unset', () => {
    const setup = parseRunConfig({ founders: ['Dinky'], match: { radiusSpread: 150, closingSpread: 5 } });
    expect(setup.config.match.radiusSpread).toBe(150);
    expect(setup.config.match.crossingSpread).toBe(0);
    const file = serialiseRunConfig(setup) as { match: Record<string, unknown> };
    expect(file.match).toMatchObject({ radiusSpread: 150, closingSpread: 5 });
    expect(file.match['crossingSpread']).toBeUndefined();
    expect(runConfigFileProblem({ match: { radiusSpread: -1 } })).toMatch(/radiusSpread must not be negative/);
  });
});
