import type { Store } from "./store.js";

/**
 * Who gets a ship's fuel, metal and charge when there is not enough to go
 * round (DESIGN.md §7, "What a ship spends on first").
 *
 * Every part has a priority (`partPriority`). What a part draws for its work —
 * an engine's fuel, a gun's rounds, a pad's fighter — and mending it are both
 * claimed at that priority. A higher priority is served in full before a lower
 * one gets any; claims of one priority split what is left in proportion to
 * what each still wants. What a claim asks for is what it wants in all — a
 * fighter on a pad the room it has, a robot bay the metal for the robots it is
 * short of — not just this step's draw, so a lower priority waits until a
 * higher one is done rather than merely slowed.
 *
 * Its own engines, weapons and mending may draw on the reserves; nothing
 * else may.
 */

/** What a part draws for, which says whether it may draw on the reserves. */
export const enum Claim {
    Thrust = 0,
    Fire = 1,
    Pads = 2,
    Ports = 3,
    Robots = 4,
    Slipway = 5,
    Mend = 6,
}

/** Whether a claim may draw on the reserves: the ship's own engines, weapons and mending. */
function own(claim: Claim): boolean {
    return claim === Claim.Thrust || claim === Claim.Fire || claim === Claim.Mend;
}

/** Which resource a store is to `Supply`: fuel, metal, charge. */
export const enum Resource {
    Fuel = 0,
    Metal = 1,
    Charge = 2,
}

const RESOURCES = 3;

/**
 * One body's books. A slot is a module's work (`2m`) or its mending
 * (`2m + 1`); a line is a slot's, of one resource (`slot * RESOURCES + r`).
 */
interface Books {
    /** The stores' layout these were sized for; a new one means the hull changed. */
    readonly layout: object;
    readonly slots: number;
    /** What each line asked for this step. */
    readonly asked: Float64Array;
    /** What each line asked for last step, which this step is shared out by. */
    readonly wanted: Float64Array;
    /** What each line may still take this step before it eats into anyone else's. */
    readonly left: Float64Array;
    /** Each slot's priority and whether it is the ship's own, as last asked. */
    readonly priority: Float64Array;
    readonly own: Uint8Array;
    /** The step each piece's resource was last shared out on. */
    readonly stamp: Float64Array;
    /** Per piece and resource, the lines that asked this step, chained through `askNext`. */
    readonly askHead: Int32Array;
    readonly askNext: Int32Array;
    readonly askStamp: Float64Array;
    /** Per piece and resource, the lines given anything this step, first served first, chained through `next`. */
    readonly head: Int32Array;
    readonly next: Int32Array;
}

/**
 * Shares out each piece of hull's stores among the parts drawing on it, a step
 * at a time. A part says what it wants and is told what it may take
 * (`allow`), then says what it took (`took`).
 *
 * Shared out at the first ask of a step, by what each asked for the step
 * before. One that asks for the first time takes from what nobody wanted
 * then; it is served by its priority from the next.
 */
export class Supply {
    /** By resource, then body: each store is laid out on its own, so each keeps its own books. */
    private readonly books: (Books | null)[][] = [[], [], []];

    constructor(private readonly stores: readonly [Store, Store, Store]) {}

    /**
     * How much module `m` of body `b` may take now of resource `r` from its
     * piece of hull, drawing for `claim` at `priority`, with `reserve` kept
     * back, on step `tick`. Notes that it wants `want` in all.
     */
    allow(b: number, r: Resource, m: number, claim: Claim, priority: number, want: number, reserve: number, tick: number): number {
        const store = this.stores[r];
        const books = this.booksOf(b, r, store);
        if (books === null) return 0;
        const piece = store.pieceAt(b, m);
        const slot = 2 * m + (claim === Claim.Mend ? 1 : 0);
        if (piece < 0 || slot >= books.slots) return 0;
        const at = piece * RESOURCES + r;
        if (books.stamp[at] !== tick) {
            this.shareOut(books, at, r, books.stamp[at] === tick - 1, store.offered(b, m), reserve);
            books.stamp[at] = tick;
        }
        const mine = own(claim);
        books.priority[slot] = priority;
        books.own[slot] = mine ? 1 : 0;
        const line = slot * RESOURCES + r;
        if (want > 0) {
            if (books.askStamp[line] !== tick) {
                books.askStamp[line] = tick;
                books.askNext[line] = books.askHead[at]!;
                books.askHead[at] = line;
            }
            books.asked[line] = books.asked[line]! + want;
        }

        // What is there, less what claims at least as pressing still have coming;
        // the reserve holding what own claims have coming first.
        const held = store.offered(b, m);
        let ownAhead = 0;
        let othersAhead = 0;
        for (let l = books.head[at]!; l >= 0; l = books.next[l]!) {
            const s = (l - r) / RESOURCES;
            if (l === line || books.priority[s]! < priority) continue;
            if (books.own[s] === 1) ownAhead += books.left[l]!;
            else othersAhead += books.left[l]!;
        }
        const avail = mine ? held - ownAhead - othersAhead : held - (reserve > ownAhead ? reserve : ownAhead) - othersAhead;
        return avail > 0 ? avail : 0;
    }

