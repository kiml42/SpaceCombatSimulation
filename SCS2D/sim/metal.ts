import type { ShipDesign } from "./blueprint.js";
import { Store } from "./store.js";

/**
 * What every body has left in its holds, and its cores' share of metal.
 *
 * A gun loads each round straight from the holds on its own piece of hull, the
 * whole round at once (`load`), as an engine draws fuel from its tanks. A
 * loaded round is off the holds but still aboard, by the gun's module, until
 * it is fired (`unload`).
 */
export class Metal extends Store {
    /** Kilograms loaded into each module's gun. */
    private readonly loaded: (Float64Array | null)[] = [];
    /** What each loaded round took off the stores' moment of inertia, kg·m². */
    private readonly loadedSpin: (Float64Array | null)[] = [];

    constructor() {
        super(
            (stats) => stats.metal,
            () => 0,
        );
    }

    /** `Store.register`, with what each module's gun has `loaded`, kg, for a body made from another. */
    override register(bodyIndex: number, design: ShipDesign, carried?: readonly number[], loaded?: readonly number[]): void {
        super.register(bodyIndex, design, carried);
        const n = design.modules.length;
        const kg = new Float64Array(n);
        const spin = new Float64Array(n);
        for (let m = 0; m < n && loaded !== undefined; m++) {
            kg[m] = loaded[m] ?? 0;
            spin[m] = kg[m]! * this.spin[bodyIndex]![m]!;
            this.spent[bodyIndex] = this.spent[bodyIndex]! - kg[m]!;
            this.spentSpin[bodyIndex] = this.spentSpin[bodyIndex]! - spin[m]!;
        }
        this.loaded[bodyIndex] = kg;
        this.loadedSpin[bodyIndex] = spin;
    }

    /**
     * Load a round of `kg` into the gun at module `mount`, if its piece of hull
     * has that much, and say whether it did. Never part of a round.
     */
    load(bodyIndex: number, mount: number, kg: number): boolean {
        if (!(kg > 0)) return true;
        if (this.pieceHeld(bodyIndex, mount) < kg) return false;
        // Still aboard, so the hull weighs what it did.
        const spent = this.spent[bodyIndex]!;
        const spin = this.spentSpin[bodyIndex]!;
        this.drain(bodyIndex, mount, kg);
        this.loaded[bodyIndex]![mount] = this.loaded[bodyIndex]![mount]! + kg;
        this.loadedSpin[bodyIndex]![mount] = this.loadedSpin[bodyIndex]![mount]! + this.spentSpin[bodyIndex]! - spin;
        this.spent[bodyIndex] = spent;
        this.spentSpin[bodyIndex] = spin;
        return true;
    }

    /** Take the round out of the gun at module `mount`, as it is fired, and say what it weighed. */
    unload(bodyIndex: number, mount: number): number {
        const loaded = this.loaded[bodyIndex];
        const kg = loaded?.[mount] ?? 0;
        if (!(kg > 0)) return 0;
        loaded![mount] = 0;
        this.spent[bodyIndex] = this.spent[bodyIndex]! + kg;
        this.spentSpin[bodyIndex] = this.spentSpin[bodyIndex]! + this.loadedSpin[bodyIndex]![mount]!;
        this.loadedSpin[bodyIndex]![mount] = 0;
        return kg;
    }

    /** Kilograms loaded into the gun at module `mount`. */
    loadedAt(bodyIndex: number, mount: number): number {
        return this.loaded[bodyIndex]?.[mount] ?? 0;
    }

    override forget(bodyIndex: number): void {
        super.forget(bodyIndex);
        this.loaded[bodyIndex] = null;
        this.loadedSpin[bodyIndex] = null;
    }
}
