import { OrderCancelCondition } from '../sim/ships.js';
import type { Battle } from './types.js';

/**
 * What a player can tell ships mid-battle, as commands: given to the battle
 * at a step, logged, and given again at the same step whenever the battle is
 * re-simulated, so a rewind or a shared link plays the orders as they were
 * given (ROADMAP.md §12). Ships are named by index, which a deterministic
 * battle gives the same ship every time.
 */

export type Order =
  | { readonly kind: 'attack'; readonly target: number; readonly cancelOn: OrderCancelCondition }
  | { readonly kind: 'defend'; readonly target: number }
  | { readonly kind: 'ram'; readonly target: number };

export type Command =
  /** The same order to each ship, replacing its queue, or after it if `append`. */
  | { readonly kind: 'order'; readonly ships: readonly number[]; readonly order: Order; readonly append: boolean }
  /** Take back one order, by its place in the ship's queue. */
  | { readonly kind: 'drop'; readonly ship: number; readonly index: number }
  /** Clear each ship's queue, handing it back to its doctrine. */
  | { readonly kind: 'stop'; readonly ships: readonly number[] };

export interface Logged {
  readonly step: number;
  readonly command: Command;
}

/**
 * Carry out a command. Ships and targets gone by then are passed over, as is
 * a ship told to defend itself or an enemy, or to attack or ram a friend.
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
  const order = command.order;
  if (!ships.isAlive(order.target)) return;
  for (const i of command.ships) {
    if (!ships.isAlive(i) || i === order.target) continue;
    // A friend is defended and an enemy attacked, whatever a hand-written log says.
    const friend = ships.teamOf(i) === ships.teamOf(order.target);
    if (friend !== (order.kind === 'defend')) continue;
    if (!command.append) ships.clearOrder(i);
    if (order.kind === 'attack') ships.pushAttack(i, order.target, order.cancelOn);
    else if (order.kind === 'defend') ships.pushDefend(i, order.target);
    else ships.pushRam(i, order.target, undefined, OrderCancelCondition.CompletelyDead);
  }
}

const KINDS = new Set(['attack', 'defend', 'ram']);
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
    } else if (command['kind'] === 'order') {
      const order = command['order'] as Record<string, unknown> | undefined;
      if (!shipList(command['ships']) || typeof command['append'] !== 'boolean') fail('an order wants ships and append');
      if (order === undefined || !KINDS.has(order['kind'] as string) || !whole(order['target'])) fail('not an order');
      if (order!['kind'] === 'attack' && !CANCELS.has(order!['cancelOn'] as number)) fail('an attack wants cancelOn');
    } else fail(`unknown command ${String(command['kind'])}`);
    return { step: step as number, command: command as unknown as Command };
  });
}
