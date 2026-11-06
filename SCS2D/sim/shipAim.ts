import { Bodies } from "./bodies.js";
import { reachAgainst, type DesignTurret, type ShipDesign } from "./blueprint.js";
import { BOTH_LAYERS, HULL_LAYER, moduleLayers, OWN_LAYERS, WEAPONS_LAYER } from "./hull.js";
import { DamageEffect } from "./damage.js";
import { inSight, lookFrom, score } from "./targeting.js";
import { DEFAULT_FUSE, firesShells, moduleRadius, type ModuleSpec, GunType, type GunStats, type ModuleKind } from "./modules.js";
import { atan2, angleDelta, PI, clamp, cos, length, max, round, sin, sqrt } from "./math.js";
import { overriddenMount, placementOf, type Targeting } from "./doctrine.js";
import type { World } from "./world.js";
import type { SpatialGrid } from "./index.js";
import { MAX_BEAM_LENGTH } from "./beams.js";
import { type Ships, NO_TARGET, WHOLE_SHIP, bearing } from "./ships.js";

/**
 * Turrets: what each mount picks to shoot at and which part of it, where it
 * aims to meet it, and whether a friend or a rock is in the way of the shot.
 */

/**
 * How often a mount reconsiders: the time it would take to act on the answer.
 *
 * Half a circle of traverse plus one firing cycle — what it costs a mount to
 * swing onto something new and get a shot away. Deriving it that way is what
 * makes a close-in mount reconsider several times a second while an artillery
 * piece that takes six seconds to come round and load thinks about as often
 * as it can do anything about it. Choosing faster than you can act on the
 * choice is only a way of never finishing a slew.
 */
const TURRET_MIN_RETHINK = 0.25;

const TURRET_MAX_RETHINK = 4;

/**
 * How far ahead of a gun's muzzle a friendly stops it firing, in seconds of
 * the round's own flight.
 *
 * Short on purpose. A shell is slow enough and a battle wide enough that
 * asking "is a friend anywhere along where this round could go" would stop a
 * fleet firing at all; what this is for is the consort that has just drifted
 * across the muzzle, which is the case a gunner would actually notice. Beyond
 * it, a round is everyone's problem and the ship that flew into the line of
 * fire is the one that made the mistake.
 *
 * A beam gets no such allowance: it arrives instantly along its whole length,
 * so anything in the line *is* hit, and the cast is the beam itself.
 */
const FRIENDLY_LOOKAHEAD = 0.5;

/**
 * Nothing on this ship that this mount's doctrine will shoot at.
 *
 * Distinct from `WHOLE_SHIP`, which is a mount with no opinion about parts
 * firing at the hull: a ship is made of its modules, so a doctrine that has
 * refused every one left has refused the ship. Aiming at the hull instead
 * would hit exactly what was refused.
 */
const NOTHING_AIMABLE = -2;

/** What a doctrine thinks one kind of module is worth shooting at. */
function partWeight(doctrine: Targeting, kind: ModuleKind): number {
    if (kind === "core") return doctrine.coreWeight;
    if (kind === "engine") return doctrine.engineWeight;
    // A tank or a hold is shot at as plating until hitting one does something more.
    if (kind === "structure" || kind === "tank" || kind === "hold") return doctrine.structureWeight;
    return doctrine.gunWeight;
}

/**
 * Whether this doctrine would rather not damage some kind of module.
 *
 * The strongest of the three things an aim weight says, and the only one that
 * reaches the trigger: **above zero is destroy this, zero is leave it alone,
 * and below zero is mind not to hit it.** The first two are about what a
 * mount aims at; the third is about what it might hit by accident, so a mount
 * holding one waits until the part it chose is under the muzzle rather than
 * firing at anything on the hull.
 */
function refusesAnything(doctrine: Targeting): boolean {
    return doctrine.coreWeight < 0 || doctrine.engineWeight < 0 || doctrine.gunWeight < 0 || doctrine.structureWeight < 0;
}

/** Whether a doctrine has any opinion about which part of a ship to hit. */
function picksParts(doctrine: Targeting): boolean {
    return doctrine.coreWeight !== 0 || doctrine.engineWeight !== 0 || doctrine.gunWeight !== 0 || doctrine.structureWeight !== 0;
}

/**
 * Let every mount pick its own fight.
 *
 * Same doctrine as the hull's, asked from the mount's point of view: its
 * own gun's reach rather than the ship's best, and nothing it cannot train
 * on. A mount that has been wrecked chooses nothing, which is also what
 * takes its firing arc off the display.
 */
