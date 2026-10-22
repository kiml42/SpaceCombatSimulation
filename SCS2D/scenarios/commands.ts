import { compileBlueprint, type Blueprint, type ShipDesign } from '../sim/blueprint.js';
import { parseBlueprint, serialiseBlueprint } from '../sim/blueprintFile.js';
import { isDoctrinePart, type DoctrinePart } from '../sim/doctrine.js';
import { NO_TARGET, OrderCancelCondition } from '../sim/ships.js';
import type { Battle } from './types.js';

/**
 * What a player can tell ships mid-battle, as commands: given to the battle
 * at a step, logged, and given again at the same step whenever the battle is
 * re-simulated, so a rewind or a shared link plays the orders as they were
 * given (ROADMAP.md §12). Ships are named by index, which a deterministic
 * battle gives the same ship every time.
 */

/**
 * How far off to hold, metres from the target's skin, and how fast to close,
 * m/s, over doctrine's, for an attack, defence or ram. Either left out follows
 * doctrine as it changes.
 */
export interface Held {
  readonly distance?: number;
  readonly speed?: number;
}

export type Order =
  | ({ readonly kind: 'attack'; readonly target: number; readonly cancelOn: OrderCancelCondition } & Held)
  | ({ readonly kind: 'defend'; readonly target: number } & Held)
  | ({ readonly kind: 'ram'; readonly target: number } & Pick<Held, 'speed'>)
  /** Take on all a friend's dock can give: at `target`, or wherever doctrine chooses for `NO_TARGET`. */
  | { readonly kind: 'dock'; readonly target: number }
  /** Fill its claw from `target`, or for `NO_TARGET` from source after source. */
  | { readonly kind: 'scavenge'; readonly target: number }
  /** Give all it can spare to `target`, a friend, or for `NO_TARGET` to friend after friend. */
  | { readonly kind: 'deliver'; readonly target: number }
  /**
   * Run away, replacing the queue whatever `append` says: from every armed
   * enemy for `NO_TARGET`, from `target` if an enemy, or hiding behind it if a
   * friend or a wreck. Ends only when told.
   */
  | { readonly kind: 'flee'; readonly target: number };

export type Command =
  /** The same order to each ship, replacing its queue, or after it if `append`. */
  | { readonly kind: 'order'; readonly ships: readonly number[]; readonly order: Order; readonly append: boolean }
  /** Take back one order, by its place in the ship's queue. */
  | { readonly kind: 'drop'; readonly ship: number; readonly index: number }
  /** Clear each ship's queue, handing it back to its doctrine. */
  | { readonly kind: 'stop'; readonly ships: readonly number[] }
  /** Tell each ship one field of one part of its doctrine, or with `null` take it back to its design's. */
  | {
      readonly kind: 'doctrine';
      readonly ships: readonly number[];
      readonly part: DoctrinePart;
      readonly field: string;
      readonly value: number | null;
    }
  /** Take one part of each ship's doctrine, or with no part all of it, back to its design's. */
  | { readonly kind: 'resetDoctrine'; readonly ships: readonly number[]; readonly part?: DoctrinePart }
  /** Tell a pad or slipway of each ship, by `slotKey`, how many to keep, or with `null` go back to its design's. */
  | { readonly kind: 'keep'; readonly ships: readonly number[]; readonly slot: string; readonly keep: number | null }
  /** Refit each ship to `blueprint` (`Ships.refit`), which it rebuilds itself to as it fights on. */
  | { readonly kind: 'remodel'; readonly ships: readonly number[]; readonly blueprint: Blueprint }
  /** Tell a pad or slipway of each ship, by `slotKey`, to build `blueprint`, or with `null` its design's craft. */
  | { readonly kind: 'craft'; readonly ships: readonly number[]; readonly slot: string; readonly blueprint: Blueprint | null }
  /** Put a new ship built to `blueprint` into the battle for `team`, where and as fast as it says: for trying things out. */
  | {
      readonly kind: 'spawn';
      readonly blueprint: Blueprint;
      readonly team: number;
      readonly x: number;
      readonly y: number;
      readonly vx: number;
      readonly vy: number;
      readonly angle: number;
    };

export interface Logged {
  readonly step: number;
  readonly command: Command;
}

/**
 * Carry out a command. Ships and targets gone by then are passed over, as is
 * a ship told to defend itself or an enemy, to attack or ram a friend, to
 * dock with or deliver to an enemy or a friend it has no dock to mate with,
 * to scavenge with no claw, or to flee an enemy that cannot hurt it.
 */
