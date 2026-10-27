import type { CoevolutionConfig } from "~/evolution/coevolution";
import type { Entrant } from "~/evolution/match";
import type { RecordedRun } from "~/evolution/recorded";
import {
    entrantOf,
    finalist,
    generationDoctrine,
    generationSize,
    spreadOf,
    type GenerationDoctrine,
    type GenerationRecord,
    type GenerationSize,
    type MatchRecord,
} from "~/evolution/run";
import type { YardstickPoint } from "~/evolution/yardstick";
import { teamColour } from "~/render/canvas2d";
import type { Series } from "~/render/chart";
import { shipColours } from "~/render/teams";
import { LiveRun, type LiveIndividual } from "~/host/evolutionRun";
import { BARE_CORE } from "~/scenarios/blueprints";

/** A run on show: being fought, or read from a file. */
export type AnyRun = LiveRun | RecordedRun;
type TwoSided = AnyRun & { coevolution: CoevolutionConfig };

/** Whether a run has two sides: a co-evolution run, live or read from a file. */
export const twoSided = (run: AnyRun | null): run is TwoSided => run !== null && run.coevolution !== null;

/** Whether the run is a co-evolution run whose sides take turns, so it goes in rounds. */
export const inRounds = (run: AnyRun | null): boolean => twoSided(run) && run.alternates;

/**
 * One point along a run: a generation of whichever side was bred. Which
 * generation of each side it shows, by index, -1 for none, the side that was
 * bred, and the round, in a co-evolution run whose sides take turns.
 */
export interface Point {
    readonly a: number;
    readonly b: number;
    readonly side: 0 | 1;
    readonly round?: number;
}

/** One line of the combatants table, from a finished generation or a live one. */
export interface Row {
    readonly id: number;
    /** Which lineage of a co-evolution run it is in, 0 for A and 1 for B; absent in a run of one. */
    readonly side?: 0 | 1;
    readonly parent: number;
    readonly matches: number;
    readonly fitness: number;
    readonly survival: number;
    readonly functional: number;
    readonly damage: number;
    readonly disabling: number;
    readonly race: number;
    readonly mass: number;
    readonly edits: readonly string[];
    readonly entrant: Entrant;
    /** Matches it won of those it fought in the generation on show, drills aside. */
    readonly wins?: { readonly won: number; readonly fought: number };
}

/** What a design weighs, by its id: compiling one is not free, so it is cached by whoever asks. */
export type MassOf = (id: number, entrant: Entrant) => number;

/** A row for a design that has not fought. */
export function unfought(id: number, entrant: Entrant, mass: number, side?: 0 | 1): Row {
    return {
        id,
        ...(side === undefined ? {} : { side }),
        parent: -1,
        matches: 0,
        fitness: 0,
        survival: 0,
        functional: 0,
        damage: 0,
        disabling: 0,
        race: 0,
        mass,
        edits: [],
        entrant,
    };
}

/** A generation being fought, as rows; `side` for a lineage of a co-evolution run. */
export function liveRows(individuals: readonly LiveIndividual[], massOf: MassOf, side?: 0 | 1): Row[] {
    return individuals.map((individual) => {
        const per = (total: number): number => (individual.matches > 0 ? total / individual.matches : 0);
        return {
            id: individual.id,
            ...(side === undefined ? {} : { side }),
            parent: individual.parent,
            matches: individual.matches,
            fitness: per(individual.score),
            survival: per(individual.survival),
            functional: per(individual.functional),
            damage: per(individual.damage),
            disabling: per(individual.disabling),
            race: per(individual.race),
            mass: massOf(individual.id, individual.entrant),
            edits: individual.edits,
            entrant: individual.entrant,
        };
    });
}

