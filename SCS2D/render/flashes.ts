/**
 * Impact flashes: where a hit landed, fading.
 *
 * A hit happens in one step and is gone; a person watching needs longer than a
 * sixtieth of a second to see it. So the sim reports impacts and this keeps
 * them for a moment, ages them and hands the renderer what is still visible.
 *
 * **Aged in simulated time, not on the wall clock.** A flash is part of the
 * battle: a paused battle holds its flashes, single-stepping advances them one
 * step at a time, and running at eight times speed burns them off eight times
 * as fast. Ageing them on the frame's own clock made a paused simulation
 * change on screen, which is exactly the thing pause is for.
 *
 * **A flash rides the hull it went off against**, which is why it is kept in
 * that body's frame as well as in the world: a ship crossing the screen at
 * two hundred metres a second would otherwise leave its own hits behind it.
 * The world position is the fallback for a hit on nothing, or on a ship that
 * has since gone.
 *
 * Presentation, and deliberately outside `sim/`: nothing here may change what
 * happens. DOM-free arithmetic, so it is unit-tested like the camera.
 */

/** How long a round's flash lasts, in simulated seconds. */
export const ROUND_FLASH_LIFETIME = 0.35;
/**
 * A beam's, which is much shorter: a beam deposits energy every step it burns,
 * so its flashes arrive in a stream and a long life would pile them into one
 * ever-brightening blob.
 */
export const BEAM_FLASH_LIFETIME = 0.1;
/**
 * A shell's burst of `BURST_REFERENCE_ENERGY`: high explosive, so a short bright
 * flash rather than a lasting fireball — about three frames.
 */
export const BURST_FLASH_LIFETIME = 0.05;
export const BURST_REFERENCE_ENERGY = 1e5;
/** Seconds longer a burst lasts for each tenfold more charge. */
const BURST_LIFETIME_PER_DECADE = 0.07;
/** The shortest a burst lasts: under a frame, so a light shell's shows once. */
const BURST_MIN_LIFETIME = 0.01;
/** The longest: a heavy shell's flash, never a fireball. */
const BURST_MAX_LIFETIME = 0.1;

/**
 * How long a burst of this energy lasts, seconds: a little longer for each
 * tenfold more charge, between a single frame and six.
 */
export function burstLifetime(energy: number): number {
  if (!(energy > 0)) return BURST_MIN_LIFETIME;
  const lifetime = BURST_FLASH_LIFETIME + BURST_LIFETIME_PER_DECADE * Math.log10(energy / BURST_REFERENCE_ENERGY);
  return Math.min(BURST_MAX_LIFETIME, Math.max(BURST_MIN_LIFETIME, lifetime));
}

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

/**
 * How wide a flash is at `age`, metres. One with a `growth` is a blast: its
 * full size at birth and spreading at that speed, as its fragments do. Any
 * other grows by `flashSize`.
 */
export function flashExtent(radius: number, growth: number, age: number, lifetime: number): number {
  if (growth > 0) return radius + growth * Math.max(0, age);
  return radius * flashSize(age, lifetime);
}

/** The share of its full size a flash starts at. */
export const FLASH_BIRTH_SIZE = 0.35;

/**
 * How big a flash is at this point in its life, as a share of its full size:
 * it grows quickly at first and then more slowly, as a blast does.
 */
export function flashSize(age: number, lifetime: number): number {
  if (!(lifetime > 0)) return 1;
  const f = Math.min(1, Math.max(0, age / lifetime));
  return FLASH_BIRTH_SIZE + (1 - FLASH_BIRTH_SIZE) * Math.sqrt(f);
}

/** How bright a flash is at this point in its life, 1 at birth and 0 at death. */
export function flashFade(age: number, lifetime: number): number {
  if (!(lifetime > 0)) return 0;
  // Before it was born is the moment it was born: an exposure reaching back
  // past it is at its brightest there.
  if (age <= 0) return 1;
  const left = 1 - age / lifetime;
  if (left <= 0) return 0;
  // Squared, so it is bright briefly and then gets out of the way, rather than
  // lingering as a grey smudge over the ship it happened on.
  return left * left;
}

