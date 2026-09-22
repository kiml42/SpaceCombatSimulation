import {
  compileBlueprint,
  type Ships,
  DAMAGE_ENERGY_PER_KG,
  math,
  NEUTRAL_TEAM,
  type Blueprint,
  type ShipDesign,
  type WellSpec,
} from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';

/**
 * One match: a handful of designs put in an arena together, and what each of
 * them is worth when it is over.
 *
 * **One match scores all three things.** Surviving, doing damage, and holding
 * a point on the field are accrued in the same battle rather than in separate
 * kinds of match, because the trade between them is the interesting part — a
 * ship that breaks off to hold the middle is not shooting while it does, and
 * one that stands off to shoot is not holding anything. Scoring them in
 * separate matches would measure all three and never the choice.
 *
 * **Every entrant is its own side.** A match is a free-for-all, so what a
 * design is being scored against is the rest of its generation rather than a
 * fixed opponent, and no entrant has a friend to hide behind.
 */

/**
 * The thing worth being near, and how far away stops being worth anything.
 *
 * **It is an object, not a coordinate.** A marker hull on `NEUTRAL_TEAM` that
 * nothing can hurt and nothing will shoot at, spawned where the goal is and
 * scored against wherever it has got to since. Three things follow from that
 * which a coordinate could not give: a ship can be *told* to go to it, since
 * every order in this game is relative to an object (DESIGN.md §2); it is
 * solid, so it can be hidden behind and run into; and it has mass, so shoving
 * it away from an opponent is a thing a ship can decide to do.
 *
 * Nothing can hurt it because an objective that can be destroyed stops being
 * an objective, and a doctrine that has learnt to ignore a wreck would learn
 * to ignore this too.
 */
export interface GoalSpec {
  readonly x: number;
  readonly y: number;
  /** Distance at which the goal is worth nothing. Closer scores proportionally. */
  readonly reach: number;
  /** How big the marker is, metres square. Its mass follows from its size. */
  readonly size: number;
}

/**
 * What each part of a score is worth, once each is expressed as a fraction of
 * the most that part could be.
 *
 * Every component is scaled to run from nothing to one before it is weighted —
 * a whole match survived, a match spent sitting on the goal, the whole of the
 * opposition destroyed — so a weight says what that outcome is worth against
 * the others rather than what a joule is worth, and the same weights mean the
 * same thing whatever size of ship is fighting or how long the match runs.
 */
export interface ScoreWeights {
  readonly survival: number;
  readonly damage: number;
  readonly race: number;
}

export interface MatchConfig {
  readonly seed: number;
  readonly dt: number;
  /** How long a match may last before it is called a draw, seconds. */
  readonly duration: number;
  /**
   * How far from the middle the entrants start, metres.
   *
   * Small enough that a match is a fight. Four of the shipped corvettes put a
   * kilometre apart never finish each other off however long they are given —
   * they settle at the standoff their doctrine asks for and plink — so the
   * arena decides whether a match discriminates at all, and one that always
   * ends in four survivors has measured nothing. At five hundred metres the
   * same four are decided every time, with survival running the whole way
   * from a sixth of the match to all of it.
   *
   * It is a distance rather than a multiple of what the entrants can shoot,
   * which is the wrong shape and is deliberately not fixed yet — see
   * ROADMAP.md §12.
   */
  readonly radius: number;
  /**
   * The point worth holding, or null for a match that is only a fight.
   *
   * At the middle of the ring by default, which is the one position every
   * entrant starts the same distance from — an objective off to one side
   * would hand the match to whoever drew the nearest slot. Its reach is twice
   * the ring, so that a craft out at the edge still has something to gain by
   * turning inwards: a goal worth nothing from where the fighting happens is
   * a goal nothing will be selected for going to.
   */
  readonly goal: GoalSpec | null;
  readonly weights: ScoreWeights;
  readonly wells: readonly WellSpec[];
}

export const DEFAULT_MATCH: MatchConfig = {
  seed: 1,
  dt: 1 / 60,
  duration: 120,
  radius: 500,
  goal: { x: 0, y: 0, reach: 1000, size: 12 },
  weights: { survival: 1, damage: 1, race: 1 },
  wells: [],
};

