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
  return sizedClone(battle).copy;
}

/** The same, with roughly how many bytes the copy holds: what a checkpoint costs to keep. */
export function sizedClone<T extends Battle>(battle: T): { copy: T; bytes: number } {
  const into: Into = { copies: new Map(), bytes: 0 };
  return { copy: clone(battle, into) as T, bytes: into.bytes };
}

interface Into {
  copies: Map<object, unknown>;
  bytes: number;
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

function clone(value: unknown, into: Into): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (shared.has(value)) return value;
  const copies = into.copies;
  const known = copies.get(value);
  if (known !== undefined) return known;

  if (value instanceof ArrayBuffer) {
    const copy = value.slice(0);
    copies.set(value, copy);
    into.bytes += value.byteLength;
    return copy;
  }
  if (ArrayBuffer.isView(value)) {
    // Through the buffer, so views onto one buffer stay onto one buffer; one
    // that is all of a buffer not met yet, as nearly all are, in one go.
    const whole = value.byteOffset === 0 && value.byteLength === value.buffer.byteLength;
    if (whole && !(value instanceof DataView) && !copies.has(value.buffer)) {
      const copy = (value as unknown as { slice(): ArrayBufferView }).slice();
      copies.set(value, copy);
      copies.set(value.buffer, copy.buffer);
      into.bytes += value.byteLength;
      return copy;
    }
    const buffer = clone(value.buffer, into) as ArrayBuffer;
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
    for (const [k, v] of value) copy.set(clone(k, into), clone(v, into));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set();
    copies.set(value, copy);
    for (const v of value) copy.add(clone(v, into));
    return copy;
  }
  if (isDesign(value)) {
    share(value);
    return value;
  }

  if (Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype) {
    // By index: walking an array's keys as an object's is most of the cost of a copy.
    const copy = new Array<unknown>(value.length);
    copies.set(value, copy);
    into.bytes += 16 + 8 * value.length;
    for (let i = 0; i < value.length; i++) {
      const item: unknown = value[i];
      copy[i] = typeof item === 'object' && item !== null ? clone(item, into) : item;
    }
    return copy;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null && !isClassInstance(prototype)) {
    throw new Error(`cloneBattle: cannot copy a ${value.constructor?.name ?? 'built-in object'}`);
  }
  const copy = Array.isArray(value) ? new Array<unknown>(value.length) : Object.create(prototype);
  copies.set(value, copy);
  const keys = Reflect.ownKeys(value);
  // A slot a key, and a little for the object itself: a guess, but in proportion.
  into.bytes += 16 + 8 * keys.length;
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in property)) {
      Object.defineProperty(copy, key, property);
    } else if (property.writable && property.enumerable && property.configurable) {
      (copy as Record<PropertyKey, unknown>)[key] = clone(property.value, into);
    } else {
      Object.defineProperty(copy, key, { ...property, value: clone(property.value, into) });
    }
  }
  return copy;
}

/** Prototypes already asked about. */
const ours = new WeakMap<object, boolean>();

/** The prototype of a class of ours, rather than a built-in with hidden state (a Date, a Promise). */
function isClassInstance(prototype: object): boolean {
  const known = ours.get(prototype);
  if (known !== undefined) return known;
  let answer = true;
  for (let p: object | null = prototype; p !== null && p !== Object.prototype; p = Object.getPrototypeOf(p) as object | null) {
    const made = (p as { constructor?: unknown }).constructor;
    if (typeof made === 'function' && /\{\s*\[native code\]\s*\}$/.test(Function.prototype.toString.call(made))) {
      answer = false;
      break;
    }
  }
  ours.set(prototype, answer);
  return answer;
}
