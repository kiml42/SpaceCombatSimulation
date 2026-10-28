import { Rng } from "../sim/index.js";
import { max, min } from "../sim/math.js";
import { BARE_CORE } from "../scenarios/blueprints.js";
import { DEFAULT_MATCH, isFleet, Match, type Entrant, type Score } from "./match.js";
import { breed, fitness, type Generation, type Individual } from "./generation.js";
import {
    DEFAULT_RUN,
    describe,
    fleetLimits,
    mutationLimits,
    seedPopulation,
    type GenerationRecord,
    type MatchRecord,
    type RunConfig,
    type RunRecord,
} from "./run.js";

/**
 * Co-evolution: two lineages bred against each other, a side at a time.
 *
 * A run is given two sets of founders, side A and side B. **One side evolves
 * while the other holds still**, as the skirmish's enemy answers the player:
 * side A is bred against side B's hall until A's best usually wins, then A's
 * best joins its own hall and side B is bred against that, and so on. Each
 * turn is a round.
 *
 * Bred together instead, each side is scored against a target that moves every
 * generation, and a side that falls behind is beaten so quickly and so evenly
 * that its scores stop telling its designs apart while the leader has nothing
 * left to improve on: the two disengage. Held still, the side being bred is
 * scored against the same opponents all round, and the round ends once it has
 * caught up rather than after a fixed count.
 *
 * **A hall of fame keeps a side from beating only the latest of the other.**
 * Each side keeps the champions of its last few rounds, its founders until it
 * has any, and every match is against a group of them, so an answer has to
 * beat what came before as well. Each match is on its own seed.
 *
 * **Drills give a side that is outclassed something to climb.** Besides its
 * matches, each design fights some with its own ships made invincible, so it
 * can learn to hurt the other side before it learns to survive it, and some
 * against bare cores, which cannot fight back at all. A drill scores only the
 * damage done and function taken, and is never a win.
 *
 * A side B that does not evolve is its founders throughout: side A is bred
 * against them, a round that never ends, and one of them against several of
 * side A is what a boss battle was.
 *
 * Everything comes off one generator seeded from the run's seed, as a run of
 * one does, so a co-evolution run is a config and a number too.
 */

/** What may differ between the sides; side B takes side A's where it says nothing. */
export type SideSettings = Pick<RunConfig, "population" | "winners" | "group" | "budget" | "mutation" | "fleet">;

export interface CoevolutionConfig {
    /** Side B's settings where they differ from side A's, which are the run's. */
    readonly rival: Partial<SideSettings>;
    /** Champions each side keeps, one per round, the latest; its founders until it has one. */
    readonly hall: number;
    /** The share of its matches a round's best must win for the round to end. */
    readonly phaseWin: number;
    /** The most generations a round may take before the other side's turn comes anyway. */
    readonly phaseCap: number;
    /** Matches each design fights a generation with its own ships invincible. */
    readonly shieldedDrills: number;
    /** Matches each design fights a generation against bare cores. */
    readonly bareCoreDrills: number;
    /** Whether side B evolves. Not, and it is its founders throughout: a fixed opponent side A is bred against. */
    readonly rivalEvolves: boolean;
}

export const DEFAULT_COEVOLUTION: CoevolutionConfig = {
    rival: {},
    hall: 5,
    phaseWin: 0.6,
    phaseCap: 10,
    shieldedDrills: 1,
    bareCoreDrills: 1,
    rivalEvolves: true,
};

/**
 * Side B's settings: side A's, with whatever side B sets in their place. The
 * weight tables merge entry by entry, so a side B that sets one kind's odds
 * keeps side A's for the rest.
 */
