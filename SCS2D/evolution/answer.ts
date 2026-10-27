import { DAMAGE_ENERGY_PER_KG, fleetBill, fleetHulls, fleetReach, math, Rng, shipFleet, type Budget, type Fleet } from "../sim/index.js";
import { BARE_CORE } from "../scenarios/blueprints.js";
import { customBattle, tally, winner, type CustomBattle } from "../scenarios/customBattle.js";
import { Activity, type Decision } from "../scenarios/decision.js";
import {
    DEFAULT_SKIRMISH_SETTINGS,
    nextMultiplier,
    roundBattle,
    startingMultiplier,
    type SkirmishSettings,
} from "../scenarios/skirmish.js";
import { breeding, type Breeding } from "./mutationFields.js";
import { mutateFleet } from "./fleetMutate.js";

/**
 * The skirmish enemy's answer to a fleet that beat it (ROADMAP.md §8 step 5):
 * mutants of the enemy fought against the player's fleet, held fixed, until
 * one beats it.
 *
 * A generation is the best enemy so far and a handful of its mutants, each
 * fought on the next round's seed and on a few random ones. A match is
 * fought under evolution's rules — over once one side alone is armed, or at a
 * time limit, an enemy ahead then being taken to win in the end — and the
 * best of the generation, by all its matches, breeds the next. An enemy that
 * wins on the next round's seed is checked by fighting that round to the
 * skirmish's decision: the first that wins that, by `answerMargin`, is the
 * answer, and one that does not is not counted as having won on it.
 *
 * Beside those, each enemy fights drills that only add to its score, never
 * to its wins: against a bare core, to learn to hit something at all, and
 * against the player's fleet with itself made invincible, to learn to hurt
 * that fleet before it is stripped by it. Each is scored by how much of the
 * other side it destroyed, and how soon it finished the job — the core
 * destroyed, or the fleet left with nothing to fire.
 *
 * Every match, real or drill, also scores the damage the enemy did, hits on
 * what makes a ship work counting for more than hits on bare structure, so an
 * enemy that hits without yet breaking anything off still has something to
 * climb.
 *
 * An answer may cost the player's budget times a multiplier, and no less than
 * the enemy it answers already does; a search that goes long without one
 * steps the multiplier up, again and again, and the skirmish keeps it.
 *
 * Worked a step at a time, so a page or a worker can do it in slices and look
 * in between. Everything is decided by the seed it is given.
 */

/** What the search is run under: the skirmish's settings, the round's rules and how the enemy is bred among them. */
export type AnswerSettings = SkirmishSettings;

export const DEFAULT_ANSWER: AnswerSettings = DEFAULT_SKIRMISH_SETTINGS;

/** How often a match looks to see whether it is over, steps. */
const CHECK_EVERY = 30;

/** How one enemy did in a generation. */
export interface Standing {
    readonly enemy: Fleet;
    /** Matches won. */
    wins: number;
    /** Whether it won on the next round's seed: the match a timeline shows of it. */
    onRound: boolean;
    /** Summed, of how far ahead it finished each in what is left of either side, and one more for a win outright or one less for a loss. */
    margin: number;
}

export interface Progress {
    /** Generations finished. */
    readonly generation: number;
    /** The best enemy so far, and how it did in the last generation it fought. */
    readonly best: Standing;
    readonly seeds: number;
    /** The answer, once there is one. */
    readonly found: Fleet | null;
    /** The enemy's budget as a multiple of the player's: where it began, up a `budgetStep` each time the search stalled. */
    readonly multiplier: number;
}

/**
 * One piece of a generation's work, which needs nothing but itself, the
 * player's fleet and the search's settings: a match an enemy fights on a seed,
 * a drill, or the round fought to its decision by an enemy that won it. So
 * pieces can be fought anywhere, in any order, and give the same results.
 */
export type AnswerJob =
    | { readonly kind: "match"; readonly enemy: Fleet; readonly seed: number }
    | { readonly kind: "drill"; readonly enemy: Fleet; readonly drill: Drill }
    | { readonly kind: "check"; readonly enemy: Fleet };

/** What a match or drill adds to its enemy's standing; whether a check answered the round. */
export type JobResult = { readonly margin: number; readonly win: boolean } | { readonly answered: boolean };

