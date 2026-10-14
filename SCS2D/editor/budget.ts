import type { Bill, Budget } from '../sim/index.js';
import { buildTime } from './stats.js';

/** A mass as people read it: kilograms, or tonnes once there are a thousand. */
export function kg(mass: number): string {
  return mass >= 1000 ? `${(mass / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} t` : `${Math.round(mass)} kg`;
}

/** A bill against a budget as table rows, a line a currency, marked `over` where it does not fit. */
export function budgetRows(bill: Bill, budget: Budget): string {
  const row = (name: string, spent: string, allowed: string, over: boolean): string =>
    `<tr${over ? ' class="over"' : ''}><th>${name}</th><td>${spent} of ${allowed}</td></tr>`;
  return (
    row('metal', kg(bill.metal), kg(budget.metal), bill.metal > budget.metal) +
    row('fuel', kg(bill.fuel), kg(budget.fuel), bill.fuel > budget.fuel) +
    row('build', buildTime(bill.build), buildTime(budget.build), bill.build > budget.build)
  );
}

/** A bill alone as table rows, a line a currency. */
export function billRows(bill: Bill): string {
  return (
    `<tr><th>metal</th><td>${kg(bill.metal)}</td></tr>` +
    `<tr><th>fuel</th><td>${kg(bill.fuel)}</td></tr>` +
    `<tr><th>build</th><td>${buildTime(bill.build)}</td></tr>`
  );
}
