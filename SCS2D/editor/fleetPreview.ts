import { Snapshot, type ShipDesign, type ShipView } from '../sim/index.js';
import { centreOf, type FleetView } from './fleetDocument.js';
import { restingTriggers } from './preview.js';

/** The team a fleet is drawn as: a fleet is a side, so it wears one. */
export const FLEET_TEAM = 0;

/**
 * A fleet as a `Snapshot` the battle renderer can draw, at rest, with the
 * fleet's origin at the world origin. The fleet editor's `previewSnapshot`.
 */
export function fleetSnapshot(
  view: Pick<FleetView, 'ships' | 'designs'>,
  out: Snapshot = new Snapshot(),
  team = FLEET_TEAM,
): Snapshot {
  let count = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  view.ships.forEach((ship, i) => {
    const design = view.designs[i];
    if (design == null) return;
    const centre = centreOf(ship, design);
    const ships: ShipView[] = out.ships;
    const shipView = ships[count] ?? freshView(design);
    ships[count++] = shipView;
    shipView.design = design;
    shipView.team = team;
    shipView.x = centre.x;
    shipView.y = centre.y;
    shipView.angle = ship.angle;
    shipView.vx = 0;
    shipView.vy = 0;
    restingTriggers(shipView, design);
    shipView.throttles.length = design.engines.length;
    shipView.throttles.fill(0);
    shipView.landed.length = 0;
    shipView.integrity.length = design.modules.length;
    shipView.integrity.fill(1);
    shipView.hasControl = true;
    shipView.isDerelict = false;
    shipView.turretDisabled.length = design.turrets.length;
    shipView.turretDisabled.fill(false);

    minX = Math.min(minX, centre.x - design.radius);
    minY = Math.min(minY, centre.y - design.radius);
    maxX = Math.max(maxX, centre.x + design.radius);
    maxY = Math.max(maxY, centre.y + design.radius);
  });

  out.shipCount = count;
  out.tick = 0;
  out.time = 0;
  out.wells = [];
  out.projectileCount = 0;
  out.beamCount = 0;
  // An empty fleet still frames its origin.
  out.minX = count === 0 ? -50 : minX;
  out.minY = count === 0 ? -50 : minY;
  out.maxX = count === 0 ? 50 : maxX;
  out.maxY = count === 0 ? 50 : maxY;
  return out;
}

function freshView(design: ShipDesign): ShipView {
  return {
    design,
    body: -1,
    team: FLEET_TEAM,
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
    hasControl: true,
    isDerelict: false,
    turretDisabled: [],
  };
}
