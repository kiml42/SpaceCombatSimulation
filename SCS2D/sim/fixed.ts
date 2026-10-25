/**
 * Arrays a body's record is given once and never written into again, only
 * replaced whole: what a copy of a battle shares with its original rather
 * than copying (`scenarios/clone.ts`), as it shares designs.
 *
 * Mark one only if nothing writes into it after it is made; a marked array
 * written into would change every copy at once. `tests/clone.test.ts` checks
 * that none is.
 */
const marked = new WeakSet<object>();

export function fixed<T extends object>(value: T): T {
    marked.add(value);
    return value;
}

export function isFixed(value: object): boolean {
    return marked.has(value);
}
