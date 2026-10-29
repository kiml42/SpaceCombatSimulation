import { DEFAULT_FLEET_LIMITS, type FleetMutationLimits, type FleetOperator } from "./fleetMutate.js";
import {
    DEFAULT_BUILD_WEIGHTS,
    DEFAULT_DOCTRINE_WEIGHTS,
    DEFAULT_KINDS,
    DEFAULT_LIMITS,
    type BuildWeights,
    type DoctrineWeights,
    type KindWeights,
    type MutationLimits,
} from "./mutate.js";

/**
 * The mutation settings a page offers, written once: what each is called and
 * what it means, its default, and how the numbers make a breeding's limits.
 * The Evolution route draws its mutation cards from these, for each side, and
 * the Skirmish route the same cards for the enemy's search.
 */

/** Which card a field is in: the build, the kinds a module may become, the fleet's changes, or the doctrine. */
export type MutationGroup = "build" | "kinds" | "fleet" | "doctrine";

export interface MutationField {
    readonly name: string;
    readonly group: MutationGroup;
    readonly label: string;
    readonly title: string;
    readonly step: number;
    readonly max?: number;
    /** Its default. */
    readonly value: number;
}

export const MUTATION_FIELDS: readonly MutationField[] = [
    {
        name: "magnitude",
        group: "build",
        label: "number drift",
        step: 0.05,
        value: DEFAULT_LIMITS.magnitude,
        title: "How far every number drifts each generation, as a share of its own size: the spread of the nudge each is given. The move, resize, fittings, tuning and doctrine weights are multiples of it. 0 leaves every number as it is.",
    },
    {
        name: "structural",
        group: "build",
        label: "structural chance",
        step: 0.05,
        max: 1,
        value: DEFAULT_LIMITS.structural,
        title: "Chance each generation of also adding, removing or copying a module, regrouping modules into parts, or lengthening or shortening a repeated row. 0 keeps the ship's structure as it is.",
    },
    {
        name: "geometry",
        group: "build",
        label: "geometry chance",
        step: 0.05,
        max: 1,
        value: DEFAULT_LIMITS.geometry,
        title: "Chance each module has its geometry changed when its design is mutated: a face or a seam moved, a slide, or a turn, chosen by the move and resize odds below. 0 leaves every module where and as big as it is.",
    },
    {
        name: "thrusters",
        group: "build",
        label: "thruster chance",
        step: 0.05,
        max: 1,
        value: DEFAULT_LIMITS.thrusters,
        title: "Chance each generation of a small engine bolted to the hull, facing out, rolled again after each one added — so several can arrive at once to turn the ship as well as push it. Halved for every four engines the ship already has. 0 adds none this way.",
    },
    {
        name: "buildMove",
        group: "build",
        label: "move",
        step: 0.5,
        value: DEFAULT_BUILD_WEIGHTS.move,
        title: "How far a module or part slides or turns when its geometry changes, how often one turns a quarter about a corner, and how often a part is mirrored. 0 leaves where everything is as it is.",
    },
    {
        name: "buildResize",
        group: "build",
        label: "resize",
        step: 0.5,
        value: DEFAULT_BUILD_WEIGHTS.resize,
        title: "How far a module's face or the seam between two modules moves when it changes — at 1, about half the ship's median module — and how often the whole ship is scaled.",
    },
    {
        name: "buildRefit",
        group: "build",
        label: "refit",
        step: 0.5,
        value: DEFAULT_BUILD_WEIGHTS.refit,
        title: "How often a module is refitted into another kind, keeping its place and size, as a multiple of the usual chance. Which kind is drawn from the odds below.",
    },
    {
        name: "buildFittings",
        group: "build",
        label: "fittings",
        step: 0.5,
        value: DEFAULT_BUILD_WEIGHTS.fittings,
        title: "How far barrel lengths and nozzles drift each generation, and how often barrels are added or taken away or a module made thick or thin.",
    },
    {
        name: "buildTuning",
        group: "build",
        label: "tuning",
        step: 0.5,
        value: DEFAULT_BUILD_WEIGHTS.tuning,
        title: "How far its loadout drifts each generation — reinforcement, sealing, fill, computing, robots per berth, traverse, fuses, fragments, burst speed — and how often a drain priority, shells or solid shot, or an engine used as a weapon is switched.",
    },
    {
        name: "buildFighter",
        group: "build",
        label: "fighter role",
        step: 0.5,
        value: DEFAULT_BUILD_WEIGHTS.fighter,
        title: "How often the ship switches between being a fighter and not, as a multiple of the usual chance. Being a fighter changes how it flies and how others target it.",
    },
    {
        name: "buildShape",
        group: "build",
        label: "triangles",
        step: 0.5,
        value: DEFAULT_BUILD_WEIGHTS.shape,
        title: "How often a piece of structure or a tank is shaped — born a wedge, or a corner cut off — and how far a wedge's corner walks along an edge. 0 keeps every module a box, which is also the fastest a run can be — a hull with wedges in it takes about half as long again to compile.",
    },
    {
        name: "kindEngine",
        group: "kinds",
        label: "engines",
        step: 1,
        value: DEFAULT_KINDS.engine,
        title: "Odds that a new or refitted module is an engine: pushes the ship, and can be steered by firing on one side.",
    },
    {
        name: "kindStructure",
        group: "kinds",
        label: "structure",
        step: 1,
        value: DEFAULT_KINDS.structure,
        title: "Odds that a new or refitted module is plain structure: holds the ship together and stops shells, as armour.",
    },
    {
        name: "kindTank",
        group: "kinds",
        label: "tanks",
        step: 1,
        value: DEFAULT_KINDS.tank,
        title: "Odds that a new or refitted module is a fuel tank: reaction mass for the engines, beyond the little each core carries.",
    },
    {
        name: "kindTurret",
        group: "kinds",
        label: "turrets",
        step: 1,
        value: DEFAULT_KINDS.turret,
        title: "Odds that a new or refitted module is a gun turret: turns to aim, firing shells.",
    },
    {
        name: "kindBeamTurret",
        group: "kinds",
        label: "beam turrets",
        step: 1,
        value: DEFAULT_KINDS.beamTurret,
        title: "Odds that a new or refitted module is a beam turret: turns to aim, burning through what it holds on.",
    },
    {
        name: "kindHullGun",
        group: "kinds",
        label: "hull guns",
        step: 1,
        value: DEFAULT_KINDS.hullGun,
        title: "Odds that a new or refitted module is a hull gun: fixed in the hull, firing shells, aimed by turning the whole ship.",
    },
    {
        name: "kindHullBeam",
        group: "kinds",
        label: "hull beams",
        step: 1,
        value: DEFAULT_KINDS.hullBeam,
        title: "Odds that a new or refitted module is a hull beam: fixed in the hull, firing a beam, aimed by turning the whole ship.",
    },
    {
        name: "kindCore",
        group: "kinds",
        label: "cores",
        step: 1,
        value: DEFAULT_KINDS.core,
        title: "Odds that a new or refitted module is a core: what flies the ship. It is out of the fight once every core is.",
    },
    {
        name: "kindClaw",
        group: "kinds",
        label: "claws",
        step: 1,
        value: DEFAULT_KINDS.claw,
        title: "Odds that a new or refitted module is a claw: jaws and a pump on the bow, which drink from wrecks for a doctrine that refuels.",
    },
    {
        name: "kindPad",
        group: "kinds",
        label: "pads",
        step: 0.5,
        value: DEFAULT_KINDS.pad,
        title: "Odds that a new or refitted module is a pad: a deck a friendly fighter can land on to take on fuel. It pays only in a fleet that carries fighters.",
    },
    {
        name: "kindPort",
        group: "kinds",
        label: "ports",
        step: 0.5,
        value: DEFAULT_KINDS.port,
        title: "Odds that a new or refitted module is a docking port: a fixture on a hull's side that mates face to face with a friend's, to pass fuel. It pays only in a fleet with another port to meet.",
    },
    {
        name: "kindHold",
        group: "kinds",
        label: "holds",
        step: 1,
        value: DEFAULT_KINDS.hold,
        title: "Odds that a new or refitted module is a hold: a box of metal that guns load their rounds from.",
    },
    {
        name: "kindBattery",
        group: "kinds",
        label: "batteries",
        step: 1,
        value: DEFAULT_KINDS.battery,
        title: "Odds that a new or refitted module is a battery: a store of charge that a generator fills and beams draw on.",
    },
    {
        name: "kindGenerator",
        group: "kinds",
        label: "generators",
        step: 1,
        value: DEFAULT_KINDS.generator,
        title: "Odds that a new or refitted module is a generator: a plant that makes power for as long as it works.",
    },
    {
        name: "kindRobotBay",
        group: "kinds",
        label: "robot bays",
        step: 0.5,
        value: DEFAULT_KINDS.robotBay,
        title: "Odds that a new or refitted module is a robot bay: robots that crawl the hull mending what damage has done.",
    },
    {
        name: "kindSlipway",
        group: "kinds",
        label: "slipways",
        step: 0.5,
        value: DEFAULT_KINDS.slipway,
        title: "Odds that a new or refitted module is a slipway: a shipyard that builds the ship it names, bow first out of its face. It pays only in a fleet, which can point it at a ship to build.",
    },
    {
        name: "fleetDesign",
        group: "fleet",
        label: "design chance",
        step: 0.05,
        max: 1,
        value: DEFAULT_FLEET_LIMITS.design,
        title: "Chance each of the fleet's designs is mutated each generation, the way a single ship is, however many designs there are. Every ship built to a design changes with it.",
    },
    {
        name: "fleetMove",
        group: "fleet",
        label: "ship moves",
        step: 0.25,
        value: DEFAULT_FLEET_LIMITS.move,
        title: "How far every ship or group moves and turns where it starts the battle, each generation: at 1, a spread of a quarter of its own size and 15°, leaning away from its nearest neighbour. 0 holds them still.",
    },
    {
        name: "fleetChange",
        group: "fleet",
        label: "fleet change chance",
        step: 0.05,
        max: 1,
        value: DEFAULT_FLEET_LIMITS.change,
        title: "Chance each generation of also changing what the fleet is made of: a ship added or removed, a design forked or merged, a ship swapped, or a pad's or slipway's craft changed, by the odds below.",
    },
    {
        name: "opAdd",
        group: "fleet",
        label: "ship added",
        step: 0.5,
        value: DEFAULT_FLEET_LIMITS.operators.add,
        title: "Odds of adding a copy of one of the fleet's ships or groups, a little way off from it.",
    },
    {
        name: "opRemove",
        group: "fleet",
        label: "ship removed",
        step: 0.5,
        value: DEFAULT_FLEET_LIMITS.operators.remove,
        title: "Odds of taking out one of the fleet's ships or groups. The last one is never removed.",
    },
    {
        name: "opFork",
        group: "fleet",
        label: "design forked",
        step: 0.5,
        value: DEFAULT_FLEET_LIMITS.operators.fork,
        title: "Odds of giving one ship its own copy of a design it shares, so it can go on changing separately. The opposite of a merge.",
    },
    {
        name: "opMerge",
        group: "fleet",
        label: "designs merged",
        step: 0.5,
        value: DEFAULT_FLEET_LIMITS.operators.merge,
        title: "Odds of building every ship of one design to another of the fleet's designs instead, dropping the first. The opposite of a fork.",
    },
    {
        name: "opSwap",
        group: "fleet",
        label: "ship swapped",
        step: 0.5,
        value: DEFAULT_FLEET_LIMITS.operators.swap,
        title: "Odds of building one of the fleet's own ships to another of its designs instead. Its own opposite.",
    },
    {
        name: "opPad",
        group: "fleet",
        label: "pad's or slipway's craft changed",
        step: 0.5,
        value: DEFAULT_FLEET_LIMITS.operators.pad,
        title: "Odds of pointing a pad at another fighter, or a slipway at another ship: one the fleet already has, a copy of its own to change separately, or a new bare core. Only in a fleet with a pad or slipway.",
    },
    {
        name: "opSteal",
        group: "fleet",
        label: "opponent's design stolen",
        step: 0.5,
        value: DEFAULT_FLEET_LIMITS.operators.steal,
        title: "Odds of stealing one of the opponent's designs, and whatever it builds, and adding a ship of it beside one of the fleet's own, to be bred apart from there: the player's fleet in a skirmish, the other side's champions in a co-evolution run of fleets. Never in a run with no opponent.",
    },
    {
        name: "opSpread",
        group: "fleet",
        label: "fleet spread or drawn in",
        step: 0.5,
        value: DEFAULT_FLEET_LIMITS.operators.spread,
        title: "Odds of moving every ship out from the fleet's middle, or in towards it, by one factor: the formation opened out or closed up in one step.",
    },
    {
        name: "fleetSpreadSize",
        group: "fleet",
        label: "spread size",
        step: 0.05,
        value: DEFAULT_FLEET_LIMITS.spreadSize,
        title: "How far a fleet spread or drawn in moves its ships, as a drift of the factor: at 0.25, a quarter out or in most often, now and then much further.",
    },
    {
        name: "opScale",
        group: "fleet",
        label: "design scaled",
        step: 0.5,
        value: DEFAULT_FLEET_LIMITS.operators.scale,
        title: "Odds of making one of the fleet's designs a tenth bigger or smaller, whole, and every ship of it with it.",
    },
    {
        name: "fleetScaleSize",
        group: "fleet",
        label: "design scale size",
        step: 0.05,
        value: DEFAULT_FLEET_LIMITS.scaleSize,
        title: "How much bigger or smaller a design scaled is made, as a drift of the factor: at 0.2, a fifth either way most often, now and then much more.",
    },
    {
        name: "opChimera",
        group: "fleet",
        label: "chimera made",
        step: 0.5,
        value: DEFAULT_FLEET_LIMITS.operators.chimera,
        title: "Odds of cutting two of the fleet's designs, or one twice, at a face of one of their modules, dropping everything beyond each face, and joining the two halves face to face into a new design one of the fleet's ships is rebuilt to.",
    },
    {
        name: "opGraft",
        group: "fleet",
        label: "opponent's part grafted",
        step: 0.5,
        value: DEFAULT_FLEET_LIMITS.operators.graft,
        title: "Odds of cutting one of the opponent's designs, the heavier the likelier, and one of the fleet's own as a chimera's are, and joining the halves into a new design one of the fleet's ships is rebuilt to, with whatever the opponent's half builds. Never in a run with no opponent.",
    },
    {
        name: "doctrineTargeting",
        group: "doctrine",
        label: "targeting",
        step: 0.5,
        value: DEFAULT_DOCTRINE_WEIGHTS.targeting,
        title: "How far the ship's own targeting numbers drift each generation — what it goes after: how big, how near, how armed or how fast a target it prefers. At 1, about a tenth; 0 leaves them as they are.",
    },
    {
        name: "doctrineApproach",
        group: "doctrine",
        label: "approach",
        step: 0.5,
        value: DEFAULT_DOCTRINE_WEIGHTS.approach,
        title: "How far the ship's approach numbers drift each generation — how it flies to a fight: the range it holds off at, how hard it accelerates and brakes, and when it rams. At 1, about a tenth; 0 leaves them as they are.",
    },
    {
        name: "doctrineEscort",
        group: "doctrine",
        label: "escorting",
        step: 0.5,
        value: DEFAULT_DOCTRINE_WEIGHTS.escort,
        title: "How far the ship's escorting numbers drift each generation: how much it would rather stay with a friend than fight, how close it keeps, and how small a friend it will cover. 0 leaves them as they are.",
    },
    {
        name: "doctrineAvoidance",
        group: "doctrine",
        label: "avoidance",
        step: 0.5,
        value: DEFAULT_DOCTRINE_WEIGHTS.avoidance,
        title: "How far the ship's avoidance numbers drift each generation: how much it wants to keep out of everybody's way, and how close is too close. 0 leaves them as they are.",
    },
    {
        name: "doctrineGunnery",
        group: "doctrine",
        label: "weapon gunnery",
        step: 0.5,
        value: DEFAULT_DOCTRINE_WEIGHTS.gunnery,
        title: "How far a weapon's own target preferences drift each generation, so one mount can learn to pick targets differently from the rest of the ship. At 1, about a tenth; 0 leaves them as they are.",
    },
];

