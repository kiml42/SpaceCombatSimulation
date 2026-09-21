/**
 * What a craft does when nobody is telling it anything.
 *
 * A ship works through the orders it has been given; doctrine is what it
 * falls back on when that queue is empty — which is most of the time, for
 * most of a fleet. It decides what a craft picks a fight with and how it
 * wants to fight it, so it is the configuration §2 means when it says depth
 * lives in ship design, target prioritisation and manoeuvre doctrine.
 *
 * **Every value is a named number.** Named, because a doctrine is authored in
 * a blueprint file by a person who has to be able to read it back. Numbers,
 * because §7's evolution has to mutate them, and a field that is a string or
 * a flag is a field evolution cannot reach — so a preference that wants to be
 * "ignore hulks" is written as a weight of zero rather than as `false`.
 *
 * **Ranges are fractions of the ship's own reach**, not metres. The same
 * doctrine then means the same *thing* on a fighter and on a capital: hold at
 * seven tenths of what your guns are good for. A doctrine written in metres
 * would have to be rewritten for every hull it was put on.
 */
export interface Doctrine {
  /**
   * Where to hold, as a fraction of the ship's own reach. Below 1 is inside
   * its best range, above 1 is standing off further than it can shoot.
   */
  readonly standoff: number;
  /** How much closer or further than that is close enough, same units. */
  readonly tolerance: number;
  /** How briskly to close the difference, metres per second. */
  readonly approachSpeed: number;

  /** Prefer what is close: score for a target at no range at all. */
  readonly proximityWeight: number;
  /**
   * What size of target to go after, as a multiple of the chooser's own mass.
   *
   * One — the default — is "something my own size", which needs no knowledge
   * of what else is in the battle and comes out right on every hull it is put
   * on: a fighter goes after fighters, a capital goes after capitals. It
   * rests on guns being scaled to the hull that carries them, so a ship's own
   * mass is a fair guess at what it can actually hurt.
   *
   * Other numbers say other things without needing another mechanism: 50 is a
   * torpedo boat that only wants capitals, a twentieth is a mount that exists
   * to swat fighters.
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
   * Prefer what can still shoot back.
   *
   * The first thing worth knowing about a target: a gun that still works is
   * the reason to fight it at all, and a ship that has lost all of them has
   * stopped being a threat whatever else is left of it.
   */
  readonly armedWeight: number;
  /**
   * Prefer what can still get away.
   *
   * Between two disarmed ships, the one that can still make it home is the
   * one worth spending rounds on — and it is what stops a fleet finishing a
   * drifting wreck while a crippled ship limps out of the battle.
   */
  readonly mobileWeight: number;
}

/**
 * What a craft does with no doctrine of its own.
 *
 * Deliberately a fighting doctrine rather than a passive one: a ship with no
 * doctrine block in its file still goes and has the battle, because a fleet
 * that does nothing is a worse default than a fleet that does something
 * simple. Closing to two thirds of its reach, preferring what is near, then
 * what is big, then what is coming at it — and sticking with it once chosen.
 */
export const DEFAULT_DOCTRINE: Doctrine = {
  standoff: 0.65,
  tolerance: 0.15,
  approachSpeed: 60,
  proximityWeight: 100,
  preferredMass: 1,
  massWeight: 40,
  closingWeight: 10,
  loyaltyWeight: 20,
  armedWeight: 60,
  mobileWeight: 30,
};

/**
 * The fields, in the order evolution walks them.
 *
 * Fixed and explicit rather than derived from the object, because the order a
 * runtime hands back its keys is not a thing to hang reproducibility on. A
 * field added here is a field evolution can reach; a field left out is one it
 * cannot.
 */
export const DOCTRINE_FIELDS: readonly (keyof Doctrine)[] = [
  'standoff',
  'tolerance',
  'approachSpeed',
  'proximityWeight',
  'preferredMass',
  'massWeight',
  'closingWeight',
  'loyaltyWeight',
  'armedWeight',
  'mobileWeight',
];

/** Whatever is wrong with a doctrine block, or null. */
export function doctrineProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `doctrine must be an object, got ${JSON.stringify(value)}`;
  }
  const raw = value as Record<string, unknown>;
  const known = new Set<string>(DOCTRINE_FIELDS);
  const extra = Object.keys(raw).filter((key) => !known.has(key));
  if (extra.length > 0) {
    return `doctrine has unknown ${extra.length > 1 ? 'keys' : 'key'} ${extra.join(', ')}`;
  }
  for (const field of DOCTRINE_FIELDS) {
    const held = raw[field];
    if (held === undefined) continue;
    if (typeof held !== 'number' || !Number.isFinite(held)) {
      return `doctrine.${field} must be a number, got ${JSON.stringify(held)}`;
    }
  }
  if (typeof raw['tolerance'] === 'number' && raw['tolerance'] < 0) {
    return `doctrine.tolerance must not be negative, got ${raw['tolerance']}`;
  }
  if (typeof raw['preferredMass'] === 'number' && !(raw['preferredMass'] > 0)) {
    // A ratio of nothing is not a size of ship.
    return `doctrine.preferredMass must be greater than zero, got ${raw['preferredMass']}`;
  }
  return null;
}

/** A doctrine from a file's block, with anything it leaves out defaulted. */
export function toDoctrine(value: unknown): Doctrine {
  if (typeof value !== 'object' || value === null) return DEFAULT_DOCTRINE;
  const raw = value as Record<string, unknown>;
  const doctrine: Record<string, number> = {};
  for (const field of DOCTRINE_FIELDS) {
    const held = raw[field];
    doctrine[field] = typeof held === 'number' ? held : DEFAULT_DOCTRINE[field];
  }
  return doctrine as unknown as Doctrine;
}

/** Only what a doctrine says differently from the default, for saving. */
export function serialiseDoctrine(doctrine: Doctrine): Record<string, number> | undefined {
  const raw: Record<string, number> = {};
  let any = false;
  for (const field of DOCTRINE_FIELDS) {
    if (doctrine[field] === DEFAULT_DOCTRINE[field]) continue;
    raw[field] = doctrine[field];
    any = true;
  }
  return any ? raw : undefined;
}
