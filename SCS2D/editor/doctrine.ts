import {
  APPROACH_FIELDS,
  DEFAULT_DOCTRINE,
  defaultTargeting,
  MOUNT_TARGETING_FIELDS,
  SHIP_TARGETING_FIELDS,
  TARGETING_FIELDS,
  type Doctrine,
  type ModuleKind,
  type Targeting,
} from '../sim/index.js';

/**
 * Doctrine as the editor offers it: which numbers to show, what to call them,
 * and what a set of them amounts to in a sentence.
 *
 * **A box left empty is the whole design.** Every field here is optional, and
 * an empty one means "whatever this archetype does" rather than zero — so a
 * ship drawn without the panel ever being opened carries no doctrine at all
 * and fights on its archetypes' defaults, which is what makes the feature
 * ignorable rather than merely tidy. Typing a number states it; clearing the
 * box takes the statement back out of the blueprint, rather than freezing
 * today's default into the file.
 *
 * No DOM in here, which is what lets the sentences and the edits be tested
 * without a page: `page.ts` turns these rows into inputs and nothing else.
 */

/** One number, as the panel shows it. */
export interface DoctrineRow {
  readonly field: string;
  readonly label: string;
  /** What it does, for the box's tooltip. */
  readonly hint: string;
  /** How much an arrow key moves it, which differs by two orders of magnitude. */
  readonly step: number;
}

const TARGETING_ROWS: readonly DoctrineRow[] = [
  { field: 'proximityWeight', label: 'near', hint: 'Prefer what is close, measured against its own reach', step: 10 },
  { field: 'preferredMass', label: 'size wanted', hint: 'What size to go after, as a multiple of its own mass: 1 is something my own size', step: 0.1 },
  { field: 'massWeight', label: 'size', hint: 'How much going after the right size of thing is worth', step: 10 },
  { field: 'closingWeight', label: 'closing', hint: 'Prefer what is coming at it, per hundred metres per second', step: 5 },
  { field: 'loyaltyWeight', label: 'sticks with it', hint: 'Prefer what it is already fighting, so it stops swapping targets', step: 5 },
  { field: 'armedWeight', label: 'still armed', hint: 'Prefer what can still shoot back', step: 10 },
  { field: 'mobileWeight', label: 'still mobile', hint: 'Prefer what can still get away', step: 10 },
  { field: 'focusWeight', label: "ship's fight", hint: 'Prefer what the ship as a whole is fighting: large, and the ship concentrates', step: 10 },
  { field: 'escortWeight', label: 'escort', hint: 'How much it would rather stay with a consort than go to the best fight it can find', step: 20 },
  { field: 'coreWeight', label: 'aim: core', hint: 'How much it would rather hit the core it is flown from. Below zero is never', step: 10 },
  { field: 'engineWeight', label: 'aim: engines', hint: 'How much it would rather hit an engine. Below zero is never', step: 10 },
  { field: 'gunWeight', label: 'aim: guns', hint: 'How much it would rather hit a gun. Below zero is never', step: 10 },
  { field: 'structureWeight', label: 'aim: structure', hint: 'How much it would rather hit plating. All four at zero shoots at the ship rather than a part of it; zero is leave it alone — never aimed at, and a ship with nothing else left stops being a target — and below zero adds care at the trigger, holding fire until the part it aims at is under the muzzle rather than firing at anything on the hull', step: 10 },
];

const APPROACH_ROWS: readonly DoctrineRow[] = [
  { field: 'standoffRadii', label: 'standoff', hint: "How close to get, in multiples of the target's own radius", step: 5 },
  { field: 'standoff', label: 'range cap', hint: 'The furthest it will hold, as a fraction of its own reach', step: 0.05 },
  { field: 'escortRadii', label: 'escort range', hint: 'How close to sit to what it is covering, in multiples of that ship’s radius', step: 1 },
  { field: 'escort', label: 'escort cap', hint: 'The furthest it will stray from what it is covering, as a fraction of its own reach', step: 0.05 },
  { field: 'separation', label: 'keeps clear', hint: 'How much it wants to stay out of everybody’s way', step: 25 },
  { field: 'separationRadii', label: 'clearance', hint: 'How close is too close, in multiples of the gap between two hulls’ skins', step: 0.5 },
  { field: 'tolerance', label: 'slack', hint: 'How much closer or further than that is close enough, as a fraction', step: 0.05 },
  { field: 'approachSpeed', label: 'closing speed', hint: 'How briskly to close the difference, metres per second', step: 10 },
];

const ROW_OF = new Map<string, DoctrineRow>(
  [...TARGETING_ROWS, ...APPROACH_ROWS].map((row) => [row.field, row]),
);

function rows(fields: readonly string[]): readonly DoctrineRow[] {
  return fields.map((field) => {
    const row = ROW_OF.get(field);
    if (row === undefined) throw new Error(`no editor row for doctrine field ${field}`);
    return row;
  });
}

/**
 * What a weapon is asked about: everything a mount's targeting reads.
 *
 * `escortWeight` is not among them because a gun does not station-keep — it
 * is a steering urge, and a mount steers nothing. Offering it here would be
 * the panel inviting a number that changes nothing.
 */
