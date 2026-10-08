import {
  APPROACH_FIELDS,
  DEFAULT_DOCTRINE,
  defaultTargeting,
  holdBand,
  TARGETING_FIELDS,
  type Approach,
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
  { field: 'sightWeight', label: 'clear shot', hint: 'Prefer what nothing else is in the way of: a friend, a wreck, or another enemy', step: 10 },
  { field: 'facingWeight', label: 'ahead', hint: 'Prefer what it is already pointed at: full weight dead ahead, nothing abeam, against astern', step: 10 },
  { field: 'escortWeight', label: 'escort', hint: 'How much it would rather stay with a consort than go to the best fight it can find', step: 20 },
  { field: 'coreWeight', label: 'aim: core', hint: 'How much it would rather hit the core it is flown from. Below zero is never', step: 10 },
  { field: 'engineWeight', label: 'aim: engines', hint: 'How much it would rather hit an engine. Below zero is never', step: 10 },
  { field: 'gunWeight', label: 'aim: guns', hint: 'How much it would rather hit a gun. Below zero is never', step: 10 },
  { field: 'fireRange', label: 'fires within', hint: 'How far out it fires, as a multiple of how far its shot is worth taking: above 1 spends shells on long odds, below 1 saves them for a sure thing', step: 0.1 },
  { field: 'structureWeight', label: 'aim: structure', hint: 'How much it would rather hit plating. All four at zero shoots at the ship rather than a part of it; zero is leave it alone — never aimed at, and a ship with nothing else left stops being a target — and below zero adds care at the trigger, holding fire until the part it aims at is under the muzzle rather than firing at anything on the hull', step: 10 },
];

const APPROACH_ROWS: readonly DoctrineRow[] = [
  { field: 'standoffRadii', label: 'standoff', hint: "How close to get, in multiples of the target's own radius", step: 5 },
  { field: 'standoff', label: 'range cap', hint: 'The furthest it will hold, as a fraction of its own reach', step: 0.05 },
  { field: 'escortRadii', label: 'escort range', hint: 'How close to sit to what it is covering, in multiples of that ship’s radius', step: 1 },
  { field: 'escortMinRadii', label: 'smallest covered', hint: 'The smallest friend it will cover, in multiples of its own radius: 1 only what is at least its own size, 0 anything. A neutral objective is gone to whatever its size', step: 0.1 },
  { field: 'escort', label: 'escort cap', hint: 'The furthest it will stray from what it is covering, as a fraction of its own reach', step: 0.05 },
  { field: 'separation', label: 'keeps clear', hint: 'How much it wants to stay out of everybody’s way', step: 25 },
  { field: 'separationRadii', label: 'clearance', hint: 'How close is too close, in multiples of the gap between two hulls’ skins', step: 0.5 },
  { field: 'tolerance', label: 'slack', hint: 'How much closer or further than that is close enough, as a fraction', step: 0.05 },
  { field: 'approachSpeed', label: 'closing speed', hint: 'The fastest it will close the difference, metres per second', step: 10 },
  { field: 'accelerate', label: 'speeds up on', hint: 'How much of its thrust towards the band to speed up with: 1 is all of it', step: 0.05 },
  { field: 'brake', label: 'brakes on', hint: 'How much of its thrust the other way to plan on stopping with: under 1 keeps a margin', step: 0.05 },
  { field: 'ramRadii', label: 'rams within', hint: "How close its target's edge has to be before it will ram, in the target's radii. 0 never rams. A fighter that rams drops into the hull layer too", step: 0.5 },
  { field: 'turnBias', label: 'turn cost', hint: 'What a half turn costs in choosing which way round to fight, as a share of its main guns: at 0.5 a half turn has to bring half its main guns more to bear', step: 0.1 },
  { field: 'burnWeight', label: 'turns to burn', hint: 'How much it would rather turn its main engines along the way it wants to go than keep its guns on target, for each share of their thrust the turn would add: the harder it wants to accelerate, the more it turns. 0 never turns from its guns', step: 0.5 },
  { field: 'rangeHold', label: 'holds guns on', hint: 'How much it would rather keep its guns on target: all of it inside the band it holds, falling away the further out it is', step: 0.5 },
  { field: 'ramArmed', label: 'rams armed', hint: 'The share of its own main guns still working at or below which it will ram: 0 only once it cannot shoot, 1 whenever it is close enough', step: 0.1 },
];

const ROW_OF = new Map<string, DoctrineRow>(
  [...TARGETING_ROWS, ...APPROACH_ROWS].map((row) => [row.field, row]),
);

