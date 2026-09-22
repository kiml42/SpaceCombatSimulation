/**
 * What a craft does when nobody is telling it anything.
 *
 * A ship works through the orders it has been given; doctrine is what it
 * falls back on when that queue is empty — which is most of the time, for
 * most of a fleet. It is the configuration §2 means when it says depth lives
 * in ship design, target prioritisation and manoeuvre doctrine.
 *
 * **Two halves, and they are different problems.** Choosing what to fight is
 * a comparison between candidates; deciding how to fight it is a question
 * about one target and this ship's own guns. Keeping them apart is not
 * tidiness — a turret picks its own target and manoeuvres nowhere, so it
 * wants the first half and has no use at all for the second.
 *
 * **Every value is a named number.** Named, because a doctrine is authored in
 * a blueprint file by a person who has to be able to read it back. Numbers,
 * because §7's evolution has to mutate them, and a field that is a string or
 * a flag is a field evolution cannot reach — so a preference that wants to be
 * "ignore hulks" is written as a weight of zero rather than as `false`.
 *
 * **Everything is a ratio to the ship holding it**, never a distance or a
 * mass. That is what makes a doctrine portable: "hold at two thirds of my
 * reach" and "go for something my own size" mean the right thing on a fighter
 * and on a capital, and a doctrine written in metres and tonnes would have to
 * be rewritten for every hull it was put on.
 */

/** What to go after: a set of preferences that argue with each other. */
export interface Targeting {
  /** Prefer what is close: score for a target at no range at all. */
  readonly proximityWeight: number;
  /**
   * What size of target to go after, as a multiple of the chooser's own mass.
   *
   * One is "something my own size", which needs no knowledge of what else is
   * in the battle and comes out right on every hull it is put on. It rests on
   * guns being scaled to the hull that carries them, so a ship's own mass is
   * a fair guess at what it can actually hurt. Other numbers say other things
   * without needing another mechanism: fifty is a torpedo boat that only
   * wants capitals, a twentieth is a mount that exists to swat fighters.
   */
  readonly preferredMass: number;
  /** How much going after the right size of thing is worth. */
  readonly massWeight: number;
  /** Prefer what is coming at you, per hundred metres per second of closing. */
  readonly closingWeight: number;
  /**
   * Prefer what you are already fighting.
   *
   * Not flavour: without it two equally good targets swap places every time
   * the numbers wobble, and a ship spends the battle turning round rather
   * than shooting. It is the cheapest fix for the most visible failure a
   * target picker has.
   */
  readonly loyaltyWeight: number;
  /**
   * Prefer what can still shoot back — the first thing worth knowing about a
   * target, since a ship that has lost every gun has stopped being a threat
   * whatever else is left of it.
   */
  readonly armedWeight: number;
  /**
   * Prefer what can still get away, which is what stops a fleet finishing a
   * drifting wreck while a crippled ship limps out of the battle.
   */
  readonly mobileWeight: number;
  /**
   * Prefer what the ship as a whole is fighting.
   *
   * A mount picks its own target, which is what lets a broadside engage on
   * both sides at once; this is what stops that from becoming every gun
   * shooting at something different. Large, and a fleet concentrates; zero,
   * and every mount fights its own battle.
   */
  readonly focusWeight: number;
  /**
   * Where on a target to aim, by what the module is for: the core it is flown
   * from, its engines, its guns, or the structure between them.
   *
   * **A core and a gun are worth the same, then engines, then structure a
   * long way behind all three.** A ship whose core is out stops fighting
   * altogether and one that cannot shoot has stopped being a threat; a ship
   * that cannot move has merely stopped being a problem, and structure is
   * what is left when there is nothing better to hit.
   *
   * The core is not rated above the gun, though it ends a fight outright,
   * because a weight is not the whole story: a core is small and usually
   * amidships with the ship in the way, so rating it higher has a gunner
   * boring the length of a hull to reach one while a turret sits on the skin
   * in front of it. Tied, the tie-break decides — whatever is nearest the gun
   * — and what is nearest is what can actually be hit. Measured in `duel`:
   * rated above, a fifth of all hits land on a core and sixteen pieces come
   * off; tied, a twentieth do and one does, and the ships spend the fight
   * stripping each other's mounts and engines instead.
   *
   * **All four zero means no opinion**, and a gun with no opinion shoots at
   * the ship as a whole rather than at a part of it. That is the way out for
   * a doctrine that would rather not pick a smaller thing to miss.
   */
  readonly coreWeight: number;
  readonly engineWeight: number;
  readonly gunWeight: number;
  readonly structureWeight: number;
  /**
   * How much a ship would rather be with something it will never shoot at
   * than at the best fight it can find.
   *
   * What a craft escorts is anything not hostile to it — one of its own, or
   * a neutral — and escorting means station-keeping and nothing else: the
   * guns go on fighting whatever they can reach, since a consort does not
   * need covering by a mount that is pointing the wrong way.
   *
   * **It is weighed against holding station, not against a target's score.**
   * A hundred is worth exactly as much as the order a craft is flying, so a
   * craft with that much splits the difference between closing on its enemy
   * and staying with its charge, and one with four hundred stays with its
   * charge and fights from there. It fades to nothing as the gap closes, so a
   * craft that has caught up is pulled by the fight alone until the fight has
   * drawn it off again.
   *
   * **Zero means escort nobody, and is the default.** A friendly is not
   * offered to the stack at all below it, which is deliberate rather than
   * tidy: every preference here can be negative, so a friendly scored by the
   * ordinary weights would beat a distant enemy on proximity alone and every
   * fleet in the game would huddle.
   */
  readonly escortWeight: number;
}