/** The fleet fields that are not a change's odds, by name, and what each sets. */
const FLEET_FIELDS: Readonly<Record<string, "design" | "move" | "change" | "scaleSize" | "spreadSize">> = {
    fleetDesign: "design",
    fleetMove: "move",
    fleetChange: "change",
    fleetScaleSize: "scaleSize",
    fleetSpreadSize: "spreadSize",
};

/** Each field's default, by name. */
export const MUTATION_DEFAULTS: Readonly<Record<string, number>> = Object.fromEntries(MUTATION_FIELDS.map((f) => [f.name, f.value]));

/** What the numbers make: how a ship is mutated, and the odds of each change to a fleet. */
export interface Breeding {
    readonly ship: Pick<MutationLimits, "magnitude" | "structural" | "geometry" | "thrusters" | "build" | "kinds" | "doctrine">;
    readonly operators: Readonly<Record<FleetOperator, number>>;
    readonly fleet: Pick<FleetMutationLimits, "design" | "move" | "change" | "scaleSize" | "spreadSize">;
}

/**
 * The limits a set of values makes, `value` reading each by name; one missing
 * or not a number is its default. None is below zero, nor a chance above one.
 */
export function breeding(value: (name: string) => number | undefined): Breeding {
    const read = (field: MutationField): number => {
        const v = value(field.name);
        const n = v !== undefined && Number.isFinite(v) ? v : field.value;
        const low = n > 0 ? n : 0;
        return field.max !== undefined && low > field.max ? field.max : low;
    };
    const build: Record<string, number> = {};
    const kinds: Record<string, number> = {};
    const operators: Record<string, number> = {};
    const doctrine: Record<string, number> = {};
    let magnitude = DEFAULT_LIMITS.magnitude;
    let structural = DEFAULT_LIMITS.structural;
    let geometry = DEFAULT_LIMITS.geometry;
    let thrusters = DEFAULT_LIMITS.thrusters;
    const fleet = {
        design: DEFAULT_FLEET_LIMITS.design,
        move: DEFAULT_FLEET_LIMITS.move,
        change: DEFAULT_FLEET_LIMITS.change,
        scaleSize: DEFAULT_FLEET_LIMITS.scaleSize,
        spreadSize: DEFAULT_FLEET_LIMITS.spreadSize,
    };
    for (const field of MUTATION_FIELDS) {
        const fleetKey = FLEET_FIELDS[field.name];
        if (fleetKey !== undefined) {
            fleet[fleetKey] = read(field);
            continue;
        }
        if (field.name === "magnitude") {
            magnitude = read(field);
            continue;
        }
        if (field.name === "structural") {
            structural = read(field);
            continue;
        }
        if (field.name === "geometry") {
            geometry = read(field);
            continue;
        }
        if (field.name === "thrusters") {
            thrusters = read(field);
            continue;
        }
        const into = field.group === "build" ? build : field.group === "kinds" ? kinds : field.group === "fleet" ? operators : doctrine;
        const prefix = field.group === "build" ? "build" : field.group === "kinds" ? "kind" : field.group === "fleet" ? "op" : "doctrine";
        const key = field.name.slice(prefix.length);
        into[key.charAt(0).toLowerCase() + key.slice(1)] = read(field);
    }
    return {
        ship: {
            magnitude,
            structural,
            geometry,
            thrusters,
            build: build as unknown as BuildWeights,
            kinds: kinds as unknown as KindWeights,
            doctrine: doctrine as unknown as DoctrineWeights,
        },
        operators: operators as Record<FleetOperator, number>,
        fleet,
    };
}
