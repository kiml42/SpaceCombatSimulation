import { Snapshot, type ShipDesign } from '../sim/index.js';

/**
 * A blueprint as a `Snapshot` the battle renderer can draw.
 *
 * The editor draws through `render/canvas2d.ts` rather than through a renderer
 * of its own, and this is the whole of the adapter. A second renderer would
 * drift from the first exactly as a second copy of the duel would have drifted
 * from the golden one, and the drift would be invisible: the editor would go
 * on showing a ship that the battle no longer drew the same way, which
 * destroys the one thing the tool is for.
 */

/**
 * The team a design is drawn as: none of them.
 *
 * A layout on a drawing board is not on a side, and giving it one implies a
 * fight it is not in. `shipColours` falls through to its neutral palette for
 * any team it does not know.
 */
export const NO_TEAM = -1;

/**
 * Take a picture of a design at rest, with the *blueprint's* origin at the
 * world origin.
 *
 * Placing it that way — rather than putting the centre of mass at the origin,
 * as a body in flight has it — is what stops the ship sliding under the
 * cursor as it is edited. Every module carries a mass, so moving any of them
 * moves the centre of mass, and a view centred on it would shift the whole
 * layout in response to an edit to one corner of it. It also means screen
 * coordinates map to blueprint coordinates with no offset, which is the frame
 * the player is typing numbers in.
 *
 * Fills a caller-owned snapshot, like `capture` does, so redrawing on every
 * pointer move does not allocate.
 */
export function previewSnapshot(design: ShipDesign, out: Snapshot = new Snapshot()): Snapshot {
  const view = out.ships[0] ?? {
    design,
    body: -1,
    team: NO_TEAM,
    x: 0,
    y: 0,
    angle: 0,
    vx: 0,
    vy: 0,
    turretBearings: [],
    turretReady: [],
    throttles: [],
    landed: [],
    integrity: [],
  };
  out.ships[0] = view;
  out.shipCount = 1;

  view.design = design;
  view.team = NO_TEAM;
  // The design expressed its modules about the centre of mass, so putting the
  // body there puts every module back at the coordinates it was written at.
  view.x = design.centreOfMassX;
  view.y = design.centreOfMassY;
  view.angle = 0;
  view.vx = 0;
  view.vy = 0;

  // Turret bearings are world bearings; the hull is unturned, so each gun
  // rests at the bearing its mount was built at.
  view.turretBearings.length = design.turrets.length;
  view.turretReady.length = design.turrets.length;
  for (let t = 0; t < design.turrets.length; t++) {
    view.turretBearings[t] = design.turrets[t]!.mount.restBearing ?? 0;
    view.turretReady[t] = false;
  }

  // Engines are cold. A design is not running, and a plume drawn on a ship
  // standing still would be saying something untrue about it.
  view.throttles.length = design.thrusters.length;
  for (let t = 0; t < design.thrusters.length; t++) view.throttles[t] = 0;

  // A design has taken nothing: the editor draws the ship as it would be built,
  // not as one that has been somewhere.
  view.integrity.length = design.modules.length;
  for (let m = 0; m < design.modules.length; m++) view.integrity[m] = 1;

  out.tick = 0;
  out.time = 0;
  out.wells = [];
  out.projectileCount = 0;

  out.minX = design.centreOfMassX - design.radius;
  out.minY = design.centreOfMassY - design.radius;
  out.maxX = design.centreOfMassX + design.radius;
  out.maxY = design.centreOfMassY + design.radius;

  return out;
}
