import {
    blueprintProblem,
    compileBlueprint,
    expandBlueprint,
    expandFleet,
    firstOverlap,
    placeModules,
    fleetHulls,
    fleetBill,
    affords,
    NO_BUDGET,
    type Budget,
    fleetProblem,
    fleetReach,
    isGroupUse,
    isInstance,
    type Blueprint,
    type Fleet,
    type FleetEntry,
    type FleetHull,
    type ModuleSpec,
    type ShipDesign,
    type Rng,
    degreesToRadians,
    radiansToDegrees,
    readsCraft,
    moduleOutline,
    type ModuleKind,
    budgetMass,
} from "../sim/index.js";
import { atan2, cos, max, min, PI, round, sin, sqrt } from "../sim/math.js";
import { byContent } from "../sim/byContent.js";
import { BARE_CORE } from "../scenarios/blueprints.js";
import { DEFAULT_LIMITS, drift, mutate, scaledBlueprint, type MutationLimits } from "./mutate.js";
import { fleetBlueprint, hangarClashes, padReached, renamePadFighter, withFleetFighters } from "../sim/fleetHangar.js";

/**
 * An angle that a file, which holds degrees, reads back as exactly itself, so
 * the record of a fleet is the fleet that fought. Most are after one trip.
 */
export function settled(angle: number): number {
    for (let k = 0; k < 4; k++) {
        const back = degreesToRadians(radiansToDegrees(angle));
        if (back === angle) break;
        angle = back;
    }
    return angle;
}

/**
 * Breeding a fleet from a fleet.
 *
 * Every operator has its inverse, so no change is a one-way door: a design is
 * mutated in every copy of it at once, each design with a chance of its own; a copy can be forked into a design of
 * its own and two designs merged back into one; a ship or a group can be added
 * and removed; one can be moved or turned; and one can be swapped onto another
 * of the fleet's designs, which a second swap undoes. Only the fleet's own entries are
 * moved, added or removed — what is inside a group changes only through its
 * designs.
 *
 * A fleet may carry designs nothing flies. A ship removed leaves its design
 * behind, and a ship added may be built to any design the fleet carries, or to
 * a bare core, so a fleet can grow by one small ship rather than only by a copy
 * of one it has. Those it does not fly are not mutated, since nothing selects
 * them — unless a pad of one it flies keeps them, when they are bred as a
 * ship it flies is. A pad can be pointed at another of the fleet's fighters,
 * at a copy of its own to breed apart, or at a new bare core of a fighter,
 * and back. Where there is an opponent and `steal` is weighted, one of its designs can be stolen: what
 * the opponent fields is often the quickest answer to it, and the stolen design is
 * bred apart from there.
 */

export interface FleetMutationLimits {
    /** How each design is mutated. Its budget is the fleet's, checked on the whole. */
    readonly ship: Partial<MutationLimits>;
    /** What the whole fleet may not cost more than. */
    readonly budget: Budget;
    /** How far from its origin any hull may reach, metres. */
    readonly radius: number;
    /** Most ships a fleet may field, which bounds what a match costs. */
    readonly maxShips: number;
    /** How far a ship moves, as a share of its radius: the spread of its drift. */
    readonly size: number;
    /** How far a heading turns, radians: the spread of its drift. */
    readonly turn: number;
    /** A multiple of `size` and `turn`: how far every ship moves and turns in every child. Zero holds them still. */
    readonly move: number;
    /** Chance each of the fleet's designs is mutated in a child, whatever the number of them. */
    readonly design: number;
    /** Chance a child also has one change to what the fleet is made of, drawn by `operators`. */
    readonly change: number;
    /** Candidates drawn for that change before going without it. */
    readonly attempts: number;
    /** Relative chance of each change to what the fleet is made of. */
    readonly operators: Readonly<Record<FleetOperator, number>>;
    /** The fleets it is bred against, whose designs `steal` takes: a skirmish's player, a co-evolution run's other side. */
    readonly rivals: readonly Fleet[];
}

export type FleetOperator = "add" | "remove" | "fork" | "merge" | "swap" | "pad" | "steal" | "spread" | "scale" | "chimera";