export function rivalSettings(a: RunConfig, rival: Partial<SideSettings>): RunConfig {
    const mine = rival.mutation ?? {};
    const theirs = a.mutation;
    const table = <T extends object>(base: T | undefined, own: T | undefined): { table?: T } =>
        base === undefined && own === undefined ? {} : { table: { ...base, ...own } as T };
    const kinds = table(theirs.kinds, mine.kinds).table;
    const build = table(theirs.build, mine.build).table;
    const doctrine = table(theirs.doctrine, mine.doctrine).table;
    const operators = table(a.fleet.operators, rival.fleet?.operators).table;
    return {
        ...a,
        ...rival,
        mutation: {
            ...theirs,
            ...mine,
            ...(kinds === undefined ? {} : { kinds }),
            ...(build === undefined ? {} : { build }),
            ...(doctrine === undefined ? {} : { doctrine }),
        },
        fleet: { ...a.fleet, ...rival.fleet, ...(operators === undefined ? {} : { operators }) },
    };
}

/** Told as each generation closes, with the side it was. */
export type OnCoGeneration = (record: GenerationRecord, side: 0 | 1) => void;

/** A past champion: who it was, and what it fought as. */
interface Champion {
    readonly id: number;
    readonly entrant: Entrant;
}

/** One side's lineage. */
interface Side {
    readonly config: RunConfig;
    /** Its generation under test on its turn, and the last it bred from otherwise. */
    generation: Generation;
    readonly generations: GenerationRecord[];
    matches: MatchRecord[];
    /** The latest champions, oldest first: its founders until it has any. */
    readonly hall: Champion[];
    /** Whether its generation has been fought, so its next turn breeds from it. */
    fought: boolean;
}

/** What a design owes a generation, by kind. */
type Kind = "match" | "shielded" | "bareCore";

/** What is in the match being fought: the side being bred's picks, and what they face. */
interface Pairing {
    readonly kind: Kind;
    readonly picked: readonly number[];
    readonly against: readonly Champion[];
}

/** A bare core stands for a design no lineage has. */
const BARE: Champion = { id: -1, entrant: BARE_CORE };

/**
 * A co-evolution run in progress: stepped as `Run` is, so a page can drive the
 * same object the headless runner drives.
 */
export class Coevolution {
    readonly config: RunConfig;
    readonly coevolution: CoevolutionConfig;
    private readonly sides: readonly [Side, Side];
    private readonly onGeneration: OnCoGeneration | undefined;
    private readonly rng: Rng;
    private nextId: number;
    private match: Match | null = null;
    private pairing: Pairing | null = null;
    private seed = 0;
    private over = false;
    /** The side being bred, and how many rounds and generations there have been. */
    private side: 0 | 1 = 0;
    private roundCount = 0;
    private roundGenerations = 0;
    private generationCount = 0;
    /** Per design of the side being bred, by kind: matches fought, and matches won. */
    private owed = new Map<Kind, number[]>();
    private wins: number[] = [];

    constructor(
        founders: readonly Entrant[],
        rivals: readonly Entrant[],
        config?: Partial<RunConfig>,
        coevolution?: Partial<CoevolutionConfig>,
        onGeneration?: OnCoGeneration,
    ) {
        const settings: RunConfig = { ...DEFAULT_RUN, ...config };
        this.config = settings;
        this.coevolution = { ...DEFAULT_COEVOLUTION, ...coevolution };
        this.onGeneration = onGeneration;
        this.rng = new Rng(settings.seed);
        const rival = rivalSettings(settings, this.coevolution.rival);
        const a = seedPopulation(founders, this.rng, settings);
        const b = seedPopulation(rivals, this.rng, rival, a.individuals.length);
        this.nextId = a.individuals.length + b.individuals.length;
        // A fixed side B fields all its founders; one that evolves, as many as its hall holds.
        const hallOf = (generation: Generation, all: boolean): Champion[] =>
            generation.individuals
                .filter((individual) => individual.parent < 0)
                .slice(0, all ? undefined : max(1, this.coevolution.hall))
                .map((individual) => ({ id: individual.id, entrant: individual.entrant }));
        this.sides = [
            { config: settings, generation: a, generations: [], matches: [], hall: hallOf(a, false), fought: false },
            { config: rival, generation: b, generations: [], matches: [], hall: hallOf(b, !this.coevolution.rivalEvolves), fought: false },
        ];
        this.reset();
        if (settings.generations <= 0 || founders.length === 0 || rivals.length === 0) this.over = true;
    }

    get done(): boolean {
        return this.over;
    }

