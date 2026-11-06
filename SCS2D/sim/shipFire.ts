import { Bodies } from "./bodies.js";
import { BOTH_LAYERS, HULL_LAYER, OWN_LAYERS, WEAPONS_LAYER } from "./hull.js";
import { DamageEffect, IMPACT_MUZZLE, type ImpactLog } from "./damage.js";
import { Claim, Resource } from "./supply.js";
import {
    casingMass,
    chargeShare,
    DEFAULT_BURST_SPEED,
    DEFAULT_FRAGMENTS,
    DEFAULT_FUSE,
    firesShells,
    type ModuleSpec,
    GunType,
} from "./modules.js";
import { Projectiles } from "./projectiles.js";
import { TurretState } from "./turrets.js";
import type { World } from "./world.js";
import type { BeamHits, Beams, SpatialGrid } from "./index.js";
import * as shipSupply from "./shipSupply.js";
import * as shipBreakup from "./shipBreakup.js";
import * as shipAim from "./shipAim.js";
import { type Ships, NO_TARGET, type FireReport } from "./ships.js";

/**
 * Firing: rounds and beams leaving the muzzles of the mounts that are ready and
 * on target, plumes scorching what they land on, and guns reloading.
 */

/** The least a fragment flies, seconds, however short its fuse. */
const FRAGMENT_MIN_LIFE = 0.5;

/**
 * Seconds a round lives before expiring. At any muzzle velocity these guns
 * reach, this is tens of kilometres — far outside an engagement — so it is a
 * guard against rounds accumulating for ever, not a range limit.
 */
const ROUND_FLIGHT_TIME = 30;

/** Twice the lead, so a fragment outlives the burst's arrival at what it was aimed at. */
function fragmentLife(spec: ModuleSpec): number {
    const life = 2 * (spec.fuse ?? DEFAULT_FUSE);
    return life > FRAGMENT_MIN_LIFE ? life : FRAGMENT_MIN_LIFE;
}

const TIMER_SETTLE = 1e-9;

/**
 * Fire every gun that is loaded, on target and clear to shoot. Call after
 * the world has stepped and the index has been rebuilt. Given `log`, each
 * round fired is recorded at its muzzle, for a flash.
 */
