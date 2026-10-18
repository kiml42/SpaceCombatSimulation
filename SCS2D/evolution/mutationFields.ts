import { DEFAULT_FLEET_LIMITS, type FleetMutationLimits, type FleetOperator } from './fleetMutate.js';
import {
  DEFAULT_BUILD_WEIGHTS,
  DEFAULT_DOCTRINE_WEIGHTS,
  DEFAULT_KINDS,
  DEFAULT_LIMITS,
  type BuildWeights,
  type DoctrineWeights,
  type KindWeights,
  type MutationLimits,
} from './mutate.js';

/**
 * The mutation settings a page offers, written once: what each is called and
 * what it means, its default, and how the numbers make a breeding's limits.
 * The evolution page draws its mutation cards from these, for each side, and
 * the skirmish page the same cards for the enemy's search.
 */

/** Which card a field is in: the build, the kinds a module may become, the fleet's changes, or the doctrine. */
export type MutationGroup = 'build' | 'kinds' | 'fleet' | 'doctrine';

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
  { name: 'structural', group: 'build', label: 'structural chance', step: 0.05, max: 1, value: DEFAULT_LIMITS.structural,
    title: 'Chance each generation of also adding, removing or copying a module, regrouping modules into parts, or lengthening or shortening a repeated row. 0 keeps the ship\'s structure as it is.' },
  { name: 'geometry', group: 'build', label: 'geometry chance', step: 0.05, max: 1, value: DEFAULT_LIMITS.geometry,
    title: 'Chance each module has its geometry changed when its design is mutated: a face or a seam moved, a slide, or a turn, chosen by the move and resize odds below. 0 leaves every module where and as big as it is.' },
  { name: 'buildMove', group: 'build', label: 'move', step: 0.5, value: DEFAULT_BUILD_WEIGHTS.move,
    title: 'How far a module or part slides or turns when its geometry changes, how often one turns a quarter about a corner, and how often a part is mirrored. 0 leaves where everything is as it is.' },
  { name: 'buildResize', group: 'build', label: 'resize', step: 0.5, value: DEFAULT_BUILD_WEIGHTS.resize,
    title: 'How far a module\'s face or the seam between two modules moves when it changes — at 1, about half the ship\'s median module — and how often the whole ship is scaled.' },
  { name: 'buildRefit', group: 'build', label: 'refit', step: 0.5, value: DEFAULT_BUILD_WEIGHTS.refit,
    title: 'How often a module is refitted into another kind, keeping its place and size, as a multiple of the usual chance. Which kind is drawn from the odds below.' },
  { name: 'buildFittings', group: 'build', label: 'fittings', step: 0.5, value: DEFAULT_BUILD_WEIGHTS.fittings,
    title: 'How far barrel lengths and nozzles drift each generation, and how often barrels are added or taken away or a module made thick or thin.' },
  { name: 'buildTuning', group: 'build', label: 'tuning', step: 0.5, value: DEFAULT_BUILD_WEIGHTS.tuning,
    title: 'How far its loadout drifts each generation — reinforcement, sealing, fill, traverse, fuses, fragments, burst speed — and how often a drain priority, shells or solid shot, or an engine used as a weapon is switched.' },
  { name: 'buildFighter', group: 'build', label: 'fighter role', step: 0.5, value: DEFAULT_BUILD_WEIGHTS.fighter,
    title: 'How often the ship switches between being a fighter and not, as a multiple of the usual chance. Being a fighter changes how it flies and how others target it.' },
  { name: 'buildShape', group: 'build', label: 'triangles', step: 0.5, value: DEFAULT_BUILD_WEIGHTS.shape,
    title: 'How often a piece of structure or a tank is shaped — born a wedge, or a corner cut off — and how far a wedge\'s corner walks along an edge. 0 keeps every module a box, which is also the fastest a run can be — a hull with wedges in it takes about half as long again to compile.' },
  { name: 'kindEngine', group: 'kinds', label: 'engines', step: 1, value: DEFAULT_KINDS.engine,
    title: 'Odds that a new or refitted module is an engine: pushes the ship, and can be steered by firing on one side.' },
  { name: 'kindStructure', group: 'kinds', label: 'structure', step: 1, value: DEFAULT_KINDS.structure,
    title: 'Odds that a new or refitted module is plain structure: holds the ship together and stops shells, as armour.' },
  { name: 'kindTank', group: 'kinds', label: 'tanks', step: 1, value: DEFAULT_KINDS.tank,
    title: 'Odds that a new or refitted module is a fuel tank: reaction mass for the engines, beyond the little each core carries.' },
  { name: 'kindTurret', group: 'kinds', label: 'turrets', step: 1, value: DEFAULT_KINDS.turret,
    title: 'Odds that a new or refitted module is a gun turret: turns to aim, firing shells.' },
  { name: 'kindBeamTurret', group: 'kinds', label: 'beam turrets', step: 1, value: DEFAULT_KINDS.beamTurret,
    title: 'Odds that a new or refitted module is a beam turret: turns to aim, burning through what it holds on.' },
  { name: 'kindHullGun', group: 'kinds', label: 'hull guns', step: 1, value: DEFAULT_KINDS.hullGun,
    title: 'Odds that a new or refitted module is a hull gun: fixed in the hull, firing shells, aimed by turning the whole ship.' },
  { name: 'kindHullBeam', group: 'kinds', label: 'hull beams', step: 1, value: DEFAULT_KINDS.hullBeam,
    title: 'Odds that a new or refitted module is a hull beam: fixed in the hull, firing a beam, aimed by turning the whole ship.' },
  { name: 'kindCore', group: 'kinds', label: 'cores', step: 1, value: DEFAULT_KINDS.core,
    title: 'Odds that a new or refitted module is a core: what flies the ship. It is out of the fight once every core is.' },
  { name: 'kindClaw', group: 'kinds', label: 'claws', step: 1, value: DEFAULT_KINDS.claw,
    title: 'Odds that a new or refitted module is a claw: jaws and a pump on the bow, which drink from wrecks for a doctrine that refuels.' },
  { name: 'kindPad', group: 'kinds', label: 'pads', step: 0.5, value: DEFAULT_KINDS.pad,
    title: 'Odds that a new or refitted module is a pad: a deck a friendly fighter can land on to take on fuel. It pays only in a fleet that carries fighters.' },
  { name: 'kindPort', group: 'kinds', label: 'ports', step: 0.5, value: DEFAULT_KINDS.port,
    title: 'Odds that a new or refitted module is a docking port: a fixture on a hull\'s side that mates face to face with a friend\'s, to pass fuel. It pays only in a fleet with another port to meet.' },
  { name: 'kindHold', group: 'kinds', label: 'holds', step: 1, value: DEFAULT_KINDS.hold,
    title: 'Odds that a new or refitted module is a hold: a box of metal that guns load their rounds from.' },
  { name: 'kindBattery', group: 'kinds', label: 'batteries', step: 1, value: DEFAULT_KINDS.battery,
    title: 'Odds that a new or refitted module is a battery: a store of charge that a generator fills and beams draw on.' },
  { name: 'kindGenerator', group: 'kinds', label: 'generators', step: 1, value: DEFAULT_KINDS.generator,
    title: 'Odds that a new or refitted module is a generator: a plant that makes power for as long as it works.' },
  { name: 'kindRobotBay', group: 'kinds', label: 'robot bays', step: 0.5, value: DEFAULT_KINDS.robotBay,
    title: 'Odds that a new or refitted module is a robot bay: robots that crawl the hull mending what damage has done.' },
  { name: 'kindSlipway', group: 'kinds', label: 'slipways', step: 0.5, value: DEFAULT_KINDS.slipway,
    title: 'Odds that a new or refitted module is a slipway: a shipyard that builds the ship it names, bow first out of its face. It pays only in a fleet, which can point it at a ship to build.' },
  { name: 'fleetDesign', group: 'fleet', label: 'design chance', step: 0.05, max: 1, value: DEFAULT_FLEET_LIMITS.design,
    title: 'Chance each of the fleet\'s designs is mutated each generation, the way a single ship is, however many designs there are. Every ship built to a design changes with it.' },
  { name: 'fleetMove', group: 'fleet', label: 'ship moves', step: 0.25, value: DEFAULT_FLEET_LIMITS.move,
    title: 'How far every ship or group moves and turns where it starts the battle, each generation: at 1, a spread of a quarter of its own size and 15°, leaning away from its nearest neighbour. 0 holds them still.' },
  { name: 'fleetChange', group: 'fleet', label: 'fleet change chance', step: 0.05, max: 1, value: DEFAULT_FLEET_LIMITS.change,
    title: 'Chance each generation of also changing what the fleet is made of: a ship added or removed, a design forked or merged, a ship swapped, or a pad\'s or slipway\'s craft changed, by the odds below.' },
  { name: 'opAdd', group: 'fleet', label: 'ship added', step: 0.5, value: DEFAULT_FLEET_LIMITS.operators.add,
    title: 'Odds of adding a copy of one of the fleet\'s ships or groups, a little way off from it.' },
  { name: 'opRemove', group: 'fleet', label: 'ship removed', step: 0.5, value: DEFAULT_FLEET_LIMITS.operators.remove,
    title: 'Odds of taking out one of the fleet\'s ships or groups. The last one is never removed.' },
  { name: 'opFork', group: 'fleet', label: 'design forked', step: 0.5, value: DEFAULT_FLEET_LIMITS.operators.fork,
    title: 'Odds of giving one ship its own copy of a design it shares, so it can go on changing separately. The opposite of a merge.' },
  { name: 'opMerge', group: 'fleet', label: 'designs merged', step: 0.5, value: DEFAULT_FLEET_LIMITS.operators.merge,
    title: 'Odds of building every ship of one design to another of the fleet\'s designs instead, dropping the first. The opposite of a fork.' },
  { name: 'opSwap', group: 'fleet', label: 'ship swapped', step: 0.5, value: DEFAULT_FLEET_LIMITS.operators.swap,
    title: 'Odds of building one of the fleet\'s own ships to another of its designs instead. Its own opposite.' },
  { name: 'opPad', group: 'fleet', label: 'pad\'s or slipway\'s craft changed', step: 0.5, value: DEFAULT_FLEET_LIMITS.operators.pad,
    title: 'Odds of pointing a pad at another fighter, or a slipway at another ship: one the fleet already has, a copy of its own to change separately, or a new bare core. Only in a fleet with a pad or slipway.' },
  { name: 'doctrineTargeting', group: 'doctrine', label: 'targeting', step: 0.5, value: DEFAULT_DOCTRINE_WEIGHTS.targeting,
    title: 'How far the ship\'s own targeting numbers drift each generation — what it goes after: how big, how near, how armed or how fast a target it prefers. At 1, a few percent; 0 leaves them as they are.' },
  { name: 'doctrineApproach', group: 'doctrine', label: 'approach', step: 0.5, value: DEFAULT_DOCTRINE_WEIGHTS.approach,
    title: 'How far the ship\'s approach numbers drift each generation — how it flies to a fight: the range it holds off at, how hard it accelerates and brakes, and when it rams. At 1, a few percent; 0 leaves them as they are.' },
  { name: 'doctrineEscort', group: 'doctrine', label: 'escorting', step: 0.5, value: DEFAULT_DOCTRINE_WEIGHTS.escort,
    title: 'How far the ship\'s escorting numbers drift each generation: how much it would rather stay with a friend than fight, how close it keeps, and how small a friend it will cover. 0 leaves them as they are.' },
  { name: 'doctrineAvoidance', group: 'doctrine', label: 'avoidance', step: 0.5, value: DEFAULT_DOCTRINE_WEIGHTS.avoidance,
    title: 'How far the ship\'s avoidance numbers drift each generation: how much it wants to keep out of everybody\'s way, and how close is too close. 0 leaves them as they are.' },
  { name: 'doctrineGunnery', group: 'doctrine', label: 'weapon gunnery', step: 0.5, value: DEFAULT_DOCTRINE_WEIGHTS.gunnery,
    title: 'How far a weapon\'s own target preferences drift each generation, so one mount can learn to pick targets differently from the rest of the ship. At 1, a few percent; 0 leaves them as they are.' },
];

