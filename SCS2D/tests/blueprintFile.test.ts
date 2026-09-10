import { describe, expect, it } from 'vitest';
import {
  BLUEPRINT_FORMAT_VERSION,
  blueprintFileProblem,
  degreesToRadians,
  expandBlueprint,
  math,
  parseBlueprint,
  radiansToDegrees,
  serialiseBlueprint,
} from '../sim/index.js';
import corvetteFile from '../scenarios/corvette.json' with { type: 'json' };
import damagedCorvetteFile from '../scenarios/damaged-corvette.json' with { type: 'json' };
import gunshipFile from '../scenarios/gunship.json' with { type: 'json' };
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
  ['damaged corvette', damagedCorvetteFile],
  ['gunship', gunshipFile],
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

describe('blueprint files', () => {
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

  it('refuses a format version it does not understand', () => {
    expect(blueprintFileProblem(file({ formatVersion: 2 }))).toMatch(/formatVersion must be 1/);
    expect(blueprintFileProblem(file({ formatVersion: undefined }))).toMatch(/formatVersion must be 1/);
  });

  it('refuses a key it does not recognise, rather than ignoring it', () => {
    // The whole point: `barrel` for `barrels` parses cleanly into a
    // single-barrelled turret, and nothing downstream can tell that the author
    // asked for eight. A silently different ship is worse than a refusal.
    expect(
      blueprintFileProblem(
        file({ modules: [{ kind: 'turret', x: 0, y: 0, length: 8, width: 6, barrel: 8 }] }),
      ),
    ).toMatch(/unknown key barrel/);
    expect(blueprintFileProblem(file({ Name: 'Corvette' }))).toMatch(/unknown key Name/);
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

  it('holds a loaded ship to the same geometry rules as an authored one', () => {
    // Delegated to blueprintProblem rather than restated, so there is one
    // definition of a valid ship and not two that can drift apart.
    expect(blueprintFileProblem(file({ modules: [] }))).toMatch(/at least one module/);
    expect(
      blueprintFileProblem(
        file({
          modules: [
            { kind: 'structure', x: 0, y: 0, length: 10, width: 4 },
            { kind: 'structure', x: 1, y: 0, length: 10, width: 4 },
          ],
        }),
      ),
    ).toMatch(/overlap/);
    expect(
      blueprintFileProblem(
        file({ modules: [{ kind: 'turret', x: 0, y: 0, length: 8, width: 6, barrels: 2.5 }] }),
      ),
    ).toMatch(/whole number/);
  });

  it('throws from parseBlueprint with the problem in the message', () => {
    expect(() => parseBlueprint(file({ formatVersion: 99 }))).toThrow(/Invalid blueprint file/);
    expect(() => parseBlueprint(file({ formatVersion: 99 }))).toThrow(/formatVersion must be 1/);
  });
});