/** A closed generation, as rows. */
export function recordRows(record: GenerationRecord, side?: 0 | 1): Row[] {
    return record.individuals.map((individual) => ({
        id: individual.id,
        ...(side === undefined ? {} : { side }),
        parent: individual.parent,
        matches: individual.matches,
        fitness: individual.fitness,
        survival: individual.survival,
        functional: individual.functional ?? 0,
        damage: individual.damage,
        disabling: individual.disabling ?? 0,
        race: individual.race,
        mass: individual.mass,
        edits: individual.edits,
        entrant: entrantOf(individual),
    }));
}

/**
 * The run's closed generations so far, a point each: in a run whose sides
 * take turns, both sides' in the order they were bred, each with the
 * generation of the other side on show then (-1 for a side with none yet).
 */
export function timeline(run: AnyRun | null): Point[] {
    if (run === null) return [];
    if (!twoSided(run) || !run.alternates) return run.generations.map((_, g) => ({ a: g, b: -1, side: 0 }));
    const points: Point[] = [];
    const a = run.generations;
    const b = run.rivalGenerations;
    let ai = -1;
    let bi = -1;
    // Merged by round: each side's generations come in its own rounds, in order.
    while (ai + 1 < a.length || bi + 1 < b.length) {
        const nextA = a[ai + 1]?.round ?? Infinity;
        const nextB = b[bi + 1]?.round ?? Infinity;
        const side: 0 | 1 = nextA <= nextB ? 0 : 1;
        if (side === 0) ai++;
        else bi++;
        points.push({ a: ai, b: bi, side, round: side === 0 ? nextA : nextB });
    }
    return points;
}

/** Which side was bred at a point along the run, as "round 2, side B evolving", in a co-evolution run; else empty. */
export function evolving(run: AnyRun | null, at: number): string {
    if (!twoSided(run)) return "";
    if (!run.alternates) return "side A evolving";
    // Past the closed points is the generation being fought.
    const point = timeline(run)[at];
    const side = point?.side ?? run.turn;
    return `round ${(point?.round ?? run.round) + 1}, side ${side === 0 ? "A" : "B"} evolving`;
}

/** A point's name, with the side bred in it where there are sides. */
export const pointLabel = (run: AnyRun | null, at: number): string =>
    [`generation ${at + 1}`, evolving(run, at)].filter((part) => part !== "").join(" · ");

/** What the panel shows at a point: which point, and the rows and matches in it. */
export interface Showing {
    readonly index: number;
    readonly rows: readonly Row[];
    readonly matches: readonly MatchRecord[];
}

/**
 * The point `wanted`, or the newest for -1: the generation being fought while
 * there is one, and the last closed once there is not.
 */
export function showing(run: AnyRun | null, wanted: number, massOf: MassOf): Showing {
    const empty = { index: 0, rows: [], matches: [] };
    if (run === null) return empty;
    const points = timeline(run);
    const closed = points.length;
    const newest = run.done ? closed - 1 : closed;
    const index = wanted < 0 ? newest : Math.min(wanted, newest);
    if (index < 0) return empty;
    if (twoSided(run)) {
        // A side not bred yet shows its hall, its founders, which is what the other side is fighting.
        const sideRows = (k: 0 | 1, at: number): Row[] => {
            const list = k === 0 ? run.generations : run.rivalGenerations;
            if (at >= 0 && list[at] !== undefined) return recordRows(list[at]!, k);
            return run.hall(k).map((champion) => unfought(champion.id, champion.entrant, massOf(champion.id, champion.entrant), k));
        };
        // A run read from a file is over, so it has nothing being bred.
        if (index >= closed && run instanceof LiveRun) {
            // The side being bred live, the other as it last was.
            const turn = run.turn;
            const last = points[closed - 1];
            const other: 0 | 1 = turn === 0 ? 1 : 0;
            const otherAt = other === 0 ? (last?.a ?? -1) : (last?.b ?? run.rivalGenerations.length - 1);
            const live = liveRows(run.living, massOf, turn);
            const frozen = sideRows(other, otherAt);
            return { index, rows: turn === 0 ? [...live, ...frozen] : [...frozen, ...live], matches: run.played };
        }
        const point = points[index]!;
        const bred = point.side === 0 ? run.generations[point.a]! : run.rivalGenerations[point.b]!;
        return { index, rows: [...sideRows(0, point.a), ...sideRows(1, point.b)], matches: bred.matches };
    }
    if (index >= closed && run instanceof LiveRun) return { index, rows: liveRows(run.living, massOf), matches: run.played };
    const record = run.generations[index]!;
    return { index, rows: recordRows(record), matches: record.matches };
}