    /** The match being fought, for watching one as it happens. */
    get current(): Match | null {
        return this.match;
    }

    /** The side being bred. */
    get turn(): 0 | 1 {
        return this.side;
    }

    /** Rounds finished: each a side's answer to the other. */
    get round(): number {
        return this.roundCount;
    }

    /** Whether both sides evolve, so the run goes in rounds. */
    get alternates(): boolean {
        return this.coevolution.rivalEvolves;
    }

    /** Side A's closed generations, as `Run.generations`. */
    get generations(): readonly GenerationRecord[] {
        return this.sides[0].generations;
    }

    /** Side B's closed generations. */
    get rivalGenerations(): readonly GenerationRecord[] {
        return this.sides[1].generations;
    }

    /** The generation being bred, of the side whose turn it is. */
    get living(): Generation {
        return this.sides[this.side].generation;
    }

    /** Matches the side being bred has fought in its generation under test. */
    get played(): readonly MatchRecord[] {
        return this.sides[this.side].matches;
    }

    /** A side's hall: the designs the other side is bred against. */
    hall(side: 0 | 1): readonly { id: number; entrant: Entrant }[] {
        return this.sides[side].hall;
    }

    /**
     * The run's first match, fought by the founders themselves: the first
     * pairing's seed, with each individual swapped for the founder it was bred
     * from. Draws the match, so it is for a run that will not be fought.
     */
    unmutatedOpening(): Match | null {
        if (this.match === null && !this.over) this.open();
        const pairing = this.pairing;
        if (this.match === null || pairing === null) return null;
        const individuals = this.living.individuals;
        const founderOf = (index: number): Entrant => {
            const individual = individuals[index]!;
            if (individual.parent < 0) return individual.entrant;
            return individuals.find((each) => each.id === individual.parent)?.entrant ?? individual.entrant;
        };
        const { entrants, teams } = this.lineUp(pairing, founderOf);
        return new Match(entrants, this.matchConfig(), teams);
    }

    /** How far through the whole run, from nothing to one. */
    get progress(): number {
        if (this.over) return 1;
        const individuals = this.living.individuals;
        let heard = 0;
        let total = 0;
        for (const [kind, played] of this.owed) {
            const wanted = this.quota(kind);
            for (let i = 0; i < individuals.length; i++) heard += min(played[i]!, wanted);
            total += individuals.length * wanted;
        }
        const within = total > 0 ? heard / total : 1;
        return (this.generationCount + within) / this.config.generations;
    }

    /** Fight up to `budget` simulation steps of it, as `Run.advance` does. */
    advance(budget: number): boolean {
        let left = max(1, budget);
        while (left > 0 && !this.over) {
            if (this.match === null) {
                this.open();
                continue;
            }
            while (left > 0 && !this.match.done) {
                this.match.advance();
                left--;
            }
            if (this.match.done) this.close();
        }
        return !this.over;
    }

    /** Fight the rest of it, and hand back the record. */
    finish(): RunRecord {
        while (!this.over) this.advance(1 << 20);
        return this.record();
    }

    /** Side A as a run of one records it, and side B beside it. */
    record(): RunRecord {
        return {
            config: this.config,
            generations: this.sides[0].generations,
            rival: { config: this.coevolution, generations: this.sides[1].generations },
        };
    }

    private matchConfig(): Partial<RunConfig["match"]> {
        return { ...this.config.match, seed: this.seed };
    }

    /** The entrants made invincible: the side being bred's, in a shielded drill. */
    private shielded(teams: readonly number[]): number[] {
        if (this.pairing?.kind !== "shielded") return [];
        return teams.flatMap((team, e) => (team === this.side ? [e] : []));
    }

    /** How many of a kind each design fights a generation. */
    private quota(kind: Kind): number {
        if (kind === "match") return max(1, this.config.minMatches);
        return max(0, kind === "shielded" ? this.coevolution.shieldedDrills : this.coevolution.bareCoreDrills);
    }

    /** Nothing fought yet, for the generation now under test. */
    private reset(): void {
        const n = this.living.individuals.length;
        this.owed = new Map((["match", "shielded", "bareCore"] as const).map((kind) => [kind, new Array<number>(n).fill(0)]));
        this.wins = new Array<number>(n).fill(0);
    }