/** Every design and every ship each child; what the fleet is made of more often than not. */
export const DEFAULT_FLEET_LIMITS: FleetMutationLimits = {
    ship: {},
    budget: NO_BUDGET,
    radius: 500,
    maxShips: 24,
    size: 0.25,
    turn: PI / 12,
    move: 1,
    design: 1,
    change: 0.6,
    attempts: 24,
    operators: { add: 1, remove: 1, fork: 0.5, merge: 0.5, swap: 0.5, pad: 0.5, steal: 0, spread: 0.5, scale: 0.5, chimera: 0.5 },
    rivals: [],
};

export interface FleetMutant {
    readonly fleet: Fleet;
    /** One sentence per change. Empty means every candidate was refused and the parent is returned. */
    readonly edits: readonly string[];
    readonly attempts: number;
}

/**
 * Breed a child: each design mutated with a chance of its own, now and then a
 * change to what the fleet is made of, and every ship moved and turned. Each
 * step that leaves the fleet unfit is undone on its own, as an edit to a
 * design is, so one bad draw does not cost the rest.
 */
export function mutateFleet(parent: Fleet, rng: Rng, limits?: Partial<FleetMutationLimits>): FleetMutant {
    const bounds: FleetMutationLimits = {
        ...DEFAULT_FLEET_LIMITS,
        ...limits,
        operators: { ...DEFAULT_FLEET_LIMITS.operators, ...limits?.operators },
    };
    const draft = clone(parent);
    const edits: string[] = [];
    let attempts = 0;

    for (const name of bredDesigns(draft)) {
        if (!rng.chance(bounds.design)) continue;
        const before = draft.designs[name]!;
        const changed = mutateDesign(draft, name, rng, bounds);
        if (changed.length === 0) continue;
        if (fleetFits(draft, bounds)) edits.push(...changed);
        else draft.designs[name] = before;
    }

    // An operator with nothing to work on draws as though there were no such operator.
    const operators = {
        ...bounds.operators,
        ...(hasPad(draft) ? {} : { pad: 0 }),
        ...(bounds.rivals.some((rival) => rival.ships.length > 0) ? {} : { steal: 0 }),
    };
    if (rng.chance(bounds.change) && Object.values(operators).some((weight) => weight > 0)) {
        for (let attempt = 1; attempt <= bounds.attempts; attempt++) {
            attempts = attempt;
            const candidate = clone(draft);
            const changed = apply(pick(rng, operators), candidate, rng, bounds.rivals);
            if (changed.length === 0 || !fleetFits(candidate, bounds)) continue;
            draft.designs = candidate.designs;
            draft.ships = candidate.ships;
            // A merge repoints groups' entries too.
            if (candidate.groups !== undefined) draft.groups = candidate.groups;
            edits.push(...changed);
            break;
        }
    }

    // After a ship is added, so it is spread with the rest.
    edits.push(...move(draft, rng, bounds, new Layout()));
    if (edits.length === 0) return { fleet: parent, edits: [], attempts };
    return { fleet: draft, edits, attempts };
}

/**
 * Whether a candidate is a fleet worth fighting: every design a ship, within
 * the budget and the deployment radius, and no two hulls on top of each other.
 */
/** `blueprintProblem`, asked once of each design however many candidates carry it unchanged. */
const designProblem = byContent(64, blueprintProblem);

export function fleetFits(fleet: Fleet, limits: Pick<FleetMutationLimits, "budget" | "radius" | "maxShips">): boolean {
    if (fleetProblem(fleet) !== null) return false;
    if (hangarClashes(fleet).length > 0) return false;
    for (const blueprint of Object.values(fleet.designs))
        if (designProblem(withFleetFighters(blueprint, fleet.designs)) !== null) return false;
    const hulls = fleetHulls(fleet);
    if (hulls.length === 0 || hulls.length > limits.maxShips) return false;
    if (!affords(limits.budget, fleetBill(hulls))) return false;
    if (fleetReach(hulls) > limits.radius) return false;
    return firstOverlap(hulls) === null;
}

function apply(operator: FleetOperator, fleet: Fleet, rng: Rng, rivals: readonly Fleet[]): string[] {
    switch (operator) {
        case "add":
            return add(fleet, rng, new Layout());
        case "remove":
            return remove(fleet, rng);
        case "fork":
            return fork(fleet, rng);
        case "merge":
            return merge(fleet, rng);
        case "swap":
            return swap(fleet, rng);
        case "pad":
            return repad(fleet, rng);
        case "steal":
            return stealDesign(fleet, rivals, rng, new Layout());
        case "spread":
            return spread(fleet, rng);
        case "scale":
            return scale(fleet, rng);
        case "chimera":
            return chimera(fleet, rng);
    }
}