/** A job handed out, and which generation and piece of it it is, so a late result is known for one. */
export interface Ticket {
    readonly epoch: number;
    readonly index: number;
    readonly job: AnswerJob;
}

export class EnemySearch {
    private readonly rng: Rng;
    private readonly settings: AnswerSettings;
    /** How the enemy is bred, from the settings' mutation odds. */
    private readonly bred: Breeding;
    private readonly radius: number;
    /** What the enemy cost and how many ships it had: an answer may always have as much. */
    private readonly startBill: Budget;
    private readonly startShips: number;
    private multiplier: number;
    private generationCount = 0;
    private best: Standing;
    private found: Fleet | null = null;

    // The generation being fought, and what has come back of it.
    private standings: Standing[] = [];
    private seeds: number[] = [];
    private drills: Drill[] = [];
    // Bumped whenever the pieces handed out change, so a result for an earlier set is dropped.
    private epoch = 0;
    private phase: "fight" | "check" = "fight";
    private handed = 0;
    private results: (JobResult | undefined)[] = [];
    private complete: boolean[] = [];
    // The enemies that won on the round, the better first, each checked to the decision.
    private candidates: Standing[] = [];
    // The piece being fought by `advance`.
    private running: { ticket: Ticket; runner: JobRunner } | null = null;

    constructor(
        private readonly player: Fleet,
        enemy: Fleet,
        /** The next round's seed, which the answer must win on. */
        private readonly wonSeed: number,
        seed: number,
        settings: Partial<AnswerSettings> = {},
        /** The player's budget, which the enemy's is a multiple of; what the enemy cost where not given. */
        private readonly playerBudget?: Budget,
        multiplier = 1,
    ) {
        this.multiplier = multiplier;
        this.rng = new Rng(seed);
        this.settings = { ...DEFAULT_ANSWER, ...settings };
        const odds = this.settings.breeding;
        this.bred = breeding((name) => odds[name]);
        const hulls = fleetHulls(enemy);
        // The skirmish's limit, unless the enemy already reaches past it.
        this.radius = math.max(this.settings.radius, fleetReach(hulls));
        this.startBill = fleetBill(hulls);
        this.multiplier = startingMultiplier(this.multiplier, playerBudget ?? this.startBill, this.startBill);
        this.startShips = hulls.length;
        this.best = { enemy, wins: 0, onRound: false, margin: -Infinity };
        this.begin();
    }

    get progress(): Progress {
        return {
            generation: this.generationCount,
            best: this.best,
            seeds: this.settings.seeds,
            found: this.found,
            multiplier: this.multiplier,
        };
    }

    /**
     * The best enemy so far of the generation being fought, of those that have
     * fought every match of it, or null before one has: what a long generation
     * shows while it is fought.
     */
    get leader(): Standing | null {
        let leader: Standing | null = null;
        for (let i = 0; i < this.standings.length; i++) {
            if (!this.complete[i]) continue;
            const standing = this.standings[i]!;
            if (leader === null || better(standing, leader)) leader = standing;
        }
        return leader;
    }

    /**
     * What an answer may cost and field: the player's budget times the
     * multiplier, and the skirmish's ship limit, each never less than the enemy
     * it answers already has.
     */
    get limits(): { budget: Budget; maxShips: number } {
        const base = this.playerBudget ?? this.startBill;
        const m = this.multiplier;
        return {
            budget: {
                metal: math.max(this.startBill.metal, base.metal * m),
                fuel: math.max(this.startBill.fuel, base.fuel * m),
                build: math.max(this.startBill.build, base.build * m),
            },
            maxShips: math.max(this.startShips, this.settings.maxShips),
        };
    }

    /** What every piece of work is fought against: the player's fleet, the round's seed and the settings. */
    get setup(): { readonly player: Fleet; readonly wonSeed: number; readonly settings: AnswerSettings } {
        return { player: this.player, wonSeed: this.wonSeed, settings: this.settings };
    }