/** Each field's default, by name. */
export const MUTATION_DEFAULTS: Readonly<Record<string, number>> = Object.fromEntries(MUTATION_FIELDS.map((f) => [f.name, f.value]));

/** What the numbers make: how a ship is mutated, and the odds of each change to a fleet. */
export interface Breeding {
  readonly ship: Pick<MutationLimits, 'structural' | 'geometry' | 'build' | 'kinds' | 'doctrine'>;
  readonly operators: Readonly<Record<FleetOperator, number>>;
  readonly fleet: Pick<FleetMutationLimits, 'design' | 'move' | 'change'>;
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
  let structural = DEFAULT_LIMITS.structural;
  let geometry = DEFAULT_LIMITS.geometry;
  const fleet = { design: DEFAULT_FLEET_LIMITS.design, move: DEFAULT_FLEET_LIMITS.move, change: DEFAULT_FLEET_LIMITS.change };
  for (const field of MUTATION_FIELDS) {
    if (field.name === 'fleetDesign' || field.name === 'fleetMove' || field.name === 'fleetChange') {
      fleet[field.name === 'fleetDesign' ? 'design' : field.name === 'fleetMove' ? 'move' : 'change'] = read(field);
      continue;
    }
    if (field.name === 'structural') {
      structural = read(field);
      continue;
    }
    if (field.name === 'geometry') {
      geometry = read(field);
      continue;
    }
    const into = field.group === 'build' ? build : field.group === 'kinds' ? kinds : field.group === 'fleet' ? operators : doctrine;
    const prefix = field.group === 'build' ? 'build' : field.group === 'kinds' ? 'kind' : field.group === 'fleet' ? 'op' : 'doctrine';
    const key = field.name.slice(prefix.length);
    into[key.charAt(0).toLowerCase() + key.slice(1)] = read(field);
  }
  return {
    ship: {
      structural,
      geometry,
      build: build as unknown as BuildWeights,
      kinds: kinds as unknown as KindWeights,
      doctrine: doctrine as unknown as DoctrineWeights,
    },
    operators: operators as Record<FleetOperator, number>,
    fleet,
  };
}
