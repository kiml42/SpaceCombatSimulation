import {
  AttackArcs,
  bestAttackBearings,
  designArcs,
  engineGeometry,
  holdBand,
  masked,
  math,
  Snapshot,
  weaponPlumeReach,
  type ShipDesign,
  type ShipView,
} from '../sim/index.js';

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

  // Engines are cold. A design is not running, and a plume drawn on a ship
  // standing still would be saying something untrue about it.
  view.throttles.length = design.engines.length;
  for (let t = 0; t < design.engines.length; t++) view.throttles[t] = 0;
  restingTriggers(view, design);

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

/**
 * A design at rest's turrets and firing wedges, at its view's angle.
 *
 * Where each gun would fire, against the enemy its doctrine wants: one
 * standing still relative to it, of the size it prefers, at the furthest it is
 * worth shooting at that. The gun is taken to be aimed straight at it from its
 * rest bearing, so the wedge shows what it would be on target for. An engine
 * used as a weapon shows where it would burn at full throttle, as firing on
 * that enemy standing in it.
 */
export function restingTriggers(view: ShipView, design: ShipDesign): void {
  const band = doctrineBand(design);
  view.holdMin = band.min;
  view.holdMax = band.max;
  view.attackBearings = attackBearings(design).map((r) => r.bearing);

  view.turretBearings.length = design.turrets.length;
  view.turretReady.length = design.turrets.length;
  const aim = (view.turretAim ??= []);
  const trigger = (view.turretTrigger ??= []);
  const triggerReach = (view.turretTriggerReach ??= []);
  const fouled = (view.turretFouled ??= []);
  aim.length = trigger.length = triggerReach.length = fouled.length = design.turrets.length;
  for (let t = 0; t < design.turrets.length; t++) {
    const turret = design.turrets[t]!;
    const rest = (turret.mount.restBearing ?? 0) + view.angle;
    view.turretBearings[t] = rest;
    aim[t] = rest;
    const reach = turret.reach;
    const enemy = design.radius * math.sqrt(orOne(turret.targeting.preferredMass));
    trigger[t] = reach > 0 ? math.atan2(enemy, reach) : 0;
    triggerReach[t] = reach;
    const mask = turret.mount.mask;
    fouled[t] = mask !== undefined && mask.length > 0 && masked(mask, 0);
    view.turretReady[t] = !fouled[t];
  }

  const engineReach = (view.engineTriggerReach ??= []);
  const engineFiring = (view.engineFiring ??= []);
  engineReach.length = engineFiring.length = design.engines.length;
  for (let t = 0; t < design.engines.length; t++) {
    const engine = design.engines[t]!;
    const module = design.modules[engine.module ?? -1];
    engineReach[t] =
      engine.weapon === true && module !== undefined
        ? weaponPlumeReach(engineGeometry(module.spec), engine.maxThrust)
        : 0;
    engineFiring[t] = true;
  }
}

/**
 * The band a design's doctrine closes to, centre to centre, against the enemy
 * its own doctrine prefers: of the size it wants, the same way a gun's wedge
 * is drawn against what that gun wants.
 */
export function doctrineBand(design: ShipDesign): { min: number; max: number } {
  const enemy = design.radius * math.sqrt(orOne(design.doctrine.targeting.preferredMass));
  return holdBand(design.doctrine.approach, design.reach, enemy);
}

/** The bearings that bring the most of a design's main guns to bear, with how many of how many. */
export function attackBearings(design: ShipDesign): { bearing: number; guns: number; total: number }[] {
  const arcs = designArcs(design, new AttackArcs());
  return bestAttackBearings(arcs, design.thrustBearing).map((r) => ({ ...r, total: arcs.total }));
}

/** A preferred mass, or one where it says none. */
function orOne(preferredMass: number): number {
  return preferredMass > 0 ? preferredMass : 1;
}