/** How to fight it, once it has been chosen. */
export interface Approach {
  /**
   * How close to get, in multiples of the target's own radius.
   *
   * **The range that matters is the one the target looks big from.** A gun
   * misses because its firing solution guessed wrong about where the target
   * would be, and how much of a guess it can afford depends on how much of
   * the sky the target fills — so closing on a fighter and closing on a
   * capital are different distances for the same reason, and a doctrine that
   * named one distance would be wrong about the other.
   */
  readonly standoffRadii: number;
  /**
   * The furthest it will hold, as a fraction of its own reach.
   *
   * A cap on the above, and the thing that keeps a ship inside the range its
   * guns are good for however small the target is.
   */
  readonly standoff: number;
  /**
   * How close to sit to what it is covering, in multiples of *its* radius.
   *
   * The escort's own version of `standoffRadii`, and a separate number
   * because it is answering a different question. A standoff is a gunnery
   * distance — how much of a guess a firing solution can afford — and an
   * escort distance is not about shooting at the thing at all. Made to do
   * both jobs, one number puts a corvette four hundred metres off the consort
   * it is meant to be covering, because that is where it would sit to shoot
   * at it.
   */
  readonly escortRadii: number;
  /**
   * The furthest it will stray from what it is covering, as a fraction of its
   * own reach.
   *
   * A cap on the above, the same way `standoff` caps `standoffRadii` — and
   * the reason it is measured in the escort's own gun range is that this is
   * what covering something *means*: a consort inside that fraction of your
   * reach is a consort your guns can do something about.
   */
  readonly escort: number;
  /**
   * How much a craft wants to keep out of everybody's way.
   *
   * Weighed against holding its station like every other urge, and against
   * nothing else: what is too close is too close whoever it is, since a
   * collision hurts both hulls whichever side they are on.
   */
  readonly separation: number;
  /**
   * How close is too close, in multiples of the gap between two hulls' skins.
   *
   * Measured from touching rather than from either centre, so one number
   * serves a fighter beside a fighter and a capital beside a capital.
   */
  readonly separationRadii: number;
  /** How much closer or further than that is close enough, as a fraction. */
  readonly tolerance: number;
  /** How briskly to close the difference, metres per second. */
  readonly approachSpeed: number;
}