/** What one entrant did, each part scaled so that one is as good as it gets. */
export interface Score {
  /**
   * Time spent still flying, weighted by how much of what flies it is left.
   *
   * **What keeps a ship in the match is a working core, and nothing else.**
   * Not whether it still has a gun or an engine: those are meant to pay for
   * themselves by doing something, and a score that pays for merely carrying
   * them makes the cheapest possible improvement to any design a weapon it
   * never fires. Weighted by what is left of the core rather than counted
   * while it holds out, so a hull that is being shot to pieces scores less
   * every step it takes it — which is what makes armour and layout worth
   * something before the moment they save a ship outright.
   */
  readonly survival: number;
  /** Fraction of the opposition destroyed, by what its hulls could absorb. */
  readonly damage: number;
  /** Fraction of the match spent on the goal, by how near it got. */
  readonly race: number;
  /** The three, weighted and added. */
  readonly total: number;
  /** Seconds it lasted, for reading a result rather than for scoring one. */
  readonly lifetime: number;
  /** What it took, as a fraction of what its own hull could absorb. */
  readonly taken: number;
}

/** Why a match stopped. */
export type Ending = 'decided' | 'annihilated' | 'timeout';

export interface MatchResult {
  readonly seed: number;
  /** Seconds simulated. */
  readonly elapsed: number;
  readonly steps: number;
  readonly ending: Ending;
  /** One per entrant, in the order they were given. */
  readonly scores: readonly Score[];
}

/**
 * What a hull can absorb before every module on it is spent, joules.
 *
 * Damage is scored as a fraction of this rather than in joules, so that
 * wrecking a fighter and scratching a capital are not the same number, and so
 * that a weight means something a person can reason about.
 */
export function hullCapacity(design: ShipDesign): number {
  let total = 0;
  for (const module of design.modules) total += module.stats.hitPoints * DAMAGE_ENERGY_PER_KG;
  return total;
}

/**
 * How much of what flies a ship is still there, from nothing to one.
 *
 * Weighted by what each core can absorb, so losing one of two cores costs
 * what that core was worth rather than half by definition — and a ship built
 * around one big core and a small spare is not the same ship as one built
 * around two of a size.
 */
function coreHealth(ships: Ships, design: ShipDesign, body: number): number {
  let held = 0;
  let total = 0;
  for (const core of design.cores) {
    const capacity = design.modules[core]!.stats.hitPoints;
    total += capacity;
    held += capacity * ships.damage.integrity(body, core);
  }
  return total > 0 ? held / total : 0;
}

/**
 * The marker hull: one core module and nothing else.
 *
 * A core because a ship is what can be flown, stationed on and shot at, and
 * the core is the one module that makes a hull any of those — a marker built
 * from structure alone would be wreckage the moment it was looked at, and
 * doctrine is right to ignore wreckage.
 */
function markerHull(size: number): Blueprint {
  return {
    name: 'Goal',
    modules: [{ kind: 'core', x: 0, y: 0, length: size, width: size }],
  };
}

/**
 * Fight one match and score it.
 *
 * Deterministic in the config's seed and the blueprints: the same call gives
 * the same result, which is what makes a match replayable from a run's record
 * rather than needing one recorded frame by frame.
 */