/** Mutate one design, which changes every ship built to it. */
function mutateDesign(fleet: Fleet, name: string, rng: Rng, bounds: FleetMutationLimits): string[] {
    // Bred as it flies here, its pads' fighters the fleet's; given back without them.
    const child = mutate(fleetBlueprint(fleet, name), rng, { ...bounds.ship, budget: bounds.budget });
    if (child.edits.length === 0) return [];
    const { hangar: _, ...bred } = child.blueprint;
    fleet.designs[name] = { ...bred, name };
    return child.edits.map((edit) => `${name}: ${edit}`);
}

/**
 * Move and turn every one of the fleet's own entries, by a drift with no dead
 * zone whose spread is `move` times `size` of its own radius and `turn`.
 *
 * Each by its own size, so a gunship moves as far beside its length as a
 * fighter does beside its own, and each move that lands on a neighbour or
 * past the deployment radius is undone on its own. A move leans away from the
 * nearest other entry, the more the closer it is, so a fleet spreads out and
 * leaves its designs room to grow.
 */
function move(fleet: Fleet, rng: Rng, bounds: FleetMutationLimits, layout: Layout): string[] {
    if (!(bounds.move > 0)) return [];
    const drawn = { ...DEFAULT_LIMITS, ...bounds.ship, deadZone: 0 };
    const edits: string[] = [];
    for (const entry of fleet.ships) {
        const spread = bounds.move * bounds.size * sizeOf(fleet, entry, layout);
        let dx = drift(rng, drawn, spread);
        let dy = drift(rng, drawn, spread);
        // Towards the nearest, turned away with a chance of how crowded it is:
        // all but always when their circles touch, an even chance far apart.
        const near = nearest(fleet, entry, layout);
        if (near !== null) {
            const towards = dx * near.ux + dy * near.uy;
            if (towards > 0 && rng.chance(near.crowding)) {
                dx -= 2 * towards * near.ux;
                dy -= 2 * towards * near.uy;
            }
        }
        dx = round(dx * 10) / 10;
        dy = round(dy * 10) / 10;
        const turn = drift(rng, drawn, bounds.move * bounds.turn);
        if (dx === 0 && dy === 0 && turn === 0) continue;
        const was = { x: entry.x, y: entry.y, angle: entry.angle };
        entry.x = round((entry.x + dx) * 10) / 10;
        entry.y = round((entry.y + dy) * 10) / 10;
        if (turn !== 0) entry.angle = settled((entry.angle ?? 0) + turn);
        if (!placed(fleet, bounds, layout)) {
            entry.x = was.x;
            entry.y = was.y;
            if (was.angle === undefined) delete entry.angle;
            else entry.angle = was.angle;
            continue;
        }
        const moved = dx !== 0 || dy !== 0 ? ` moved ${round(sqrt(dx * dx + dy * dy) * 10) / 10} m` : "";
        const turned = turn !== 0 ? ` turned ${round((turn * 180) / PI)}°` : "";
        edits.push(`${describe(entry)}${moved}${moved && turned ? " and" : ""}${turned}`);
    }
    return edits;
}

/** Another ship or group beside one of the fleet's: anything it carries, or a bare core. */
function add(fleet: Fleet, rng: Rng, layout: Layout): string[] {
    if (fleet.ships.length === 0) return [];
    const anchor = fleet.ships[rng.nextInt(fleet.ships.length)]!;
    const groups = [...new Set(fleet.ships.filter(isGroupUse).map((entry) => entry.group))];
    const designs = Object.keys(fleet.designs);
    const core = designs.find((name) => sameAsCore(fleet.designs[name]!)) ?? null;
    const choices: (FleetEntry | null)[] = [
        ...designs.map((design) => ({ design, x: 0, y: 0 })),
        ...groups.map((group) => ({ group, x: 0, y: 0 })),
        ...(core === null ? [null] : []),
    ];
    // By what each weighs, taking a bigger ship to be a stronger one, so what is added is more often what counts.
    const picked = weighted(
        rng,
        choices.map((choice) => (choice === null ? budgetMass(compileBlueprint(BARE_CORE)) : entryMass(fleet, choice))),
        choices,
    );
    let entry: FleetEntry;
    if (picked !== null) entry = picked;
    else {
        const name = fleet.designs[BARE_CORE.name] === undefined ? BARE_CORE.name : freeName(fleet, BARE_CORE.name);
        fleet.designs[name] = { name, modules: JSON.parse(JSON.stringify(BARE_CORE.modules)) as Blueprint["modules"] };
        entry = { design: name, x: 0, y: 0 };
    }
    if (anchor.angle !== undefined) entry.angle = anchor.angle;
    // Clear of the ship it goes beside by a share of both their sizes, in any
    // direction: a gunship beside a gunship stands a gunship or two off, where a
    // fixed few metres had them mustered almost hull to hull. One that lands on
    // another ship is refused whole.
    const reach = sizeOf(fleet, entry, layout) + sizeOf(fleet, anchor, layout);
    const distance = round(reach * offset(rng));
    const heading = rng.nextFloat() * 2 * PI;
    entry.x = round(anchor.x + cos(heading) * distance);
    entry.y = round(anchor.y + sin(heading) * distance);
    fleet.ships.push(entry);
    return [`${describe(entry)} added, ${distance} m off`];
}