/** The generation the chart marks as on show, when it has a point for it. */
export function markedGeneration(run: AnyRun | null, shown: number): number | undefined {
    if (run === null) return undefined;
    const closed = timeline(run).length;
    const newest = run.done ? closed - 1 : closed;
    const index = shown < 0 ? newest : Math.min(shown, newest);
    return index >= 0 && index < closed ? index : undefined;
}

/** A design anywhere in the run, by id: a champion from a past generation is fought, but not on show. */
export function entrantById(run: AnyRun | null, id: number): Entrant | null {
    if (run === null) return null;
    if (id < 0) return BARE_CORE;
    if (twoSided(run)) {
        for (const side of [0, 1] as const) {
            const champion = run.hall(side).find((each) => each.id === id);
            if (champion !== undefined) return champion.entrant;
        }
    }
    const lists = twoSided(run) ? [run.generations, run.rivalGenerations] : [run.generations];
    for (const generations of lists) {
        for (let g = generations.length - 1; g >= 0; g--) {
            const found = generations[g]!.individuals.find((individual) => individual.id === id);
            if (found !== undefined) return entrantOf(found);
        }
    }
    return null;
}

/** Who fought, by id; with sides, each side's led by its letter and the two split by a v. */
export function competitorsText(record: MatchRecord): string {
    const teams = record.teams;
    if (teams === undefined) return record.competitors.join(" ");
    return record.competitors
        .map((id, k) => {
            if (k > 0 && teams[k] === teams[k - 1]) return String(id);
            const letter = teams[k] === 0 ? "A" : "B";
            return k === 0 ? `${letter} ${id}` : `v ${letter} ${id}`;
        })
        .join(" ");
}

/** How a match ended: who won it, when it was decided and the record says. */
export function endingText(record: MatchRecord): string {
    const first = record.winners?.[0];
    if (record.ending !== "decided" || first === undefined) return record.ending;
    if (record.teams !== undefined) return `${record.teams[first] === 0 ? "A" : "B"} won`;
    return `#${record.competitors[first]} won`;
}

export type Finalist = NonNullable<ReturnType<typeof finalist>> & { readonly label: string };

/** The run's best: one, or one a side in a co-evolution run, each labelled with its side. */
export function finalists(run: AnyRun | null): Finalist[] {
    if (run === null) return [];
    const record = run.record();
    if (record.rival === undefined) {
        const top = finalist(record);
        return top === null ? [] : [{ ...top, label: "" }];
    }
    const out: Finalist[] = [];
    const a = finalist(record);
    const b = finalist({ config: record.config, generations: record.rival.generations });
    if (a !== null) out.push({ ...a, label: "A " });
    if (b !== null) out.push({ ...b, label: "B " });
    return out;
}

/** The run's best, a side each in a co-evolution run, renamed for the side and generation it came from. */
export function champions(run: AnyRun | null): { entrant: Entrant; id: number }[] {
    return finalists(run).map((top) => {
        const entrant = entrantOf(top.individual);
        const side = top.label === "" ? "" : ` ${top.label.trim()}`;
        return { entrant: { ...entrant, name: `${entrant.name}${side} g${top.generation + 1}` }, id: top.individual.id };
    });
}

