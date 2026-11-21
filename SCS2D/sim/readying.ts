import type { ShipDesign } from "./blueprint.js";
import { billOf } from "./bill.js";
import { REPAIR_ENERGY_PER_JOULE } from "./damage.js";
import { max, min } from "./math.js";
import { fillOf, ROBOT_CHARGE, ROBOT_REFILL_TIME, ROBOT_REPAIR_RATE, shotCharge, shotFuel } from "./modules.js";

/**
 * Readying a fleet in the time its build leaves before a battle.
 *
 * The yard's robots build the ships one at a time, all on one together, the
 * slowest to ready first. A finished ship then has until the deadline to load
 * its guns, its generators charging them, then its robots, then its batteries.
 * Once the whole fleet is built the robots' own power charges its batteries.
 * Nothing sets out loaded or charged for nothing; the first round's metal and
 * fuel are on the bill (`billOf`), so holds and tanks set out full.
 */

/** What one of the yard's robots draws working, W: what it charges batteries at once the fleet is built. */
export const YARD_POWER = ROBOT_REPAIR_RATE * REPAIR_ENERGY_PER_JOULE;

/** How long a ship has to ready itself, and what the yard puts in its batteries. */
export interface Ready {
    /** Seconds from when it is built to the battle. */
    readonly spare: number;
    /** The share, 0 to 1, of the room its generators leave in its batteries that the yard fills. */
    readonly yard: number;
}

/** Ready for anything: what a ship with no deadline sets out as. */
export const FULLY_READY: Ready = { spare: Infinity, yard: 1 };

/** How far a ship got with its readying, by its design's mounts, robots and modules. */
export interface Readied {
    /** Seconds left of each mount's first reload. */
    readonly reload: Float64Array;
    /** What each rail gun's bank holds, J. */
    readonly bank: Float64Array;
    /** Fuel the budget paid towards each mount's unfinished first reload, kg. */
    readonly primed: Float64Array;
    /** Each robot's charge, J, bay by bay as they are berthed. */
    readonly robots: Float64Array;
    /** What each module's batteries hold, J. */
    readonly charge: Float64Array;
}

/** A lance charged only once it is on target, which sets out uncharged whatever the time. */
function waitsForTarget(design: ShipDesign, t: number): boolean {
    const spec = design.modules[design.turrets[t]!.module]?.spec;
    return spec !== undefined && spec.kind === "plasmaLance" && spec.ready !== true;
}

/** Robots berthed in each module, in the order `Robots.register` stocks them. */
function robotBays(design: ShipDesign): number[] {
    const bays: number[] = [];
    for (let m = 0; m < design.modules.length; m++) {
        for (let r = 0; r < design.modules[m]!.stats.robots; r++) bays.push(m);
    }
    return bays;
}

/** Each module's battery as it sets out: as full as it is built to be. */
function batteryOf(design: ShipDesign, m: number): number {
    const module = design.modules[m]!;
    return module.stats.charge * fillOf(module.spec);
}

/**
 * What a design's generators load and charge in `spare` seconds, and when
 * each load is done: every module that draws charge before the battle, in
 * order (the main battery's mounts, the other mounts, robots, batteries), each
 * taking what its piece of hull makes as fast as it can, what is left going on.
 */
class Charging {
    /** Joules each load needs, draws at most a second, and has had. */
    readonly need: number[] = [];
    readonly rate: number[] = [];
    readonly got: number[] = [];
    /** When each load was done, s; Infinity if it never was. */
    readonly done: number[] = [];
    private readonly piece: number[] = [];
    /** Which load each mount's charge is, and each robot's, and each battery module's; -1 for none. */
    readonly mountLoad: number[] = [];
    readonly robotLoad: number[] = [];
    readonly batteryLoad: number[] = [];

    constructor(design: ShipDesign, spare: number) {
        const pieceOf = (m: number): number => design.pieces?.[m] ?? 0;
        const turrets = design.turrets;
        this.mountLoad = turrets.map(() => -1);
        for (const main of [true, false]) {
            for (let t = 0; t < turrets.length; t++) {
                const mount = turrets[t]!;
                if (mount.main !== main || waitsForTarget(design, t)) continue;
                const gun = mount.gun;
                const bank = gun.bankEnergy > 0;
                const need = bank ? gun.bankEnergy : shotCharge(gun);
                if (!(need > 0)) continue;
                const rate = bank ? gun.bankPower : gun.cycleTime > 0 ? need / gun.cycleTime : Infinity;
                this.mountLoad[t] = this.add(need, rate, pieceOf(mount.module));
            }
        }
        for (const bay of robotBays(design)) this.robotLoad.push(this.add(ROBOT_CHARGE, ROBOT_CHARGE / ROBOT_REFILL_TIME, pieceOf(bay)));
        for (let m = 0; m < design.modules.length; m++) {
            const need = batteryOf(design, m);
            this.batteryLoad.push(need > 0 ? this.add(need, design.modules[m]!.stats.chargeRate, pieceOf(m)) : -1);
        }

        const pieces = this.piece.reduce((most, p) => (p + 1 > most ? p + 1 : most), 0);
        const made = new Float64Array(pieces);
        for (let m = 0; m < design.modules.length; m++) {
            const p = pieceOf(m);
            if (p < pieces) made[p] = made[p]! + design.modules[m]!.stats.generation;
        }
        this.run(made, spare);
    }