export function give(battle: Battle, command: Command): void {
  const ships = battle.ships;
  if (command.kind === 'drop') {
    if (ships.isAlive(command.ship)) ships.dropOrder(command.ship, command.index);
    return;
  }
  if (command.kind === 'stop') {
    for (const i of command.ships) if (ships.isAlive(i)) ships.clearOrder(i);
    return;
  }
  if (command.kind === 'doctrine') {
    for (const i of command.ships) if (ships.isAlive(i)) ships.setDoctrine(i, command.part, command.field, command.value);
    return;
  }
  if (command.kind === 'resetDoctrine') {
    for (const i of command.ships) if (ships.isAlive(i)) ships.resetDoctrine(i, command.part);
    return;
  }
  if (command.kind === 'keep') {
    for (const i of command.ships) if (ships.isAlive(i)) ships.setKeep(i, command.slot, command.keep);
    return;
  }
  if (command.kind === 'remodel') {
    const to = compiled(command.blueprint);
    for (const i of command.ships) if (ships.isAlive(i)) ships.refit(battle.world, i, to);
    return;
  }
  if (command.kind === 'spawn') {
    const { blueprint, team, x, y, vx, vy, angle } = command;
    ships.spawn(battle.world, { design: compiled(blueprint), team, x, y, vx, vy, angle });
    return;
  }
  if (command.kind === 'craft') {
    const craft = command.blueprint === null ? null : compiled(command.blueprint);
    for (const i of command.ships) if (ships.isAlive(i)) ships.setCraft(i, command.slot, craft);
    return;
  }
  const order = command.order;
  if (order.kind === 'flee') {
    if (order.target !== NO_TARGET && !ships.isAlive(order.target)) return;
    for (const i of command.ships) if (ships.isAlive(i)) ships.pushFlee(i, order.target);
    return;
  }
  const errand = order.kind === 'dock' || order.kind === 'scavenge' || order.kind === 'deliver';
  const anywhere = errand && order.target === NO_TARGET;
  if (!anywhere && !ships.isAlive(order.target)) return;
  for (const i of command.ships) {
    if (!ships.isAlive(i) || i === order.target) continue;
    if (errand) {
      // A dock or delivery is to a friend; a claw can take from anyone.
      if (!anywhere && order.kind !== 'scavenge' && ships.teamOf(i) !== ships.teamOf(order.target)) continue;
      if (!command.append) ships.clearOrder(i);
      if (order.kind === 'dock') ships.pushDock(i, order.target);
      else if (order.kind === 'scavenge') ships.pushScavenge(i, order.target);
      else ships.pushDeliver(i, order.target);
      continue;
    }
    // A friend is defended and an enemy attacked, whatever a hand-written log says.
    const friend = ships.teamOf(i) === ships.teamOf(order.target);
    if (friend !== (order.kind === 'defend')) continue;
    if (!command.append) ships.clearOrder(i);
    if (order.kind === 'attack') ships.pushAttack(i, order.target, order.cancelOn, order.distance, order.speed);
    else if (order.kind === 'defend') ships.pushDefend(i, order.target, order.distance, order.speed);
    else ships.pushRam(i, order.target, order.speed, OrderCancelCondition.CompletelyDead);
  }
}

/** Each blueprint a command names, compiled once, however often it is given again. */
const designs = new WeakMap<Blueprint, ShipDesign>();
function compiled(blueprint: Blueprint): ShipDesign {
  let design = designs.get(blueprint);
  if (design === undefined) {
    design = compileBlueprint(blueprint);
    designs.set(blueprint, design);
  }
  return design;
}

const KINDS = new Set(['attack', 'defend', 'ram', 'dock', 'scavenge', 'deliver', 'flee']);
/** Orders whose target may be `NO_TARGET`. */
const ANYWHERE = new Set(['dock', 'scavenge', 'deliver', 'flee']);
const CANCELS = new Set(Object.values(OrderCancelCondition).filter((v) => typeof v === 'number'));

