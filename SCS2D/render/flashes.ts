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

import { IMPACT_BEAM, IMPACT_BURST, IMPACT_COLLISION, IMPACT_MUZZLE } from "../sim/index.js";
import { thrownFor } from "./particles.js";

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
const BURST_MAX_LIFETIME = 0.25;

/**
 * How long a burst of this energy lasts, seconds: a little longer for each
 * tenfold more charge, between a single frame and fifteen.
 */
export function burstLifetime(energy: number): number {
    if (!(energy > 0)) return BURST_MIN_LIFETIME;
    const lifetime = BURST_FLASH_LIFETIME + BURST_LIFETIME_PER_DECADE * Math.log10(energy / BURST_REFERENCE_ENERGY);
    return Math.min(BURST_MAX_LIFETIME, Math.max(BURST_MIN_LIFETIME, lifetime));
}

/**
 * A gun going off with `FLASH_REFERENCE_ENERGY`: a few frames, so a gun can be
 * seen to fire even when its round is too small or too fast to follow.
 */
export const MUZZLE_FLASH_LIFETIME = 0.08;
/** Seconds longer a muzzle flash lasts for each tenfold more energy. */
const MUZZLE_LIFETIME_PER_DECADE = 0.03;
const MUZZLE_MIN_LIFETIME = 0.05;
const MUZZLE_MAX_LIFETIME = 0.2;

/** How long a muzzle flash of this energy lasts, seconds: a big gun's a little longer. */
export function muzzleLifetime(energy: number): number {
    if (!(energy > 0)) return MUZZLE_MIN_LIFETIME;
    const lifetime = MUZZLE_FLASH_LIFETIME + MUZZLE_LIFETIME_PER_DECADE * Math.log10(energy / FLASH_REFERENCE_ENERGY);
    return Math.min(MUZZLE_MAX_LIFETIME, Math.max(MUZZLE_MIN_LIFETIME, lifetime));
}
/**
 * A muzzle flash's size as a share of a hit's of the same energy: the charge
 * mostly goes into the round, not the flare, and at full size the flash would
 * hide the gun it came from.
 */
export const MUZZLE_FLASH_SHARE = 0.4;
/** A collision's flash as a share of a hit's of the same energy: the metal it breaks off shows the rest. */
export const COLLISION_FLASH_SHARE = 0.5;
/** How far ahead of the muzzle a muzzle flash reaches at the end of its life, in its radii. */
export const MUZZLE_FLASH_REACH = 3;
/** Its width at the muzzle, as a share of its radius. */
const MUZZLE_FLASH_THROAT = 0.2;

/**
 * Where a muzzle flash is along the barrel's line at `age`: its back and front,
 * metres ahead of the muzzle, and its half-width at each.
 *
 * A wedge rather than a disc, narrow at the back and wide at the front, which
 * travels out ahead of the barrel as it grows — the gas leaving with the round,
 * rather than something going off on the gun. Its back leaves the muzzle
 * slowly at first, so it is seen coming out of the barrel.
 */