/** What an entry weighs as it sets out, every ship of a group's together. */
function entryMass(fleet: Fleet, entry: FleetEntry): number {
    let mass = 0;
    for (const hull of fleetHulls({ ...fleet, ships: [entry] })) mass += budgetMass(hull.design);
    return mass;
}

/**
 * A ship built to one of a rival fleet's designs, beside one of the fleet's own
 * as `add` places one: the design, and every craft its pads and slipways
 * build, copied in under names the fleet has free.
 */
function stealDesign(fleet: Fleet, rivals: readonly Fleet[], rng: Rng, layout: Layout): string[] {
    const fielded = rivals.filter((rival) => rival.ships.length > 0);
    if (fielded.length === 0 || fleet.ships.length === 0) return [];
    const rival = fielded[rng.nextInt(fielded.length)]!;
    const flown = usedDesigns(rival);
    if (flown.length === 0) return [];
    // By what each costs, so a rival's step up in strength is what is most often taken.
    const from = weighted(
        rng,
        flown.map((name) => budgetMass(compileBlueprint(fleetBlueprint(rival, name)))),
        flown,
    );
    const names = new Map<string, string>();
    const taken = (name: string): boolean => fleet.designs[name] !== undefined || [...names.values()].includes(name);
    for (const name of padReached(rival, [from])) {
        let free = name;
        for (let n = 2; taken(free); n++) free = `${name.replace(/ \d+$/, "")} ${n}`;
        names.set(name, free);
    }
    for (const [name, as] of names) fleet.designs[as] = { ...recraft(rival.designs[name]!, names), name: as };
    const anchor = fleet.ships[rng.nextInt(fleet.ships.length)]!;
    const entry: FleetEntry = { design: names.get(from)!, x: 0, y: 0 };
    if (anchor.angle !== undefined) entry.angle = anchor.angle;
    const reach = sizeOf(fleet, entry, layout) + sizeOf(fleet, anchor, layout);
    const distance = round(reach * offset(rng));
    const heading = rng.nextFloat() * 2 * PI;
    entry.x = round(anchor.x + cos(heading) * distance);
    entry.y = round(anchor.y + sin(heading) * distance);
    fleet.ships.push(entry);
    return [`${rival.name}'s ${from} stolen, added as ${entry.design}, ${distance} m off`];
}

/** A copy of a design with each pad's and slipway's craft renamed by `names`, all at once. */
function recraft(blueprint: Blueprint, names: ReadonlyMap<string, string>): Blueprint {
    const copy = JSON.parse(JSON.stringify(blueprint)) as Blueprint;
    for (const list of [copy.modules, ...Object.values(copy.assemblies ?? {}).map((a) => a.modules)]) {
        for (const p of list) if (!isInstance(p) && p.craft !== undefined) p.craft = names.get(p.craft) ?? p.craft;
    }
    return copy;
}

/** Take out one of the fleet's entries. Its design stays, for an `add` to build again. */
function remove(fleet: Fleet, rng: Rng): string[] {
    if (fleet.ships.length <= 1) return [];
    const index = rng.nextInt(fleet.ships.length);
    const [gone] = fleet.ships.splice(index, 1);
    return [`${describe(gone!)} removed`];
}