/** A log read back from a file or a link. Throws on one it cannot read. */
export function parseLog(value: unknown): Logged[] {
  if (!Array.isArray(value)) throw new Error('orders: not a list');
  const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
  const shipList = (v: unknown): v is number[] => Array.isArray(v) && v.every(whole);
  return value.map((entry, n) => {
    const fail = (why: string): never => {
      throw new Error(`orders[${n}]: ${why}`);
    };
    const { step, command } = (entry ?? {}) as { step?: unknown; command?: Record<string, unknown> };
    if (!whole(step)) fail('no step');
    if (typeof command !== 'object' || command === null) return fail('no command');
    if (command['kind'] === 'drop') {
      if (!whole(command['ship']) || !whole(command['index'])) fail('a drop wants a ship and an index');
    } else if (command['kind'] === 'stop') {
      if (!shipList(command['ships'])) fail('a stop wants ships');
    } else if (command['kind'] === 'doctrine') {
      const value = command['value'];
      if (!shipList(command['ships']) || !isDoctrinePart(command['part']) || typeof command['field'] !== 'string') {
        fail('a doctrine change wants ships, a part and a field');
      }
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) fail('a doctrine change wants a number or null');
    } else if (command['kind'] === 'resetDoctrine') {
      if (!shipList(command['ships']) || (command['part'] !== undefined && !isDoctrinePart(command['part']))) fail('a reset wants ships');
    } else if (command['kind'] === 'remodel' || command['kind'] === 'craft') {
      if (!shipList(command['ships'])) fail(`a ${command['kind']} wants ships`);
      if (command['kind'] === 'craft' && typeof command['slot'] !== 'string') fail('a craft wants a slot');
      const raw = command['blueprint'];
      if (!(command['kind'] === 'craft' && raw === null)) {
        try {
          return { step: step as number, command: { ...command, blueprint: parseBlueprint(raw) } as unknown as Command };
        } catch (error) {
          return fail(`its blueprint: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } else if (command['kind'] === 'spawn') {
      const number = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
      if (!Number.isInteger(command['team']) || !['x', 'y', 'vx', 'vy', 'angle'].every((k) => number(command[k]))) {
        fail('a spawn wants a team, a place, a velocity and a heading');
      }
      try {
        return { step: step as number, command: { ...command, blueprint: parseBlueprint(command['blueprint']) } as unknown as Command };
      } catch (error) {
        return fail(`its blueprint: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (command['kind'] === 'keep') {
      const keep = command['keep'];
      if (!shipList(command['ships']) || typeof command['slot'] !== 'string' || !(keep === null || whole(keep))) {
        fail('a keep wants ships, a slot and a count');
      }
    } else if (command['kind'] === 'order') {
      const order = command['order'] as Record<string, unknown> | undefined;
      if (!shipList(command['ships']) || typeof command['append'] !== 'boolean') fail('an order wants ships and append');
      const target = order?.['target'];
      const nowhere = ANYWHERE.has(order?.['kind'] as string) && target === NO_TARGET;
      if (order === undefined || !KINDS.has(order['kind'] as string) || !(whole(target) || nowhere)) fail('not an order');
      if (order!['kind'] === 'attack' && !CANCELS.has(order!['cancelOn'] as number)) fail('an attack wants cancelOn');
      const distance = order!['distance'];
      const speed = order!['speed'];
      const held = order!['kind'] === 'attack' || order!['kind'] === 'defend';
      if (distance !== undefined && !(held && typeof distance === 'number' && distance >= 0))
        fail('a distance wants an attack or defence, and 0 or more');
      if (speed !== undefined && !((held || order!['kind'] === 'ram') && typeof speed === 'number' && speed > 0)) {
        fail('a speed wants an attack, defence or ram, and more than 0');
      }
    } else fail(`unknown command ${String(command['kind'])}`);
    return { step: step as number, command: command as unknown as Command };
  });
}

/**
 * A log as a file or a link writes it: each blueprint a command carries
 * written once, in `designs`, and named by its place there.
 */
export function writeLog(log: readonly Logged[]): { orders: unknown[]; designs?: unknown[] } {
  const designs: string[] = [];
  const orders = log.map(({ step, command }) => {
    if ((command.kind !== 'remodel' && command.kind !== 'craft' && command.kind !== 'spawn') || command.blueprint === null)
      return { step, command };
    const text = JSON.stringify(serialiseBlueprint(command.blueprint));
    let at = designs.indexOf(text);
    if (at < 0) at = designs.push(text) - 1;
    return { step, command: { ...command, blueprint: at } };
  });
  return designs.length === 0 ? { orders } : { orders, designs: designs.map((text) => JSON.parse(text) as unknown) };
}

/** A log `writeLog` wrote, read back. Throws on one it cannot read. */
export function readLog(orders: unknown, designs: unknown = []): Logged[] {
  if (!Array.isArray(orders) || !Array.isArray(designs)) throw new Error('orders: not a list');
  const resolved = orders.map((entry: unknown) => {
    const command = (entry as { command?: Record<string, unknown> } | null)?.command;
    const at = command?.['blueprint'];
    if (typeof at !== 'number') return entry;
    if (!Number.isInteger(at) || designs[at] === undefined) throw new Error(`orders: no design ${at}`);
    return { ...(entry as object), command: { ...command, blueprint: designs[at] } };
  });
  return parseLog(resolved);
}
