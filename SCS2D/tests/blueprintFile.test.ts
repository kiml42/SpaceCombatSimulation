import { describe, expect, it } from 'vitest';
import {
  BLUEPRINT_FORMAT_VERSION,
  blueprintFileProblem,
  blueprintProblem,
  blueprintWarnings,
  degreesToRadians,
  expandBlueprint,
  math,
  parseBlueprint,
  radiansToDegrees,
  serialiseBlueprint,
  type ModuleSpec,
} from '../sim/index.js';
import corvetteFile from '../scenarios/blueprints/corvette.json' with { type: 'json' };
import fractalFile from '../scenarios/blueprints/fractal.json' with { type: 'json' };
import gunshipFile from '../scenarios/blueprints/gunship.json' with { type: 'json' };
import { CORVETTE, GUNSHIP } from '../scenarios/blueprints.js';

/**
 * The blueprint file format.
 *
 * Two things are worth testing here and they are different in kind. That a
 * file survives the trip out and back is a property of the format; that a
 * *stranger's* file cannot become a broken ship is a property of the parser,
 * and it is the one that matters once a player can import someone else's
 * design.
 *
 * What is deliberately *not* tested here is that the shipped ships behave as
 * they did before the conversion. The golden checksums already say that, and
 * they say it through the whole simulation rather than through an assertion
 * about geometry — which is why the conversion was done with them watching.
 */

const FILES = [
  ['corvette', corvetteFile],
  ['gunship', gunshipFile],
  ['fractal', fractalFile],
] as const;

/** A minimal valid file, to mutate one field of per rejection test. */
function file(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatVersion: BLUEPRINT_FORMAT_VERSION,
    name: 'Test',
    modules: [{ kind: 'structure', x: 0, y: 0, length: 10, width: 4 }],
    ...overrides,
  };
}

/**
 * A file with a key the format does not read: it opens, says so, and writes the
 * key back where it found it rather than losing it.
 */
function keptAndWarned(raw: unknown, warning: RegExp): Record<string, unknown> {
  expect(blueprintFileProblem(raw)).toBeNull();
  const parsed = parseBlueprint(raw);
  expect(blueprintWarnings(parsed).join('\n')).toMatch(warning);
  const back = serialiseBlueprint(parsed);
  expect(back).toEqual(raw);
  return back;
}

describe('blueprint files', () => {
  it('reads a thruster, which faced the way it pushed, as an engine facing along its bell', () => {
    const file = serialiseBlueprint({
      name: 'Old',
      modules: [
        { kind: 'engine', x: -5, y: 0, angle: 0, length: 4, width: 4, nozzle: 0.4 },
        { kind: 'engine', x: 0, y: 3, angle: degreesToRadians(-90), length: 2, width: 2 },
        { kind: 'engine', x: 5, y: 0, length: 2, width: 2 },
      ],
    });
    for (const module of file['modules'] as Record<string, unknown>[]) module['kind'] = 'thruster';
    expect(blueprintFileProblem(file)).toBeNull();
    const [aft, lateral, bare] = parseBlueprint(file).modules as ModuleSpec[];
    expect(aft).toMatchObject({ kind: 'engine', x: -5, angle: Math.PI, nozzle: 0.4 });
    expect(lateral!.angle).toBe(degreesToRadians(90));
    // No angle was a thruster pushing along +x, so its bell faces aft.
    expect(bare!.angle).toBe(Math.PI);
  });

  it('accepts every ship that ships with the game', () => {
    for (const [name, raw] of FILES) {
      expect(blueprintFileProblem(raw), name).toBeNull();
    }
  });

  it('round-trips out and back unchanged', () => {
    // The editor's save is this journey, so anything it loses is lost from a
    // ship the moment someone opens it and presses save.
    for (const [name, raw] of FILES) {
      expect(serialiseBlueprint(parseBlueprint(raw)), name).toEqual(raw);
    }
  });

  it('keeps the notes that explain each layout', () => {
    // The reason the format has notes at all: converting away from TypeScript
    // would otherwise have deleted the record of why these ships are shaped
    // as they are, and nothing would have failed.
    expect(GUNSHIP.notes).toMatch(/broadside turret on each beam/);
    expect(GUNSHIP.assemblies?.['outrigger']?.notes).toMatch(/clear of the spine/);
    expect(CORVETTE.assemblies?.['wingBox']?.notes).toMatch(/moment arm/);

    // A module's own note has to survive expansion, or it explains nothing
    // about the ship that actually gets built — and it must reach *both*
    // copies, since the reason for a part does not stop applying when it is
    // mirrored onto the far beam.
    const beams = expandBlueprint(GUNSHIP).filter((m) => m.kind === 'turret' && m.barrels === 8);
    expect(beams).toHaveLength(2);
    for (const beam of beams) expect(beam.notes).toMatch(/same bore budget/);
  });
});

