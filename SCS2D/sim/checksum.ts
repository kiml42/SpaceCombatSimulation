import { imul } from './math.js';
import type { Projectiles } from './projectiles.js';
import type { World } from './world.js';

/**
 * A deterministic checksum of world state, for golden tests and replay
 * verification.
 *
 * Hashes the raw IEEE-754 *bits* of each value, not a decimal rendering:
 * `String(x)` would hide differences below the shortest round-trip
 * representation, which is exactly where a determinism bug shows up first.
 *
 * FNV-1a over 32-bit words. Not cryptographic — it only has to notice change.
 */

// A scratch buffer to read the bits out of a double. Module-level and mutable,
// which is acceptable here and nowhere else: it is written and read within a
// single synchronous expression, so there is nothing to interleave with.
const scratch = new Float64Array(1);
const scratchBits = new Uint32Array(scratch.buffer);

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function mixByte(h: number, byte: number): number {
  return imul(h ^ (byte & 0xff), FNV_PRIME);
}

function mixU32(h: number, v: number): number {
  h = mixByte(h, v);
  h = mixByte(h, v >>> 8);
  h = mixByte(h, v >>> 16);
  h = mixByte(h, v >>> 24);
  return h;
}

function mixF64(h: number, v: number): number {
  // Normalise negative zero: -0 and +0 are the same number but different bits,
  // and the distinction is never meaningful to the simulation.
  scratch[0] = v === 0 ? 0 : v;
  h = mixU32(h, scratchBits[0]!);
  h = mixU32(h, scratchBits[1]!);
  return h;
}

/**
 * Checksum the dynamic state of every live body, plus the tick count.
 *
 * Forces and accelerations are excluded: they are derived from position and
 * are recomputed every step, so including them would add nothing but would
 * make the checksum depend on where in the step it was taken.
 */
export function checksumWorld(world: World): number {
  const b = world.bodies;
  let h = FNV_OFFSET;
  h = mixU32(h, world.tick);
  h = mixU32(h, b.count);

  for (let i = 0; i < b.highWater; i++) {
    if (b.alive[i] === 0) continue;
    h = mixU32(h, i);
    h = mixU32(h, b.generation[i]!);
    h = mixF64(h, b.x[i]!);
    h = mixF64(h, b.y[i]!);
    h = mixF64(h, b.vx[i]!);
    h = mixF64(h, b.vy[i]!);
    h = mixF64(h, b.angle[i]!);
    h = mixF64(h, b.angularVel[i]!);
    h = mixF64(h, b.mass[i]!);
    h = mixF64(h, b.inertia[i]!);
  }

  return h >>> 0;
}

/**
 * Checksum every round in flight. Pass a previous checksum as `seed` to chain
 * it after another — `checksumProjectiles(p, checksumWorld(w))` covers both.
 *
 * Slot indices are included, so recycling a slot in a different order shows up.
 * That is deliberate: the free list is part of what has to be reproducible.
 */
export function checksumProjectiles(projectiles: Projectiles, seed = FNV_OFFSET): number {
  let h = seed;
  h = mixU32(h, projectiles.count);

  for (let i = 0; i < projectiles.highWater; i++) {
    if (projectiles.alive[i] === 0) continue;
    h = mixU32(h, i);
    h = mixF64(h, projectiles.x[i]!);
    h = mixF64(h, projectiles.y[i]!);
    h = mixF64(h, projectiles.vx[i]!);
    h = mixF64(h, projectiles.vy[i]!);
    h = mixF64(h, projectiles.ttl[i]!);
    h = mixF64(h, projectiles.mass[i]!);
    h = mixU32(h, projectiles.owner[i]!);
    h = mixU32(h, projectiles.kind[i]!);
    h = mixU32(h, projectiles.pending[i]!);
  }

  return h >>> 0;
}

/** Format a checksum as fixed-width hex, for readable golden constants. */
export function formatChecksum(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}
