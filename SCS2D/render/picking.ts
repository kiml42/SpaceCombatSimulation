import { NEUTRAL_TEAM, type ShipView, type Snapshot } from '../sim/index.js';

/**
 * Which ships the viewer has picked out to give orders to, as the ships the
 * simulation knows them by. A selection is one side only, and never a
 * neutral's, so that one right-click means one thing for all of it; a plain
 * click can still pick out a neutral, alone, to look at.
 *
 * DOM-free arithmetic over a snapshot, like the camera, so it is unit-tested.
 */

/** The ship under a world point, nearest first, or null. */
export function shipViewAt(snapshot: Snapshot, x: number, y: number, reach: number): ShipView | null {
  let best: ShipView | null = null;
  let nearest = Infinity;
  for (let i = 0; i < snapshot.shipCount; i++) {
    const ship = snapshot.ships[i]!;
    const d = Math.hypot(ship.x - x, ship.y - y);
    if (d > Math.max(ship.currentStructure.radius, reach) || d >= nearest) continue;
    nearest = d;
    best = ship;
  }
  return best;
}

/** The side a selection is of, or null for none or for a neutral looked at alone. */
export function sideOf(snapshot: Snapshot, picked: readonly number[]): number | null {
  const first = viewOf(snapshot, picked[0]);
  return first === null || first.team === NEUTRAL_TEAM ? null : first.team;
}

/** A click on `ship` (or on nothing): it alone, or with Shift, added to or taken from the selection. */
export function clicked(snapshot: Snapshot, picked: readonly number[], ship: ShipView | null, shift: boolean): number[] {
  if (!shift) return ship?.ship === undefined ? [] : [ship.ship];
  if (ship?.ship === undefined || ship.team === NEUTRAL_TEAM) return [...picked];
  const side = sideOf(snapshot, picked);
  if (side === null) return [ship.ship];
  // Shift never changes the side picked; a plain click does that.
  if (ship.team !== side) return [...picked];
  return picked.includes(ship.ship) ? picked.filter((i) => i !== ship.ship) : [...picked, ship.ship];
}

/**
 * A box dragged from (x0, y0) to (x1, y1), added to the selection: the ships
 * inside it of the selection's side, or with none picked, of whichever side
 * has the most ships in it, a tie going to the side of the ship nearest
 * where the drag started.
 */
export function boxed(snapshot: Snapshot, picked: readonly number[], x0: number, y0: number, x1: number, y1: number): number[] {
  const inside: ShipView[] = [];
  for (let i = 0; i < snapshot.shipCount; i++) {
    const ship = snapshot.ships[i]!;
    if (ship.ship === undefined || ship.team === NEUTRAL_TEAM) continue;
    if (ship.x < Math.min(x0, x1) || ship.x > Math.max(x0, x1)) continue;
    if (ship.y < Math.min(y0, y1) || ship.y > Math.max(y0, y1)) continue;
    inside.push(ship);
  }
  const side = sideOf(snapshot, picked) ?? majority(inside, x0, y0);
  const out = sideOf(snapshot, picked) === null ? [] : [...picked];
  for (const ship of inside) if (ship.team === side && !out.includes(ship.ship!)) out.push(ship.ship!);
  return out;
}

function majority(ships: readonly ShipView[], x: number, y: number): number | null {
  const counts = new Map<number, number>();
  for (const ship of ships) counts.set(ship.team, (counts.get(ship.team) ?? 0) + 1);
  const most = Math.max(0, ...counts.values());
  const tied = new Set([...counts].filter(([, n]) => n === most).map(([team]) => team));
  if (tied.size <= 1) return [...tied][0] ?? null;
  let best: number | null = null;
  let nearest = Infinity;
  for (const ship of ships) {
    const d = Math.hypot(ship.x - x, ship.y - y);
    if (tied.has(ship.team) && d < nearest) {
      nearest = d;
      best = ship.team;
    }
  }
  return best;
}

/** Every ship of `ship`'s design on its side: what a double-click picks. */
export function sameDesign(snapshot: Snapshot, ship: ShipView | null): number[] {
  if (ship?.ship === undefined || ship.team === NEUTRAL_TEAM) return ship?.ship === undefined ? [] : [ship.ship];
  const out: number[] = [];
  for (let i = 0; i < snapshot.shipCount; i++) {
    const other = snapshot.ships[i]!;
    if (other.ship !== undefined && other.team === ship.team && blueprintOf(other).name === blueprintOf(ship).name) out.push(other.ship);
  }
  return out;
}

/**
 * Every fighter a fleet strip's tile stands for along with `ship`: its side's
 * fighters of its design still under control, as the strips group them.
 */
export function fighterGroup(snapshot: Snapshot, ship: ShipView | null): number[] {
  if (ship?.ship === undefined) return [];
  if (!blueprintOf(ship).fighter || ship.team === NEUTRAL_TEAM) return [ship.ship];
  const out: number[] = [];
  for (let i = 0; i < snapshot.shipCount; i++) {
    const other = snapshot.ships[i]!;
    if (other.ship !== undefined && other.team === ship.team && blueprintOf(other).name === blueprintOf(ship).name && other.hasControl)
      out.push(other.ship);
  }
  return out;
}

/** The design a ship is built to, damage aside. */
function blueprintOf(ship: ShipView): ShipView['currentStructure'] {
  return ship.blueprint ?? ship.currentStructure;
}

/** Every ship on a side that can still be told anything. */
export function wholeSide(snapshot: Snapshot, team: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < snapshot.shipCount; i++) {
    const ship = snapshot.ships[i]!;
    if (ship.ship !== undefined && ship.team === team && ship.hasControl) out.push(ship.ship);
  }
  return out;
}

/** The selection, less ships no longer in the picture. */
export function stillThere(snapshot: Snapshot, picked: readonly number[]): number[] {
  return picked.filter((i) => viewOf(snapshot, i) !== null);
}

/** A ship's view in the picture, by the simulation's index for it. */
export function viewOf(snapshot: Snapshot, ship: number | undefined): ShipView | null {
  if (ship === undefined) return null;
  for (let i = 0; i < snapshot.shipCount; i++) if (snapshot.ships[i]!.ship === ship) return snapshot.ships[i]!;
  return null;
}

/** World metres a click may miss a mount by and still pick it. */
const MOUNT_SLOP = 0.5;

/**
 * The module of the mount of `ship` under a world point, or -1: what a click
 * picks to tell one placement's mounts their doctrine.
 */
export function mountAt(ship: ShipView, x: number, y: number): number {
  const design = ship.currentStructure;
  const c = Math.cos(-ship.angle);
  const s = Math.sin(-ship.angle);
  const bx = (x - ship.x) * c - (y - ship.y) * s;
  const by = (x - ship.x) * s + (y - ship.y) * c;
  for (const mount of design.turrets) {
    const m = design.modules[mount.module];
    if (m === undefined) continue;
    const mc = Math.cos(-m.angle);
    const ms = Math.sin(-m.angle);
    const lx = (bx - m.x) * mc - (by - m.y) * ms;
    const ly = (bx - m.x) * ms + (by - m.y) * mc;
    if (Math.abs(lx) <= m.spec.length / 2 + MOUNT_SLOP && Math.abs(ly) <= m.spec.width / 2 + MOUNT_SLOP) return mount.module;
  }
  return -1;
}