export function fire(
    ships: Ships,
    world: World,
    projectiles: Projectiles,
    beams: Beams,
    grid: SpatialGrid,
    beamHits: BeamHits,
    log?: ImpactLog,
): FireReport {
    ships.tick = world.tick;
    const bodies = world.bodies;
    ships.bodyStore = bodies;
    shipAim.noteRocks(ships, world.tick);
    let projectilesFired = 0;
    let beamsFired = 0;

    for (let i = 0; i < ships.alive.length; i++) {
        if (ships.alive[i] === 0) continue;
        // A gun with nothing left to tell it what to shoot at holds its fire,
        // which is the same rule for a severed chunk and for a ship whose cores
        // have gone.
        if (!ships.hasControl(i)) continue;
        const design = ships.designs[i]!;
        const indices = ships.turretIndex[i]!;
        const aiming = ships.turretAiming[i]!;
        const timers = ships.cooldown[i]!;

        const turretStates = ships.turretStates[i]!;
        const barrels = ships.nextBarrelToFire[i]!;
        const bodyIdx = bodies.indexOf(ships.bodyIds[i]!);
        if (bodyIdx < 0 || ships.onSlipway(i, bodyIdx)) continue;

        // Recoil is accumulated across the ship's guns and applied once, after
        // all of them have fired. Applying it per gun would work only for a ship
        // with one: `fireFrom` gives a round the hull's velocity, so the second
        // gun's round would inherit a hull the first gun had already pushed, and
        // the salvo would quietly gain the momentum that ordering invented. A
        // broadside leaves together.
        let impulseX = 0;
        let impulseY = 0;
        let angularImpulse = 0;
        let loaded = false;

        for (let t = 0; t < indices.length; t++) {
            let state = turretStates[t]!;
            const gun = design.turrets[t]!.gun;
            let barrel = barrels[t]!;

            // What damage has left of this mount's rate of fire. A wrecked mount
            // stops where it is: it does not finish the shot it was committed to,
            // because there is no longer a gun to finish it with.
            if (!ships.ownsAt(i, bodyIdx, design.turrets[t]!.module)) continue;
            const rate = ships.left(i, bodyIdx, design.turrets[t]!.module, DamageEffect.FireRate);
            if (!(rate > 0)) {
                turretStates[t] = TurretState.Idle;
                timers[t] = 0;
                continue;
            }

            if (timers[t]! <= 0 && state != TurretState.Idle) {
                // the timer's run out, progress the state (except idle, which only progresses when ready to fire)
                if (state == TurretState.Reloading) {
                    // finished reloading -> idle & switch to the next barrel
                    state = turretStates[t] = TurretState.Idle;
                    barrel = barrels[t] = (barrel + 1) % gun.barrelCount;
                }
                if (state == TurretState.CommittedOn) {
                    // finished firing -> reload
                    state = turretStates[t] = TurretState.Reloading;
                    timers[t] = gun.cycleTime / rate;
                }
            }

            const ti = indices[t]!;
            ships.turrets.lit[ti] = state == TurretState.CommittedOn ? 1 : 0;
            if (state == TurretState.Reloading) continue; // Can't fire while reloading.

            // What this gun was trained on, rather than what it would pick now:
            // the hull has turned since, and a target chosen after the barrel
            // stopped moving is one the barrel is not pointing at.
            const target = aiming[t]!;

            // skip if it's not ready to fire, and it's not committed to being on.
            if ((target === NO_TARGET || !ships.turrets.readyToFire(ti)) && state != TurretState.CommittedOn) continue;

            const lateralOffset = gun.barrelCount > 1 ? (barrel - (gun.barrelCount - 1) * 0.5) * gun.barrelSpacing : 0;

            ships.turrets.firingSolution(bodies, ti, ships.solution, lateralOffset);

            // A burst already committed is seen through: the emitter is lit and
            // there is nothing to hold. Discipline is about pulling the trigger.
            if (
                (state != TurretState.CommittedOn &&
                    shipAim.friendlyInTheWay(
                        ships,
                        bodies,
                        grid,
                        i,
                        bodyIdx,
                        gun,
                        target === NO_TARGET ? design.turrets[t]!.reach : ships.turrets.fireReach[ti]!,
                        target,
                        shipAim.mountLayers(ships, i, design.turrets[t]!),
                    )) ||
                (target !== NO_TARGET && shipAim.rockInTheWay(ships, bodies, bodyIdx, target))
            ) {
                continue;
            }

            if (gun.type == GunType.Projectile) {
                // A gun with nothing to load holds, ready, until there is.
                const mount = design.turrets[t]!.module;
                if (shipSupply.allowed(ships, Resource.Metal, bodyIdx, mount, Claim.Fire, gun.roundMass) < gun.roundMass) continue;
                if (!ships.metal.load(bodyIdx, mount, gun.roundMass)) continue;
                shipSupply.took(ships, Resource.Metal, bodyIdx, mount, Claim.Fire, gun.roundMass);
                loaded = true;
                const fuse = design.modules[design.turrets[t]!.module]!.spec;
                projectiles.fireFrom(
                    bodies,
                    bodyIdx,
                    ships.solution.x,
                    ships.solution.y,
                    ships.solution.dirX * gun.muzzleSpeed + ships.solution.vx,
                    ships.solution.dirY * gun.muzzleSpeed + ships.solution.vy,
                    gun.calibre,
                    ROUND_FLIGHT_TIME,
                    gun.roundMass,
                    gun.muzzleEnergy,
                    0,
                    0,
                    design.turrets[t]!.module,
                    shipAim.mountLayers(ships, i, design.turrets[t]!),
                    shipAim.fuseFor(ships, bodies, i, ti, target, fuse),
                    fuse.burstSpeed ?? DEFAULT_BURST_SPEED,
                    fragmentLife(fuse),
                    firesShells(fuse) ? (fuse.fragments ?? DEFAULT_FRAGMENTS) : 0,
                    casingMass(fuse, gun.roundMass),
                    firesShells(fuse) ? 1 - chargeShare(fuse.burstSpeed ?? DEFAULT_BURST_SPEED) : 1,
                );
                log?.push(
                    ships.solution.x,
                    ships.solution.y,
                    gun.muzzleEnergy,
                    IMPACT_MUZZLE,
                    bodies,
                    bodyIdx,
                    0,
                    0,
                    0,
                    ships.solution.dirX,
                    ships.solution.dirY,
                );

                // An impulse rather than a force: the round leaves within the step, so
                // there is no interval to spread it over. A beam mount firing off the
                // centreline also yaws its own hull, which is part of what an outrigger
                // costs.
                //
                // Only the muzzle velocity recoils. The round also leaves carrying the
                // tangential velocity of the mount it sat on, but that is momentum it
                // already had while attached rather than anything the gun gave it, so
                // the charge does not push back for it.
                //
                // The round was part of the hull's mass until it was loaded, so the
                // hull's velocity it leaves with is momentum the hull no longer has.
                const impulse = gun.roundMass * gun.muzzleSpeed;
                const jx = -ships.solution.dirX * impulse;
                const jy = -ships.solution.dirY * impulse;
                impulseX += jx;
                impulseY += jy;
                angularImpulse += (ships.solution.x - bodies.x[bodyIdx]!) * jy - (ships.solution.y - bodies.y[bodyIdx]!) * jx;

                // A battered mount loads slower, which is the whole of what damage
                // does to a gun for now.
                timers[t] = gun.cycleTime / rate;

                turretStates[t] = TurretState.Reloading; // Projectile guns immediately reload after firing.

                projectilesFired++; // increment for every shot fired
                ships.firedAt[i] = world.tick;
            } else {
                // One beam a layer, each with its share of the power: a thick
                // module takes both, and what is in one layer only takes its half
                // and lets the other go on past it, as a thick engine's flame does.
                const layers = shipAim.mountLayers(ships, i, design.turrets[t]!);
                // A craft in both layers to ram or dock fires as it is, in both at once.
                const split = layers === BOTH_LAYERS && shipAim.shipLayers(ships, i) === OWN_LAYERS;
                for (let k = 0; k < (split ? 2 : 1); k++) {
                    const layer = split ? (k === 0 ? HULL_LAYER : WEAPONS_LAYER) : layers;
                    beams.fireFrom(
                        bodyIdx,
                        ships.solution.x,
                        ships.solution.y,
                        ships.solution.dirX,
                        ships.solution.dirY,
                        gun.calibre,
                        split ? gun.beamPower / 2 : gun.beamPower,
                        0,
                        bodies,
                        grid,
                        beamHits,
                        ships.holedHulls,
                        design.turrets[t]!.module,
                        layer,
                    );
                }
                ships.firedAt[i] = world.tick;
                if (state == TurretState.Idle) {
                    // was idle before, now committed on for beamOnTime
                    turretStates[t] = TurretState.CommittedOn;
                    timers[t] = gun.beamOnTime;
                    ships.turrets.lit[ti] = 1;

                    beamsFired++; // only increment when going from idle to on.
                }
            }
        }

        // Lighter by what left, before what pushed it off acts on what remains.
        if (loaded) shipBreakup.settleMass(ships, bodies, bodyIdx);
        const mass = bodies.mass[bodyIdx]!;
        if (mass > 0 && (impulseX !== 0 || impulseY !== 0)) {
            bodies.vx[bodyIdx] = bodies.vx[bodyIdx]! + impulseX / mass;
            bodies.vy[bodyIdx] = bodies.vy[bodyIdx]! + impulseY / mass;
        }
        const inertia = bodies.inertia[bodyIdx]!;
        if (inertia > 0 && angularImpulse !== 0) {
            bodies.angularVel[bodyIdx] = bodies.angularVel[bodyIdx]! + angularImpulse / inertia;
        }
    }

    return { projectilesFired, beamsFired };
}