export function decideTurrets(ships: Ships, world: World, bodies: Bodies, i: number): void {
    const design = ships.designs[i]!;
    const indices = ships.turretIndex[i]!;
    const targets = ships.turretTarget[i]!;
    const aims = ships.turretAimModule[i]!;
    const schedule = ships.turretRethinkAt[i]!;
    const b = bodies.indexOf(ships.bodyIds[i]!);
    if (b < 0) return;

    const focus = focusOf(ships, i);
    // A secondary mount ignores orders, so converges on what doctrine chose.
    const ownFocus = ships.chosenOf(i);

    for (let t = 0; t < indices.length; t++) {
        // A mount another ship on this body works is that ship's to aim.
        if (!ships.ownsAt(i, b, design.turrets[t]!.module)) continue;
        // What it was fighting is dropped the moment that stops being a fight,
        // whatever its schedule says: a mount tracking a wreck, or a hulk, is
        // worse than a mount at rest, because it goes on shooting at it.
        const held = targets[t]!;
        if (
            held !== NO_TARGET &&
            (ships.alive[held] !== 1 ||
                ships.derelict[held] === 1 ||
                !ships.hasControl(held) ||
                clingsToFriend(ships, i, held, bodies.indexOf(ships.bodyIds[held]!)))
        ) {
            targets[t] = NO_TARGET;
            aims[t] = WHOLE_SHIP;
        }
        if (world.tick < schedule[t]!) continue;
        const mount = design.turrets[t]!;
        const layers = mountLayers(ships, i, mount);
        // A shell's fragments fly in both layers, so it can hurt a ship its own
        // layer would pass by.
        const hurts = firesShellsFrom(ships, i, mount) ? BOTH_LAYERS : layers;
        schedule[t] = world.tick + turretRethinkTicks(world, t, design);

        if (!(ships.left(i, b, mount.module, DamageEffect.FireRate) > 0)) {
            targets[t] = NO_TARGET;
            aims[t] = WHOLE_SHIP;
            continue;
        }

        const ti = indices[t]!;
        const doctrine = aimDoctrine(ships, i, mount);

        // Everything is measured from the gun rather than from the hull it is
        // bolted to. Metres, against gunnery range — but enough to order two
        // targets differently, which is what stops both beams piling onto the
        // same one when either could take it.
        locateMount(ships, bodies, b, mount);
        const gunX = ships.gunPoint.x;
        const gunY = ships.gunPoint.y;
        const gunVx = ships.gunPoint.vx;
        const gunVy = ships.gunPoint.vy;
        const barrel = ships.turrets.worldBearing(bodies, ti);
        const faceX = cos(barrel);
        const faceY = sin(barrel);

        ships.choice.begin();
        ships.maskedChoice.begin();
        ships.farChoice.begin();
        for (let e = 0; e < ships.alive.length; e++) {
            if (e === i || ships.alive[e] === 0) continue;
            if (ships.derelict[e] === 1 || !ships.hostile(i, e) || !ships.hasControl(e)) continue;
            const tb = bodies.indexOf(ships.bodyIds[e]!);
            if (tb < 0 || clingsToFriend(ships, i, e, tb)) continue;
            // An enemy hooked on shares this body, so the body's centre says
            // nothing about where it is: it is where the part this mount would
            // shoot at is.
            const hooked = tb === b;
            // So does one sharing a body with others, a friend or a rock.
            const shared = !hooked && sharesBody(ships, e, tb);
            let tx = bodies.x[tb]!;
            let ty = bodies.y[tb]!;
            if (!hooked && !canAimAt(ships, i, mount, hurts, e, tb)) {
                // A ship with nothing left this mount will shoot at is not a target
                // for it, however good it looks by every other measure.
                continue;
            }
            if (hooked || shared) {
                const part = aimModule(ships, bodies, i, mount, layers, e, gunX, gunY, hooked);
                if (part < 0) continue;
                partPoint(ships, bodies, tb, ships.designs[e]!, part);
                tx = ships.partAt.x;
                ty = ships.partAt.y;
            }
            // What it cannot point at or fire at yet is still worth tracking: the
            // gun is on it the moment the target, or the ship, moves round.
            const towards = bearing(gunX, gunY, tx, ty);
            const clear = ships.turrets.firesOn(bodies, ti, towards);
            const seen = lookFrom(
                bodies,
                gunX,
                gunY,
                gunVx,
                gunVy,
                faceX,
                faceY,
                tb,
                e,
                ships.designs[e]!.mass,
                !ships.isDisarmed(e),
                !ships.hasNoEngines(e),
            );
            const partRange = hooked || shared ? length(tx - gunX, ty - gunY) : 0;
            const candidate =
                hooked || shared
                    ? {
                          ...seen,
                          range: partRange,
                          closing: hooked ? 0 : seen.closing,
                          facing: partRange > 0 ? (faceX * (tx - gunX) + faceY * (ty - gunY)) / partRange : 1,
                      }
                    : seen;
            // Out of reach is tracked but never preferred to anything in reach,
            // and never fired on: proximity alone would let a mount shoot at
            // something far outside what its gun is good for all battle.
            //
            // Against *this* target's size rather than the one the doctrine
            // expects: a capital is worth shooting at from far further off than a
            // fighter. A doctrine that minds what it hits fires only on the part
            // it picked, so its reach is against that part.
            const against = reachOn(
                ships,
                i,
                mount,
                e,
                refusesAnything(doctrine) ? aimFor(ships, bodies, i, mount, layers, e, gunX, gunY, hooked) : WHOLE_SHIP,
            );
            // A hooked target is alongside, with nothing between to look past.
            const judged =
                !hooked && doctrine.sightWeight !== 0 && !inSight(bodies, gunX, gunY, b, tb) ? { ...candidate, clear: false } : candidate;
            // Behind an asteroid is as good as out of its arc: tracked, for when it comes out.
            const open = clear && (hooked || !rockBetween(ships, bodies, gunX, gunY, tx, ty, b, tb));
            (candidate.range > against ? ships.farChoice : open ? ships.choice : ships.maskedChoice).offer(
                judged,
                score(doctrine, candidate, against, design.mass, targets[t]!, mount.main ? focus : ownFocus),
            );
        }
        // Something it can fire at first; then what is in reach but behind its
        // own ship or out of its arc; then what it will be able to reach.
        targets[t] =
            ships.choice.ship !== NO_TARGET
                ? ships.choice.ship
                : ships.maskedChoice.ship !== NO_TARGET
                  ? ships.maskedChoice.ship
                  : ships.farChoice.ship;
        aims[t] = targets[t] === NO_TARGET ? WHOLE_SHIP : choosePart(ships, bodies, b, i, mount, layers, targets[t]!, gunX, gunY);
        // Holding something it cannot fire on yet, it looks again soon: what it
        // can fire on may turn up long before its own reconsidering would.
        if (ships.choice.ship === NO_TARGET && targets[t] !== NO_TARGET) {
            schedule[t] = world.tick + max(1, round(TURRET_MIN_RETHINK / world.dt));
        }
    }
}