    private add(need: number, rate: number, piece: number): number {
        this.need.push(need);
        this.rate.push(rate);
        this.got.push(0);
        this.done.push(Infinity);
        this.piece.push(piece);
        return this.need.length - 1;
    }

    /** Charge until `spare` runs out or nothing more can be charged; each step lasts until a load fills. */
    private run(made: Float64Array, spare: number): void {
        const n = this.need.length;
        const flow = new Float64Array(n);
        const left = new Float64Array(made.length);
        let t = 0;
        while (t < spare) {
            left.set(made);
            let step = spare - t;
            let any = false;
            for (let k = 0; k < n; k++) {
                flow[k] = 0;
                if (this.got[k]! >= this.need[k]!) continue;
                const p = this.piece[k]!;
                const take = this.rate[k]! < left[p]! ? this.rate[k]! : left[p]!;
                if (!(take > 0)) continue;
                flow[k] = take;
                left[p] = left[p]! - take;
                const until = (this.need[k]! - this.got[k]!) / take;
                if (until < step) step = until;
                any = true;
            }
            if (!any) return;
            t += step;
            for (let k = 0; k < n; k++) {
                if (!(flow[k]! > 0)) continue;
                const got = this.got[k]! + flow[k]! * step;
                if (got >= this.need[k]! * (1 - 1e-12)) {
                    this.got[k] = this.need[k]!;
                    this.done[k] = t;
                } else {
                    this.got[k] = got;
                }
            }
        }
    }

    /** The share, 0 to 1, of load `k` done; 1 for no load. */
    share(k: number): number {
        return k < 0 ? 1 : this.got[k]! / this.need[k]!;
    }
}

/** What `design` has done of its readying given `ready`. */
export function readied(design: ShipDesign, ready: Ready): Readied {
    return readiedBy(design, ready, ready.spare === Infinity);
}

/** `readied`, everything simply full for no deadline where `full`, or as far as its generators would ever get it. */
function readiedBy(design: ShipDesign, ready: Ready, full: boolean): Readied {
    const turrets = design.turrets;
    const reload = new Float64Array(turrets.length);
    const bank = new Float64Array(turrets.length);
    const primed = new Float64Array(turrets.length);
    const bays = robotBays(design);
    const robots = new Float64Array(bays.length);
    const charge = new Float64Array(design.modules.length);
    const charging = full ? null : new Charging(design, ready.spare);

    for (let t = 0; t < turrets.length; t++) {
        const gun = turrets[t]!.gun;
        if (waitsForTarget(design, t)) {
            reload[t] = gun.cycleTime;
            continue;
        }
        if (gun.bankEnergy > 0) {
            bank[t] = gun.bankEnergy * (charging === null ? 1 : charging.share(charging.mountLoad[t]!));
            reload[t] = full || !(gun.cycleTime > ready.spare) ? 0 : gun.cycleTime - ready.spare;
            continue;
        }
        // Its charge drawn as it reloads, so the two go together; a gun drawing
        // none reloads as fast as its machinery.
        const load = charging === null ? -1 : charging.mountLoad[t]!;
        const share =
            charging === null ? 1 : load >= 0 ? charging.share(load) : gun.cycleTime > 0 ? min(1, ready.spare / gun.cycleTime) : 1;
        reload[t] = share < 1 ? gun.cycleTime * (1 - share) : 0;
        primed[t] = share < 1 ? shotFuel(gun) * (1 - share) : 0;
    }
    for (let r = 0; r < bays.length; r++) robots[r] = ROBOT_CHARGE * (charging === null ? 1 : charging.share(charging.robotLoad[r]!));
    for (let m = 0; m < design.modules.length; m++) {
        const most = batteryOf(design, m);
        if (!(most > 0)) continue;
        const own = charging === null ? most : charging.got[charging.batteryLoad[m]!]!;
        charge[m] = own + (most - own) * ready.yard;
    }
    return { reload, bank, primed, robots, charge };
}

/** Room its generators leave in a design's batteries after `spare` seconds, J. */
function batteryRoom(design: ShipDesign, spare: number): number {
    const charge = readied(design, { spare, yard: 0 }).charge;
    let room = 0;
    for (let m = 0; m < design.modules.length; m++) room += batteryOf(design, m) - charge[m]!;
    return room;
}