/**
 * Burn whatever every burning engine is pointed at.
 *
 * Driven after the index is rebuilt, like firing, and with the throttles the
 * pilot set before the world stepped: an engine damages what is behind it
 * now, where it is now.
 *
 * The thrust it burns with is what the engine is actually producing rather
 * than what it is rated at, so an engine that damage has already half killed
 * leaves a shorter, weaker flame — which is also the flame the renderer
 * draws, since `throttleOf` reports the same fraction.
 */
export function scorch(ships: Ships, world: World, grid: SpatialGrid, dt: number): void {
    const bodies = world.bodies;
    ships.bodyStore = bodies;

    for (let i = 0; i < ships.alive.length; i++) {
        if (ships.alive[i] === 0) continue;
        const bodyIdx = bodies.indexOf(ships.bodyIds[i]!);
        if (bodyIdx < 0) continue;
        const design = ships.designs[i]!;
        const throttles = ships.throttles[i]!;
        const landed = ships.landed[i]!;
        landed.fill(0);

        for (let t = 0; t < design.engines.length; t++) {
            const force = throttles[t]! * ships.exhaustOf(i, design, bodyIdx, t);
            if (!(force > 0)) continue;
            const layers = ships.pieceLayers(i, bodyIdx, design, design.engines[t]!.module ?? -1);
            ships.plumes.burn(design, t, force, ships.damage, bodies, bodyIdx, grid, ships.holedHulls, dt, landed, layers);
        }
    }
}