/** Where a flash is now: on its hull if that hull is still about. */
export interface FlashAnchor {
  /** Body index, matching `ShipView.body`. */
  body: number;
  x: number;
  y: number;
  angle: number;
}

/**
 * Put a flash back where it belongs, given the hull it is riding.
 *
 * The offset was taken in the body's frame at the moment of the hit, so this
 * is the same transform the hull's own modules are drawn through.
 */
export function flashPosition(
  localX: number,
  localY: number,
  anchor: FlashAnchor,
): { x: number; y: number } {
  const c = Math.cos(anchor.angle);
  const s = Math.sin(anchor.angle);
  return { x: anchor.x + localX * c - localY * s, y: anchor.y + localX * s + localY * c };
}

/** Flashes still burning, in arrays a renderer can walk without objects. */
export class Flashes {
  x = new Float64Array(64);
  y = new Float64Array(64);
  /** The body it happened on, or -1 for one that rides nothing. */
  body = new Int32Array(64);
  localX = new Float64Array(64);
  localY = new Float64Array(64);
  radius = new Float64Array(64);
  age = new Float64Array(64);
  lifetime = new Float64Array(64);
  kind = new Uint8Array(64);
  /** Drift, m/s, for a flash that rides nothing. */
  vx = new Float64Array(64);
  vy = new Float64Array(64);
  /** How fast it spreads, m/s, or 0 for one that grows by `flashSize`. */
  growth = new Float64Array(64);
  count = 0;

  add(
    x: number,
    y: number,
    energy: number,
    kind: number,
    body = -1,
    localX = 0,
    localY = 0,
    vx = 0,
    vy = 0,
    growth = 0,
  ): void {
    const radius = flashRadius(energy);
    if (!(radius > 0)) return;
    if (this.count === this.x.length) this.grow();
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.body[i] = body;
    this.localX[i] = localX;
    this.localY[i] = localY;
    this.radius[i] = radius;
    this.age[i] = 0;
    this.lifetime[i] = kind === 1 ? BEAM_FLASH_LIFETIME : kind === 3 ? burstLifetime(energy) : ROUND_FLASH_LIFETIME;
    this.kind[i] = kind;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.growth[i] = growth;
  }

  /** Age everything by `dt` *simulated* seconds and drop what has burned out. */
  step(dt: number): void {
    let kept = 0;
    for (let i = 0; i < this.count; i++) {
      const age = this.age[i]! + dt;
      if (age >= this.lifetime[i]!) continue;
      this.x[kept] = this.x[i]! + this.vx[i]! * dt;
      this.y[kept] = this.y[i]! + this.vy[i]! * dt;
      this.vx[kept] = this.vx[i]!;
      this.vy[kept] = this.vy[i]!;
      this.growth[kept] = this.growth[i]!;
      this.body[kept] = this.body[i]!;
      this.localX[kept] = this.localX[i]!;
      this.localY[kept] = this.localY[i]!;
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
    const body = new Int32Array(size);
    const localX = new Float64Array(size);
    const localY = new Float64Array(size);
    const radius = new Float64Array(size);
    const age = new Float64Array(size);
    const lifetime = new Float64Array(size);
    const kind = new Uint8Array(size);
    const vx = new Float64Array(size);
    const vy = new Float64Array(size);
    vx.set(this.vx);
    vy.set(this.vy);
    this.vx = vx;
    this.vy = vy;
    const growth = new Float64Array(size);
    growth.set(this.growth);
    this.growth = growth;
    x.set(this.x);
    y.set(this.y);
    body.set(this.body);
    localX.set(this.localX);
    localY.set(this.localY);
    radius.set(this.radius);
    age.set(this.age);
    lifetime.set(this.lifetime);
    kind.set(this.kind);
    this.x = x;
    this.y = y;
    this.body = body;
    this.localX = localX;
    this.localY = localY;
    this.radius = radius;
    this.age = age;
    this.lifetime = lifetime;
    this.kind = kind;
  }
}