/** What the score chart plots: the run's best and mean and the parts of the mean, and the yardstick over them. */
export function scoreSeries(run: AnyRun | null, yardstick: readonly YardstickPoint[] | undefined): Series[] {
    const series: Series[] = [];
    const closed = run === null ? [] : run.generations;
    if (closed.length > 0) {
        const of = (read: (g: GenerationRecord) => number): number[] => closed.map(read);
        series.push(
            { name: "best", colour: "#e6edf5", values: of((g) => g.bestFitness) },
            { name: "mean", colour: "#7fa8e0", values: of((g) => g.meanFitness) },
            { name: "hull kept", colour: "#7fd6a0", values: of((g) => g.mean.survival), dashed: true },
            { name: "function kept", colour: "#b48ee0", values: of((g) => g.mean.functional), dashed: true },
            { name: "damage", colour: "#e0655f", values: of((g) => g.mean.damage), dashed: true },
            { name: "function taken", colour: "#e08ec0", values: of((g) => g.mean.disabling), dashed: true },
            { name: "ground", colour: "#e9c05f", values: of((g) => g.mean.race), dashed: true },
        );
    }
    // The yardstick last, so it is drawn over the rest: it is the line that
    // means the same thing at both ends of the chart, and the others are not.
    if (yardstick !== undefined && yardstick.length > 0) {
        const scores: number[] = [];
        for (const point of yardstick) scores[point.generation] = point.mean;
        series.push({ name: "vs. yardstick", colour: "#5bd6d6", values: scores });
    }
    return series;
}

/** What the chart under the score shows: mass and ships, weapons and engines, the scores' spread, or a doctrine number. */
export type SizeMetric = "mass" | "fittings" | "spread" | `doctrine:${string}`;

/**
 * Worked out once per generation and kept: counting what each individual
 * fields means compiling it, and reading its doctrine means reading every one.
 */
const sizes = new WeakMap<GenerationRecord, GenerationSize>();
export function sizeOf(generation: GenerationRecord): GenerationSize {
    let size = sizes.get(generation);
    if (size === undefined) {
        size = generationSize(generation);
        sizes.set(generation, size);
    }
    return size;
}
const doctrines = new WeakMap<GenerationRecord, GenerationDoctrine>();
export function doctrineOf(generation: GenerationRecord): GenerationDoctrine {
    let doctrine = doctrines.get(generation);
    if (doctrine === undefined) {
        doctrine = generationDoctrine(generation);
        doctrines.set(generation, doctrine);
    }
    return doctrine;
}

/** How far a doctrine number's mean has moved over the run, or NaN before there are two generations. */
export function doctrineMoved(run: AnyRun | null, key: string): number {
    const records = run?.generations ?? [];
    const first = records[0];
    const last = records[records.length - 1];
    return first === undefined || last === first ? NaN : doctrineOf(last!).mean[key]! - doctrineOf(first).mean[key]!;
}

/**
 * The chart under the score: what one fleet of each generation weighs and
 * fields — the mean solid, the best dashed — or how far apart its scores are,
 * or a doctrine number. In a co-evolution run each side takes its team's
 * colours, and in a run whose sides take turns the one not being bred holds
 * where it was.
 */