/** Give one ship a design of its own, a copy of the one it shared. The inverse of `merge`. */
function fork(fleet: Fleet, rng: Rng): string[] {
    const shared = fleet.ships
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => !isGroupUse(entry) && uses(fleet, entry.design) > 1);
    if (shared.length === 0) return [];
    const { entry } = shared[rng.nextInt(shared.length)]!;
    if (isGroupUse(entry)) return [];
    const from = entry.design;
    const name = freeName(fleet, from);
    copyDesign(fleet, from, name);
    entry.design = name;
    return [`a ${from} forked into ${name}`];
}

/** A copy of design `from` as design `to`: one that built itself builds the copy. */
function copyDesign(fleet: Fleet, from: string, to: string): void {
    const copy = { ...(JSON.parse(JSON.stringify(fleet.designs[from])) as Blueprint), name: to };
    fleet.designs[to] = renamePadFighter(copy, from, to);
}

/** Build every ship of one design to another instead. The inverse of `fork`. */
function merge(fleet: Fleet, rng: Rng): string[] {
    const names = usedDesigns(fleet);
    if (names.length < 2) return [];
    const gone = names.splice(rng.nextInt(names.length), 1)[0]!;
    const into = names[rng.nextInt(names.length)]!;
    const repoint = (entries: FleetEntry[]): void => {
        for (const entry of entries) if (!isGroupUse(entry) && entry.design === gone) entry.design = into;
    };
    repoint(fleet.ships);
    for (const group of Object.values(fleet.groups ?? {})) repoint(group.ships);
    delete fleet.designs[gone];
    for (const [name, design] of Object.entries(fleet.designs)) fleet.designs[name] = renamePadFighter(design, gone, into);
    return [`${gone} merged into ${into}`];
}

/**
 * Point a pad or slipway of a design the fleet flies at another craft: one the
 * fleet carries — a fighter for a pad, any other ship for a slipway, the
 * design itself among them — a copy of its own to be bred apart from the
 * ships that share it, or a new bare core, sized to grow into one the pad
 * holds or the slipway builds. Each is undone by another: a copy or a new one
 * pointed back.
 */
function repad(fleet: Fleet, rng: Rng): string[] {
    const pads: { carrier: string; pad: ModuleSpec }[] = [];
    for (const carrier of usedDesigns(fleet)) {
        const blueprint = fleet.designs[carrier]!;
        const lists = [blueprint.modules, ...Object.values(blueprint.assemblies ?? {}).map((a) => a.modules)];
        for (const list of lists) for (const p of list) if (!isInstance(p) && readsCraft(p.kind)) pads.push({ carrier, pad: p });
    }
    if (pads.length === 0) return [];
    const { carrier, pad } = pads[rng.nextInt(pads.length)]!;
    const fighter = pad.kind === "pad";
    const was = pad.craft;
    const others = Object.keys(fleet.designs).filter((name) => name !== was && (fleet.designs[name]!.fighter === true) === fighter);
    // Another of the fleet's, a copy of its own, or a new one, each as likely as the others.
    const ways = others.length + (was === undefined ? 0 : 1) + 1;
    const way = rng.nextInt(ways);
    let to: string;
    if (way < others.length) to = others[way]!;
    else if (way === others.length && was !== undefined && fleet.designs[was] !== undefined) {
        to = freeName(fleet, was);
        copyDesign(fleet, was, to);
    } else if (fighter) {
        to = freeName(fleet, "Fighter");
        // A tenth of the pad across: room round it for a fighter the pad still holds.
        const side = max(0.1, round(min(pad.length, pad.width)) / 10);
        fleet.designs[to] = { name: to, fighter: true, modules: [{ kind: "core", x: 0, y: 0, length: side, width: side }] };
    } else {
        to = freeName(fleet, "Ship");
        // Half the slipway across: room either side to grow into a beam it still builds.
        const side = max(0.1, round(pad.width * 5) / 10);
        fleet.designs[to] = { name: to, modules: [{ kind: "core", x: 0, y: 0, length: side, width: side }] };
    }
    pad.craft = to;
    return [`${carrier}: a ${pad.kind}'s ${was ?? "nothing"} → ${to}`];
}

/**
 * Build one of the fleet's own ships to another of its designs instead: a
 * line can find that one more of its frigates and one fewer of its gunships
 * does better, without the frigate design having to be bred again from the
 * gunship. Its own inverse.
 */
