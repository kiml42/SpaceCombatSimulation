import type { ShipDesign } from "./blueprint.js";
import { fillOf, ROBOT_REPAIR_RATE, shotFuel } from "./modules.js";
import { buildWork, fittingOf } from "./rebuild.js";

/**
 * What a design costs, in the three things a fleet is made of: metal, fuel
 * and the time to build it. Charge is left out: it is paid for in time, made
 * in what the build leaves before the battle (`readying.ts`).
 */
export interface Bill {
    /** Its hull, fittings, the metal in its holds and its guns' first rounds, kg. */
    readonly metal: number;
    /** The fuel in its tanks and its guns' first rounds, kg. */
    readonly fuel: number;
    /** How long one robot would take to build every module, s, travel aside. */
    readonly build: number;
}

/**
 * The most a design or a fleet may cost; `Infinity` for no limit on that one.
 * Its `build` is the time before the battle, s: a yard of `n` robots
 * (`Yard`) builds `n` times as much in it.
 */
export type Budget = Bill;

export const NO_BUDGET: Budget = { metal: Infinity, fuel: Infinity, build: Infinity };
export const NO_BILL: Bill = { metal: 0, fuel: 0, build: 0 };

/** What a design costs as it sets out: the metal and fuel of every fighter it carries too, but not their build. */
export function billOf(design: ShipDesign): Bill {
    let fuel = 0;
    let work = 0;
    for (const module of design.modules) {
        fuel += module.stats.fuel * fillOf(module.spec);
        work += buildWork(module.stats) * (module.stats.structureMass + fittingOf(module.stats));
    }
    let rounds = 0;
    for (const mount of design.turrets) rounds += shotFuel(mount.gun);
    const own: Bill = { metal: design.launchMass - fuel, fuel: fuel + rounds, build: work / ROBOT_REPAIR_RATE };
    // A fighter it sets out with is its pad's to build, in the time before the battle (`readying.ts`).
    let bill = own;
    for (const aboard of design.aboard ?? []) bill = addBills(bill, { ...billOf(aboard.design), build: 0 });
    return bill;
}

export function addBills(a: Bill, b: Bill): Bill {
    return { metal: a.metal + b.metal, fuel: a.fuel + b.fuel, build: a.build + b.build };
}

/** Whether a bill is within a budget, in every one of the three, built by `robots` robots. */
export function affords(budget: Budget, bill: Bill, robots = 1): boolean {
    return bill.metal <= budget.metal && bill.fuel <= budget.fuel && bill.build <= budget.build * robots;
}

/** Whether a budget limits anything at all. */
export function isLimited(budget: Budget): boolean {
    return budget.metal !== Infinity || budget.fuel !== Infinity || budget.build !== Infinity;
}