/**
 * The doctrine a panel is showing, with every field resolved: what is stated,
 * or what happens anyway. A mount's `approach` is its ship's, and unread.
 */
export interface DoctrineValues {
  readonly targeting: Targeting;
  readonly approach: Approach;
}

/** What the panel knows about the ship, so a relative number can be said in metres. */
export interface DoctrineContext {
  /** Kilograms. */
  readonly mass: number;
  /** Bounding radius, metres. */
  readonly radius: number;
  /** How far its guns reach against its own size of enemy, metres; 0 unarmed. */
  readonly reach: number;
  /** Acceleration holding a heading, ahead and astern, m/s². */
  readonly accelFore: number;
  readonly accelAft: number;
  /** Braking holding its guns on, and turned onto its mains, m/s² (`DesignStats`). */
  readonly brakeHolding: number;
  readonly brakeTurned: number;
  /** How many main weapon mounts it has. */
  readonly guns: number;
  /** A mount's: how far it fires at the enemy it wants, metres. */
  readonly fireRange?: number | null;
}

/**
 * One box as the panel lays it out: whose field it is, whether a setting above
 * it has made it mean nothing, and what it comes to in metres or tonnes.
 */
export interface DoctrineEntry extends DoctrineRow {
  readonly half: 'targeting' | 'approach' | 'mount';
  /** Whether it means anything, given the rest; shown always when absent. */
  readonly shown?: (values: DoctrineValues) => boolean;
  /** What it comes to for this ship, or null where there is nothing to say. */
  readonly absolute?: (values: DoctrineValues, ship: DoctrineContext) => string | null;
}

/** Boxes that go together, under a heading of their own. */
export interface DoctrineGroup {
  readonly title: string;
  readonly entries: readonly DoctrineEntry[];
}

/** One thing a ship or a gun decides, and the boxes that decide it. */
export interface DoctrineSection {
  readonly title: string;
  readonly groups: readonly DoctrineGroup[];
}

const metres = (value: number): string => `${Math.round(value).toLocaleString('en-GB')} m`;

/** The radius of the enemy a doctrine prefers, sized as its own hull scaled by mass. */
function enemyRadius(values: DoctrineValues, ship: DoctrineContext): number {
  const preferred = values.targeting.preferredMass;
  return ship.radius * Math.sqrt(preferred > 0 ? preferred : 1);
}

function entry(
  half: DoctrineEntry['half'],
  field: string,
  extra: Pick<DoctrineEntry, 'shown' | 'absolute'> = {},
): DoctrineEntry {
  const row = ROW_OF.get(field);
  if (row === undefined) throw new Error(`no editor row for doctrine field ${field}`);
  return { ...row, half, ...extra };
}

const sizeWanted = (half: DoctrineEntry['half']): DoctrineEntry =>
  entry(half, 'preferredMass', {
    // How much size is worth comes first: at zero, which size is moot.
    shown: (v) => v.targeting.massWeight !== 0,
    absolute: (v, ship) =>
      `≈ ${(ship.mass * v.targeting.preferredMass / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} t`,
  });

const preferences = (half: DoctrineEntry['half'], fields: readonly string[]): DoctrineEntry[] =>
  fields.map((field) => entry(half, field));

/**
 * A ship's doctrine as the panel lays it out: by what each decision is about,
 * rather than by which half of the file it is written in.
 */