function swap(fleet: Fleet, rng: Rng): string[] {
    const names = usedDesigns(fleet);
    if (names.length < 2) return [];
    const ships = fleet.ships.filter((entry) => !isGroupUse(entry));
    if (ships.length === 0) return [];
    const entry = ships[rng.nextInt(ships.length)]!;
    if (isGroupUse(entry)) return [];
    const others = names.filter((name) => name !== entry.design);
    const from = entry.design;
    entry.design = others[rng.nextInt(others.length)]!;
    return [`a ${from} rebuilt as a ${entry.design}`];
}

/**
 * Each design compiled once for a candidate: moving ships changes where they
 * stand and nothing about what they are.
 */
class Layout {
    private readonly designs = new Map<string, { design: ShipDesign; modules: ModuleSpec[] }>();

    hulls(fleet: Fleet): FleetHull[] {
        return expandFleet(fleet).map((ship) => {
            let found = this.designs.get(ship.design);
            if (found === undefined) {
                const blueprint = fleetBlueprint(fleet, ship.design);
                found = { design: compileBlueprint(blueprint), modules: expandBlueprint(blueprint) };
                this.designs.set(ship.design, found);
            }
            return { ship, design: found.design, modules: placeModules(found.modules, ship) };
        });
    }
}

/**
 * How far off an added ship stands from the one it goes beside, as a multiple
 * of their two sizes: far enough that neither flies through the other's plume
 * nor shies from it, as a fleet added hull by hull would otherwise end up.
 */
function offset(rng: Rng): number {
    return ADD_GAP * (1 + rng.nextFloat());
}

/** The least `offset`: how many of their two sizes apart an added ship and its neighbour stand at the closest. */
const ADD_GAP = 2.5;

/** The most a spread moves the fleet's ships out or in, as a share of where they stand. */
const SPREAD_SHARE = 0.4;

/**
 * Every ship moved out from the fleet's middle, or in towards it, by one
 * factor, so a fleet can open out or close up in one step rather than a ship
 * at a time. Turns are kept: it is the formation that changes, not the ships.
 */
function spread(fleet: Fleet, rng: Rng): string[] {
    if (fleet.ships.length < 2) return [];
    let cx = 0;
    let cy = 0;
    for (const entry of fleet.ships) {
        cx += entry.x;
        cy += entry.y;
    }
    cx /= fleet.ships.length;
    cy /= fleet.ships.length;
    const by = 1 + SPREAD_SHARE * (0.25 + 0.75 * rng.nextFloat());
    const factor = rng.chance(0.5) ? by : 1 / by;
    for (const entry of fleet.ships) {
        entry.x = round((cx + (entry.x - cx) * factor) * 10) / 10;
        entry.y = round((cy + (entry.y - cy) * factor) * 10) / 10;
    }
    return [`fleet ${factor > 1 ? "spread out" : "drawn in"} by ${round(factor * 100) / 100}`];
}

/** How much `scale` grows or shrinks a design by. */
const SCALE_STEP = 1.1;

/**
 * One of the fleet's designs made a tenth bigger, or smaller, whole: every
 * module and where it sits, as a ship's own `rescale` does in smaller steps.
 * A step a ship can take without flying much differently, which its scaling
 * laws make a little more or less of, so a fleet of small ships can grow its
 * ships rather than only its numbers. Every ship of the design is rebuilt to it.
 */
function scale(fleet: Fleet, rng: Rng): string[] {
    const designs = bredDesigns(fleet);
    if (designs.length === 0) return [];
    const name = designs[rng.nextInt(designs.length)]!;
    const factor = rng.chance(0.5) ? SCALE_STEP : 1 / SCALE_STEP;
    const scaled = scaledBlueprint(fleet.designs[name]!, factor);
    if (scaled === null) return [];
    fleet.designs[name] = scaled;
    return [`${name} ${factor > 1 ? "scaled up" : "scaled down"} by a tenth`];
}

/** What a chimera may be cut at: a module with nothing sticking out of any face. */
const CUT_KINDS: ReadonlySet<ModuleKind> = new Set(["structure", "tank", "core", "hold", "battery", "generator"]);

/** One design cut at a face of one of its modules, and everything beyond that face dropped. */
interface Half {
    readonly modules: ModuleSpec[];
    /** The face's middle, and its outward normal. */
    readonly x: number;
    readonly y: number;
    readonly nx: number;
    readonly ny: number;
}