    /**
     * Fight up to `steps` battle steps of the search here, a piece at a time.
     * Whether there is an answer.
     */
    advance(steps: number): boolean {
        let left = steps;
        while (left > 0 && this.found === null) {
            if (this.running === null) {
                const ticket = this.take();
                if (ticket === null) break;
                this.running = { ticket, runner: new JobRunner(ticket.job, this.player, this.settings, this.wonSeed) };
            }
            left -= this.running.runner.advance(left);
            const { ticket, runner } = this.running;
            if (runner.result === null) continue;
            this.running = null;
            this.give(ticket, runner.result);
        }
        return this.found !== null;
    }

    /**
     * The next piece of work to fight, or null while every piece of this stage
     * is out and the next waits on them, or once there is an answer. Pieces
     * may be handed out several at a time and fought anywhere; the search
     * comes out the same whatever order their results come back in.
     */
    take(): Ticket | null {
        if (this.found !== null) return null;
        const index = this.handed;
        if (this.phase === "fight") {
            const each = this.seeds.length + this.drills.length;
            if (index >= this.standings.length * each) return null;
            this.handed++;
            const enemy = this.standings[math.floor(index / each)]!.enemy;
            const match = index % each;
            const job: AnswerJob =
                match < this.seeds.length
                    ? { kind: "match", enemy, seed: this.seeds[match]! }
                    : { kind: "drill", enemy, drill: this.drills[match - this.seeds.length]! };
            return { epoch: this.epoch, index, job };
        }
        if (index >= this.candidates.length) return null;
        this.handed++;
        return { epoch: this.epoch, index, job: { kind: "check", enemy: this.candidates[index]!.enemy } };
    }

    /** Take back what a piece of work came to. One handed out before the stage it was for ended is dropped. */
    give(ticket: Ticket, result: JobResult): void {
        if (ticket.epoch !== this.epoch || this.found !== null || this.results[ticket.index] !== undefined) return;
        this.results[ticket.index] = result;
        if (this.phase === "fight") this.tally(ticket.index);
        else this.settle();
    }

    private begin(): void {
        const parent = this.best.enemy;
        this.standings = [{ enemy: parent, wins: 0, onRound: false, margin: 0 }];
        const limits = {
            ...this.limits,
            ...this.bred.fleet,
            radius: this.radius,
            ship: this.bred.ship,
            operators: this.bred.operators,
            rivals: [this.player],
        };
        for (let i = 0; i < this.settings.mutants; i++) {
            const child = mutateFleet(parent, this.rng, limits).fleet;
            this.standings.push({ enemy: child, wins: 0, onRound: false, margin: 0 });
        }
        this.seeds = [this.wonSeed];
        while (this.seeds.length < this.settings.seeds) this.seeds.push(this.rng.nextUint32());
        this.drills = [];
        for (let i = 0; i < this.settings.bareCoreDrills; i++) this.drills.push({ kind: "bareCore", seed: this.rng.nextUint32() });
        for (let i = 0; i < this.settings.shieldedDrills; i++) this.drills.push({ kind: "shielded", seed: this.rng.nextUint32() });
        this.stage("fight");
        this.complete = this.standings.map(() => false);
    }

    private stage(phase: "fight" | "check"): void {
        this.phase = phase;
        this.epoch++;
        this.handed = 0;
        this.results = [];
    }

    /**
     * An enemy whose every match is back is scored, its matches added up in the
     * order they were drawn, so the sums are the same however the results came.
     * Once every enemy is, the generation is.
     */
    private tally(index: number): void {
        const each = this.seeds.length + this.drills.length;
        const at = math.floor(index / each);
        for (let k = 0; k < each; k++) if (this.results[at * each + k] === undefined) return;
        const standing = this.standings[at]!;
        for (let k = 0; k < each; k++) {
            const result = this.results[at * each + k]! as { margin: number; win: boolean };
            standing.margin += result.margin;
            if (result.win) standing.wins++;
            // The round's own seed is always the first an enemy fights.
            if (k === 0) standing.onRound = result.win;
        }
        this.complete[at] = true;
        if (this.complete.every((done) => done)) this.finishGeneration();
    }

    /** Every match fought: pick the best, and check each that won on the round, the better first. */
    private finishGeneration(): void {
        let best = this.standings[0]!;
        for (const standing of this.standings) if (better(standing, best)) best = standing;
        this.best = best;
        const onRound = this.standings.filter((standing) => standing.onRound);
        onRound.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
        this.candidates = onRound;
        this.stage("check");
        this.settle();
    }

