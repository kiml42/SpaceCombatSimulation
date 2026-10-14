import type { ShipDesign } from './blueprint.js';
import { fillOf, ROBOT_REPAIR_RATE } from './modules.js';
import { buildWork, fittingOf } from './rebuild.js';

/**
 * What a design costs, in the three things a fleet is made of: metal, fuel
 * and the time to build it. Charge is left out: batteries set out full and
 * cost nothing to fill.
 */
export interface Bill {
  /** Its hull, fittings and the metal in its holds, kg. */
  readonly metal: number;
  /** The fuel in its tanks, kg. */
  readonly fuel: number;
  /** How long one robot would take to build every module, s, travel aside. */
  readonly build: number;
}

/** The most a design or a fleet may cost; `Infinity` for no limit on that one. */
export type Budget = Bill;

export const NO_BUDGET: Budget = { metal: Infinity, fuel: Infinity, build: Infinity };
export const NO_BILL: Bill = { metal: 0, fuel: 0, build: 0 };

/** What a design costs as it sets out, every fighter it carries included. */
export function billOf(design: ShipDesign): Bill {
  let fuel = 0;
  let work = 0;
  for (const module of design.modules) {
    fuel += module.stats.fuel * fillOf(module.spec);
    work += buildWork(module.stats) * (module.stats.structureMass + fittingOf(module.stats));
  }
  const own: Bill = { metal: design.launchMass - fuel, fuel, build: work / ROBOT_REPAIR_RATE };
  let bill = own;
  for (const aboard of design.aboard ?? []) bill = addBills(bill, billOf(aboard.design));
  return bill;
}

export function addBills(a: Bill, b: Bill): Bill {
  return { metal: a.metal + b.metal, fuel: a.fuel + b.fuel, build: a.build + b.build };
}

/** Whether a bill is within a budget, in every one of the three. */
export function affords(budget: Budget, bill: Bill): boolean {
  return bill.metal <= budget.metal && bill.fuel <= budget.fuel && bill.build <= budget.build;
}

/** Whether a budget limits anything at all. */
export function isLimited(budget: Budget): boolean {
  return budget.metal !== Infinity || budget.fuel !== Infinity || budget.build !== Infinity;
}