export interface Doctrine {
  readonly targeting: Targeting;
  readonly approach: Approach;
}

/**
 * What a craft does with no doctrine of its own.
 *
 * Deliberately a fighting doctrine rather than a passive one: a ship with no
 * doctrine block in its file still goes and has the battle, because a fleet
 * that does nothing is a worse default than a fleet that does something
 * simple. It prefers what is near, then what can still shoot back, then what
 * is its own size, then what can still get away — and sticks with what it
 * chose. A hulk earns neither of the two "can still" bonuses, which is what
 * puts a mission kill behind every live ship on the list without a rule that
 * says so. Where it shoots follows the same reasoning at the other scale: the
 * core first, then guns, then engines, then whatever structure is left.
 */
export const DEFAULT_DOCTRINE: Doctrine = {
  targeting: {
    proximityWeight: 100,
    preferredMass: 1,
    massWeight: 40,
    closingWeight: 10,
    loyaltyWeight: 20,
    armedWeight: 80,
    mobileWeight: 10,
    focusWeight: 60,
    coreWeight: 100,
    engineWeight: 80,
    gunWeight: 100,
    structureWeight: 20,
    escortWeight: 0,
  },
  approach: {
    standoffRadii: 50,
    standoff: 0.65,
    escortRadii: 8,
    escort: 0.15,
    separation: 300,
    separationRadii: 3,
    tolerance: 0.2,
    approachSpeed: 60,
  },
};

/**
 * The fields of each half, in the order evolution walks them.
 *
 * Fixed and explicit rather than derived from the object, because the order a
 * runtime hands back its keys is not a thing to hang reproducibility on. A
 * field added here is a field evolution can reach; one left out is one it
 * cannot.
 */
export const TARGETING_FIELDS: readonly (keyof Targeting)[] = [
  'proximityWeight',
  'preferredMass',
  'massWeight',
  'closingWeight',
  'loyaltyWeight',
  'armedWeight',
  'mobileWeight',
  'focusWeight',
  'coreWeight',
  'engineWeight',
  'gunWeight',
  'structureWeight',
  'escortWeight',
];

export const APPROACH_FIELDS: readonly (keyof Approach)[] = [
  'standoffRadii',
  'standoff',
  'escortRadii',
  'escort',
  'separation',
  'separationRadii',
  'tolerance',
  'approachSpeed',
];

/**
 * The fields that mean nothing at or below zero: a size, and two distances.
 *
 * Stated once and read by everything that writes a doctrine rather than being
 * repeated wherever one is made up — the parser that refuses a bad file and
 * the mutation that must not write one are the same rule seen twice, and two
 * copies of it would disagree the first time a field was added.
 */
export const POSITIVE_FIELDS: readonly string[] = [
  'preferredMass',
  'standoffRadii',
  'escortRadii',
  'separationRadii',
];

/** Every number in a doctrine, named by its path, in a fixed order. */
export const DOCTRINE_FIELDS: readonly string[] = [
  ...TARGETING_FIELDS.map((field) => `targeting.${field}`),
  ...APPROACH_FIELDS.map((field) => `approach.${field}`),
];

/** Whatever is wrong with one half of a doctrine block, or null. */
function halfProblem(
  value: unknown,
  where: string,
  fields: readonly string[],
  positive: readonly string[],
): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `${where} must be an object, got ${JSON.stringify(value)}`;
  }
  const raw = value as Record<string, unknown>;
  const known = new Set<string>(fields);
  const extra = Object.keys(raw).filter((key) => !known.has(key));
  if (extra.length > 0) {
    return `${where} has unknown ${extra.length > 1 ? 'keys' : 'key'} ${extra.join(', ')}`;
  }
  for (const field of fields) {
    const held = raw[field];
    if (held === undefined) continue;
    if (typeof held !== 'number' || !Number.isFinite(held)) {
      return `${where}.${field} must be a number, got ${JSON.stringify(held)}`;
    }
    if (positive.includes(field) && !(held > 0)) {
      return `${where}.${field} must be greater than zero, got ${held}`;
    }
  }
  return null;
}

