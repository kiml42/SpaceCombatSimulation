import { describe, expect, it } from 'vitest';
import {
  blueprintProblem,
  expandFleet,
  fleetFileProblem,
  math,
  parseFleet,
  serialiseBlueprint,
  serialiseFleet,
  type Fleet,
} from '../sim/index.js';
import lineOfBattleFile from '../scenarios/fleets/line-of-battle.json' with { type: 'json' };
import { FLEETS } from '../scenarios/fleets.js';
import { BLUEPRINTS, DINKY, GUNSHIP } from '../scenarios/blueprints.js';

const designs = { Gunship: serialiseBlueprint(GUNSHIP), Dinky: serialiseBlueprint(DINKY) };

function file(extra: Record<string, unknown>): Record<string, unknown> {
  return { formatVersion: 1, name: 'Test', designs, ships: [], ...extra };
}

const wing = {
  ships: [
    { design: 'Dinky', x: 0, y: 0 },
    { design: 'Dinky', x: -15, y: 12, angle: 30 },
  ],
};

describe('the fleet file format', () => {
  it('round-trips the stock fleet exactly', () => {
    expect(serialiseFleet(parseFleet(lineOfBattleFile))).toEqual(lineOfBattleFile);
  });

  it('round-trips groups, mirrors and notes', () => {
    const raw = file({
      notes: 'n',
      groups: { Wing: { notes: 'w', ...wing } },
      ships: [
        { design: 'Gunship', x: 0, y: 0, angle: 90, notes: 's' },
        { group: 'Wing', x: 60, y: -80, angle: 0, mirror: true, repeat: 2, step: { x: 0, y: -40, angle: 15 } },
        { design: 'Dinky', x: -50, y: 0, repeat: 3, step: { x: 0, y: 10 } },
      ],
    });
    expect(serialiseFleet(parseFleet(raw))).toEqual(raw);
  });

  it.each([
    ['an unknown key', file({ colour: 'red' }), /unknown key colour/],
    ['a wrong version', file({ formatVersion: 2 }), /formatVersion/],
    ['an unknown design', file({ ships: [{ design: 'Nope', x: 0, y: 0 }] }), /no design named Nope/],
    ['an unknown group', file({ ships: [{ group: 'Nope', x: 0, y: 0 }] }), /no group named Nope/],
    ['both design and group', file({ ships: [{ design: 'Dinky', group: 'Wing', x: 0, y: 0 }] }), /both/],
    ['a missing position', file({ ships: [{ design: 'Dinky', x: 0 }] }), /y must be/],
    ['a repeat that is not a whole number', file({ ships: [{ design: 'Dinky', x: 0, y: 0, repeat: 1.5 }] }), /repeat/],
    ['a step with an unknown key', file({ ships: [{ design: 'Dinky', x: 0, y: 0, step: { x: 0, y: 1, z: 2 } }] }), /unknown key z/],
    ['a mirrored single ship', file({ ships: [{ design: 'Dinky', x: 0, y: 0, mirror: true }] }), /unknown key mirror/],
    ['a design named differently inside', file({ designs: { Big: serialiseBlueprint(GUNSHIP) } }), /named "Gunship"/],
    ['a broken design', file({ designs: { Dinky: { formatVersion: 1, name: 'Dinky' } } }), /design Dinky: modules/],
    [
      'a group containing itself',
      file({ groups: { A: { ships: [{ group: 'B', x: 0, y: 0 }] }, B: { ships: [{ group: 'A', x: 0, y: 0 }] } } }),
      /contains itself \(A → B → A\)/,
    ],
  ])('refuses %s', (_what, raw, message) => {
    expect(fleetFileProblem(raw)).toMatch(message);
    expect(() => parseFleet(raw)).toThrow(message);
  });

  it('refuses a fleet whose groups multiply past the cap', () => {
    const groups: Record<string, unknown> = { G0: { ships: [{ design: 'Dinky', x: 0, y: 0 }] } };
    for (let i = 1; i <= 5; i++) {
      groups[`G${i}`] = { ships: Array.from({ length: 5 }, () => ({ group: `G${i - 1}`, x: 0, y: 0 })) };
    }
    expect(fleetFileProblem(file({ groups, ships: [{ group: 'G5', x: 0, y: 0 }] }))).toMatch(/more than \d+ ships/);
  });

  const library = new Map(Object.values(BLUEPRINTS).map((b) => [b.name, b]));

  it('carries only flyable stock designs, identical to the library copies', () => {
    for (const fleet of Object.values(FLEETS)) {
      for (const [name, design] of Object.entries(fleet.designs)) {
        expect(blueprintProblem(design), `${fleet.name}: ${name}`).toBeNull();
        expect(serialiseBlueprint(design), `${fleet.name}: ${name} out of sync`).toEqual(
          serialiseBlueprint(library.get(name)!),
        );
      }
    }
  });
});