describe('angles', () => {
  it('converts the right angles a layout is drawn on exactly', () => {
    // Not approximately: a layout authored at 90° must compile to the same
    // bits HALF_PI does, or every derived figure moves in the last place and
    // the golden checksums shift for no reason anybody can see.
    expect(degreesToRadians(90)).toBe(math.HALF_PI);
    expect(degreesToRadians(-90)).toBe(-math.HALF_PI);
    expect(degreesToRadians(180)).toBe(math.PI);
    expect(degreesToRadians(0)).toBe(0);
    expect(degreesToRadians(45)).toBe(math.PI / 4);
  });

  it('round-trips those angles back to whole degrees', () => {
    for (const d of [0, 15, 30, 45, 90, 135, 180, -45, -90, -180]) {
      expect(radiansToDegrees(degreesToRadians(d)), `${d}°`).toBe(d);
    }
  });

  it('puts degrees in the file and radians in the simulation', () => {
    const beam = expandBlueprint(GUNSHIP).find((m) => m.kind === 'turret' && m.y > 0);
    expect(beam?.angle).toBe(math.HALF_PI);
    const raw = gunshipFile.assemblies.outrigger.modules.find((m) => 'kind' in m && m.kind === 'turret');
    expect(raw && 'angle' in raw ? raw.angle : undefined).toBe(90);
  });
});