/**
 * The part of a target a mount aims at, or the whole ship.
 *
 * The part, as a doctrine picks it, wherever that is worth shooting at.
 * Further out than that, when hitting any of the ship will do, the middle
 * of the ship: more of the shots land. A shell bursts into the hull layer,
 * so it can be aimed there too; solid shot in the weapons layer would pass
 * over the deck, and takes the part it can hit nearest the middle instead.
 */
export function choosePart(
    ships: Ships,
    bodies: Bodies,
    b: number,
    i: number,
    mount: DesignTurret,
    layers: number,
    target: number,
    gunX: number,
    gunY: number,
): number {
    const shells = firesShellsFrom(ships, i, mount);
    const tb = bodies.indexOf(ships.bodyIds[target]!);
    const hooked = tb === b;
    const part = aimFor(ships, bodies, i, mount, layers, target, gunX, gunY, hooked);
    if (part < 0 || hooked || sharesBody(ships, target, tb) || refusesAnything(aimDoctrine(ships, i, mount))) return part;
    const design = ships.designs[target]!;
    partPoint(ships, bodies, tb, design, part);
    const range = length(ships.partAt.x - gunX, ships.partAt.y - gunY);
    if (range <= reachFor(ships, i, mount, moduleRadius(design.modules[part]!.spec))) return part;
    if (meetsWhole(ships, shells ? layers | HULL_LAYER : layers, target)) return WHOLE_SHIP;
    let middle = part;
    let nearest = Infinity;
    for (let k = 0; k < design.modules.length; k++) {
        if (!reaches(ships, layers, design, tb, target, k)) continue;
        const m = design.modules[k]!;
        const off = m.x * m.x + m.y * m.y;
        if (off < nearest) {
            nearest = off;
            middle = k;
        }
    }
    return middle;
}

/**
 * How far a mount will fire at a target, aiming at `part` of it: against
 * the size of what it will fire on, which is the whole ship unless its
 * doctrine minds what it hits, and as far out as its doctrine says.
 */
export function reachOn(ships: Ships, i: number, mount: DesignTurret, target: number, part: number): number {
    const design = ships.designs[target]!;
    const selective = refusesAnything(aimDoctrine(ships, i, mount)) && part >= 0 && part < design.modules.length;
    return reachFor(ships, i, mount, selective ? moduleRadius(design.modules[part]!.spec) : sizeOf(ships, target));
}

/** How far a mount will fire at something of this radius, metres. */
export function reachFor(ships: Ships, i: number, mount: DesignTurret, radius: number): number {
    return reachAgainst(mount.gun, radius) * aimDoctrine(ships, i, mount).fireRange;
}

/**
 * Where a mount is and how fast that point is moving, into `gunPoint`.
 *
 * A mount out on a beam is carried round by its ship, so its velocity is
 * the hull's plus ω × r — the same term a round leaving it inherits.
 */
export function locateMount(ships: Ships, bodies: Bodies, b: number, mount: DesignTurret): void {
    const angle = bodies.angle[b]!;
    const rx = mount.mount.x * cos(angle) - mount.mount.y * sin(angle);
    const ry = mount.mount.x * sin(angle) + mount.mount.y * cos(angle);
    const spin = bodies.angularVel[b]!;
    ships.gunPoint.x = bodies.x[b]! + rx;
    ships.gunPoint.y = bodies.y[b]! + ry;
    ships.gunPoint.vx = bodies.vx[b]! - spin * ry;
    ships.gunPoint.vy = bodies.vy[b]! + spin * rx;
}

/**
 * Which part of a target to shoot at: the best-weighted module still worth
 * hitting, or the ship as a whole when the doctrine has no opinion.
 *
 * Ties go to whatever is nearest the gun — the gun itself, not its ship —
 * so a mount aiming for engines takes the engine on the near side rather
 * than shooting through the ship to reach one behind it. A module already
 * spent is no longer worth a round.
 */
export function aimModule(
    ships: Ships,
    bodies: Bodies,
    i: number,
    mount: DesignTurret,
    layers: number,
    target: number,
    fromX: number,
    fromY: number,
    hooked = false,
): number {
    const doctrine = aimDoctrine(ships, i, mount);
    // A mount in the hull layer with no opinion about parts shoots at the
    // hull. One in the weapons layer cannot: amidships is usually deck, which
    // its rounds pass over, so it always picks something in the weapons layer. Nor can one
    // hooked to its target, whose hull's middle may be its own.
    const anyPart = !picksParts(doctrine);
    const tb = bodies.indexOf(ships.bodyIds[target]!);
    if (tb < 0) return WHOLE_SHIP;
    // Nor one sharing its body with others, whose middle may be theirs.
    if (anyPart && meetsWhole(ships, layers, target) && !hooked && !sharesBody(ships, target, tb)) return WHOLE_SHIP;
    const design = ships.designs[target]!;
    const angle = bodies.angle[tb]!;
    const c = cos(angle);
    const s = sin(angle);

    let best = WHOLE_SHIP;
    let bestWeight = 0;
    let bestRange = 0;
    for (let k = 0; k < design.modules.length; k++) {
        if (!reaches(ships, layers, design, tb, target, k)) continue;
        const weight = anyPart ? 1 : partWeight(doctrine, design.modules[k]!.spec.kind);
        // Only what this doctrine wants destroyed. Zero is not a poor ranking
        // but a different statement — *not worth a shot* — and the best of a
        // bad list would otherwise still be chosen however bad the list is.
        if (weight <= 0) continue;
        const mx = bodies.x[tb]! + design.modules[k]!.x * c - design.modules[k]!.y * s;
        const my = bodies.y[tb]! + design.modules[k]!.x * s + design.modules[k]!.y * c;
        const range = length(mx - fromX, my - fromY);
        if (best !== WHOLE_SHIP && (weight < bestWeight || (weight === bestWeight && range >= bestRange))) {
            continue;
        }
        best = k;
        bestWeight = weight;
        bestRange = range;
    }
    // Nothing left that this doctrine wants destroyed, so there is nothing
    // here to shoot at — not the hull either, since the hull is the modules
    // it has just passed over.
    return best === WHOLE_SHIP ? NOTHING_AIMABLE : best;
}

