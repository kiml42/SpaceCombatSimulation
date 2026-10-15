import { compileBlueprint, expandFleet, shipFleet, type Blueprint, type Fleet, type ShipDesign, type Snapshot } from '../sim/index.js';
import { draw } from '../render/canvas2d.js';
import type { Camera } from '../render/camera.js';
import { NO_TEAM } from '../editor/preview.js';
import { fleetSnapshot } from '../editor/fleetPreview.js';
import type { FleetView } from '../editor/fleetDocument.js';

/**
 * A fleet drawn small, two ways, as the evolution page and the skirmish's
 * timeline both show one: each kind of ship once, with how many there are,
 * and the whole fleet as it is arranged.
 */

/** One kind of ship in a fleet, and how many of that kind it has. */
export interface ShipKind {
  readonly name: string;
  readonly design: ShipDesign;
  readonly count: number;
}

/** A fleet laid out to draw, what it weighs, and what kinds of ship it is made of. */
export interface Picture {
  readonly view: Pick<FleetView, 'ships' | 'designs'>;
  readonly mass: number;
  /** Largest first: a fleet is read by its heaviest ship before its escorts. */
  readonly kinds: readonly ShipKind[];
}

export function pictureOf(entrant: Fleet | Blueprint): Picture {
  const fleet = 'designs' in entrant ? entrant : shipFleet(entrant);
  const compiled = new Map<string, ShipDesign>();
  const ships = expandFleet(fleet);
  const designs = ships.map((ship) => {
    let design = compiled.get(ship.design);
    if (design === undefined) {
      design = compileBlueprint(fleet.designs[ship.design]!);
      compiled.set(ship.design, design);
    }
    return design;
  });
  // One entry per kind of ship, heaviest first: what a fleet is made of, which
  // is the thing a picture of the whole fleet cannot show at the size a row gives it.
  const counted = new Map<string, { design: ShipDesign; count: number }>();
  ships.forEach((ship, i) => {
    const held = counted.get(ship.design);
    if (held === undefined) counted.set(ship.design, { design: designs[i]!, count: 1 });
    else held.count += 1;
  });
  const kinds: ShipKind[] = [...counted]
    .map(([name, { design, count }]) => ({ name, design, count }))
    .sort((a, b) => b.design.mass - a.design.mass || a.name.localeCompare(b.name));
  return { view: { ships, designs }, mass: designs.reduce((sum, d) => sum + d.mass, 0), kinds };
}

/** One kind of ship alone at the origin, to draw or to measure. */
export function kindSnapshot(kind: ShipKind, into: Snapshot): Snapshot {
  return fleetSnapshot(
    {
      ships: [{ design: kind.name, x: 0, y: 0, angle: 0, path: kind.name, entry: 0, trail: [] }],
      designs: [kind.design],
    },
    into,
    NO_TEAM,
  );
}

/** The whole fleet as it stands, to draw or to measure. */
export function formationSnapshot(picture: Picture, into: Snapshot): Snapshot {
  return fleetSnapshot(picture.view, into, NO_TEAM);
}

/** Draw a snapshot centred on a canvas at a scale, pixels a metre. */
export function drawCentred(canvas: HTMLCanvasElement, shot: Snapshot, scale: number): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const eye: Camera = { x: (shot.minX + shot.maxX) / 2, y: (shot.minY + shot.maxY) / 2, scale };
  draw(ctx, shot, eye, canvas.width, canvas.height);
}