    /**
     * Go through the checks in order as far as they have come back: the first
     * that answered the round is the answer, whatever came back after it, and
     * one that did not is not counted as having won on it. All failed, the
     * generation is done.
     */
    private settle(): void {
        for (let i = 0; i < this.candidates.length; i++) {
            const result = this.results[i] as { answered: boolean } | undefined;
            if (result === undefined) return;
            const standing = this.candidates[i]!;
            standing.onRound = result.answered;
            if (result.answered) {
                this.found = standing.enemy;
                this.best = standing;
                this.generationCount++;
                return;
            }
        }
        this.nextGeneration();
    }

    /** The generation done and its winners checked: count it, and breed the next. */
    private nextGeneration(): void {
        this.generationCount++;
        // Long without an answer: a bigger budget, for good.
        if (this.generationCount % this.settings.stretchAfter === 0) {
            this.multiplier = nextMultiplier(this.multiplier, this.settings.budgetStep);
        }
        this.begin();
    }
}

/**
 * One piece of work fought a slice at a time: a match, scored by how far ahead
 * the enemy finished, whether it won, and the damage it did; a drill, scored
 * by what it destroyed and how soon; or the round, to the skirmish's decision.
 */
export class JobRunner {
    result: JobResult | null = null;
    private readonly battle: CustomBattle;
    private readonly activity: Activity | null = null;
    // The weighted damage the enemy has done, J.
    private dealt = 0;

    constructor(
        private readonly job: AnswerJob,
        player: Fleet,
        private readonly settings: AnswerSettings,
        wonSeed: number,
    ) {
        if (job.kind === "match") {
            // On the round's map whatever the seed, so the enemy is bred for the place it answers in.
            this.battle = customBattle(roundBattle(player, job.enemy, job.seed, settings, wonSeed));
        } else if (job.kind === "drill") {
            this.battle = drillBattle(job.drill, player, job.enemy, settings, wonSeed);
        } else {
            this.battle = customBattle(roundBattle(player, job.enemy, wonSeed, settings));
            this.activity = new Activity(2, settings.timeCap, settings.quietTime);
        }
    }

    /** Fight up to `steps` of it; how many it took. Its result is set once it is over. */
    advance(steps: number): number {
        if (this.result !== null) return 0;
        if (this.job.kind === "check") return this.check(steps);
        const battle = this.battle;
        const limit = math.round(this.settings.duration / battle.dt);
        let taken = 0;
        while (taken < steps) {
            battle.step();
            taken++;
            this.dealt += damageDealt(battle);
            const tick = battle.world.tick;
            if (tick % CHECK_EVERY !== 0 && tick < limit) continue;
            if (this.job.kind === "match") {
                const now = tally(battle, 2);
                const decided = winner(now);
                if (decided === null && tick < limit) continue;
                // How much more of itself the enemy has left than the player, as a share
                // of each: a loss that hurt the player more is a better loss.
                const ahead = share(now[1]!.mass, battle.start[1]!.mass) - share(now[0]!.mass, battle.start[0]!.mass);
                // A loss is worth more the longer it was held off, which is what lets a
                // search that loses every match still tell its enemies apart.
                const held = math.min(1, tick / limit);
                // Ahead when time runs out is taken as a win to come.
                this.result = {
                    margin: ahead + (decided === 1 ? 1 : decided !== null ? held - 1 : 0) + this.damageScore(),
                    win: decided === 1 || (decided === null && ahead > 0),
                };
                break;
            }
            // A drill adds to the enemy's score: the share of the other side it destroyed,
            // and one more for finishing the job, less the share of the match that took.
            const target = tally(battle, 2)[0]!;
            // A bare core is done with once it is gone; a fleet once it has nothing left to fire.
            const done = this.job.drill.kind === "bareCore" ? target.ships === 0 : target.armed === 0;
            if (!done && tick < limit) continue;
            const destroyed = 1 - share(target.mass, battle.start[0]!.mass);
            this.result = { margin: destroyed + (done ? 1 - math.min(1, tick / limit) : 0) + this.damageScore(), win: false };
            break;
        }
        return taken;
    }

