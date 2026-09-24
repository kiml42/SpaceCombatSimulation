import {
  compileBlueprint,
  Rng,
  type Ships,
  DAMAGE_ENERGY_PER_KG,
  math,
  NEUTRAL_TEAM,
  type Blueprint,
  type ShipDesign,
  type WellSpec,
} from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import type { Battle } from '../scenarios/types.js';

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
 *
 * **It can be a ghost instead** (`solid: false`): still there to be flown to
 * and scored against, but nothing collides with it, it shields nothing behind
 * it, and nothing moves it — so ships either side of it can still shoot at
 * each other across it.
 */
export interface GoalSpec {
  readonly x: number;
  readonly y: number;
  /**
   * The distance at which the goal is worth half of what it is worth at the
   * goal itself, metres. It is worth something at *every* distance.
   *
   * **There is no range beyond which the goal stops counting.** A ramp that
   * falls to nothing at some distance leaves everything past it flat, and a
   * flat region is a region selection cannot see across: a hull that has
   * evolved an engine too feeble to cross it scores exactly what a hull with
   * no engine at all scores, so the first step towards moving is worth
   * nothing and is never taken. Falling away for ever instead means any
   * closing at all is an improvement, however small, which is what lets a
   * half-metre thruster be an advantage rather than a rounding error.
   *
   * The price is a gentler slope near the goal than a ramp would give — half
   * the weight is spent on the first `scale` metres and the rest is spread
   * over the whole field — and that is the right way round for a search that
   * has to start from nothing.
   */
  readonly scale: number;
  /** How big the marker is, metres square. Its mass follows from its size. */
  readonly size: number;
  /** False for a marker nothing can meet or move. Solid when left out. */
  readonly solid?: boolean;
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
   * would hand the match to whoever drew the nearest slot. It is worth half
   * from the ring the entrants start on, so a craft that never moves scores
   * the same half as every other craft that never moves — what selection sees
   * is which of them closed, and by how much.
   */
  readonly goal: GoalSpec | null;
  readonly weights: ScoreWeights;
  readonly wells: readonly WellSpec[];
  /**
   * How far a craft's starting heading may be turned from facing the middle,
   * radians. Zero points every entrant inwards; `PI` is any heading at all.
   *
   * **A heading nobody chose is what asks a design to be able to turn.** Start
   * every craft already pointing where it wants to go and nothing is ever
   * asked of a hull but to go forwards: a design with no way to turn is never
   * found out, and one that can turn is never rewarded for it. Scattered, the
   * first thing every craft must do is come round — so the pilot asks for
   * torque, and a thruster that can supply some is worth firing where one
   * bolted to a hull that is already aimed would never be.
   *
   * Measured on three hundred generations bred from a bare core against the
   * goal and nothing else: pointed inwards, a population reaches 0.68 and
   * stops; scattered, it is slower to start and then passes it, reaching 0.85
   * and still climbing. What it breeds is different in kind, too. Pointed
   * inwards it accumulates guns it never fires, because nothing charges it for
   * the mass; scattered, every kilogram is one it has to swing round before it
   * can go anywhere, and what comes out is lean — three engines, three cores
   * and a little structure, against a nine-gun lump that scored worse.
   */
  readonly scatter: number;
}