/**
 * How much of a step's reload a gun gets through, 0 to 1. A gun that loads
 * rounds gets all of it. A beam refills its bank from its piece of hull's
 * power over its reload, so it gets the share of the step's energy that
 * power could supply.
 */
export function recharged(ships: Ships, b: number, i: number, t: number, dt: number): number {
    if (ships.turretStates[i]![t] !== TurretState.Reloading) return 1;
    const mount = ships.designs[i]!.turrets[t]!;
    const gun = mount.gun;
    if (gun.type !== GunType.Beam || !(gun.cycleTime > 0)) return 1;
    const rate = ships.damage.remaining(b, mount.module, DamageEffect.FireRate);
    const need = (gun.beamPower * gun.beamOnTime * rate * dt) / gun.cycleTime;
    if (!(need > 0)) return 1;
    const allowed = shipSupply.allowed(ships, Resource.Charge, b, mount.module, Claim.Fire, need);
    const got = ships.power.draw(b, mount.module, need < allowed ? need : allowed);
    shipSupply.took(ships, Resource.Charge, b, mount.module, Claim.Fire, got);
    return got / need;
}

/** Run down each of ship `i`'s mounts' reload, as far as its power allows. */
export function reloadOne(ships: Ships, dt: number, bodies: Bodies, i: number): void {
    const timers = ships.cooldown[i]!;
    const b = bodies.indexOf(ships.bodyIds[i]!);
    const mounts = ships.designs[i]!.turrets;
    // The main battery first, so it has the power when there is not enough to go round.
    for (let pass = 0; pass < 2; pass++) {
        for (let t = 0; t < timers.length; t++) {
            if (mounts[t]!.main !== (pass === 0) || !ships.ownsAt(i, b, mounts[t]!.module)) continue;
            if (timers[t]! > 0) {
                const remaining = timers[t]! - dt * recharged(ships, b, i, t, dt);
                timers[t] = remaining > TIMER_SETTLE ? remaining : 0;
            }
        }
    }
}