export const SHIP_SECTIONS: readonly DoctrineSection[] = [
  {
    title: 'Picking a fight and closing on it',
    groups: [
      {
        title: 'What it goes after',
        entries: preferences('targeting', [
          'proximityWeight',
          'closingWeight',
          'loyaltyWeight',
          'armedWeight',
          'mobileWeight',
          'facingWeight',
          'sightWeight',
        ]),
      },
      { title: 'What size', entries: [entry('targeting', 'massWeight'), sizeWanted('targeting')] },
      {
        title: 'How close it holds',
        entries: [
          entry('approach', 'standoffRadii', {
            absolute: (v, ship) =>
              `${metres(v.approach.standoffRadii * enemyRadius(v, ship))} off the skin of the size it wants`,
          }),
          entry('approach', 'standoff', {
            absolute: (v, ship) => (ship.reach > 0 ? `no further than ${metres(v.approach.standoff * ship.reach)}` : null),
          }),
          entry('approach', 'tolerance', {
            absolute: (v, ship) => {
              const band = holdBand(v.approach, ship.reach, enemyRadius(v, ship));
              return `holds ${metres(band.min)}–${metres(band.max)}, centre to centre`;
            },
          }),
        ],
      },
      {
        title: 'Which way round',
        entries: [
          entry('approach', 'turnBias'),
          entry('approach', 'burnWeight'),
          entry('approach', 'rangeHold', { shown: (v) => v.approach.burnWeight > 0 }),
        ],
      },
      {
        title: 'How it gets there',
        entries: [
          entry('approach', 'approachSpeed'),
          entry('approach', 'accelerate', {
            absolute: (v, ship) => `≈ ${(v.approach.accelerate * ship.accelFore).toFixed(2)} m/s² ahead`,
          }),
          entry('approach', 'brake', {
            absolute: (v, ship) => {
              const holding = `≈ ${(v.approach.brake * ship.brakeHolding).toFixed(2)} m/s² with its guns on`;
              // A ship that turns to burn brakes on its mains too.
              return v.approach.burnWeight > 0
                ? `${holding}, ≈ ${(v.approach.brake * ship.brakeTurned).toFixed(2)} turned onto its mains`
                : holding;
            },
          }),
        ],
      },
    ],
  },
  {
    title: 'Escorting',
    groups: [
      {
        title: 'Escorting',
        entries: [
          entry('targeting', 'escortWeight'),
          ...(['escortMinRadii', 'escortRadii', 'escort'] as const).map((field) =>
            entry('approach', field, {
              // Nothing about escorting matters to a ship that never escorts.
              shown: (v) => v.targeting.escortWeight > 0,
              absolute: (v, ship) =>
                field === 'escortMinRadii'
                  ? v.approach.escortMinRadii > 0
                    ? `covers friends of ${metres(v.approach.escortMinRadii * ship.radius)} radius or more`
                    : 'covers friends of any size'
                  : field === 'escortRadii'
                    ? `${metres(v.approach.escortRadii * ship.radius)} off the skin of a consort its own size`
                    : ship.reach > 0
                      ? `no further than ${metres(v.approach.escort * ship.reach)}`
                      : 'no cap: it has no guns',
            }),
          ),
        ],
      },
    ],
  },
  {
    title: 'Ramming',
    groups: [
      {
        title: 'Ramming',
        entries: [
          entry('approach', 'ramRadii', {
            absolute: (v, ship) =>
              v.approach.ramRadii > 0
                ? `within ${metres(v.approach.ramRadii * enemyRadius(v, ship))} of the skin of the size it wants`
                : 'never rams',
          }),
          entry('approach', 'ramArmed', {
            shown: (v) => v.approach.ramRadii > 0,
            absolute: (v, ship) =>
{
              if (ship.guns === 0) return 'it has no guns';
              const working = Math.floor(v.approach.ramArmed * ship.guns + 1e-9);
              const guns = ship.guns === 1 ? '1 gun' : `${ship.guns} guns`;
              return working === 0
                ? `only once none of its ${guns} works`
                : `with ${working} of ${guns} working, or fewer`;
            },
          }),
        ],
      },
    ],
  },
  {
    title: 'Keeping clear',
    groups: [
      {
        title: 'Keeping clear',
        entries: [
          entry('approach', 'separation'),
          entry('approach', 'separationRadii', {
            shown: (v) => v.approach.separation > 0,
            absolute: (v, ship) =>
              `${metres(2 * ship.radius * v.approach.separationRadii)} between centres, beside its own size`,
          }),
        ],
      },
    ],
  },
];

/** A gun's doctrine as the panel lays it out. */
export const MOUNT_SECTIONS: readonly DoctrineSection[] = [
  {
    title: 'What it shoots at',
    groups: [
      {
        title: 'What it goes after',
        entries: preferences('mount', [
          'proximityWeight',
          'closingWeight',
          'loyaltyWeight',
          'armedWeight',
          'mobileWeight',
          'focusWeight',
          'facingWeight',
          'sightWeight',
        ]),
      },
      { title: 'What size', entries: [entry('mount', 'massWeight'), sizeWanted('mount')] },
    ],
  },
  {
    title: 'Where it aims',
    groups: [
      {
        title: 'Where it aims',
        entries: preferences('mount', ['coreWeight', 'engineWeight', 'gunWeight', 'structureWeight']),
      },
    ],
  },
  {
    title: 'How far out it fires',
    groups: [
      {
        title: 'How far out it fires',
        entries: [
          entry('mount', 'fireRange', {
            absolute: (_v, ship) =>
              ship.fireRange == null ? null : `fires within ${metres(ship.fireRange)} of the size it wants`,
          }),
        ],
      },
    ],
  },
];

/** Every box a set of sections lays out, in order. */
export function sectionEntries(sections: readonly DoctrineSection[]): DoctrineEntry[] {
  return sections.flatMap((section) => section.groups.flatMap((group) => group.entries));
}

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