/**
 * Whatever is wrong with a mount's own targeting block, or null.
 *
 * A partial: a mount says only what it wants differently from the ship it is
 * bolted to, so a hull's doctrine goes on covering everything its guns have
 * no opinion about.
 */
export function targetingProblem(value: unknown, where: string): string | null {
  return halfProblem(value, where, TARGETING_FIELDS, POSITIVE_FIELDS);
}

/** A mount's targeting, with whatever it leaves out taken from its ship. */
export function resolveTargeting(value: unknown, ship: Targeting): Targeting {
  return toHalf(value, TARGETING_FIELDS, ship);
}

/** Only what a mount says differently from its ship's doctrine, for saving. */
export function serialiseTargeting(
  held: Targeting,
  ship: Targeting,
): Record<string, number> | undefined {
  return serialiseHalf(
    held as unknown as Record<string, number>,
    ship as unknown as Record<string, number>,
    TARGETING_FIELDS,
  );
}

/** Whatever is wrong with a doctrine block, or null. */
export function doctrineProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `doctrine must be an object, got ${JSON.stringify(value)}`;
  }
  const raw = value as Record<string, unknown>;
  const extra = Object.keys(raw).filter((key) => key !== 'targeting' && key !== 'approach');
  if (extra.length > 0) {
    return `doctrine has unknown ${extra.length > 1 ? 'keys' : 'key'} ${extra.join(', ')}`;
  }
  return (
    halfProblem(raw['targeting'], 'doctrine.targeting', TARGETING_FIELDS, POSITIVE_FIELDS) ??
    halfProblem(raw['approach'], 'doctrine.approach', APPROACH_FIELDS, POSITIVE_FIELDS)
  );
}

function toHalf<T>(value: unknown, fields: readonly string[], fallback: T): T {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const held = fallback as unknown as Record<string, number>;
  const built: Record<string, number> = {};
  for (const field of fields) {
    const given = raw[field];
    built[field] = typeof given === 'number' ? given : held[field]!;
  }
  return built as unknown as T;
}

/** A doctrine from a file's block, with anything it leaves out defaulted. */
export function toDoctrine(value: unknown): Doctrine {
  if (typeof value !== 'object' || value === null) return DEFAULT_DOCTRINE;
  const raw = value as Record<string, unknown>;
  return {
    targeting: toHalf(raw['targeting'], TARGETING_FIELDS, DEFAULT_DOCTRINE.targeting),
    approach: toHalf(raw['approach'], APPROACH_FIELDS, DEFAULT_DOCTRINE.approach),
  };
}

function serialiseHalf(
  held: Record<string, number>,
  fallback: Record<string, number>,
  fields: readonly string[],
): Record<string, number> | undefined {
  const raw: Record<string, number> = {};
  let any = false;
  for (const field of fields) {
    if (held[field] === fallback[field]) continue;
    raw[field] = held[field]!;
    any = true;
  }
  return any ? raw : undefined;
}

/** Only what a doctrine says differently from the default, for saving. */
export function serialiseDoctrine(doctrine: Doctrine): Record<string, unknown> | undefined {
  const targeting = serialiseHalf(
    doctrine.targeting as unknown as Record<string, number>,
    DEFAULT_DOCTRINE.targeting as unknown as Record<string, number>,
    TARGETING_FIELDS,
  );
  const approach = serialiseHalf(
    doctrine.approach as unknown as Record<string, number>,
    DEFAULT_DOCTRINE.approach as unknown as Record<string, number>,
    APPROACH_FIELDS,
  );
  if (targeting === undefined && approach === undefined) return undefined;
  const raw: Record<string, unknown> = {};
  if (targeting !== undefined) raw['targeting'] = targeting;
  if (approach !== undefined) raw['approach'] = approach;
  return raw;
}
