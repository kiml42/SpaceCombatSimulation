import { DEFAULT_FLEET_LIMITS, type FleetOperator } from './fleetMutate.js';
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
  { name: 'buildMove', group: 'build', label: 'move', step: 0.5, value: DEFAULT_BUILD_WEIGHTS.move,
    title: 'How often a module or part is moved a grid step, turned, or mirrored.' },
  { name: 'buildResize', group: 'build', label: 'resize', step: 0.5, value: DEFAULT_BUILD_WEIGHTS.resize,
    title: 'How often a module is made longer or wider, or the seam between two modules is shifted.' },
  { name: 'buildRefit', group: 'build', label: 'refit', step: 0.5, value: DEFAULT_BUILD_WEIGHTS.refit,
    title: 'How often a module is refitted into another kind, keeping its place and size. Which kind is drawn from the odds below.' },
  { name: 'buildFittings', group: 'build', label: 'fittings', step: 0.5, value: DEFAULT_BUILD_WEIGHTS.fittings,
    title: 'How often something that would take real work on the craft is changed: barrels and their length, nozzles, and thickness.' },
  { name: 'buildTuning', group: 'build', label: 'tuning', step: 0.5, value: DEFAULT_BUILD_WEIGHTS.tuning,
    title: 'How often its loadout is changed: reinforcement, sealing, drain priority, traverse, fuses, fragments, burst speed, and an engine used as a weapon.' },
  { name: 'buildFighter', group: 'build', label: 'fighter role', step: 0.5, value: DEFAULT_BUILD_WEIGHTS.fighter,
    title: 'How often the ship switches between being a fighter and not, which changes how it flies and how others target it.' },
  { name: 'buildShape', group: 'build', label: 'triangles', step: 0.5, value: DEFAULT_BUILD_WEIGHTS.shape,
    title: 'How often a piece of structure or a tank is shaped: born a wedge, a corner cut off, or a corner walked along an edge. 0 keeps every module a box, which is also the fastest a run can be — a hull with wedges in it takes about half as long again to compile.' },
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
  { name: 'kindPad', group: 'kinds', label: 'pads', step: 1, value: DEFAULT_KINDS.pad,
    title: 'Odds that a new or refitted module is a pad: a deck a friendly fighter can land on to take on fuel. It pays only in a fleet that carries fighters.' },
  { name: 'kindPort', group: 'kinds', label: 'ports', step: 1, value: DEFAULT_KINDS.port,
    title: 'Odds that a new or refitted module is a docking port: a fixture on a hull\'s side that mates face to face with a friend\'s, to pass fuel. It pays only in a fleet with another port to meet.' },
  { name: 'kindHold', group: 'kinds', label: 'holds', step: 1, value: DEFAULT_KINDS.hold,
    title: 'Odds that a new or refitted module is a hold: a box of metal that guns load their rounds from.' },
  { name: 'kindBattery', group: 'kinds', label: 'batteries', step: 1, value: DEFAULT_KINDS.battery,
    title: 'Odds that a new or refitted module is a battery: a store of charge that a generator fills and beams draw on.' },
  { name: 'kindGenerator', group: 'kinds', label: 'generators', step: 1, value: DEFAULT_KINDS.generator,
    title: 'Odds that a new or refitted module is a generator: a plant that makes power for as long as it works.' },
  { name: 'kindRobotBay', group: 'kinds', label: 'robot bays', step: 1, value: DEFAULT_KINDS.robotBay,
    title: 'Odds that a new or refitted module is a robot bay: robots that crawl the hull mending what damage has done.' },
  { name: 'opDesign', group: 'fleet', label: 'design mutated', step: 0.5, value: DEFAULT_FLEET_LIMITS.operators.design,
    title: 'Odds of mutating one of the fleet\'s designs, the way a single ship is mutated. Every ship built to that design changes with it.' },
  { name: 'opMove', group: 'fleet', label: 'ship moved/turned', step: 0.5, value: DEFAULT_FLEET_LIMITS.operators.move,
    title: 'Odds of moving one of the fleet\'s ships or groups a few metres, or turning it, where it starts the battle.' },
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
  { name: 'doctrineTargeting', group: 'doctrine', label: 'targeting', step: 0.5, value: DEFAULT_DOCTRINE_WEIGHTS.targeting,
    title: 'How often the ship\'s own targeting numbers are the ones changed — what it goes after: how big, how near, how armed or how fast a target it prefers. At 1, each is as likely to change as any number in the build; 0 leaves them as they are.' },
  { name: 'doctrineApproach', group: 'doctrine', label: 'approach', step: 0.5, value: DEFAULT_DOCTRINE_WEIGHTS.approach,
    title: 'How often the ship\'s approach numbers are the ones changed — how it flies to a fight: the range it holds off at, how hard it accelerates and brakes, and when it rams. At 1, each is as likely to change as any number in the build; 0 leaves them as they are.' },
  { name: 'doctrineEscort', group: 'doctrine', label: 'escorting', step: 0.5, value: DEFAULT_DOCTRINE_WEIGHTS.escort,
    title: 'How often the ship\'s escorting numbers are the ones changed: how much it would rather stay with a friend than fight, how close it keeps, and how small a friend it will cover. 0 leaves them as they are.' },
  { name: 'doctrineAvoidance', group: 'doctrine', label: 'avoidance', step: 0.5, value: DEFAULT_DOCTRINE_WEIGHTS.avoidance,
    title: 'How often the ship\'s avoidance numbers are the ones changed: how much it wants to keep out of everybody\'s way, and how close is too close. 0 leaves them as they are.' },
  { name: 'doctrineGunnery', group: 'doctrine', label: 'weapon gunnery', step: 0.5, value: DEFAULT_DOCTRINE_WEIGHTS.gunnery,
    title: 'How often a weapon\'s own target preferences are the ones changed, so one mount can learn to pick targets differently from the rest of the ship. At 1, each weapon is as likely to change as any number in the build; 0 leaves them as they are.' },
];

/** Each field's default, by name. */
export const MUTATION_DEFAULTS: Readonly<Record<string, number>> = Object.fromEntries(MUTATION_FIELDS.map((f) => [f.name, f.value]));

/** What the numbers make: how a ship is mutated, and the odds of each change to a fleet. */
export interface Breeding {
  readonly ship: Pick<MutationLimits, 'structural' | 'build' | 'kinds' | 'doctrine'>;
  readonly operators: Readonly<Record<FleetOperator, number>>;
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
  for (const field of MUTATION_FIELDS) {
    if (field.name === 'structural') {
      structural = read(field);
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
      build: build as unknown as BuildWeights,
      kinds: kinds as unknown as KindWeights,
      doctrine: doctrine as unknown as DoctrineWeights,
    },
    operators: operators as Record<FleetOperator, number>,
  };
}