/**
 * `aimModule` for ship `i`'s mount, looking past its own layer when that has
 * nothing to offer and it fires shells, whose fragments fly in both.
 */
export function aimFor(
    ships: Ships,
    bodies: Bodies,
    i: number,
    mount: DesignTurret,
    layers: number,
    target: number,
    fromX: number,
    fromY: number,
    hooked: boolean,
): number {
    const part = aimModule(ships, bodies, i, mount, layers, target, fromX, fromY, hooked);
    if (part !== NOTHING_AIMABLE || !firesShellsFrom(ships, i, mount)) return part;
    return aimModule(ships, bodies, i, mount, BOTH_LAYERS, target, fromX, fromY, hooked);
}

/** How big ship `t` is to anything aiming at it: its own radius, or what `locate` makes of it. */
export function sizeOf(ships: Ships, t: number): number {
    const bodies = ships.bodyStore;
    const tb = bodies === null ? -1 : bodies.indexOf(ships.bodyIds[t]!);
    return tb < 0 || !sharesBody(ships, t, tb) ? ships.designs[t]!.radius : ships.locate(bodies!, t, tb, ships.sizeAt).radius;
}

/** Whether ship `t` shares body `tb` with another ship or with rock it hooked on to. */
export function sharesBody(ships: Ships, t: number, tb: number): boolean {
    const pilots = ships.pilots[tb];
    if (pilots === null || pilots === undefined) return false;
    for (let k = 0; k < pilots.length; k++) if (pilots[k] !== t) return true;
    return false;
}

/**
 * Whether ship `t`, on body `tb`, shares it with a friend of ship `i`'s: then
 * what misses `t` lands on the friend, so `t` is not `i`'s to shoot at.
 * Wreckage is no friend, as in `friendlyInTheWay`.
 */
export function clingsToFriend(ships: Ships, i: number, t: number, tb: number): boolean {
    const pilots = ships.pilots[tb];
    if (pilots === null || pilots === undefined) return false;
    for (let k = 0; k < pilots.length; k++) {
        const p = pilots[k]!;
        if (p < 0 || p === t || p === i) continue;
        if (ships.alive[p] === 1 && ships.derelict[p] === 0 && !ships.hostile(i, p)) return true;
    }
    return false;
}

/** Where module `part` of a body is in the world, into `partAt`. */
export function partPoint(ships: Ships, bodies: Bodies, tb: number, design: ShipDesign, part: number): void {
    const angle = bodies.angle[tb]!;
    const module = design.modules[part]!;
    ships.partAt.x = bodies.x[tb]! + module.x * cos(angle) - module.y * sin(angle);
    ships.partAt.y = bodies.y[tb]! + module.x * sin(angle) + module.y * cos(angle);
}

/**
 * Whether a round from this mount could land on module `k` of a target:
 * still standing, still the target's, and in a layer the mount fires in.
 */
export function reaches(ships: Ships, layers: number, design: ShipDesign, tb: number, target: number, k: number): boolean {
    if (ships.damage.spent(tb, k) || !ships.ownsAt(target, tb, k)) return false;
    return (moduleLayers(design.modules[k]!, shipLayers(ships, target)) & layers) !== 0;
}

/**
 * Whether a shot in these layers meets whatever it hits of this ship, so the
 * ship's centre is as good an aim point as any part: in the hull layer, at
 * a ship every module of which is in it.
 */
export function meetsWhole(ships: Ships, layers: number, target: number): boolean {
    const whole = shipLayers(ships, target);
    return (layers & HULL_LAYER) !== 0 && (whole === OWN_LAYERS || (whole & HULL_LAYER) !== 0);
}

/** The layers every module of this ship is in, or `OWN_LAYERS`: a fighter's, by whether it has committed. */
export function shipLayers(ships: Ships, i: number): number {
    if (!ships.designs[i]!.fighter) return OWN_LAYERS;
    return ships.committed[i] === 1 ? BOTH_LAYERS : WEAPONS_LAYER;
}

/** The layers this mount's shots fly in: a fighter's guns fire in whatever it occupies. */
export function mountLayers(ships: Ships, i: number, mount: DesignTurret): number {
    const whole = shipLayers(ships, i);
    if (whole !== OWN_LAYERS) return whole;
    if (!mount.hullLayer) return WEAPONS_LAYER;
    // A thick hull beam stands in both, and fires a beam in each.
    return mount.gun.type === GunType.Beam && ships.designs[i]!.modules[mount.module]!.weaponsLayer ? BOTH_LAYERS : HULL_LAYER;
}

