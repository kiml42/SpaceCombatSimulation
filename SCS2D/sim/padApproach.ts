import type { DesignModule, ShipDesign } from './blueprint.js';
import { abs, ceil, cos, floor, max, min, PI, sin } from './math.js';

/**
 * The way a fighter comes in to a pad: of the pad's four sides, the one with
 * the longest run before anything in the weapons layer, and of those the
 * longest before anything at all, so it comes in from open space rather than
 * along the decks. Worked out once, when a carrier is compiled
 * (`ShipDesign.approaches`).
 */
export interface PadApproach {
  /** The pad, as an index into the design's modules. */
  readonly pad: number;
  /** The way out from the pad it comes in along, in the design's frame. */
  readonly angle: number;
  /** How far out that way is clear of the weapons layer, metres, up to twice the design's radius. */
  readonly clear: number;
  /** How far out that way is clear of anything at all, metres, up to the same. */
  readonly open: number;
}

/** The way in to pad `pad` of `design`. */
export function padApproach(design: ShipDesign, pad: number): PadApproach {
  const module = design.modules[pad]!;
  const facing = module.spec.angle ?? 0;
  const cap = 2 * design.radius;
  let best: PadApproach = { pad, angle: facing, clear: 0, open: 0 };
  let longest = -1;
  for (let k = 0; k < 4; k++) {
    const a = facing + (k * PI) / 2;
    const ux = cos(a);
    const uy = sin(a);
    const depth = (k % 2 === 0 ? module.spec.length : module.spec.width) / 2;
    const across = (k % 2 === 0 ? module.spec.width : module.spec.length) / 2;
    const clear = clearRun(design, pad, ux, uy, depth, across, cap, true);
    const open = clearRun(design, pad, ux, uy, depth, across, cap, false);
    const run = clear * cap + open;
    if (run > longest) {
      longest = run;
      best = { pad, angle: a, clear, open };
    }
  }
  return best;
}

/**
 * How far out from pad `pad`'s side along `ux`, `uy` is clear, metres, up to
 * `cap`: of anything in the weapons layer, or of anything at all. Sampled a
 * metre at a time on three lines out from the side, its middle and edges,
 * but only near where each line crosses each module, which is worked out
 * directly.
 */
function clearRun(
  design: ShipDesign,
  pad: number,
  ux: number,
  uy: number,
  depth: number,
  across: number,
  cap: number,
  weaponsOnly: boolean,
): number {
  const from = design.modules[pad]!;
  let run = cap > 0 ? ceil(cap) : 0;
  for (let m = 0; m < design.modules.length; m++) {
    const module = design.modules[m]!;
    if (m === pad || (weaponsOnly && !module.weaponsLayer)) continue;
    const a = module.spec.angle ?? 0;
    const c = cos(a);
    const s = sin(a);
    const halfLength = module.spec.length / 2;
    const halfWidth = module.spec.width / 2;
    const alongRate = ux * c + uy * s;
    const acrossRate = uy * c - ux * s;
    for (let side = -1; side <= 1; side++) {
      const dx = from.x + ux * (depth + 0.5) - uy * side * across - module.x;
      const dy = from.y + uy * (depth + 0.5) + ux * side * across - module.y;
      let lo = 0;
      let hi = Infinity;
      for (let axis = 0; axis < 2; axis++) {
        const at = axis === 0 ? dx * c + dy * s : dy * c - dx * s;
        const rate = axis === 0 ? alongRate : acrossRate;
        const half = axis === 0 ? halfLength : halfWidth;
        // Square to the line, where it moves by rounding alone: generously
        // in or out of it all the way, and the samples decide.
        if (abs(rate) < 1e-9) {
          if (abs(at) > half + 1e-3) hi = -Infinity;
          continue;
        }
        const t0 = (-half - at) / rate;
        const t1 = (half - at) / rate;
        lo = max(lo, min(t0, t1));
        hi = min(hi, max(t0, t1));
      }
      if (!(hi >= lo - 1)) continue;
      // The span is only as exact as its rounding, so the metres either end
      // of it are sampled exactly as stepping out would have.
      const last = min(run - 1, ceil(hi) + 1);
      for (let k = max(0, floor(lo) - 1); k <= last; k++) {
        if (sampleIn(from, module, c, s, ux, uy, depth + k + 0.5, side * across)) {
          run = k;
          break;
        }
      }
    }
  }
  return run;
}

/** Whether the point `out` along `ux`, `uy` from `from` and `aside` across lies inside `module`, whose angle's cosine and sine are `c` and `s`. */
function sampleIn(
  from: DesignModule,
  module: DesignModule,
  c: number,
  s: number,
  ux: number,
  uy: number,
  out: number,
  aside: number,
): boolean {
  const dx = from.x + ux * out - uy * aside - module.x;
  const dy = from.y + uy * out + ux * aside - module.y;
  return abs(dx * c + dy * s) <= module.spec.length / 2 && abs(dy * c - dx * s) <= module.spec.width / 2;
}