export function muzzleWedge(
    radius: number,
    age: number,
    lifetime: number,
): { back: number; front: number; backWidth: number; frontWidth: number } {
    const f = lifetime > 0 ? Math.sqrt(Math.min(1, Math.max(0, age / lifetime))) : 1;
    const reach = radius * MUZZLE_FLASH_REACH;
    return {
        back: reach * 0.5 * f * f,
        front: reach * (FLASH_BIRTH_SIZE + (1 - FLASH_BIRTH_SIZE) * f),
        backWidth: radius * MUZZLE_FLASH_THROAT,
        frontWidth: radius * (FLASH_BIRTH_SIZE + (1 - FLASH_BIRTH_SIZE) * f),
    };
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
export function flashPosition(localX: number, localY: number, anchor: FlashAnchor): { x: number; y: number } {
    const c = Math.cos(anchor.angle);
    const s = Math.sin(anchor.angle);
    return { x: anchor.x + localX * c - localY * s, y: anchor.y + localX * s + localY * c };
}

/** What a flash keeps, by field: each a typed array a flash's index runs through. */
const FIELDS = [
    ["x", Float64Array],
    ["y", Float64Array],
    ["body", Int32Array],
    ["localX", Float64Array],
    ["localY", Float64Array],
    ["radius", Float64Array],
    ["age", Float64Array],
    ["lifetime", Float64Array],
    ["kept", Float64Array],
    ["kind", Uint8Array],
    ["energy", Float64Array],
    ["vx", Float64Array],
    ["vy", Float64Array],
    ["growth", Float64Array],
    ["dirX", Float64Array],
    ["dirY", Float64Array],
    ["normalX", Float64Array],
    ["normalY", Float64Array],
    ["speed", Float64Array],
] as const;

type Field = (typeof FIELDS)[number][0];

/**
 * Flashes still burning, in arrays a renderer can walk without objects. Each is
 * an event as much as a flash: it is kept for as long as what it throws off
 * (`particles.ts`) is still flying, after its own light has gone out.
 */
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
    /** How long it is kept, seconds: its lifetime, or longer while what it threw off is still flying. */
    kept = new Float64Array(64);
    kind = new Uint8Array(64);
    /** What it was worth, joules: how much it throws off. */
    energy = new Float64Array(64);
    /** Drift, m/s, for a flash that rides nothing. */
    vx = new Float64Array(64);
    vy = new Float64Array(64);
    /** How fast it spreads, m/s, or 0 for one that grows by `flashSize`. */
    growth = new Float64Array(64);
    /**
     * The way it points, in its body's frame where it rides one; zero for a
     * flash that points no way. A muzzle flash's barrel, or the way a round
     * was going where it met a surface.
     */
    dirX = new Float64Array(64);
    dirY = new Float64Array(64);
    /** The outward normal of the surface it met, in the same frame; zero for none. */
    normalX = new Float64Array(64);
    normalY = new Float64Array(64);
    /** How fast it happened, m/s: a collision's closing speed; zero for the rest. */
    speed = new Float64Array(64);
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
        dirX = 0,
        dirY = 0,
        normalX = 0,
        normalY = 0,
        speed = 0,
    ): void {
        const radius =
            flashRadius(energy) * (kind === IMPACT_MUZZLE ? MUZZLE_FLASH_SHARE : kind === IMPACT_COLLISION ? COLLISION_FLASH_SHARE : 1);
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
        const lifetime =
            kind === IMPACT_BEAM
                ? BEAM_FLASH_LIFETIME
                : kind === IMPACT_BURST
                  ? burstLifetime(energy)
                  : kind === IMPACT_MUZZLE
                    ? muzzleLifetime(energy)
                    : ROUND_FLASH_LIFETIME;
        this.lifetime[i] = lifetime;
        this.kept[i] = Math.max(lifetime, thrownFor(kind));
        this.kind[i] = kind;
        this.energy[i] = energy;
        this.vx[i] = vx;
        this.vy[i] = vy;
        this.growth[i] = growth;
        this.dirX[i] = dirX;
        this.dirY[i] = dirY;
        this.normalX[i] = normalX;
        this.normalY[i] = normalY;
        this.speed[i] = speed;
    }

    /** Age everything by `dt` *simulated* seconds and drop what has burned out and landed. */
    step(dt: number): void {
        let kept = 0;
        for (let i = 0; i < this.count; i++) {
            const age = this.age[i]! + dt;
            if (age >= this.kept[i]!) continue;
            for (const [name] of FIELDS) this[name][kept] = this[name][i]!;
            this.x[kept] = this.x[i]! + this.vx[i]! * dt;
            this.y[kept] = this.y[i]! + this.vy[i]! * dt;
            this.age[kept] = age;
            kept++;
        }
        this.count = kept;
    }

    clear(): void {
        this.count = 0;
    }

    copy(): Flashes {
        const out = new Flashes();
        for (const [name] of FIELDS) (out as Record<Field, unknown>)[name] = this[name].slice();
        out.count = this.count;
        return out;
    }

    /** Take on another's flashes, as they are. */
    set(from: Flashes): void {
        const copy = from.copy();
        for (const [name] of FIELDS) (this as Record<Field, unknown>)[name] = copy[name];
        this.count = copy.count;
    }

    private grow(): void {
        const size = this.x.length * 2;
        for (const [name, Kind] of FIELDS) {
            const grown = new Kind(size);
            grown.set(this[name]);
            (this as Record<Field, unknown>)[name] = grown;
        }
    }
}