/** Whether this ship's mount fires shells, whose fragments fly in both layers. */
export function firesShellsFrom(ships: Ships, i: number, mount: DesignTurret): boolean {
    return firesShells(ships.designs[i]!.modules[mount.module]!.spec);
}

/**
 * Whether this mount's doctrine would shoot at anything still standing on
 * that ship, in a layer it can reach.
 *
 * Asked while choosing a target rather than after, because a ship a mount
 * may not fire at is not a worse target than the rest — it is not a target.
 * A mount that scored it anyway would pick it, train on it and hold its
 * fire, which is a gun taken out of the battle by its own doctrine.
 */
export function canAimAt(ships: Ships, i: number, mount: DesignTurret, layers: number, target: number, tb: number): boolean {
    const doctrine = aimDoctrine(ships, i, mount);
    const anyPart = !picksParts(doctrine);
    if (anyPart && meetsWhole(ships, layers, target)) return true;
    const design = ships.designs[target]!;
    for (let k = 0; k < design.modules.length; k++) {
        if (!reaches(ships, layers, design, tb, target, k)) continue;
        if (anyPart || partWeight(doctrine, design.modules[k]!.spec.kind) > 0) return true;
    }
    return false;
}

export function focusOf(ships: Ships, i: number): number {
    const given = ships.getCurrentOrder(i);
    if (given !== undefined && given.defend !== true && given.errand === undefined && given.flee !== true) return given.target;
    return ships.chosenOf(i);
}

/** A mount's doctrine on ship `i`, with what the ship has been told over it. */
export function aimDoctrine(ships: Ships, i: number, mount: DesignTurret): Targeting {
    const override = ships.overrides[i];
    if (override === undefined) return mount.targeting;
    const design = ships.designs[i]!;
    let cached = ships.mountDoctrines[i];
    if (cached === null || cached === undefined || cached.design !== design) {
        cached = { design, byMount: new Map() };
        ships.mountDoctrines[i] = cached;
    }
    let resolved = cached.byMount.get(mount);
    if (resolved === undefined) {
        const placement = placementOf(design.keys?.[design.modules[mount.module]?.index ?? -1]);
        resolved = overriddenMount(mount.targeting, mount.main, placement, override);
        cached.byMount.set(mount, resolved);
    }
    return resolved;
}

/**
 * What one mount is shooting at.
 *
 * An order given is an order obeyed by the main battery, so a main mount
 * that can train on the ordered target takes it; one that cannot is not left
 * idle for the sake of it, and fights what it can reach. A secondary mount
 * ignores orders, so a close-in gun goes on swatting whatever is about to
 * hit the ship. Otherwise this is whatever the mount picked for itself.
 */
export function turretAim(ships: Ships, bodies: Bodies, i: number, t: number): number {
    const current = ships.designs[i]!.turrets[t]!.main ? ships.getCurrentOrder(i) : undefined;
    // A friend to defend, fetch from or hide behind is not a target.
    const given = current?.defend === true || current?.errand !== undefined || current?.flee === true ? undefined : current;
    let tracksGiven = false;
    if (given !== undefined && given.target !== NO_TARGET && ships.alive[given.target] === 1) {
        const tb = bodies.indexOf(ships.bodyIds[given.target]!);
        const b = bodies.indexOf(ships.bodyIds[i]!);
        if (tb >= 0 && b >= 0 && tb !== b) {
            const ti = ships.turretIndex[i]![t]!;
            locateMount(ships, bodies, b, ships.designs[i]!.turrets[t]!);
            const towards = bearing(ships.gunPoint.x, ships.gunPoint.y, bodies.x[tb]!, bodies.y[tb]!);
            if (ships.turrets.firesOn(bodies, ti, towards)) return given.target;
            tracksGiven = true;
        }
    }
    const own = ships.turretTarget[i]![t]!;
    if (own !== NO_TARGET && ships.alive[own] === 1) return own;
    // Nothing else to do: track the order where it may not fire, or cannot
    // point, so the gun is on it as it comes clear or round.
    return tracksGiven ? given!.target : NO_TARGET;
}

/**
 * Seconds until a round from this mount bursts: its fuse short of the
 * flight time to what it is aimed at. Never, with nothing to time it to.
 */
export function fuseFor(ships: Ships, turret: number, target: number, spec: ModuleSpec): number {
    const flight = ships.turrets.aimTime[turret]!;
    if (target === NO_TARGET || !(flight > 0) || !firesShells(spec)) return Infinity;
    const fuse = flight - (spec.fuse ?? DEFAULT_FUSE);
    return fuse > 0 ? fuse : 0;
}

/**
 * Whether a friendly hull is in the way of this shot.
 *
 * A straight cast from the muzzle along the barrel, at this instant and
 * ignoring everyone's velocity: a gun that tried to work out where its
 * friends will be would be solving the firing problem twice, and the answer
 * it wants is the crude one — is somebody *there*.
 *
 * The cast stops at the nearest hull, so an enemy between this gun and a
 * consort behind it is still shot at. Wreckage is not a friend however it
 * is painted: nothing controls it, and holding fire for it would make every
 * broken ship a shield. Nor is what this mount is shooting at, whoever's
 * side it is on — a ship told to fire on one of its own does so, because
 * this is a rule about what is *in the way* and not about who may be shot.
 */