    /** Fight it to the end, as a worker that does nothing else does. */
    finish(): JobResult {
        while (this.result === null) this.advance(1 << 20);
        return this.result;
    }

    /**
     * The damage the enemy did, from 0 to 1: its share of what would wreck the
     * player's side to its last kilogram were every hit on what makes it work,
     * on a log scale, so the first few hits of an enemy that can barely hit
     * count for something and each tenfold more for as much again.
     */
    private damageScore(): number {
        const whole = FUNCTIONAL_WEIGHT * DAMAGE_ENERGY_PER_KG * this.battle.start[0]!.mass;
        return damageScale(whole > 0 ? math.min(1, this.dealt / whole) : 0);
    }

    /** Fight the round to its decision for up to `steps`; how many it took. */
    private check(steps: number): number {
        const battle = this.battle;
        let taken = 0;
        let decision: Decision | null = null;
        while (taken < steps && decision === null) {
            battle.step();
            taken++;
            decision = this.activity!.observe(battle);
        }
        if (decision !== null) {
            // Its win on the round is the decision's, not the time limit's, and by the margin asked.
            const now = tally(battle, 2);
            const ahead = share(now[1]!.mass, battle.start[1]!.mass) - share(now[0]!.mass, battle.start[0]!.mass);
            this.result = { answered: decision.winner === 1 && ahead >= this.settings.answerMargin };
        }
        return taken;
    }
}

/** Whether one enemy did better than another: more wins, then the wider margin. */
function better(a: Standing, b: Standing): boolean {
    return a.wins > b.wins || (a.wins === b.wins && a.margin > b.margin);
}

/** How much more a hit on anything but bare structure counts, as it is what makes a ship work. */
const FUNCTIONAL_WEIGHT = 3;

/** The smallest share of damage that scores, below which a hit is a rounding error: a millionth. */
const LEAST_DAMAGE = 1e-6;

/** A share of damage, 0 to 1, on a log scale from `LEAST_DAMAGE` to the whole. */
export function damageScale(share: number): number {
    if (!(share > 0)) return 0;
    return math.log(1 + share / LEAST_DAMAGE) / math.log(1 + 1 / LEAST_DAMAGE);
}

/** The damage the enemy (side 1) did to the player's side (side 0) in the step just taken, weighted, J. */
export function damageDealt(battle: CustomBattle): number {
    const { ships, credit } = battle;
    let dealt = 0;
    for (let h = 0; h < credit.count; h++) {
        const attacker = ships.pilotAt(credit.attacker[h]!, credit.attackerModule[h]!);
        const victim = ships.pilotAt(credit.victim[h]!, credit.module[h]!);
        if (attacker < 0 || victim < 0 || ships.teamOf(attacker) !== 1 || ships.teamOf(victim) !== 0) continue;
        const kind = ships.damage.kindAt(credit.victim[h]!, credit.module[h]!);
        dealt += credit.energy[h]! * (kind === "structure" ? 1 : FUNCTIONAL_WEIGHT);
    }
    return dealt;
}

/** A match that only adds to an enemy's score. */
export interface Drill {
    readonly kind: "bareCore" | "shielded";
    readonly seed: number;
}

/** A drill's battle: the enemy against a bare core, or invincible against the player's fleet. */
export function drillBattle(drill: Drill, player: Fleet, enemy: Fleet, settings: AnswerSettings, mapSeed = drill.seed): CustomBattle {
    if (drill.kind === "bareCore") return customBattle(roundBattle(shipFleet(BARE_CORE), enemy, drill.seed, settings, mapSeed));
    const battle = customBattle(roundBattle(player, enemy, drill.seed, settings, mapSeed));
    const { ships, world } = battle;
    for (let i = 0; i < ships.highWater; i++) {
        if (ships.isAlive(i) && ships.teamOf(i) === 1) ships.damage.protect(world.bodies.indexOf(ships.body(i)));
    }
    return battle;
}

/**
 * How much of what a side started with it still has, never more than all of
 * it: a side that mines, or builds ships of its own, can end a match heavier
 * than it began, and that is not more of itself left to fight with.
 */
export function share(now: number, start: number): number {
    return start > 0 ? math.min(1, now / start) : 0;
}