export function sizeSeries(run: AnyRun | null, metric: SizeMetric): Series[] {
    const along = timeline(run);
    const atPoints = (k: 0 | 1): (GenerationRecord | undefined)[] => {
        if (run === null) return [];
        const list = k === 0 ? run.generations : twoSided(run) ? run.rivalGenerations : [];
        return along.map((point) => list[k === 0 ? point.a : point.b]);
    };
    const each = <T>(records: (GenerationRecord | undefined)[], read: (g: GenerationRecord) => T): (T | undefined)[] =>
        records.map((g) => (g === undefined ? undefined : read(g)));
    const sides = (
        twoSided(run)
            ? [
                  { label: "A ", records: atPoints(0), mass: teamColour(0), ships: shipColours(0).trim },
                  { label: "B ", records: atPoints(1), mass: teamColour(1), ships: shipColours(1).trim },
              ]
            : [{ label: "", records: atPoints(0), mass: "#7fa8e0", ships: "#e9a35f" }]
    )
        .filter((side) => side.records.some((g) => g !== undefined))
        .map((side) => ({ ...side, size: each(side.records, sizeOf) }));
    type Side = (typeof sides)[number];
    const bestAndMean = (
        what: string,
        colour: (side: Side) => string,
        read: (s: GenerationSize) => [number, number],
        right: boolean,
    ): Series[] =>
        sides.flatMap((side) => {
            if (side.size.length === 0) return [];
            const scale = right ? { right } : {};
            return [
                {
                    name: `${side.label}mean ${what}`,
                    colour: colour(side),
                    values: side.size.map((s) => (s === undefined ? NaN : read(s)[1])),
                    ...scale,
                },
                {
                    name: `${side.label}best's ${what}`,
                    colour: colour(side),
                    values: side.size.map((s) => (s === undefined ? NaN : read(s)[0])),
                    dashed: true,
                    ...scale,
                },
            ];
        });

    if (metric.startsWith("doctrine:")) {
        const key = metric.slice("doctrine:".length);
        return sides.flatMap((side) => {
            const values = each(side.records, doctrineOf);
            return [
                { name: `${side.label}mean ${key}`, colour: side.mass, values: values.map((d) => d?.mean[key] ?? NaN) },
                { name: `${side.label}best's ${key}`, colour: side.mass, values: values.map((d) => d?.best[key] ?? NaN), dashed: true },
            ];
        });
    }
    if (metric === "spread") {
        // The middle half's width solid, the whole field's dashed, and how many tied on the right.
        return sides.flatMap((side) => {
            const spreads = each(side.records, spreadOf);
            const of = (read: (s: ReturnType<typeof spreadOf>) => number): number[] =>
                spreads.map((s) => (s === undefined ? NaN : read(s)));
            return [
                { name: `${side.label}middle half`, colour: side.mass, values: of((s) => s.upperQuartile - s.lowerQuartile) },
                { name: `${side.label}best to worst`, colour: side.mass, values: of((s) => s.highest - s.lowest), dashed: true },
                { name: `${side.label}tied`, colour: side.ships, values: of((s) => s.tied), right: true },
            ];
        });
    }
    if (metric === "fittings") {
        return [
            ...bestAndMean(
                "weapons",
                (side) => side.mass,
                (s) => [s.bestWeapons, s.meanWeapons],
                false,
            ),
            ...bestAndMean(
                "engines",
                (side) => side.ships,
                (s) => [s.bestEngines, s.meanEngines],
                true,
            ),
        ];
    }
    // Ships on the right once a run fields more than one.
    const fleets = sides.some((side) => side.size.some((s) => s !== undefined && s.meanShips !== 1));
    return [
        ...bestAndMean(
            "mass",
            (side) => side.mass,
            (s) => [s.bestMass / 1000, s.meanMass / 1000],
            false,
        ),
        ...(fleets
            ? bestAndMean(
                  "ships",
                  (side) => side.ships,
                  (s) => [s.bestShips, s.meanShips],
                  true,
              )
            : []),
    ];
}

/** How a size chart's legend reads its values: places and units, on the left scale and the right. */
export function sizeDigits(metric: SizeMetric): { digits: number; unit: string; rightDigits: number; rightUnit: string } {
    if (metric === "fittings") return { digits: 1, unit: "", rightDigits: 1, rightUnit: "" };
    if (metric === "spread") return { digits: 3, unit: "", rightDigits: 0, rightUnit: "" };
    if (metric.startsWith("doctrine:")) return { digits: 3, unit: "", rightDigits: 3, rightUnit: "" };
    return { digits: 1, unit: " t", rightDigits: 2, rightUnit: "" };
}