export function friendlyInTheWay(
    ships: Ships,
    bodies: Bodies,
    grid: SpatialGrid,
    i: number,
    bodyIdx: number,
    gun: GunStats,
    reach: number,
    target: number,
    layers: number,
): boolean {
    // Never further than the shot itself goes: a consort beyond what this gun
    // is willing to shoot at is not in the way of anything, and a cast that
    // looked past it would hold fire for a ship in no danger — as well as
    // walking grid cells to learn nothing.
    // Out to the target, though, when a friend may be hooked to it: then it is no passer-by.
    const tb = target === NO_TARGET ? -1 : bodies.indexOf(ships.bodyIds[target]!);
    const shared = tb >= 0 && sharesBody(ships, target, tb);
    const lookahead = gun.type === GunType.Beam ? MAX_BEAM_LENGTH : shared ? reach : gun.muzzleSpeed * FRIENDLY_LOOKAHEAD;
    const range = lookahead < reach ? lookahead : reach;
    if (!(range > 0)) return false;
    const hit = ships.lineOfFire;
    // A friend is only in the way of what it would stop.
    ships.hulls.castFrom(layers, -1, -1);
    const dx = ships.solution.dirX * range;
    const dy = ships.solution.dirY * range;
    const found = grid.raycast(
        bodies,
        ships.solution.x,
        ships.solution.y,
        ships.solution.x + dx,
        ships.solution.y + dy,
        hit,
        bodyIdx,
        ships.hulls,
    );
    // Whose module it meets, not whose body: a friend hooked to the target is still in the way, and the target is not.
    const module =
        found && ships.hulls.describe(bodies, hit.bodyIndex, ships.solution.x, ships.solution.y, dx, dy) ? ships.hulls.module : -1;
    ships.hulls.reset();
    if (!found) return false;
    const pilots = ships.pilots[hit.bodyIndex];
    const other = module >= 0 && pilots !== null && pilots !== undefined ? pilots[module]! : ships.shipAt(bodies, hit.bodyIndex);
    if (other < 0 || other === i || other === target || ships.alive[other] !== 1) return false;
    return ships.derelict[other] === 0 && !ships.hostile(i, other);
}

/**
 * Whether an asteroid is across this shot, short of `target`: the line the
 * round leaves on, out to the target's range. Checked against every rock's
 * bounding circle rather than by a cast, because there are few of them and
 * a shot is wasted on one however far down the line it is.
 */
export function rockInTheWay(ships: Ships, bodies: Bodies, bodyIdx: number, target: number): boolean {
    const tb = bodies.indexOf(ships.bodyIds[target]!);
    if (tb < 0) return false;
    const x = ships.solution.x;
    const y = ships.solution.y;
    const range = length(bodies.x[tb]! - x, bodies.y[tb]! - y);
    return rockBetween(ships, bodies, x, y, x + ships.solution.dirX * range, y + ships.solution.dirY * range, bodyIdx, tb);
}

/**
 * Whether an asteroid's bounding circle crosses the line from (`fromX`,
 * `fromY`) to (`toX`, `toY`). Never body `own` or `to`, which a ship moored
 * to a rock or a target clinging to one share, nor a rock the line starts
 * inside, which says nothing about which way is blocked.
 */
export function rockBetween(
    ships: Ships,
    bodies: Bodies,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    own: number,
    to: number,
): boolean {
    return blockingRock(ships, bodies, fromX, fromY, toX, toY, own, to) >= 0;
}

/**
 * `rockBetween`, naming the rock whose circle the line cuts deepest, or -1,
 * and leaving how deep in `blockDepth`: one through its middle, nothing at a graze.
 */
export function blockingRock(
    ships: Ships,
    bodies: Bodies,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    own: number,
    to: number,
): number {
    ships.blockDepth = 0;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const lengthSq = dx * dx + dy * dy;
    if (!(lengthSq > 0)) return -1;
    let deepest = -1;
    for (let k = 0; k < ships.rockShips.length; k++) {
        const rock = ships.rockShips[k]!;
        if (ships.alive[rock] === 0) continue;
        const rb = bodies.indexOf(ships.bodyIds[rock]!);
        if (rb < 0 || rb === own || rb === to || bodies.ghost[rb] === 1) continue;
        const ox = bodies.x[rb]! - fromX;
        const oy = bodies.y[rb]! - fromY;
        const r = bodies.radius[rb]!;
        if (ox * ox + oy * oy < r * r) continue;
        const along = (ox * dx + oy * dy) / lengthSq;
        if (along <= 0 || along >= 1) continue;
        const px = ox - along * dx;
        const py = oy - along * dy;
        const depth = 1 - sqrt(px * px + py * py) / r;
        if (depth > ships.blockDepth) {
            ships.blockDepth = depth;
            deepest = rock;
        }
    }
    return deepest;
}

/**
 * Whether a hull on ship `i`'s side, under control, lies across the line from
 * its body `b` to (`toX`, `toY`), within its own radius of that hull's circle.
 * Never body `to`, nor a fighter, which will be elsewhere by the time it gets there.
 */
export function friendBetween(ships: Ships, bodies: Bodies, i: number, b: number, toX: number, toY: number, to: number): boolean {
    const fromX = bodies.x[b]!;
    const fromY = bodies.y[b]!;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const lengthSq = dx * dx + dy * dy;
    if (!(lengthSq > 0)) return false;
    const mine = ships.designs[i]!.radius;
    for (let t = 0; t < ships.alive.length; t++) {
        if (t === i || ships.alive[t] !== 1 || ships.team[t] !== ships.team[i] || ships.designs[t]!.fighter || !ships.hasControl(t))
            continue;
        const ob = bodies.indexOf(ships.bodyIds[t]!);
        if (ob < 0 || ob === b || ob === to || bodies.ghost[ob] === 1) continue;
        const ox = bodies.x[ob]! - fromX;
        const oy = bodies.y[ob]! - fromY;
        const along = (ox * dx + oy * dy) / lengthSq;
        if (along <= 0 || along >= 1) continue;
        const r = bodies.radius[ob]! + mine;
        const px = ox - along * dx;
        const py = oy - along * dy;
        if (px * px + py * py < r * r) return true;
    }
    return false;
}