describe('rejecting a file that arrived from somewhere else', () => {
  it('refuses anything that is not an object of the right shape', () => {
    expect(blueprintFileProblem(null)).toMatch(/must be an object/);
    expect(blueprintFileProblem([])).toMatch(/must be an object/);
    expect(blueprintFileProblem('Corvette')).toMatch(/must be an object/);
    expect(blueprintFileProblem(file({ modules: 'lots' }))).toMatch(/modules must be an array/);
    expect(blueprintFileProblem(file({ name: '   ' }))).toMatch(/name must be a non-empty string/);
    expect(blueprintFileProblem(file({ notes: 7 }))).toMatch(/notes must be a string/);
  });

  it('carries an engine\'s bell and its nozzle count out and back', () => {
    // Both are an engine's own geometry rather than something derived, so
    // they have to survive the file: a ship saved and loaded with a different
    // nozzle is a different ship.
    const raw = file({
      modules: [
        { kind: 'core', x: 0, y: 0, length: 10, width: 4 },
        { kind: 'engine', x: -5, y: 0, angle: Math.PI, length: 4, width: 4, nozzle: 0.3, barrels: 3 },
      ],
    }) as Record<string, unknown>;
    expect(blueprintFileProblem(raw)).toBeNull();
    const back = serialiseBlueprint(parseBlueprint(raw));
    expect((back['modules'] as Record<string, unknown>[])[1]).toMatchObject({
      nozzle: 0.3,
      barrels: 3,
    });
    // A bell on a core is a field that kind never reads. In memory it is a
    // dormant value mutation is holding against a refit back; in a *file* it
    // is a mistake to be told about, not a reason to refuse the ship, so it is
    // kept as written and warned of, as a key the format does not know is.
    // Nothing `serialiseBlueprint` writes from memory can land here, since it
    // writes only what the kind reads.
    keptAndWarned(
      file({ modules: [{ kind: 'core', x: 0, y: 0, length: 10, width: 4, nozzle: 0.3 }] }),
      /modules\[0\] has a key the game does not read, kept as written: nozzle/,
    );
    expect(
      (parseBlueprint(file({ modules: [{ kind: 'core', x: 0, y: 0, length: 10, width: 4, nozzle: 0.3 }] }))
        .modules[0] as ModuleSpec).nozzle,
    ).toBeUndefined();
    expect(blueprintProblem(parseBlueprint(file({
      modules: [{ kind: 'core', x: 0, y: 0, length: 10, width: 4 }],
    })))).toBeNull();
    expect(
      serialiseBlueprint({
        name: 'Dormant',
        modules: [{ kind: 'core', x: 0, y: 0, length: 10, width: 4, nozzle: 0.3 }],
      })['modules'],
    ).toEqual([{ kind: 'core', x: 0, y: 0, length: 10, width: 4 }]);
  });

  it('carries a gun\'s barrel length out and back, in calibres', () => {
    const raw = file({
      modules: [
        { kind: 'core', x: 0, y: 0, length: 10, width: 4 },
        { kind: 'turret', x: 6, y: 0, angle: 0, length: 5, width: 4, barrelCalibres: 70 },
        { kind: 'hullGun', x: -9, y: 0, angle: 180, length: 8, width: 4, barrelCalibres: 12 },
      ],
    }) as Record<string, unknown>;
    expect(blueprintFileProblem(raw)).toBeNull();
    const back = serialiseBlueprint(parseBlueprint(raw))['modules'] as Record<string, unknown>[];
    expect(back[1]).toMatchObject({ barrelCalibres: 70 });
    expect(back[2]).toMatchObject({ barrelCalibres: 12 });
    // A laser has no barrel to set.
    keptAndWarned(
      file({ modules: [{ kind: 'beamTurret', x: 0, y: 0, length: 5, width: 4, barrelCalibres: 30 }] }),
      /modules\[0\] has a key the game does not read, kept as written: barrelCalibres/,
    );
  });

  it('reads a hull mount\'s barrel share from an older file', () => {
    // An 8x4 hull gun's bore is 0.4 m, so half of it is ten calibres.
    const gun = parseBlueprint(
      file({ modules: [{ kind: 'hullGun', x: 0, y: 0, length: 8, width: 4, nozzle: 0.75 }] }),
    ).modules[0] as ModuleSpec;
    expect(gun.barrelCalibres).toBe(15);
    expect(gun.nozzle).toBeUndefined();
    expect(gun.unread).toBeUndefined();
    // A lens housing has one depth now, so its share is simply dropped.
    const beam = parseBlueprint(
      file({ modules: [{ kind: 'hullBeam', x: 0, y: 0, length: 8, width: 4, nozzle: 0.2 }] }),
    ).modules[0] as ModuleSpec;
    expect(beam.nozzle).toBeUndefined();
    expect(beam.unread).toBeUndefined();
  });

  it('carries a weapon\'s traverse limit out and back, in degrees', () => {
    // Degrees in the file and radians in the simulation, as every other angle
    // — a layout is written by a person and read by arithmetic.
    const raw = file({
      modules: [
        { kind: 'core', x: 0, y: 0, length: 10, width: 4 },
        { kind: 'turret', x: 6, y: 0, angle: 0, length: 5, width: 4, barrels: 1, traverse: 30 },
      ],
    });
    expect(blueprintFileProblem(raw)).toBeNull();
    const back = parseBlueprint(raw);
    expect((back.modules[1] as ModuleSpec).traverse).toBeCloseTo(degreesToRadians(30), 12);
    expect(serialiseBlueprint(back)).toEqual(raw);
    // And a girder that says how far it trains is a mistake here, as a bell on
    // a core is, though mutation may hold one in memory against a refit back.
    keptAndWarned(
      file({ modules: [{ kind: 'structure', x: 0, y: 0, length: 10, width: 4, traverse: 30 }] }),
      /traverse/,
    );
    expect(
      serialiseBlueprint({
        name: 'Dormant',
        modules: [{ kind: 'structure', x: 0, y: 0, length: 10, width: 4, traverse: 0.5 }],
      })['modules'],
    ).toEqual([{ kind: 'structure', x: 0, y: 0, length: 10, width: 4 }]);
  });

  it('refuses a format version it does not understand', () => {
    expect(blueprintFileProblem(file({ formatVersion: 2 }))).toMatch(/formatVersion must be 1/);
    expect(blueprintFileProblem(file({ formatVersion: undefined }))).toMatch(/formatVersion must be 1/);
  });

  it('opens a file with a key it does not recognise, says so, and keeps it', () => {
    // `barrel` for `barrels` parses into a single-barrelled turret, and nothing
    // downstream can tell that the author asked for eight — so it is said, on
    // opening and on saving. Refusing the file instead would make a typo cost
    // the whole ship, which is no way to treat someone editing it by hand.
    keptAndWarned(
      file({ modules: [{ kind: 'turret', x: 0, y: 0, length: 8, width: 6, barrel: 8 }] }),
      /modules\[0\] has a key the game does not read, kept as written: barrel/,
    );
    keptAndWarned(file({ Name: 'Corvette' }), /the file has a key the game does not read, kept as written: Name/);
    keptAndWarned(
      file({ doctrine: { targetting: { x: 1 }, approach: { standof: 2, standoff: 0.5 } } }),
      /doctrine has a key[^\n]*targetting[\s\S]*doctrine\.approach has a key[^\n]*standof/,
    );
    keptAndWarned(
      file({
        modules: [{ kind: 'turret', x: 0, y: 0, length: 8, width: 6, targeting: { proximityweight: 3 } }],
      }),
      /modules\[0\]: targeting has a key[^\n]*proximityweight/,
    );
  });

  it('refuses numbers that are not numbers, including the ones JSON allows', () => {
    expect(blueprintFileProblem(file({ modules: [{ kind: 'structure', x: '0', y: 0, length: 10, width: 4 }] })))
      .toMatch(/x must be a finite number/);
    expect(blueprintFileProblem(file({ modules: [{ kind: 'structure', x: 0, y: 0, length: null, width: 4 }] })))
      .toMatch(/length must be a finite number/);
    expect(blueprintFileProblem(file({ modules: [{ kind: 'structure', x: 0, y: 0, length: 1e400, width: 4 }] })))
      .toMatch(/length must be a finite number/);
  });

  it('refuses a module kind that does not exist', () => {
    expect(blueprintFileProblem(file({ modules: [{ kind: 'laser', x: 0, y: 0, length: 10, width: 4 }] })))
      .toMatch(/kind must be one of/);
  });

  it('reads a file whose layout breaks the design rules, and leaves them to be reported', () => {
    // Readability and validity are different questions. A file naming an
    // overlapping hull or a fractional barrel count says exactly what it
    // means, so it parses; `blueprintProblem` is what says it would not fly,
    // and an editor that could not open one could not put it right.
    const overlapping = file({
      modules: [
        { kind: 'structure', x: 0, y: 0, length: 10, width: 4 },
        { kind: 'structure', x: 1, y: 0, length: 10, width: 4 },
      ],
    });
    expect(blueprintFileProblem(overlapping)).toBeNull();
    expect(blueprintProblem(parseBlueprint(overlapping))).toMatch(/overlap/);

    const halfBarrelled = file({
      modules: [{ kind: 'turret', x: 0, y: 0, length: 8, width: 6, barrels: 2.5 }],
    });
    expect(blueprintFileProblem(halfBarrelled)).toBeNull();
    expect(blueprintProblem(parseBlueprint(halfBarrelled))).toMatch(/whole number/);

    const empty = file({ modules: [] });
    expect(blueprintFileProblem(empty)).toBeNull();
    expect(blueprintProblem(parseBlueprint(empty))).toMatch(/at least one module/);
  });

  it('refuses a malformed repeat or step', () => {
    const instance = (over: Record<string, unknown>) =>
      file({
        assemblies: { seg: { modules: [{ kind: 'structure', x: 0, y: 0, length: 4, width: 4 }] } },
        modules: [{ kind: 'structure', x: 0, y: 0, length: 10, width: 4 }, { use: 'seg', x: 0, y: 5, ...over }],
      });
    expect(blueprintFileProblem(instance({ repeat: 'four' }))).toMatch(/repeat must be a finite number/);
    expect(blueprintFileProblem(instance({ repeat: 3, step: 8 }))).toMatch(/step must be an object/);
    keptAndWarned(instance({ repeat: 3, step: { x: 0, y: 4, dx: 1 } }), /\[1\]: step has a key[^\n]*dx/);
    expect(blueprintFileProblem(instance({ repeat: 3, step: { x: 0 } }))).toMatch(/step y must be a finite number/);
  });

  it('keeps, unread, the extras a copy used to carry: a part is taken out of the assembly instead', () => {
    const withExtra = file({
      assemblies: { seg: { modules: [{ kind: 'structure', x: 0, y: 0, length: 4, width: 4 }] } },
      modules: [
        { kind: 'structure', x: 0, y: 0, length: 10, width: 4 },
        { use: 'seg', x: 0, y: 5, extra: [{ kind: 'structure', x: 0, y: 4, length: 4, width: 4 }] },
      ],
    });
    keptAndWarned(withExtra, /modules\[1\] has a key[^\n]*extra/);
    expect(expandBlueprint(parseBlueprint(withExtra))).toHaveLength(2);
  });

  it('puts a step angle in degrees too', () => {
    const parsed = parseBlueprint(
      file({
        assemblies: { seg: { modules: [{ kind: 'structure', x: 0, y: 0, length: 4, width: 4 }] } },
        modules: [
          { kind: 'core', x: 0, y: 0, length: 10, width: 4 },
          { use: 'seg', x: 0, y: 4, repeat: 2, step: { x: 4, y: 0, angle: 90 } },
        ],
      }),
    );
    const instance = parsed.modules[1];
    expect(instance && 'step' in instance ? instance.step?.angle : undefined).toBe(math.HALF_PI);
  });

  it('throws from parseBlueprint with the problem in the message', () => {
    expect(() => parseBlueprint(file({ formatVersion: 99 }))).toThrow(/Invalid blueprint file/);
    expect(() => parseBlueprint(file({ formatVersion: 99 }))).toThrow(/formatVersion must be 1/);
  });
});