    /** Draw the next match, or close the generation if every design has had all it is owed. */
    private open(): void {
        const kind = (["match", "shielded", "bareCore"] as const).find((k) => this.owed.get(k)!.some((played) => played < this.quota(k)));
        if (kind === undefined) {
            this.roll();
            return;
        }
        const own = this.sides[this.side];
        const other = this.sides[this.side === 0 ? 1 : 0];
        const played = this.owed.get(kind)!;
        const individuals = own.generation.individuals;
        const picked = this.pick(individuals.length, groupOf(own), (i) => [played[i]!, individuals[i]!.matches]);
        const size = groupOf(other);
        let against: Champion[];
        if (kind === "bareCore") against = Array.from({ length: size }, () => BARE);
        else {
            const met = (champion: Champion): number => {
                let sum = 0;
                for (const i of picked) sum += individuals[i]!.met.get(champion.id) ?? 0;
                return sum;
            };
            // Stable, so the oldest of those met equally goes first; round again if the hall is short.
            const order = [...other.hall].sort((x, y) => met(x) - met(y));
            against = Array.from({ length: size }, (_, k) => order[k % order.length]!);
        }
        this.pairing = { kind, picked, against };
        this.seed = this.rng.nextUint32();
        const { entrants, teams } = this.lineUp(this.pairing, (index) => individuals[index]!.entrant);
        this.match = new Match(entrants, this.matchConfig(), teams, this.shielded(teams));
    }

    /**
     * `count` of the side's designs, one at a time, each the least by `key`
     * compared entry by entry, ties broken by a draw.
     */
    private pick(n: number, count: number, key: (index: number) => number[]): number[] {
        const picked: number[] = [];
        while (picked.length < count) {
            let best = -1;
            let bestKey: number[] = [];
            let bestDraw = 0;
            for (let i = 0; i < n; i++) {
                if (picked.includes(i)) continue;
                const draw = this.rng.nextFloat();
                const k = key(i);
                if (best >= 0) {
                    let order = 0;
                    for (let e = 0; e < k.length && order === 0; e++) order = k[e]! - bestKey[e]!;
                    if (order > 0 || (order === 0 && draw <= bestDraw)) continue;
                }
                best = i;
                bestKey = k;
                bestDraw = draw;
            }
            if (best < 0) break;
            picked.push(best);
        }
        return picked;
    }

    /** The match's entrants, side A's then side B's, with each one's side and id. */
    private lineUp(pairing: Pairing, entrantOf: (index: number) => Entrant): { entrants: Entrant[]; teams: number[]; ids: number[] } {
        const entrants: Entrant[] = [];
        const teams: number[] = [];
        const ids: number[] = [];
        const individuals = this.living.individuals;
        for (const k of [0, 1] as const) {
            if (k === this.side) {
                for (const index of pairing.picked) {
                    entrants.push(entrantOf(index));
                    ids.push(individuals[index]!.id);
                    teams.push(k);
                }
            } else {
                for (const champion of pairing.against) {
                    entrants.push(champion.entrant);
                    ids.push(champion.id);
                    teams.push(k);
                }
            }
        }
        return { entrants, teams, ids };
    }

    private close(): void {
        const result = this.match!.result();
        const pairing = this.pairing!;
        const own = this.sides[this.side];
        const { teams, ids } = this.lineUp(pairing, (index) => own.generation.individuals[index]!.entrant);
        own.matches.push({
            seed: this.seed,
            competitors: ids,
            teams,
            ending: result.ending,
            winners: result.winners,
            elapsed: result.elapsed,
            scores: result.scores,
            ...(pairing.kind === "match" ? {} : { drill: pairing.kind }),
            ...(pairing.kind === "shielded" ? { invulnerable: this.shielded(teams) } : {}),
        });
        const at = teams.indexOf(this.side);
        const opponents = ids.filter((_, e) => teams[e] !== this.side && ids[e]! >= 0);
        const won = result.ending === "decided" && result.winners.some((e) => teams[e] === this.side);
        const weights = { ...DEFAULT_MATCH.weights, ...this.config.match.weights };
        const played = this.owed.get(pairing.kind)!;
        pairing.picked.forEach((index, e) => {
            const score = result.scores[at + e]!;
            own.generation.credit(index, pairing.kind === "match" ? score : drillScore(score, weights), opponents);
            played[index] = played[index]! + 1;
            if (pairing.kind === "match" && won) this.wins[index] = this.wins[index]! + 1;
        });
        this.match = null;
        this.pairing = null;
    }