/**
 * A ship of two designs' halves, or of one design's two halves: each cut at a
 * face of one of its modules, everything beyond the face dropped, and the two
 * stuck together face to face. A ship nearly as big as both, with more
 * modules rather than bigger ones, which one ship flying the first design is
 * rebuilt to. Everything kept of one half lies behind its face, so the two
 * cannot overlap; a cut that leaves a half in pieces, or without a core, is
 * refused as any unfit ship is.
 */
function chimera(fleet: Fleet, rng: Rng): string[] {
    const flown = fleet.ships.filter((entry): entry is FleetEntry & { design: string } => !isGroupUse(entry));
    const designs = usedDesigns(fleet);
    if (flown.length === 0 || designs.length === 0) return [];
    const ship = flown[rng.nextInt(flown.length)]!;
    const other = designs[rng.nextInt(designs.length)]!;
    const a = cut(expandBlueprint(fleetBlueprint(fleet, ship.design)), rng);
    const b = cut(expandBlueprint(fleetBlueprint(fleet, other)), rng);
    if (a === null || b === null) return [];
    // B turned so its face looks back into A's, and moved so the two faces' middles meet.
    const turn = atan2(-a.ny, -a.nx) - atan2(b.ny, b.nx);
    const c = cos(turn);
    const s = sin(turn);
    const joined = [
        ...a.modules,
        ...b.modules.map((spec) => {
            const dx = spec.x - b.x;
            const dy = spec.y - b.y;
            return { ...spec, x: a.x + dx * c - dy * s, y: a.y + dx * s + dy * c, angle: (spec.angle ?? 0) + turn };
        }),
    ].map(({ id: _id, ...spec }) => spec);
    const first = fleet.designs[ship.design]!;
    const second = fleet.designs[other]!;
    const name = fleet.designs[CHIMERA] === undefined ? CHIMERA : freeName(fleet, CHIMERA);
    const design: Blueprint = { name, modules: joined };
    if (first.doctrine !== undefined) design.doctrine = first.doctrine;
    if (first.fighter === true && second.fighter === true) design.fighter = true;
    // Only ever a bigger ship than the one rebuilt: a chimera is a way to grow, and
    // cut down to less it is a smaller ship found the long way round.
    const was = ship.design;
    const before = entryMass(fleet, ship);
    fleet.designs[name] = design;
    ship.design = name;
    if (blueprintProblem(withFleetFighters(design, fleet.designs)) !== null || !(entryMass(fleet, ship) > before)) {
        delete fleet.designs[name];
        ship.design = was;
        return [];
    }
    const of = first.name === second.name ? `two ${first.name}s` : `a ${first.name} and a ${second.name}`;
    return [`${name}, of ${of}, in place of a ${first.name}`];
}

/** A design cut at a face of one of its modules that could be welded to, or null if it has none. */
function cut(modules: ModuleSpec[], rng: Rng): Half | null {
    const sites = modules.filter((spec) => CUT_KINDS.has(spec.kind));
    if (sites.length === 0) return null;
    const at = sites[rng.nextInt(sites.length)]!;
    const corners: number[] = [];
    const count = moduleOutline(at, corners);
    const edge = rng.nextInt(count);
    const x0 = corners[edge * 2]!;
    const y0 = corners[edge * 2 + 1]!;
    const x1 = corners[((edge + 1) % count) * 2]!;
    const y1 = corners[((edge + 1) % count) * 2 + 1]!;
    const length = sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
    if (!(length > 0)) return null;
    // Wound anticlockwise, so outward is the edge turned a quarter clockwise.
    const nx = (y1 - y0) / length;
    const ny = -(x1 - x0) / length;
    const x = (x0 + x1) / 2;
    const y = (y0 + y1) / 2;
    const kept = modules.filter((spec) => {
        if (spec === at) return true;
        const outline: number[] = [];
        const n = moduleOutline(spec, outline);
        for (let i = 0; i < n; i++) if ((outline[i * 2]! - x) * nx + (outline[i * 2 + 1]! - y) * ny > CUT_TOLERANCE) return false;
        return true;
    });
    return { modules: kept.map((spec) => JSON.parse(JSON.stringify(spec)) as ModuleSpec), x, y, nx, ny };
}

/** What a chimera is called, numbered after the first. */
const CHIMERA = "Chimera";

/** How far past a cut a kept module may reach, metres: corners on the face itself, and rounding. */
const CUT_TOLERANCE = 1e-6;

