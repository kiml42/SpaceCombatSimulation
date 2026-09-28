import { DAMAGE_RESPONSES, DamageEffect, type ShipDesign, type Ships } from '../sim/index.js';
import { GunType, type ModuleStats } from '../sim/modules.js';

/**
 * What a hull can still do, one figure per damage effect: thrust in newtons,
 * firepower in watts, and control in the hit points of the cores holding it.
 *
 * Read through the damage model's own responses, so a gun past its cutout
 * counts for nothing here exactly as it fires nothing in the battle. A new
 * effect joins by being added to `DamageEffect` and given a rating below.
 */

/** How many effects there are, which is how long a capability array is. */
export const EFFECTS = Object.values(DamageEffect).filter((value) => typeof value === 'number').length;

/** What a module contributes to an effect when untouched. */
function rating(stats: ModuleStats, effect: DamageEffect): number {
  switch (effect) {
    case DamageEffect.Thrust:
      return stats.thrust;
    case DamageEffect.FireRate: {
      const gun = stats.gun;
      if (gun === null || !(gun.cycleTime > 0)) return 0;
      // Energy delivered per second, sustained: a beam is on for part of each cycle.
      return gun.type === GunType.Beam ? (gun.beamPower * gun.beamOnTime) / gun.cycleTime : gun.muzzleEnergy / gun.cycleTime;
    }
    case DamageEffect.Control:
      return stats.hitPoints;
  }
}

/** Add what a hull can still do to `into`, indexed by effect from `offset`. Undamaged when `ships` is null. */
export function addCapability(into: Float64Array, offset: number, design: ShipDesign, ships: Ships | null, body: number): void {
  for (let m = 0; m < design.modules.length; m++) {
    const module = design.modules[m]!;
    const integrity = ships === null ? 1 : ships.damage.integrity(body, m);
    for (const response of DAMAGE_RESPONSES[module.spec.kind]) {
      into[offset + response.effect]! += rating(module.stats, response.effect) * response.remaining(integrity);
    }
  }
}

/**
 * What is left as one fraction: each effect's share of what it started at,
 * averaged over the effects there were to begin with.
 */
export function workingShare(now: Float64Array, start: Float64Array, offset = 0): number {
  let sum = 0;
  let effects = 0;
  for (let e = 0; e < EFFECTS; e++) {
    const was = start[offset + e]!;
    if (!(was > 0)) continue;
    sum += now[offset + e]! / was;
    effects++;
  }
  return effects > 0 ? sum / effects : 0;
}