/**
 * How long a design and the fighters it sets out with take to load every gun
 * they can, s, once built: its readying time, by which a yard orders its
 * build. A gun its generators could never load counts for nothing, since no
 * amount of time would help it.
 */
export function readyingTime(design: ShipDesign): number {
    const charging = new Charging(design, Infinity);
    let most = 0;
    for (let t = 0; t < design.turrets.length; t++) {
        if (waitsForTarget(design, t)) continue;
        const gun = design.turrets[t]!.gun;
        const load = charging.mountLoad[t]!;
        const charged = load < 0 ? 0 : charging.done[load]!;
        const time = gun.bankEnergy > 0 || load < 0 ? max(gun.cycleTime, charged) : charged;
        if (time !== Infinity && time > most) most = time;
    }
    for (const aboard of design.aboard ?? []) most = max(most, readyingTime(aboard.design));
    return most;
}

/** A yard: the time before the battle, s, and how many robots build in it. */
export interface Yard {
    readonly deadline: number;
    readonly robots: number;
}

/** No deadline: every ship sets out ready. */
export const NO_YARD: Yard = { deadline: Infinity, robots: 1 };

/** When each ship of a fleet is built, s from the yard starting, in the order the yard builds them. */
export function buildOrder(designs: readonly ShipDesign[], robots: number): { order: number[]; finish: number[] } {
    const keys = designs.map(readyingTime);
    const order = designs.map((_, i) => i).sort((a, b) => keys[b]! - keys[a]! || a - b);
    const finish = new Array<number>(designs.length).fill(0);
    let t = 0;
    for (const i of order) {
        t += billOf(designs[i]!).build / max(1, robots);
        finish[i] = t;
    }
    return { order, finish };
}

/**
 * How ready each of a fleet's ships sets out, built by `yard`: its spare time
 * the deadline less when it is built, and the yard's charge shared out across
 * the fleet's batteries in proportion to the room their generators leave.
 */
export function schedule(designs: readonly ShipDesign[], yard: Yard): Ready[] {
    if (yard.deadline === Infinity) return designs.map(() => FULLY_READY);
    const robots = max(1, yard.robots);
    const { finish } = buildOrder(designs, robots);
    const spares = finish.map((t) => (yard.deadline > t ? yard.deadline - t : 0));
    let work = 0;
    for (const design of designs) work += billOf(design).build;
    const pool = YARD_POWER * max(0, robots * yard.deadline - work);
    let room = 0;
    designs.forEach((design, i) => {
        room += batteryRoom(design, spares[i]!);
        for (const aboard of design.aboard ?? []) room += batteryRoom(aboard.design, spares[i]!);
    });
    const share = room > 0 ? min(1, pool / room) : 1;
    return spares.map((spare) => ({ spare, yard: share }));
}

/** Whether `got` is as ready as `best`, near enough. */
function asReady(got: Readied, best: Readied): boolean {
    const close = (a: number, b: number): boolean => a >= b - 1e-6 * (b > 1 ? b : 1);
    for (let k = 0; k < best.reload.length; k++) if (!close(best.reload[k]!, got.reload[k]!)) return false;
    for (const key of ["bank", "robots", "charge"] as const) {
        for (let k = 0; k < best[key].length; k++) if (!close(got[key][k]!, best[key][k]!)) return false;
    }
    return true;
}

/**
 * The least time before the battle, s, in which `robots` robots build a fleet
 * and it readies itself as far as it ever could: every gun its generators can
 * load loaded, and every robot and battery charged. What a skirmish's budget
 * starts at, so neither side sets out short.
 */
export function readyDeadline(designs: readonly ShipDesign[], robots = 1): number {
    const crew = max(1, robots);
    let work = 0;
    for (const design of designs) work += billOf(design).build;
    const all = (design: ShipDesign): ShipDesign[] => [design, ...(design.aboard ?? []).map((aboard) => aboard.design)];
    const best = designs.map((design) => all(design).map((d) => readiedBy(d, { spare: Infinity, yard: 1 }, false)));
    const ok = (deadline: number): boolean =>
        schedule(designs, { deadline, robots: crew }).every((ready, i) =>
            all(designs[i]!).every((d, k) => asReady(readiedBy(d, ready, false), best[i]![k]!)),
        );
    let low = work / crew;
    if (ok(low)) return low;
    let high = low + 1;
    for (let k = 0; k < 64 && !ok(high); k++) {
        low = high;
        high = low + (high - work / crew) * 2;
    }
    for (let k = 0; k < 48 && high - low > 0.01; k++) {
        const mid = (low + high) / 2;
        if (ok(mid)) high = mid;
        else low = mid;
    }
    return high;
}