export const DEFAULT_MATCH: MatchConfig = {
  seed: 1,
  dt: 1 / 60,
  duration: 120,
  radius: 500,
  goal: { x: 0, y: 0, scale: 500, size: 12 },
  weights: { survival: 1, damage: 1, race: 1 },
  wells: [],
  scatter: math.PI,
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
  /**
   * Ground gained on the goal over the match, as a share of what there was to
   * gain. Zero for a design that stayed where it was put, and negative for one
   * that ended further off than it started.
   */
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
 * A match in progress: the battle it is, and the tally being kept of it.
 *
 * **Built rather than run, so that the same match can be watched.** A headless
 * runner fights it flat out and reads the score; a viewer steps it a frame at a
 * time and draws it. Both drive this one object, so what is watched is the
 * match that was scored rather than a second one assembled to look like it —
 * which, everything here being decided by the seed, is the whole of what makes
 * a replay worth anything.
 */
export class Match {
  readonly battle: Battle & { slots: number[]; marker: number };
  private readonly settings: MatchConfig;
  private readonly designs: ShipDesign[];
  private readonly capacities: number[];
  private readonly count: number;
  private readonly survival: Float64Array;
  private readonly race: Float64Array;
  private readonly nearness: Float64Array;
  private readonly began: Float64Array;
  private readonly lifetime: Float64Array;
  private readonly dealt: Float64Array[];
  private readonly entrantOf = new Map<number, number>();
  private readonly total: number;
  private measured = false;
  private step = 0;
  private ending: Ending = 'timeout';

  constructor(entrants: readonly Blueprint[], config?: Partial<MatchConfig>) {
    const settings: MatchConfig = { ...DEFAULT_MATCH, ...config };
    this.settings = settings;
    this.designs = entrants.map((blueprint) => compileBlueprint(blueprint));
    this.capacities = this.designs.map(hullCapacity);
    const count = entrants.length;
    this.count = count;
    this.total = math.round(settings.duration / settings.dt);

    this.battle = makeBattle(
      {
        seed: settings.seed,
        dt: settings.dt,
        wells: settings.wells,
        projectiles: 1024,
        beams: 256,
      },
      (ships, world) => {
        // Its own generator rather than the world's, so that scattering the
        // headings does not shift every other draw a match makes and make two
        // runs incomparable for a reason that has nothing to do with the ships.
        //
        // **One draw for the whole match, not one each.** A heading nobody chose
        // is meant to ask every design the same question; drawn separately it
        // asks each of them a different one, and hands whoever drew the kindest
        // start a lead that has nothing to do with how it was built. The ring is
        // laid out so that every entrant is the same distance from every other
        // and from the goal — turning them all by one angle keeps that, and
        // turning them each by their own throws it away.
        const scatter = new Rng(settings.seed ^ 0x5CA77E4);
        const turned = scatter.nextRange(-settings.scatter, settings.scatter);
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
                ghost: goal.solid === false,
              });
        for (let i = 0; i < count; i++) {
          // Evenly round a ring. Every entrant is the same distance from every
          // other and from the goal, so a slot is worth what any other is.
          const bearing = (math.TAU * i) / count;
          slots.push(
            ships.spawn(world, {
              design: this.designs[i]!,
              x: math.cos(bearing) * settings.radius,
              y: math.sin(bearing) * settings.radius,
              angle: bearing + math.PI + turned,
              team: i,
            }),
          );
        }
        return { slots, marker };
      },
    );

    // Counted in steps rather than accrued in seconds: a sum of `dt` over two
    // minutes at sixty hertz comes to a shade over the duration it is divided
    // by, and a survival score of 1.0000000000000073 makes a liar of every
    // sentence saying these run from nothing to one.
    this.survival = new Float64Array(count);
    this.race = new Float64Array(count);
    this.nearness = new Float64Array(count);
    this.began = new Float64Array(count);
    this.lifetime = new Float64Array(count);
    this.dealt = [];
    for (let i = 0; i < count; i++) this.dealt.push(new Float64Array(count));

    // Where everyone began, taken before a single step so that nothing has had
    // a chance to shove anybody: a craft knocked off its mark by a neighbour in
    // the first instant would otherwise be scored from somewhere it never was.
    const { ships, world } = this.battle;
    const goal = settings.goal;
    if (goal !== null && goal.scale > 0 && ships.isAlive(this.battle.marker)) {
      const at = world.bodies.indexOf(ships.body(this.battle.marker));
      for (let i = 0; i < count; i++) {
        const body = world.bodies.indexOf(ships.body(this.battle.slots[i]!));
        const dx = world.bodies.x[body]! - world.bodies.x[at]!;
        const dy = world.bodies.y[body]! - world.bodies.y[at]!;
        this.began[i] = goal.scale / (goal.scale + math.length(dx, dy));
        this.nearness[i] = this.began[i]!;
      }
      this.measured = true;
    }
  }

  /**
   * Whether the match is over: by the clock, by nobody being left, or by one
   * being left — unless getting to the goal still counts, since a survivor
   * still has the goal to fly, and scoring it as though it stopped where the
   * last kill left it pays for where it happened to be at that moment.
   */
  get done(): boolean {
    if (this.step >= this.total || this.ending === 'annihilated') return true;
    return this.ending === 'decided' && !(this.measured && this.settings.weights.race !== 0);
  }

  /** How far through it is, from nothing to one. */
  get progress(): number {
    return this.total > 0 ? this.step / this.total : 1;
  }

  /** Advance one step of the simulation and score what happened in it. */
  advance(): void {
    if (this.done) return;
    const { ships, world } = this.battle;
    const settings = this.settings;
    this.battle.step();

    this.entrantOf.clear();
    let fighting = 0;
    for (let i = 0; i < this.count; i++) {
      const ship = this.battle.slots[i]!;
      if (!ships.isAlive(ship)) continue;
      const body = world.bodies.indexOf(ships.body(ship));
      this.entrantOf.set(body, i);
      if (!ships.hasControl(ship)) continue;

      // Nobody is flying a hull whose cores have gone (DESIGN.md §4), and it
      // scores nothing more for being wreckage that has not been finished off.
      fighting++;
      this.survival[i]! += coreHealth(ships, this.designs[i]!, body);
      this.lifetime[i]! = this.step + 1;

      const goal = settings.goal;
      if (goal !== null && goal.scale > 0 && ships.isAlive(this.battle.marker)) {
        const at = world.bodies.indexOf(ships.body(this.battle.marker));
        const dx = world.bodies.x[body]! - world.bodies.x[at]!;
        const dy = world.bodies.y[body]! - world.bodies.y[at]!;
        // One at the goal, a half at `scale`, and never quite nothing however
        // far off — so every metre closed is worth something.
        this.nearness[i]! = goal.scale / (goal.scale + math.length(dx, dy));
        this.race[i]! += this.nearness[i]! - this.began[i]!;
      }
    }

    // Who hit whom, this step. A hit whose shooter or whose victim is not a
    // competitor — wreckage, or a piece that has come off something — is
    // nobody's credit: it is neither a ship damaged nor an entrant doing it.
    const credit = this.battle.credit;
    for (let h = 0; h < credit.count; h++) {
      const attacker = this.entrantOf.get(credit.attacker[h]!);
      const victim = this.entrantOf.get(credit.victim[h]!);
      if (attacker === undefined || victim === undefined || attacker === victim) continue;
      this.dealt[attacker]![victim]! += credit.energy[h]!;
    }

    this.step++;
    if (fighting === 0) this.ending = 'annihilated';
    else if (this.count > 1 && fighting === 1) this.ending = 'decided';
  }

  /** What every entrant was worth. Call once it is `done`. */
  result(): MatchResult {
    const settings = this.settings;
    const { ships, world } = this.battle;
    const count = this.count;
    const taken = new Float64Array(count);

    // What is left of the match, credited to whoever is still fighting at its
    // last state.
    //
    // Without this, winning outright is worth *less* than a stalemate: a ship
    // that kills everything in ten seconds of a two-minute match is credited
    // with ten seconds of survival, and one that spends two minutes failing to
    // land a shot is credited with all of it. The rest of a decided match is a
    // formality, so it is scored as though it had been played out and gone on
    // the way it was going.
    const survival = Float64Array.from(this.survival);
    const race = Float64Array.from(this.race);
    const left = this.total - this.step;
    if (left > 0) {
      for (let i = 0; i < count; i++) {
        const ship = this.battle.slots[i]!;
        if (!ships.isAlive(ship) || !ships.hasControl(ship)) continue;
        const body = world.bodies.indexOf(ships.body(ship));
        survival[i]! += coreHealth(ships, this.designs[i]!, body) * left;
        race[i]! += (this.nearness[i]! - this.began[i]!) * left;
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
        hurt += math.min(1, this.dealt[i]![v]! / this.capacities[v]!);
        taken[i]! += this.dealt[v]![i]!;
      }
      const opposition = math.max(1, count - 1);
      const parts = {
        survival: survival[i]! / this.total,
        damage: hurt / opposition,
        // Signed, and bounded by how much ground there was to gain or lose.
        race: this.measured ? race[i]! / this.total : 0,
      };
      scores.push({
        ...parts,
        total:
          parts.survival * settings.weights.survival +
          parts.damage * settings.weights.damage +
          parts.race * settings.weights.race,
        lifetime: this.lifetime[i]! * settings.dt,
        taken: math.min(1, taken[i]! / this.capacities[i]!),
      });
    }
    return {
      seed: settings.seed,
      elapsed: this.step * settings.dt,
      steps: this.step,
      ending: this.ending,
      scores,
    };
  }
}

/**
 * Fight one match and score it.
 *
 * Deterministic in the config's seed and the blueprints: the same call gives
 * the same result, which is what makes a match replayable from a run's record
 * rather than needing one recorded frame by frame.
 */
export function runMatch(entrants: readonly Blueprint[], config?: Partial<MatchConfig>): MatchResult {
  const match = new Match(entrants, config);
  while (!match.done) match.advance();
  return match.result();
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