    /** Close the generation; then breed it, or end the round and breed the other side. */
    private roll(): void {
        const own = this.sides[this.side];
        const individuals = own.generation.individuals;
        let best: Individual | null = null;
        let bestAt = -1;
        individuals.forEach((individual, i) => {
            if (individual.matches > 0 && (best === null || fitness(individual) > fitness(best))) {
                best = individual;
                bestAt = i;
            }
        });
        const matches = this.owed.get("match")!;
        const won = bestAt >= 0 && matches[bestAt]! > 0 ? this.wins[bestAt]! / matches[bestAt]! : 0;
        const record: GenerationRecord = {
            ...describe(own.generation, own.matches),
            ...(this.alternates ? { round: this.roundCount } : {}),
            won,
        };
        own.generations.push(record);
        own.matches = [];
        own.fought = true;
        this.onGeneration?.(record, this.side);
        this.generationCount++;
        this.roundGenerations++;
        if (this.generationCount >= this.config.generations) {
            this.over = true;
            return;
        }
        const ends = this.alternates && (won >= this.coevolution.phaseWin || this.roundGenerations >= this.coevolution.phaseCap);
        if (ends && best !== null) {
            this.enshrine(own, best);
            this.side = this.side === 0 ? 1 : 0;
            this.roundCount++;
            this.roundGenerations = 0;
            const next = this.sides[this.side];
            // A side's first turn fights the population it was founded with.
            if (next.fought) next.generation = this.bred(next);
        } else {
            own.generation = this.bred(own);
        }
        this.reset();
    }

    private bred(s: Side): Generation {
        // The other side's champions are what this one is bred against, and what it may copy a ship of.
        const other = this.sides[s === this.sides[0] ? 1 : 0];
        const rivals = other.hall.map((champion) => champion.entrant).filter(isFleet);
        return breed(
            s.generation,
            this.rng,
            {
                population: s.config.population,
                winners: s.config.winners,
                limits: mutationLimits(s.config),
                fleetLimits: { ...fleetLimits(s.config), rivals },
            },
            () => this.nextId++,
        );
    }

    /**
     * Put a round's best in its side's hall, keeping only the latest. Its
     * founders go oldest first, and until then are the weaker opponents a side
     * that is outclassed can still score against.
     */
    private enshrine(s: Side, best: Individual): void {
        // A design carried over unchanged keeps its id, and is moved up rather than kept twice.
        const already = s.hall.findIndex((champion) => champion.id === best.id);
        if (already >= 0) s.hall.splice(already, 1);
        s.hall.push({ id: best.id, entrant: best.entrant });
        while (s.hall.length > max(1, this.coevolution.hall)) s.hall.shift();
    }
}

/** A drill's score: only what was done to the other side, since its own ships could not be hurt or there was nothing to hurt them. */
function drillScore(score: Score, weights: typeof DEFAULT_MATCH.weights): Score {
    return {
        ...score,
        survival: 0,
        functional: 0,
        race: 0,
        total: weights.damage * score.damage + weights.disabling * score.disabling,
    };
}

/** How many of a side each match fields: its `group`, or all of it if it is smaller. */
function groupOf(s: Side): number {
    return max(1, min(s.config.group, s.generation.individuals.length));
}

/** Fight a whole co-evolution run and record it. */
export function runCoevolution(
    founders: readonly Entrant[],
    rivals: readonly Entrant[],
    config?: Partial<RunConfig>,
    coevolution?: Partial<CoevolutionConfig>,
    onGeneration?: OnCoGeneration,
): RunRecord {
    return new Coevolution(founders, rivals, config, coevolution, onGeneration).finish();
}