/** Note which ships are asteroids, once a step: there are few, and every pilot and gun asks. */
export function noteRocks(ships: Ships, tick: number): void {
    if (ships.rocksAt === tick) return;
    ships.rocksAt = tick;
    ships.rockShips.length = 0;
    for (let t = 0; t < ships.alive.length; t++) {
        const rock = ships.alive[t] !== 0 && ships.isAsteroid(t);
        ships.rockFlag[t] = rock ? 1 : 0;
        if (rock) ships.rockShips.push(t);
    }
}

/** How long this mount waits before reconsidering, in steps. */
export function turretRethinkTicks(world: World, t: number, design: ShipDesign): number {
    const mount = design.turrets[t]!;
    const rate = mount.mount.maxRate;
    const sweep = rate > 0 ? PI / rate : TURRET_MAX_RETHINK;
    const seconds = clamp(sweep + mount.gun.cycleTime, TURRET_MIN_RETHINK, TURRET_MAX_RETHINK);
    return max(1, round(seconds / world.dt));
}

/** Train each of this ship's turrets on what it is fighting, leading it. */
export function trainOne(ships: Ships, bodies: Bodies, i: number): void {
    const indices = ships.turretIndex[i]!;
    const aiming = ships.turretAiming[i]!;
    const own = bodies.indexOf(ships.bodyIds[i]!);
    const mounts = ships.designs[i]!.turrets;
    for (let t = 0; t < indices.length; t++) {
        if (!ships.ownsAt(i, own, mounts[t]!.module)) continue;
        const ti = indices[t]!;
        const target = turretAim(ships, bodies, i, t);
        aiming[t] = NO_TARGET;
        if (target === NO_TARGET) {
            ships.turrets.returnToRest(ti);
            continue;
        }
        const tb = bodies.indexOf(ships.bodyIds[target]!);
        if (tb < 0) {
            ships.turrets.returnToRest(ti);
            continue;
        }
        // Tracked whether or not it is in reach, so the gun is already on it
        // when it closes; the trigger is held until it is (`allowSlack`).
        locateMount(ships, bodies, own, mounts[t]!);
        // Where on it: a part, when the doctrine has an opinion about parts and
        // that part is still there, and otherwise the ship.
        //
        // **The part's position, the hull's velocity.** A part does not travel
        // in the straight line a firing solution assumes: it goes round the
        // centre of mass, so extrapolating the ω × r it has right now sends the
        // aim point off on a tangent that grows with the square of the flight
        // time. Leading the *hull* instead is wrong by at most how far the part
        // sits from the centre of mass, whatever the flight time — metres,
        // against a lead measured in hundreds of them. It is the better
        // approximation for every shot long enough for the difference to
        // matter, and the tangent is worse for exactly those.
        //
        // The error it does leave — a part swinging round to the far side while
        // the round is in the air — grows with the hull's rate of turn and its
        // size, and those pull against each other: a ship large enough for the
        // offset to matter is one too heavy to spin quickly. It is also the
        // forgiving kind of error: an aim point held on the hull puts a round
        // that misses the part it was meant for into some other part of the
        // same ship, where a tangent that has run off the ship misses
        // altogether.
        const part = aimPart(ships, bodies, i, t, target, tb);
        // Nothing on it this mount will shoot at — including under an order,
        // which can say which ship to fight but cannot make a gun fire at the
        // one thing its doctrine refused. It stands down until it looks again,
        // by which time the battle or the target will have changed.
        if (part === NOTHING_AIMABLE) {
            ships.turrets.returnToRest(ti);
            continue;
        }
        aiming[t] = target;
        const design = ships.designs[target]!;
        let x = bodies.x[tb]!;
        let y = bodies.y[tb]!;
        // What the barrel has to keep up with is the part's own motion, ω × r
        // and all: that is how fast the sky it sits in is moving. Only the lead
        // is the hull's.
        let sweepVx = bodies.vx[tb]!;
        let sweepVy = bodies.vy[tb]!;
        let rx = 0;
        let ry = 0;
        if (part !== WHOLE_SHIP) {
            const angle = bodies.angle[tb]!;
            const module = design.modules[part]!;
            rx = module.x * cos(angle) - module.y * sin(angle);
            ry = module.x * sin(angle) + module.y * cos(angle);
            const spin = bodies.angularVel[tb]!;
            x += rx;
            y += ry;
            sweepVx -= spin * ry;
            sweepVy += spin * rx;
        }
        ships.turrets.aimAt(bodies, ti, x, y, bodies.vx[tb]!, bodies.vy[tb]!, sweepVx, sweepVy);
        // Sharing a body, its middle is the body's no longer: the rest may be a friend.
        let radius = design.radius;
        if (sharesBody(ships, target, tb)) {
            const own = ships.locate(bodies, target, tb, ships.sizeAt);
            rx = x - own.x;
            ry = y - own.y;
            radius = own.radius;
        }
        const slack = firingSlack(
            ships,
            aimDoctrine(ships, i, mounts[t]!),
            target,
            part,
            ships.turrets.aimDx[ti]!,
            ships.turrets.aimDy[ti]!,
            rx,
            ry,
            radius,
        );
        // In reach of what it will fire on: the part it picked if it minds what
        // it hits, and otherwise the ship, from its middle.
        const selective = refusesAnything(aimDoctrine(ships, i, mounts[t]!)) && part !== WHOLE_SHIP;
        ships.turrets.allowSlack(
            ti,
            slack,
            ships.slackOffset,
            reachOn(ships, i, mounts[t]!, target, part),
            selective ? length(x - ships.gunPoint.x, y - ships.gunPoint.y) : length(x - rx - ships.gunPoint.x, y - ry - ships.gunPoint.y),
        );
    }
}

