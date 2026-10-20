import { describe, expect, it } from 'vitest';
import {
  blueprintFileProblem,
  expandWithOrigins,
  moduleKeys,
  parseBlueprint,
  Rng,
  serialiseBlueprint,
  settleIds,
  topId,
  type Blueprint,
  type Placement,
} from '../sim/index.js';
import { BLUEPRINTS, DINKY } from '../scenarios/blueprints.js';
import { createAssembly, duplicatePlacement, movePlacement, removePlacement } from '../editor/edit.js';
import { EditorDocument } from '../editor/document.js';
import { mutate } from '../evolution/mutate.js';

/** Stable placement ids, so one version of a design matches the next (ROADMAP.md §8 step 12, slice 2). */

const PLAIN: Blueprint = {
  name: 'Plain',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
    { kind: 'tank', x: 4, y: 0, length: 4, width: 4 },
    { kind: 'engine', x: -4, y: 0, angle: Math.PI, length: 4, width: 4 },
  ],
};

const ids = (list: readonly Placement[]): (number | undefined)[] => list.map((p) => p.id);

function allIds(blueprint: Blueprint): number[] {
  return [blueprint.modules, ...Object.values(blueprint.assemblies ?? {}).map((a) => a.modules)].flat().map((p) => p.id!);
}

describe('settling ids', () => {
  it('gives each placement an id, in order, where none has one', () => {
    expect(ids(settleIds(PLAIN).modules)).toEqual([1, 2, 3]);
  });

  it('keeps what is unique, and gives a repeat or a gap the next free id', () => {
    const muddled: Blueprint = { ...PLAIN, modules: [{ ...PLAIN.modules[0]!, id: 5 }, { ...PLAIN.modules[1]!, id: 5 }, PLAIN.modules[2]!] };
    expect(ids(settleIds(muddled).modules)).toEqual([5, 6, 7]);
  });

  it('never gives a new placement the id of one that went', () => {
    const settled = settleIds(PLAIN);
    const gone = { ...settled, modules: [...settled.modules.slice(0, 2), { ...PLAIN.modules[2]!, x: -8 }] };
    expect(ids(settleIds(gone, topId(settled)).modules)).toEqual([1, 2, 4]);
  });

  it('returns the same blueprint when every id is already its own', () => {
    const settled = settleIds(PLAIN);
    expect(settleIds(settled)).toBe(settled);
  });

  it('reads them from a file, and writes them back, and refuses one that is not a whole number from one', () => {
    const back = parseBlueprint(serialiseBlueprint(settleIds(PLAIN)));
    expect(ids(back.modules)).toEqual([1, 2, 3]);
    const bad = { ...serialiseBlueprint(PLAIN), modules: [{ id: 0, kind: 'core', x: 0, y: 0, length: 4, width: 4 }] };
    expect(blueprintFileProblem(bad)).toMatch(/id must be a whole number from 1/);
  });

  it('every stock design has them, each unique', () => {
    for (const blueprint of Object.values(BLUEPRINTS)) {
      const all = allIds(blueprint);
      expect(new Set(all).size, blueprint.name).toBe(all.length);
      expect(
        all.every((id) => Number.isInteger(id) && id >= 1),
        blueprint.name,
      ).toBe(true);
    }
  });
});

describe("a module's key", () => {
  it('is unique to each module drawn, copies of a shared part included', () => {
    const keys = moduleKeys(DINKY);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(expandWithOrigins(DINKY).modules.length);
  });

  it('stays the same through an edit that does not touch the module', () => {
    const doc = new EditorDocument(PLAIN);
    const before = moduleKeys(doc.blueprint);
    const origin = expandWithOrigins(doc.blueprint).origins[1]!;
    doc.apply(movePlacement(doc.blueprint, origin, 1, 0)!);
    expect(moduleKeys(doc.blueprint)).toEqual(before);
  });
});

describe('editing keeps ids', () => {
  it('gives a duplicate an id of its own and leaves the original its id', () => {
    const doc = new EditorDocument(PLAIN);
    const origin = expandWithOrigins(doc.blueprint).origins[1]!;
    doc.apply(duplicatePlacement(doc.blueprint, origin)!.blueprint);
    const all = allIds(doc.blueprint);
    expect(new Set(all).size).toBe(all.length);
    // The tank, now an assembly placed twice, is still module 2 inside it.
    expect(Object.values(doc.blueprint.assemblies ?? {})[0]!.modules[0]!.id).toBe(2);
  });

  it('keeps every member’s id when parts are made an assembly', () => {
    const doc = new EditorDocument(PLAIN);
    const paths = expandWithOrigins(doc.blueprint)
      .origins.slice(1)
      .map((o) => o.path);
    doc.apply(createAssembly(doc.blueprint, paths)!.blueprint);
    expect(
      Object.values(doc.blueprint.assemblies ?? {})[0]!
        .modules.map((p) => p.id)
        .sort(),
    ).toEqual([2, 3]);
  });

  it('does not give a module added in the same edit the id of one deleted', () => {
    const doc = new EditorDocument(PLAIN);
    const path = expandWithOrigins(doc.blueprint).origins[2]!.path;
    const removed = removePlacement(doc.blueprint, path)!;
    doc.apply({ ...removed, modules: [...removed.modules, { kind: 'tank', x: 8, y: 0, length: 4, width: 4 }] });
    expect(ids(doc.blueprint.modules)).toEqual([1, 2, 4]);
  });
});

describe('breeding keeps ids', () => {
  it('gives a child only ids that are its parent’s or new above them, each unique', () => {
    const parent = settleIds(DINKY);
    const top = topId(parent);
    const before = new Set(allIds(parent));
    for (let seed = 1; seed <= 40; seed++) {
      const child = mutate(parent, new Rng(seed), { structural: 0.5 });
      const all = allIds(child.blueprint);
      expect(new Set(all).size).toBe(all.length);
      for (const id of all) expect(before.has(id) || id > top).toBe(true);
    }
  });
});
