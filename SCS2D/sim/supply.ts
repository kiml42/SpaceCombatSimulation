import type { ShipDesign } from "./blueprint.js";
import type { Approach } from "./doctrine.js";
import { round } from "./math.js";
import type { Store } from "./store.js";

/**
 * Who gets a ship's fuel, metal and charge when there is not enough to go
 * round (DESIGN.md §7, "What a ship spends on first").
 *
 * Everything that draws on a piece of hull's stores does so as one of a fixed
 * set of claims, and the ship's doctrine gives each claim a priority and a
 * share (`<claim>Priority`, `<claim>Share`). A higher priority is served in
 * full before a lower one gets any; claims of one priority split what is left
 * by share. What a claim asks for is what it wants in all — a fighter on a
 * pad the room it has, a robot bay the metal for the robots it is short of —
 * not just this step's draw, so a lower priority waits until a higher one is
 * done rather than merely slowed.
 *
 * Its own engines, weapons and mending may draw on the reserves; nothing
 * else may.
 */

/** Every claim, in the order their doctrine fields are named. */
export const CLAIMS = [
    "thrust",
    "fire",
    "pads",
    "ports",
    "robots",
    "slipway",
    "mendCore",
    "mendBays",
    "mendEngines",
    "mendMain",
    "mendSecondary",
    "mendStores",
    "mendGenerators",
    "mendHangar",
    "mendClaws",
    "mendStructure",
] as const;

export type ClaimName = (typeof CLAIMS)[number];

export const enum Claim {
    Thrust = 0,
    Fire = 1,
    Pads = 2,
    Ports = 3,
    Robots = 4,
    Slipway = 5,
    MendCore = 6,
    MendBays = 7,
    MendEngines = 8,
    MendMain = 9,
    MendSecondary = 10,
    MendStores = 11,
    MendGenerators = 12,
    MendHangar = 13,
    MendClaws = 14,
    MendStructure = 15,
}

const COUNT = CLAIMS.length;

/** The claims that may draw on the reserves: the ship's own engines, weapons and mending. */
function own(claim: number): boolean {
    return claim === Claim.Thrust || claim === Claim.Fire || claim >= Claim.MendCore;
}

/** Which resource a store is to `Supply`: fuel, metal, charge. */
export const enum Resource {
    Fuel = 0,
    Metal = 1,
    Charge = 2,
}

const RESOURCES = 3;

/** The claim mending module `m` of `design` draws as. */
export function mendClaim(design: ShipDesign, m: number): Claim {
    const kind = design.modules[m]!.spec.kind;
    switch (kind) {
        case "core":
            return Claim.MendCore;
        case "robotBay":
            return Claim.MendBays;
        case "engine":
            return Claim.MendEngines;
        case "tank":
        case "hold":
        case "battery":
            return Claim.MendStores;
        case "generator":
            return Claim.MendGenerators;
        case "pad":
        case "slipway":
        case "port":
            return Claim.MendHangar;
        case "claw":
            return Claim.MendClaws;
    }
    for (let t = 0; t < design.turrets.length; t++) {
        const mount = design.turrets[t]!;
        if (mount.module === m) return mount.main ? Claim.MendMain : Claim.MendSecondary;
    }
    return Claim.MendStructure;
}

/** A claim's priority, as a whole number: higher is served first. */
export function priorityOf(approach: Approach, claim: number): number {
    return round(approach[`${CLAIMS[claim]!}Priority`]);
}

/** A claim's share of what its priority gets. */
export function shareOf(approach: Approach, claim: number): number {
    const share = approach[`${CLAIMS[claim]!}Share`];
    return share > 0 ? share : 0;
}

/** One body's books: per piece of hull, per resource, per claim. */
interface Books {
    /** The stores' layout these were sized for; a new one means the hull changed. */
    readonly layout: object;
    readonly pieces: number;
    /** What each claim asked for this step. */
    readonly asked: Float64Array;
    /** What each claim asked for last step, which this step is shared out by. */
    readonly wanted: Float64Array;
    /** What each claim may still take this step before it eats into anyone else's. */
    readonly left: Float64Array;
    /** The step each piece's resource was last shared out on. */
    readonly stamp: Float64Array;
}

/**
 * Shares out each piece of hull's stores among the claims on it, a step at a
 * time. A claim says what it wants and is told what it may take (`allow`),
 * then says what it took (`took`).
 *
 * Shared out at the first ask of a step, by what each claim asked for the
 * step before. One that asks for the first time takes from what nobody wanted
 * then; it is served by its priority from the next.
 */
export class Supply {
    private readonly books: (Books | null)[] = [];
    private readonly priority = new Float64Array(COUNT);
    private readonly share = new Float64Array(COUNT);
    private readonly order = new Int32Array(COUNT);
    private readonly room = new Float64Array(COUNT);

    constructor(private readonly stores: readonly [Store, Store, Store]) {}