export const MOUNT_ROWS: readonly DoctrineRow[] = rows(MOUNT_TARGETING_FIELDS);

/**
 * What a ship is asked about: which fight to pick, and how to fly it.
 *
 * The four aim weights are missing for the mirror of the reason above. A ship
 * chooses a *ship*; only a mount chooses which part of one to shoot at, so a
 * hull's `engineWeight` is read by nothing. Leaving them out of the panel is
 * how it stays true rather than merely uncluttered.
 */
export const SHIP_TARGETING_ROWS: readonly DoctrineRow[] = rows(SHIP_TARGETING_FIELDS);

export const SHIP_APPROACH_ROWS: readonly DoctrineRow[] = rows(APPROACH_FIELDS);

function isAimField(field: string): boolean {
  return (
    field === 'coreWeight' ||
    field === 'engineWeight' ||
    field === 'gunWeight' ||
    field === 'structureWeight'
  );
}

/** What to call an archetype where a person is reading it rather than a file. */
export function kindName(kind: ModuleKind): string {
  if (kind === 'beamTurret') return 'beam turret';
  if (kind === 'hullGun') return 'hull gun';
  if (kind === 'hullBeam') return 'hull beam';
  return kind;
}

/** How many of a mount's fields say something its archetype does not. */
export function mountChanges(kind: ModuleKind, held: Partial<Targeting> | undefined): number {
  if (held === undefined) return 0;
  const base = defaultTargeting(kind) as unknown as Record<string, number>;
  return TARGETING_FIELDS.filter((field) => {
    const value = (held as Record<string, number | undefined>)[field];
    return value !== undefined && value !== base[field];
  }).length;
}

/** How many of a ship's fields say something the default does not. */
export function shipChanges(doctrine: Doctrine | undefined): number {
  if (doctrine === undefined) return 0;
  let count = 0;
  for (const field of TARGETING_FIELDS) {
    if (isAimField(field)) continue;
    if (doctrine.targeting[field] !== DEFAULT_DOCTRINE.targeting[field]) count++;
  }
  for (const field of APPROACH_FIELDS) {
    if (doctrine.approach[field] !== DEFAULT_DOCTRINE.approach[field]) count++;
  }
  return count;
}

/** How many changes there are, in the words the summary line uses. */
function counted(changes: number): string {
  return changes === 1 ? '1 change' : `${changes} changes`;
}

/**
 * The line the section shows while it is shut.
 *
 * It says which of the two things is true — this is the archetype, or it is
 * not — because that is what someone who has never opened the panel needs to
 * know, and it is the whole of what "safe to ignore" looks like from outside.
 */
export function mountSummary(kind: ModuleKind, held: Partial<Targeting> | undefined): string {
  const changes = mountChanges(kind, held);
  return changes === 0 ? `${kindName(kind)} default` : `${kindName(kind)}, ${counted(changes)}`;
}

export function shipSummary(doctrine: Doctrine | undefined): string {
  const changes = shipChanges(doctrine);
  return changes === 0 ? 'default' : counted(changes);
}

/**
 * A mount's block with one field stated, or taken back out.
 *
 * Taking the last one out gives `undefined` rather than an empty object, so a
 * mount that has been set back to its archetype writes no `targeting` at all
 * and reads like one that never had any.
 */
export function withMountField(
  held: Partial<Targeting> | undefined,
  field: string,
  value: number | null,
): Partial<Targeting> | undefined {
  const next = { ...held } as Record<string, number>;
  if (value === null) delete next[field];
  else next[field] = value;
  return Object.keys(next).length === 0 ? undefined : (next as Partial<Targeting>);
}

/**
 * A ship's doctrine with one field stated, or taken back to the default.
 *
 * A doctrine is held whole in memory and written as only its differences, so
 * clearing a box is setting the field back to the default value rather than
 * deleting a key — and a doctrine that has become the default exactly is
 * dropped, which is the same "says nothing" a mount gets.
 */
export function withShipField(
  doctrine: Doctrine | undefined,
  half: 'targeting' | 'approach',
  field: string,
  value: number | null,
): Doctrine | undefined {
  const base = doctrine ?? DEFAULT_DOCTRINE;
  const fallback = DEFAULT_DOCTRINE[half] as unknown as Record<string, number>;
  const next: Doctrine = {
    targeting: { ...base.targeting },
    approach: { ...base.approach },
  };
  (next[half] as unknown as Record<string, number>)[field] = value ?? fallback[field]!;
  return shipChanges(next) === 0 ? undefined : next;
}

/** What a mount's box shows when it is empty: what the archetype would do. */
export function mountDefault(kind: ModuleKind, field: string): number {
  return (defaultTargeting(kind) as unknown as Record<string, number>)[field]!;
}

/** The same for a ship, where the fallback is the one default doctrine. */
export function shipDefault(half: 'targeting' | 'approach', field: string): number {
  return (DEFAULT_DOCTRINE[half] as unknown as Record<string, number>)[field]!;
}
