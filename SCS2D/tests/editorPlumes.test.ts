import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileBlueprint, HULL_LAYER, landedIndex } from '../sim/index.js';
import { parseFleet } from '../sim/fleetFile.js';
import { CORVETTE } from '../scenarios/blueprints.js';
import { landOnSelf, previewSnapshot } from '../editor/preview.js';

describe('the editor drawing an engine that fires into its own hull', () => {
  const fleet = parseFleet(JSON.parse(readFileSync('tests/fixtures/plume-exploit-fleet.json', 'utf8')));
  const design = compileBlueprint(Object.values(fleet.designs)[0]!);

  it('lights it at full throttle, and leaves every clear engine cold', () => {
    const view = previewSnapshot(design).ships[0]!;
    design.engines.forEach((t, k) => expect(view.throttles[k]).toBe((t.escaping ?? 1) < 1 ? 1 : 0));
    expect(view.throttles.some((throttle) => throttle === 1)).toBe(true);
  });

  it('says where its flame lands, for the renderer to cut it there and draw the burn', () => {
    const view = previewSnapshot(design).ships[0]!;
    const blocked = design.engines.findIndex((t) => (t.escaping ?? 1) < 1);
    // Half its exit is covered, so of its three thirds the one beside the
    // covered edge lands and the one beside the open edge does not.
    const thirds = [0, 1, 2].map((ray) => view.landed[landedIndex(design, blocked, ray, HULL_LAYER)]!);
    expect(thirds.filter((share) => share > 0).length).toBeGreaterThan(0);
    expect(thirds.filter((share) => share > 0).length).toBeLessThan(3);
  });

  it('lands nothing for a ship whose engines are clear, however hard they burn', () => {
    const corvette = compileBlueprint(CORVETTE);
    const view = previewSnapshot(corvette).ships[0]!;
    expect(view.throttles.every((throttle) => throttle === 0)).toBe(true);
    view.throttles.fill(1);
    landOnSelf(view);
    expect(view.landed.every((share) => share === 0)).toBe(true);
  });
});