    /** Note that module `m` of body `b`, drawing for `claim`, took `amount` of resource `r`. */
    took(b: number, r: Resource, m: number, claim: Claim, amount: number): void {
        const books = this.books[r]![b];
        if (books === null || books === undefined || !(amount > 0)) return;
        const slot = 2 * m + (claim === Claim.Mend ? 1 : 0);
        if (slot >= books.slots) return;
        const line = slot * RESOURCES + r;
        const left = books.left[line]! - amount;
        books.left[line] = left > 0 ? left : 0;
    }

    forget(b: number): void {
        for (const byBody of this.books) byBody[b] = null;
    }

    private booksOf(b: number, r: Resource, store: Store): Books | null {
        const layout = store.layoutOf(b);
        if (layout === null) return null;
        const books = this.books[r]![b];
        if (books !== null && books !== undefined && books.layout === layout) return books;
        const lists = store.piecesOf(b) * RESOURCES;
        const slots = 2 * store.modulesOf(b);
        const lines = slots * RESOURCES;
        const fresh: Books = {
            layout,
            slots,
            asked: new Float64Array(lines),
            wanted: new Float64Array(lines),
            left: new Float64Array(lines),
            priority: new Float64Array(slots),
            own: new Uint8Array(slots),
            stamp: new Float64Array(lists).fill(-1),
            askHead: new Int32Array(lists).fill(-1),
            askNext: new Int32Array(lines).fill(-1),
            askStamp: new Float64Array(lines).fill(-1),
            head: new Int32Array(lists).fill(-1),
            next: new Int32Array(lines).fill(-1),
        };
        this.books[r]![b] = fresh;
        return fresh;
    }

    /**
     * Share `held` out among the lines of piece-and-resource `at`, by what each
     * asked for last step (none if `fresh` is false, the books having missed a
     * step): priority by priority, own claims first from the `reserve`, then
     * all of a priority in proportion to what each still wants.
     */
    private shareOut(books: Books, at: number, r: Resource, fresh: boolean, held: number, reserve: number): void {
        for (let l = books.head[at]!; l >= 0; l = books.next[l]!) books.left[l] = 0;
        books.head[at] = -1;
        // Last step's asks, into `head` in the order they are served:
        // highest priority first, ties by slot.
        for (let l = books.askHead[at]!; l >= 0;) {
            const after = books.askNext[l]!;
            const want = fresh ? books.asked[l]! : 0;
            books.asked[l] = 0;
            books.askStamp[l] = -1;
            books.wanted[l] = want;
            if (want > 0) this.insert(books, at, r, l);
            l = after;
        }
        books.askHead[at] = -1;

        const kept = reserve < held ? (reserve > 0 ? reserve : 0) : held;
        let fromReserve = kept;
        let free = held - kept;
        let l = books.head[at]!;
        while (l >= 0) {
            const p = books.priority[(l - r) / RESOURCES]!;
            let room = 0;
            let end = l;
            for (; end >= 0 && books.priority[(end - r) / RESOURCES] === p; end = books.next[end]!) {
                const want = books.wanted[end]!;
                let given = 0;
                if (books.own[(end - r) / RESOURCES] === 1 && fromReserve > 0) {
                    given = want < fromReserve ? want : fromReserve;
                    fromReserve -= given;
                }
                books.left[end] = given;
                books.wanted[end] = want - given;
                room += want - given;
            }
            const scale = free >= room ? 1 : free > 0 ? free / room : 0;
            for (let k = l; k !== end; k = books.next[k]!) books.left[k] = books.left[k]! + books.wanted[k]! * scale;
            free -= room * scale;
            l = end;
        }
    }

    /** Put `line` into the served order of `at`. */
    private insert(books: Books, at: number, r: Resource, line: number): void {
        const p = books.priority[(line - r) / RESOURCES]!;
        let before = -1;
        let k = books.head[at]!;
        while (k >= 0) {
            const q = books.priority[(k - r) / RESOURCES]!;
            if (q < p || (q === p && k > line)) break;
            before = k;
            k = books.next[k]!;
        }
        books.next[line] = k;
        if (before < 0) books.head[at] = line;
        else books.next[before] = line;
    }
}