export function runMatch(entrants: readonly Blueprint[], config?: Partial<MatchConfig>): MatchResult {
  const settings: MatchConfig = { ...DEFAULT_MATCH, ...config };
  const designs = entrants.map((blueprint) => compileBlueprint(blueprint));
  const capacities = designs.map(hullCapacity);
  const count = entrants.length;

  const battle = makeBattle(
    {
      seed: settings.seed,
      dt: settings.dt,
      wells: settings.wells,
      projectiles: 1024,
      beams: 256,
    },
    (ships, world) => {
      const slots: number[] = [];
      const goal = settings.goal;
      const marker =
        goal === null
          ? -1
          : ships.spawn(world, {
              design: compileBlueprint(markerHull(goal.size)),
              x: goal.x,
              y: goal.y,
              team: NEUTRAL_TEAM,
              invulnerable: true,
            });
      for (let i = 0; i < count; i++) {
        // Evenly round a ring, each facing the middle. Every entrant is the
        // same distance from every other and from the goal, so a slot is
        // worth what any other slot is worth.
        const bearing = (math.TAU * i) / count;
        slots.push(
          ships.spawn(world, {
            design: designs[i]!,
            x: math.cos(bearing) * settings.radius,
            y: math.sin(bearing) * settings.radius,
            angle: bearing + math.PI,
            team: i,
          }),
        );
      }
      return { slots, marker };
    },
  );

  const { ships, world } = battle;
  const slots = battle.slots;
  const marker = battle.marker;

  // Counted in steps rather than accrued in seconds: a sum of `dt` over two
  // minutes at sixty hertz comes to a shade over the duration it is divided
  // by, and a survival score of 1.0000000000000073 makes a liar of every
  // sentence saying these run from nothing to one.
  const survival = new Float64Array(count);
  const race = new Float64Array(count);
  /** How near the goal each ship was when it was last looked at. */
  const nearness = new Float64Array(count);
  const lifetime = new Float64Array(count);
  const taken = new Float64Array(count);
  // What each entrant has put into each other entrant's hull, joules.
  const dealt: Float64Array[] = [];
  for (let i = 0; i < count; i++) dealt.push(new Float64Array(count));

  /** Which entrant a body belongs to, rebuilt each step. */
  const entrantOf = new Map<number, number>();

  const steps = math.round(settings.duration / settings.dt);
  let step = 0;
  let ending: Ending = 'timeout';

  for (; step < steps; step++) {
    battle.step();

    entrantOf.clear();
    let fighting = 0;
    for (let i = 0; i < count; i++) {
      const ship = slots[i]!;
      if (!ships.isAlive(ship)) continue;
      const body = world.bodies.indexOf(ships.body(ship));
      entrantOf.set(body, i);
      if (!ships.hasControl(ship)) continue;

      // Nobody is flying a hull whose cores have gone (DESIGN.md §4), and it
      // scores nothing more for being wreckage that has not been finished off.
      fighting++;
      survival[i]! += coreHealth(ships, designs[i]!, body);
      lifetime[i]! = step + 1;

      const goal = settings.goal;
      if (goal !== null && goal.reach > 0 && ships.isAlive(marker)) {
        const at = world.bodies.indexOf(ships.body(marker));
        const dx = world.bodies.x[body]! - world.bodies.x[at]!;
        const dy = world.bodies.y[body]! - world.bodies.y[at]!;
        nearness[i]! = math.max(0, (goal.reach - math.length(dx, dy)) / goal.reach);
        race[i]! += nearness[i]!;
      }
    }

    // Who hit whom, this step. A hit whose shooter or whose victim is not a
    // competitor — wreckage, or a piece that has come off something — is
    // nobody's credit: it is neither a ship damaged nor an entrant doing it.
    const credit = battle.credit;
    for (let h = 0; h < credit.count; h++) {
      const attacker = entrantOf.get(credit.attacker[h]!);
      const victim = entrantOf.get(credit.victim[h]!);
      if (attacker === undefined || victim === undefined || attacker === victim) continue;
      dealt[attacker]![victim]! += credit.energy[h]!;
    }

    if (count > 1 && fighting <= 1) {
      ending = fighting === 0 ? 'annihilated' : 'decided';
      step++;
      break;
    }
  }

  const elapsed = step * settings.dt;

  // What is left of the match, credited to whoever is still fighting at its
  // last state.
  //
  // Without this, winning outright is worth *less* than a stalemate: a ship
  // that kills everything in ten seconds of a two-minute match is credited
  // with ten seconds of survival, and one that spends two minutes failing to
  // land a shot is credited with all of it. The rest of a decided match is a
  // formality, so it is scored as though it had been played out and gone on
  // the way it was going.
  const left = steps - step;
  if (left > 0) {
    for (let i = 0; i < count; i++) {
      const ship = slots[i]!;
      if (!ships.isAlive(ship) || !ships.hasControl(ship)) continue;
      const body = world.bodies.indexOf(ships.body(ship));
      survival[i]! += coreHealth(ships, designs[i]!, body) * left;
      race[i]! += nearness[i]! * left;
    }
  }
  const scores: Score[] = [];
  for (let i = 0; i < count; i++) {
    let hurt = 0;
    for (let v = 0; v < count; v++) {
      if (v === i) continue;
      // Capped per victim: a ship can only be destroyed once, and without the
      // cap the best thing a gun could do is go on firing into a hull that has
      // already stopped — which is exactly the habit a fitness function must
      // not pay for.
      hurt += math.min(1, dealt[i]![v]! / capacities[v]!);
      taken[i]! += dealt[v]![i]!;
    }
    const opposition = math.max(1, count - 1);
    const parts = {
      survival: survival[i]! / steps,
      damage: hurt / opposition,
      race: math.min(1, race[i]! / steps),
    };
    scores.push({
      ...parts,
      total:
        parts.survival * settings.weights.survival +
        parts.damage * settings.weights.damage +
        parts.race * settings.weights.race,
      lifetime: lifetime[i]! * settings.dt,
      taken: math.min(1, taken[i]! / capacities[i]!),
    });
  }

  return { seed: settings.seed, elapsed, steps: step, ending, scores };
}
