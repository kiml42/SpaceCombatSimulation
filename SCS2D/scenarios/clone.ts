import type { Battle } from './types.js';

/**
 * A copy of a battle that steps on as the original would, with nothing in
 * common but what never changes. What a rewind checkpoint is made of.
 *
 * Everything reachable is copied, keeping each object's prototype and which
 * objects are the same object, except:
 *
 * - **Designs**, and all they reach, which are never changed once made: a
 *   ship rebuilt or refitted gets a new design. Sharing them keeps the caches
 *   keyed on them (the module-level and `Ships`' `WeakMap`s) working.
 * - **`WeakMap`s and `WeakSet`s**, which cannot be walked. Those in the sim are
 *   caches whose entries follow from their key, so sharing them is safe.
 * - **Functions**, which cannot be copied. One closing over what changes would
 *   keep reaching into the original, which is why `Battle.step`, a force
 *   provider with state and Damage's shed visitor go through `this` instead.
 *
 * A copy that drifts from its original fails `tests/clone.test.ts`.
 */
export function cloneBattle<T extends Battle>(battle: T): T {
  return clone(battle, new Map()) as T;
}

/** Designs met so far, and everything reachable from them: never copied. */
const shared = new WeakSet<object>();

/** A `ShipDesign`, by what only a compiled design carries. */
function isDesign(value: object): boolean {
  return 'engineLayout' in value && 'modules' in value && 'launchMass' in value;
}

function share(value: unknown): void {
  if (typeof value !== 'object' || value === null || shared.has(value)) return;
  shared.add(value);
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
  if (value instanceof Map) {
    for (const [k, v] of value) {
      share(k);
      share(v);
    }
  } else if (value instanceof Set) {
    for (const v of value) share(v);
  } else {
    for (const key of Reflect.ownKeys(value)) {
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      if ('value' in property) share(property.value);
    }
  }
}

function clone(value: unknown, copies: Map<object, unknown>): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (shared.has(value)) return value;
  const known = copies.get(value);
  if (known !== undefined) return known;

  if (value instanceof ArrayBuffer) {
    const copy = value.slice(0);
    copies.set(value, copy);
    return copy;
  }
  if (ArrayBuffer.isView(value)) {
    // Through the buffer, so views onto one buffer stay onto one buffer.
    const buffer = clone(value.buffer, copies) as ArrayBuffer;
    const View = value.constructor as new (buffer: ArrayBuffer, offset: number, length: number) => ArrayBufferView;
    const length = value instanceof DataView ? value.byteLength : (value as unknown as { length: number }).length;
    const copy = new View(buffer, value.byteOffset, length);
    copies.set(value, copy);
    return copy;
  }
  if (value instanceof WeakMap || value instanceof WeakSet) return value;
  if (value instanceof Map) {
    const copy = new Map();
    copies.set(value, copy);
    for (const [k, v] of value) copy.set(clone(k, copies), clone(v, copies));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set();
    copies.set(value, copy);
    for (const v of value) copy.add(clone(v, copies));
    return copy;
  }
  if (isDesign(value)) {
    share(value);
    return value;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null && !isClassInstance(value)) {
    throw new Error(`cloneBattle: cannot copy a ${value.constructor?.name ?? 'built-in object'}`);
  }
  const copy = Array.isArray(value) ? new Array<unknown>(value.length) : Object.create(prototype);
  copies.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in property)) {
      Object.defineProperty(copy, key, property);
    } else if (property.writable && property.enumerable && property.configurable) {
      (copy as Record<PropertyKey, unknown>)[key] = clone(property.value, copies);
    } else {
      Object.defineProperty(copy, key, { ...property, value: clone(property.value, copies) });
    }
  }
  return copy;
}

/** An instance of a class of ours, rather than a built-in with hidden state (a Date, a Promise). */
function isClassInstance(value: object): boolean {
  let prototype = Object.getPrototypeOf(value) as object | null;
  while (prototype !== null && prototype !== Object.prototype) {
    const made = (prototype as { constructor?: unknown }).constructor;
    if (typeof made === 'function' && /\{\s*\[native code\]\s*\}$/.test(Function.prototype.toString.call(made))) {
      return false;
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  return true;
}
