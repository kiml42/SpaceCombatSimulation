import { describe, expect, it } from 'vitest';
import {
  parseRunConfig,
  runConfigFileProblem,
  serialiseRunConfig,
  RUN_CONFIG_FORMAT_VERSION,
} from '../evolution/configFile.js';
import { DEFAULT_KINDS } from '../evolution/mutate.js';
import { DEFAULT_RUN } from '../evolution/run.js';
import { DEFAULT_MATCH } from '../evolution/match.js';

/**
 * Settings, written down and read back.
 *
 * A run is decided entirely by its seed and its configuration, so a file that
 * loses or quietly alters one of those numbers is a file that describes a
 * different experiment from the one it was written from — which is the whole
 * failure mode worth testing here. The other is a file from somewhere else
 * being believed: a weight that is a string, a population of nought, a typo in
 * a key that silently means the default.
 */

const SETUP = {
  founders: ['Corvette', 'Dinky'],
  config: {
    ...DEFAULT_RUN,
    seed: 42,
    generations: 25,
    massBudget: 12_000,
    mutation: { kinds: { ...DEFAULT_KINDS, turret: 0 } },
    match: { duration: 45, radius: 900, weights: { survival: 0, damage: 0, race: 1 } },
  },
};

describe('the run config file', () => {
  it('round-trips a setup without changing it', () => {
    const back = parseRunConfig(serialiseRunConfig(SETUP));
    expect(back.founders).toEqual(SETUP.founders);
    expect(back.config.seed).toEqual(42);
    expect(back.config.generations).toEqual(25);
    expect(back.config.massBudget).toEqual(12_000);
    expect(back.config.mutation.kinds!.turret).toEqual(0);
    expect(back.config.match.duration).toEqual(45);
    expect(back.config.match.radius).toEqual(900);
    expect(back.config.match.weights).toEqual({ survival: 0, damage: 0, race: 1 });
    // Written in degrees and read back in radians, exactly.
    expect(back.config.match.scatter).toEqual(DEFAULT_MATCH.scatter);
    expect(serialiseRunConfig(back)).toEqual(serialiseRunConfig(SETUP));
  });

  it('writes no budget as null, since JSON has no infinity', () => {
    const file = serialiseRunConfig({ founders: [], config: DEFAULT_RUN });
    expect(file['massBudget']).toBeNull();
    expect(parseRunConfig(file).config.massBudget).toEqual(Infinity);
  });

  it('takes the defaults for everything a file leaves out', () => {
    // "The defaults but with beam turrets shut out" should be three lines.
    const setup = parseRunConfig({ kinds: { beamTurret: 0 } });
    expect(setup.config.generations).toEqual(DEFAULT_RUN.generations);
    expect(setup.config.match.duration).toEqual(DEFAULT_MATCH.duration);
    expect(setup.config.mutation.kinds!.beamTurret).toEqual(0);
    expect(setup.config.mutation.kinds!.thruster).toEqual(DEFAULT_KINDS.thruster);
  });

  it('keeps a goal it is given, and a match told to have none', () => {
    const goal = { x: 10, y: -20, scale: 250, size: 30 };
    expect(parseRunConfig({ match: { goal } }).config.match.goal).toEqual(goal);
    expect(parseRunConfig({ match: { goal: null } }).config.match.goal).toBeNull();
    expect(parseRunConfig({}).config.match.goal).toEqual(DEFAULT_MATCH.goal);
    // A ghost says so; a goal that does not say is solid, as files written
    // before there was a choice meant.
    const ghost = { ...goal, solid: false };
    expect(parseRunConfig({ match: { goal: ghost } }).config.match.goal).toEqual(ghost);
  });

  it('refuses a file that is not one, and says why', () => {
    const problems: [unknown, RegExp][] = [
      [null, /must be an object/],
      [[], /must be an object/],
      [{ formatVersion: 99 }, /formatVersion/],
      [{ populaton: 4 }, /unknown key populaton/],
      [{ population: 0 }, /at least one/],
      [{ population: 2.5 }, /whole number/],
      [{ seed: 'one' }, /seed must be a finite number/],
      [{ massBudget: -1 }, /more than nothing/],
      [{ founders: 'Corvette' }, /list of ship names/],
      [{ kinds: { thrusters: 1 } }, /unknown kind thrusters/],
      [{ kinds: { thruster: -1 } }, /zero or more/],
      [{ match: { durations: 10 } }, /unknown key durations/],
      [{ match: { duration: 0 } }, /more than nothing/],
      [{ match: { goal: { x: 0, y: 0, scale: 1 } } }, /missing size/],
      [{ match: { goal: { x: 0, y: 0, scale: 1, size: 1, solid: 'no' } } }, /solid must be true or false/],
      [{ match: { weights: { survival: 'lots' } } }, /weights.survival/],
    ];
    for (const [value, expected] of problems) {
      const problem = runConfigFileProblem(value);
      expect(problem, JSON.stringify(value)).toMatch(expected);
      expect(() => parseRunConfig(value)).toThrow();
    }
  });

  it('accepts what it writes, including the version it stamps', () => {
    const file = serialiseRunConfig(SETUP);
    expect(file['formatVersion']).toEqual(RUN_CONFIG_FORMAT_VERSION);
    expect(runConfigFileProblem(file)).toBeNull();
    expect(runConfigFileProblem(JSON.parse(JSON.stringify(file)))).toBeNull();
  });
});
