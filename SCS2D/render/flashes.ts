/**
 * Impact flashes: where a hit landed, fading.
 *
 * A hit happens in one step and is gone; a person watching needs longer than a
 * sixtieth of a second to see it. So the sim reports impacts and this keeps
 * them for a moment, ages them in wall-clock time and hands the renderer what
 * is still visible.
 *
 * Presentation, and deliberately outside `sim/`: nothing here may change what
 * happens, and ageing by the frame's own clock would break determinism if it
 * did. DOM-free arithmetic, so it is unit-tested like the camera.
 */

/** How long a round's flash lasts, seconds. */
export const ROUND_FLASH_LIFETIME = 0.35;
/**
 * A beam's, which is much shorter: a beam deposits energy every step it burns,
 * so its flashes arrive in a stream and a long life would pile them into one
 * ever-brightening blob.
 */
export const BEAM_FLASH_LIFETIME = 0.1;

/** The energy a flash is drawn at full size for, joules. */
export const FLASH_REFERENCE_ENERGY = 1e6;
/** Radius at that energy, metres. */
export const FLASH_REFERENCE_RADIUS = 3;
const FLASH_MIN_RADIUS = 0.6;
const FLASH_MAX_RADIUS = 18;

/**
 * How big a flash of this energy is, metres.
 *
 * A cube root, so that ten times the energy is about twice the flash: hits
 * across a battle span several orders of magnitude, and anything steeper turns
 * the small ones invisible and the large ones into a screen-filling disc.
 */
export function flashRadius(energy: number): number {
  if (!(energy > 0)) return 0;
  const scaled = FLASH_REFERENCE_RADIUS * Math.cbrt(energy / FLASH_REFERENCE_ENERGY);
  return Math.min(FLASH_MAX_RADIUS, Math.max(FLASH_MIN_RADIUS, scaled));
}

/** How bright a flash is at this point in its life, 1 at birth and 0 at death. */
export function flashFade(age: number, lifetime: number): number {
  if (!(lifetime > 0)) return 0;
  const left = 1 - age / lifetime;
  if (left <= 0) return 0;
  // Squared, so it is bright briefly and then gets out of the way, rather than
  // lingering as a grey smudge over the ship it happened on.
  return left * left;
}

/** Flashes still burning, in arrays a renderer can walk without objects. */
export class Flashes {
  x = new Float64Array(64);
  y = new Float64Array(64);
  radius = new Float64Array(64);
  age = new Float64Array(64);
  lifetime = new Float64Array(64);
  kind = new Uint8Array(64);
  count = 0;

  add(x: number, y: number, energy: number, kind: number): void {
    const radius = flashRadius(energy);
    if (!(radius > 0)) return;
    if (this.count === this.x.length) this.grow();
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.radius[i] = radius;
    this.age[i] = 0;
    this.lifetime[i] = kind === 1 ? BEAM_FLASH_LIFETIME : ROUND_FLASH_LIFETIME;
    this.kind[i] = kind;
  }

  /** Age everything by `dt` seconds and drop what has burned out. */
  step(dt: number): void {
    let kept = 0;
    for (let i = 0; i < this.count; i++) {
      const age = this.age[i]! + dt;
      if (age >= this.lifetime[i]!) continue;
      this.x[kept] = this.x[i]!;
      this.y[kept] = this.y[i]!;
      this.radius[kept] = this.radius[i]!;
      this.age[kept] = age;
      this.lifetime[kept] = this.lifetime[i]!;
      this.kind[kept] = this.kind[i]!;
      kept++;
    }
    this.count = kept;
  }

  clear(): void {
    this.count = 0;
  }

  private grow(): void {
    const size = this.x.length * 2;
    const x = new Float64Array(size);
    const y = new Float64Array(size);
    const radius = new Float64Array(size);
    const age = new Float64Array(size);
    const lifetime = new Float64Array(size);
    const kind = new Uint8Array(size);
    x.set(this.x);
    y.set(this.y);
    radius.set(this.radius);
    age.set(this.age);
    lifetime.set(this.lifetime);
    kind.set(this.kind);
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.age = age;
    this.lifetime = lifetime;
    this.kind = kind;
  }
}