describe('flattening a fleet', () => {
  const fleet: Fleet = parseFleet(
    file({
      groups: { Wing: wing, Squadron: { ships: [{ group: 'Wing', x: 0, y: 0 }, { group: 'Wing', x: 0, y: 40 }] } },
      ships: [
        { design: 'Gunship', x: 0, y: 0 },
        { group: 'Wing', x: 60, y: 80, angle: 90 },
        { group: 'Wing', x: 60, y: -80, mirror: true },
        { group: 'Squadron', x: -100, y: 0 },
      ],
    }),
  );
  const ships = expandFleet(fleet);

  it('names every ship by path, counting same-named siblings', () => {
    expect(ships.map((s) => s.path)).toEqual([
      'Gunship#1',
      'Wing#1/Dinky#1',
      'Wing#1/Dinky#2',
      'Wing#2/Dinky#1',
      'Wing#2/Dinky#2',
      'Squadron#1/Wing#1/Dinky#1',
      'Squadron#1/Wing#1/Dinky#2',
      'Squadron#1/Wing#2/Dinky#1',
      'Squadron#1/Wing#2/Dinky#2',
    ]);
  });

  it('turns a group about its own origin', () => {
    const [lead, second] = [ships[1]!, ships[2]!];
    expect(lead).toMatchObject({ x: 60, y: 80, angle: math.HALF_PI });
    expect(second.x).toBeCloseTo(60 - 12, 9);
    expect(second.y).toBeCloseTo(80 - 15, 9);
    expect(second.angle).toBeCloseTo(math.HALF_PI + math.PI / 6, 9);
  });

  it('mirrors positions and headings but not designs', () => {
    const second = ships[4]!;
    expect(second).toMatchObject({ design: 'Dinky', x: 45, y: -92 });
    expect(second.angle).toBeCloseTo(-math.PI / 6, 9);
  });

  it('nests groups', () => {
    expect(ships[7]).toMatchObject({ x: -100, y: 40 });
  });

  it('steps each copy of a repeat from the one before, in its own frame', () => {
    const arc = expandFleet(
      parseFleet(file({ ships: [{ design: 'Dinky', x: 0, y: 0, repeat: 3, step: { x: 10, y: 0, angle: 90 } }] })),
    );
    expect(arc.map((s) => s.path)).toEqual(['Dinky#1', 'Dinky#2', 'Dinky#3']);
    expect(arc[1]).toMatchObject({ x: 10, y: 0 });
    expect(arc[2]!.x).toBeCloseTo(10, 9);
    expect(arc[2]!.y).toBeCloseTo(10, 9);
    expect(arc[2]!.angle).toBeCloseTo(math.PI, 9);
    expect(arc[2]!.trail.map((step) => step.copy)).toEqual([2]);
  });

  it('runs a mirrored group’s repeat the other way', () => {
    const rows = expandFleet(
      parseFleet(
        file({
          groups: { One: { ships: [{ design: 'Dinky', x: 0, y: 0 }] } },
          ships: [{ group: 'One', x: 0, y: 0, mirror: true, repeat: 2, step: { x: 0, y: 30 } }],
        }),
      ),
    );
    expect(rows[1]).toMatchObject({ x: 0, y: -30 });
  });
});