    /**
     * How much `claim` may take now of resource `r` from the piece of hull
     * module `m` of body `b` is on, as a ship of doctrine `approach` keeping
     * `reserve` back sees it, on step `tick`. Notes that it wants `want` in all.
     */
    allow(b: number, r: Resource, m: number, claim: Claim, want: number, reserve: number, approach: Approach, tick: number): number {
        const store = this.stores[r];
        const books = this.booksOf(b, store);
        if (books === null) return 0;
        const piece = store.pieceAt(b, m);
        if (piece < 0) return 0;
        const at = (piece * RESOURCES + r) * COUNT;
        this.rank(approach);
        if (books.stamp[piece * RESOURCES + r] !== tick) {
            const fresh = books.stamp[piece * RESOURCES + r] === tick - 1;
            for (let c = 0; c < COUNT; c++) {
                books.wanted[at + c] = fresh ? books.asked[at + c]! : 0;
                books.asked[at + c] = 0;
            }
            books.stamp[piece * RESOURCES + r] = tick;
            this.shareOut(books, at, store.offered(b, m), reserve);
        }
        if (want > 0) books.asked[at + claim] = books.asked[at + claim]! + want;

        // What is there, less what claims at least as pressing still have coming;
        // the reserve holding what own claims have coming first.
        const held = store.offered(b, m);
        const mine = this.priority[claim]!;
        let ownAhead = 0;
        let othersAhead = 0;
        for (let c = 0; c < COUNT; c++) {
            if (c === claim || this.priority[c]! < mine) continue;
            if (own(c)) ownAhead += books.left[at + c]!;
            else othersAhead += books.left[at + c]!;
        }
        const avail = own(claim) ? held - ownAhead - othersAhead : held - (reserve > ownAhead ? reserve : ownAhead) - othersAhead;
        return avail > 0 ? avail : 0;
    }

    /** Note that `claim` took `amount` of resource `r` from module `m`'s piece of body `b`. */
    took(b: number, r: Resource, m: number, claim: Claim, amount: number): void {
        const books = this.books[b];
        if (books === null || books === undefined || !(amount > 0)) return;
        const piece = this.stores[r].pieceAt(b, m);
        if (piece < 0 || piece >= books.pieces) return;
        const k = (piece * RESOURCES + r) * COUNT + claim;
        const left = books.left[k]! - amount;
        books.left[k] = left > 0 ? left : 0;
    }

    forget(b: number): void {
        this.books[b] = null;
    }

    private booksOf(b: number, store: Store): Books | null {
        const layout = store.layoutOf(b);
        if (layout === null) return null;
        const books = this.books[b];
        if (books !== null && books !== undefined && books.layout === layout) return books;
        const pieces = store.piecesOf(b);
        const n = pieces * RESOURCES * COUNT;
        const fresh: Books = {
            layout,
            pieces,
            asked: new Float64Array(n),
            wanted: new Float64Array(n),
            left: new Float64Array(n),
            stamp: new Float64Array(pieces * RESOURCES).fill(-1),
        };
        this.books[b] = fresh;
        return fresh;
    }

    /** Each claim's priority and share, and the claims from first served to last. */
    private rank(approach: Approach): void {
        for (let c = 0; c < COUNT; c++) {
            this.priority[c] = priorityOf(approach, c);
            this.share[c] = shareOf(approach, c);
            this.order[c] = c;
        }
        // Insertion sort, highest priority first, ties in claim order.
        for (let k = 1; k < COUNT; k++) {
            const c = this.order[k]!;
            let j = k - 1;
            while (j >= 0 && this.priority[this.order[j]!]! < this.priority[c]!) {
                this.order[j + 1] = this.order[j]!;
                j--;
            }
            this.order[j + 1] = c;
        }
    }

    /**
     * Share `held` out among the claims at `at`, by what each wanted last step:
     * priority by priority, own claims first from the `reserve`, then the rest
     * by share among all of a priority.
     */
    private shareOut(books: Books, at: number, held: number, reserve: number): void {
        const kept = reserve < held ? (reserve > 0 ? reserve : 0) : held;
        let fromReserve = kept;
        let free = held - kept;
        let k = 0;
        while (k < COUNT) {
            const p = this.priority[this.order[k]!]!;
            let end = k;
            while (end < COUNT && this.priority[this.order[end]!]! === p) end++;
            for (let j = k; j < end; j++) {
                const c = this.order[j]!;
                const want = books.wanted[at + c]!;
                let given = 0;
                if (own(c) && fromReserve > 0 && want > 0) {
                    given = want < fromReserve ? want : fromReserve;
                    fromReserve -= given;
                }
                books.left[at + c] = given;
                this.room[c] = want - given;
            }
            free -= this.fill(books, at, k, end, free);
            k = end;
        }
    }

    /**
     * Pour `pool` into the claims `order[from..to)` in proportion to share, none
     * past what it still has room for, and say how much went.
     */
    private fill(books: Books, at: number, from: number, to: number, pool: number): number {
        let left = pool;
        for (let pass = from; pass < to && left > 1e-12; pass++) {
            let shares = 0;
            let open = 0;
            for (let j = from; j < to; j++) {
                const c = this.order[j]!;
                if (!(this.room[c]! > 0)) continue;
                shares += this.share[c]!;
                open++;
            }
            if (open === 0) break;
            let given = 0;
            for (let j = from; j < to; j++) {
                const c = this.order[j]!;
                const room = this.room[c]!;
                if (!(room > 0)) continue;
                const part = shares > 0 ? (left * this.share[c]!) / shares : left / open;
                // A claim of no share gets only what those with a share leave.
                if (shares > 0 && !(this.share[c]! > 0)) continue;
                const give = part < room ? part : room;
                books.left[at + c] = books.left[at + c]! + give;
                this.room[c] = room - give;
                given += give;
            }
            left -= given;
            if (!(given > 0)) break;
        }
        return pool - left;
    }
}