/**
 * How big the ships an entry places are: its largest hull's radius. Not how
 * far the entry reaches, since a row of twenty fighters is still fighters.
 */
function sizeOf(fleet: Fleet, entry: FleetEntry, layout: Layout): number {
    let size = 0;
    for (const hull of layout.hulls({ ...fleet, ships: [entry] })) size = max(size, hull.design.radius);
    return size;
}

/**
 * The fleet's other entry nearest this one: which way it lies, as a unit
 * vector, and how crowded the two are, from 0 far apart to 1 with their
 * circles touching or closer.
 */
function nearest(fleet: Fleet, entry: FleetEntry, layout: Layout): { ux: number; uy: number; crowding: number } | null {
    let best: { ux: number; uy: number; crowding: number } | null = null;
    let closest = Infinity;
    const own = sizeOf(fleet, entry, layout);
    for (const other of fleet.ships) {
        if (other === entry) continue;
        const dx = other.x - entry.x;
        const dy = other.y - entry.y;
        const d = sqrt(dx * dx + dy * dy);
        if (!(d > 0) || d >= closest) continue;
        closest = d;
        best = { ux: dx / d, uy: dy / d, crowding: min(1, (own + sizeOf(fleet, other, layout)) / d) };
    }
    return best;
}

/** Whether the fleet's ships stand clear of each other and inside the radius. */
function placed(fleet: Fleet, bounds: Pick<FleetMutationLimits, "radius">, layout: Layout): boolean {
    const hulls = layout.hulls(fleet);
    return fleetReach(hulls) <= bounds.radius && firstOverlap(hulls) === null;
}

function describe(entry: FleetEntry): string {
    return isGroupUse(entry) ? `group ${entry.group}` : `a ${entry.design}`;
}

function hasPad(fleet: Fleet): boolean {
    return Object.values(fleet.designs).some((blueprint) => {
        const lists = [blueprint.modules, ...Object.values(blueprint.assemblies ?? {}).map((a) => a.modules)];
        return lists.some((list) => list.some((p) => !isInstance(p) && readsCraft(p.kind)));
    });
}

/** Designs some entry flies, and those a pad of one keeps, in the order the fleet lists them. */
function bredDesigns(fleet: Fleet): string[] {
    const kept = padReached(fleet, usedDesigns(fleet));
    return Object.keys(fleet.designs).filter((name) => kept.has(name));
}

/** Designs some entry flies, in the order the fleet lists them. */
function usedDesigns(fleet: Fleet): string[] {
    return Object.keys(fleet.designs).filter((name) => uses(fleet, name) > 0);
}

/** How many entries name a design, directly or in a group. */
function uses(fleet: Fleet, name: string): number {
    let count = 0;
    const visit = (entries: readonly FleetEntry[]): void => {
        for (const entry of entries) if (!isGroupUse(entry) && entry.design === name) count += entry.repeat ?? 1;
    };
    visit(fleet.ships);
    for (const group of Object.values(fleet.groups ?? {})) visit(group.ships);
    return count;
}

function sameAsCore(design: Blueprint): boolean {
    return JSON.stringify(design.modules) === JSON.stringify(BARE_CORE.modules);
}

/** `name 2`, `name 3`, … — the first the fleet does not already carry. */
function freeName(fleet: Fleet, name: string): string {
    const stem = name.replace(/ \d+$/, "");
    for (let n = 2; ; n++) {
        const candidate = `${stem} ${n}`;
        if (fleet.designs[candidate] === undefined) return candidate;
    }
}

function weighted<T>(rng: Rng, weights: readonly number[], of: readonly T[]): T {
    let total = 0;
    for (const weight of weights) total += max(0, weight);
    let draw = rng.nextFloat() * total;
    for (let i = 0; i < of.length; i++) {
        draw -= max(0, weights[i]!);
        if (draw < 0) return of[i]!;
    }
    return of[of.length - 1]!;
}

function pick(rng: Rng, weights: Readonly<Record<FleetOperator, number>>): FleetOperator {
    const entries = Object.entries(weights) as [FleetOperator, number][];
    return weighted(
        rng,
        entries.map(([, weight]) => weight),
        entries.map(([operator]) => operator),
    );
}

function clone(fleet: Fleet): Fleet {
    return JSON.parse(JSON.stringify(fleet)) as Fleet;
}