/**
 * How far off its aim point a mount may fire and still do what its doctrine
 * asked, radians.
 *
 * **The angular size of what it is shooting at**, which is the whole of why
 * a fixed tolerance was wrong: a gun trained to within a twentieth of a
 * degree of the centre of a capital it could not miss was waiting for
 * nothing, while the same tolerance on a fighter two kilometres off is
 * looser than the target is wide.
 *
 * **Which thing has to be hit is the doctrine's own refusals, rather than a
 * setting of its own.** The question a gunner is asking is "would this shot
 * land on something I am allowed to shoot at", and the aim weights already
 * answer it. A doctrine that refuses nothing is allowed to hit any part of
 * that ship, so anywhere on the hull will do. One that refuses something is
 * not: the part it chose is the only piece it is sure of, so it holds until
 * that part is under the muzzle. A refusal therefore says two things at
 * once, and they are the same thing — *mind what you hit*.
 *
 * Where the ship will do, the cone is the whole ship's, about its middle,
 * whatever part the aim is on: `slackOffset` says how far that middle is off
 * the aim point. A gun aiming at a wing fires once anywhere on the hull is
 * under the muzzle. `partX`, `partY` and `radius` are the part's offset from
 * that middle and the ship's size, which for a ship sharing a body are its own
 * rather than the body's.
 *
 * Approximate on purpose, and in the forgiving direction: a bounding circle
 * is not a silhouette, so a target seen end-on is taken to be as wide as it
 * is long. What that costs is a shot sent at a ship that has presented its
 * bow, which is a shot at a ship rather than a shot at nothing. ROADMAP §12
 * holds the presented aspect, and with it the finer answer this
 * approximates — which of a target's *neighbouring* parts a stray shot
 * would land on, rather than whether any of them might be refused.
 */
export function firingSlack(
    ships: Ships,
    doctrine: Targeting,
    target: number,
    part: number,
    aimX: number,
    aimY: number,
    partX: number,
    partY: number,
    radius: number,
): number {
    ships.slackOffset = 0;
    const design = ships.designs[target]!;
    const range = length(aimX, aimY);
    if (!(range > 0)) return 0;

    // Selective, so the part it picked is the whole of what it will accept.
    if (refusesAnything(doctrine) && part !== WHOLE_SHIP) {
        return atan2(moduleRadius(design.modules[part]!.spec), range);
    }

    // Otherwise the whole ship's cone, about its middle: where the aim is,
    // less where the part sits on the hull, led alike.
    const cx = aimX - partX;
    const cy = aimY - partY;
    const centre = length(cx, cy);
    if (!(centre > 0)) return 0;
    ships.slackOffset = angleDelta(atan2(aimY, aimX), atan2(cy, cx));
    return atan2(radius, centre);
}

/**
 * The part of its target this mount is aiming at, or `WHOLE_SHIP`.
 *
 * Checked here rather than trusted, because what was chosen may since have
 * been shot away or broken off — and a gun holding its aim on a module that
 * is no longer there would be pointing at empty space beside the ship. A
 * target that has just come apart renumbers its modules, so a mount may aim
 * at the wrong part of it until it next looks; that is a fraction of a
 * second of pointing at the same ship, which is why it is left alone.
 */
export function aimPart(ships: Ships, bodies: Bodies, i: number, t: number, target: number, targetBody: number): number {
    const mount = ships.designs[i]!.turrets[t]!;
    const doctrine = aimDoctrine(ships, i, mount);
    const part = ships.turretAimModule[i]![t]!;
    // The ship as a whole, chosen for this target: too far out for a part.
    if (part === WHOLE_SHIP && ships.turretTarget[i]![t] === target) return WHOLE_SHIP;
    const held =
        ships.turretTarget[i]![t] !== target ||
        part === WHOLE_SHIP ||
        part === NOTHING_AIMABLE ||
        part >= ships.designs[target]!.modules.length ||
        ships.damage.spent(targetBody, part)
            ? -1
            : part;
    if (held >= 0) return held;

    // Nothing usable held: the part has been shot away, or this is a target
    // the mount was ordered onto rather than one it chose. A doctrine with no
    // refusals can fall back on the hull, which is where a mount with no
    // opinion about parts aims anyway — if it fires in the hull layer. In the
    // weapons layer amidships is deck its rounds pass over.
    const hooked = targetBody === bodies.indexOf(ships.bodyIds[i]!);
    const layers = mountLayers(ships, i, mount);
    if (!refusesAnything(doctrine) && meetsWhole(ships, layers, target) && !hooked && !sharesBody(ships, target, targetBody))
        return WHOLE_SHIP;

    // One that *has* refused something cannot: a ship's centre is whatever is
    // amidships, which on most hulls is the plating a beam has just turned
    // down. So it chooses again from what is actually left, now, and only
    // stands down when the answer is that there is nothing it will shoot at.
    // The mount is already located by the caller.
    return aimFor(ships, bodies, i, mount, layers, target, ships.gunPoint.x, ships.gunPoint.y, hooked);
}
