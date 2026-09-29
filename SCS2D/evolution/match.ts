import {
  compileBlueprint,
  expandFleet,
  Rng,
  type Ships,
  DAMAGE_ENERGY_PER_KG,
  math,
  NEUTRAL_TEAM,
  type Blueprint,
  type Fleet,
  type ShipDesign,
  type WellSpec,
} from '../sim/index.js';
import { addCapability, EFFECTS, workingShare } from './capability.js';
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
 *
 * **An entrant is a ship or a fleet.** A fleet stands where a ship would, in
 * its own frame, and is scored as one thing: each of its ships counts for its
 * share of what the fleet's hulls can absorb, so a lone ship is a fleet of one
 * scored exactly as it always was.
 */

/** What a match is fought between. */
export type Entrant = Blueprint | Fleet;

export function isFleet(entrant: Entrant): entrant is Fleet {
  return 'designs' in entrant;
}

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
  readonly functional: number;
  readonly damage: number;
  readonly disabling: number;
  readonly race: number;
}

/** The parts of a score, in the order they are listed. */
export const SCORE_PARTS = ['survival', 'functional', 'damage', 'disabling', 'race'] as const;

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
   * ROADMAP.md §12. Widened, never narrowed, where fleets would start on top
   * of each other or the goal.
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
  /**
   * A ship or fleet every entrant fights together, or null for a free-for-all.
   *
   * The boss stands at the middle of the ring, where the goal would be — so a
   * boss match has no goal — and every entrant is on one side against it,
   * scored for what it does to the boss alone: a hit on another entrant is
   * nobody's credit. It is not scored itself, and does not evolve.
   */
  readonly boss: Entrant | null;
}

export const DEFAULT_MATCH: MatchConfig = {
  seed: 1,
  dt: 1 / 60,
  duration: 120,
  radius: 500,
  goal: { x: 0, y: 0, scale: 500, size: 12 },
  weights: { survival: 1, functional: 1, damage: 1, disabling: 1, race: 1 },
  wells: [],
  scatter: math.PI,
  boss: null,
};

/** What one entrant did, each part scaled so that one is as good as it gets. */
export interface Score {
  /**
   * What the entrant's hulls could still absorb, as a share of what they
   * started with, averaged over the match. A ship whose cores are out counts
   * for nothing, and a piece shot off is lost; being hurt later costs less than
   * being hurt sooner. More ships do not score more: it is one fraction per fleet.
   */
  readonly survival: number;
  /**
   * What the entrant can still do — thrust, firepower, control — as a share
   * of what it started with, each effect alike, averaged over the match.
   * Armour counts here only for what it keeps working.
   */
  readonly functional: number;
  /** Fraction of the opposition destroyed, by what its hulls could absorb. */
  readonly damage: number;
  /** Fraction of the opposition's `functional` share this entrant took away. */
  readonly disabling: number;
  /**
   * Ground gained on the goal over the match by the entrant's nearest ship, as
   * a share of what there was to gain. Zero for a design that stayed where it was put, and negative for one
   * that ended further off than it started.
   */
  readonly race: number;
  /** The parts, weighted and added. */
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

/** The boss's side; every entrant is on side 0 against it. */
const BOSS_TEAM = 1;
/** Metres kept between a boss and the nearest entrant at the start. */
const BOSS_CLEARANCE = 50;

/**
 * The ring's radius: the one asked for, or as far out as keeps fleets clear of
 * each other and of the goal at the start. Lone ships never need it widened.
 */
function ringRadius(
  placed: readonly (readonly { x: number; y: number; design: ShipDesign }[])[],
  boss: readonly { x: number; y: number; design: ShipDesign }[] | undefined,
  settings: MatchConfig,
): number {
  const reachOf = (ships: readonly { x: number; y: number; design: ShipDesign }[]): number => {
    let reach = 0;
    for (const ship of ships) reach = math.max(reach, math.length(ship.x, ship.y) + ship.design.radius);
    return reach;
  };
  let first = 0;
  let second = 0;
  for (const ships of placed) {
    const reach = reachOf(ships);
    if (reach > first) {
      second = first;
      first = reach;
    } else if (reach > second) second = reach;
  }
  let radius = settings.radius;
  if (placed.length > 1) radius = math.max(radius, (first + second) / (2 * math.sin(math.PI / placed.length)));
  if (settings.goal !== null) radius = math.max(radius, first + settings.goal.size);
  // Clear of a boss at the middle, with room for either to turn before they meet.
  if (boss !== undefined) radius = math.max(radius, reachOf(boss) + first + BOSS_CLEARANCE);
  return radius;
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
  /** Every ship the entrants put on the field, and which entrant each belongs to. */
  readonly battle: Battle & { slots: number[]; owners: number[]; marker: number };
  private readonly settings: MatchConfig;
  /** Per entrant: what its hulls could absorb between them. */
  private readonly capacities: number[];
  private readonly count: number;
  /** The entrants, and the boss after them if there is one. */
  private readonly sides: number;
  private readonly survival: Float64Array;
  private readonly race: Float64Array;
  /** Per ship. */
  private readonly nearness: Float64Array;
  private readonly began: Float64Array;
  /** Per entrant: its nearest ship's nearness at the start, and this step. */
  private readonly start: Float64Array;
  private readonly best: Float64Array;
  private readonly lifetime: Float64Array;
  private readonly dealt: Float64Array[];
  /** Per entrant, by effect: what it could do at the start, and this step. */
  private readonly startCapability: Float64Array;
  private readonly capability: Float64Array;
  /** Per entrant: its `functional` share last step, and summed over the match. */
  private readonly working: Float64Array;
  private readonly functional: Float64Array;
  /** Per ship: what its hull could absorb last step. */
  private readonly hull: Float64Array;
  /** Per entrant this step: joules its hulls lost, and joules each attacker put in, by attacker * count + victim. */
  private readonly lost: Float64Array;
  private readonly delivered: Float64Array;
  /** Per attacker, by victim: share of the victim's function taken away. */
  private readonly disabled: Float64Array[];
  /** Which entrants still have a ship under command this step. */
  private readonly fightingNow: Uint8Array;
  private readonly entrantOf = new Map<number, number>();
  private readonly total: number;
  private measured = false;
  private step = 0;
  private ending: Ending = 'timeout';

  constructor(entrants: readonly Entrant[], config?: Partial<MatchConfig>) {
    const given: MatchConfig = { ...DEFAULT_MATCH, ...config };
    const settings: MatchConfig = given.boss === null ? given : { ...given, goal: null };
    this.settings = settings;
    const boss = settings.boss;
    // Each entrant's ships in its own frame, with their designs compiled once;
    // the boss, if there is one, as a side after them.
    const placed = [...entrants, ...(boss === null ? [] : [boss])].map((entrant) => {
      if (!isFleet(entrant)) return [{ x: 0, y: 0, angle: 0, design: compileBlueprint(entrant) }];
      const compiled = new Map<string, ShipDesign>();
      for (const [name, blueprint] of Object.entries(entrant.designs)) compiled.set(name, compileBlueprint(blueprint));
      return expandFleet(entrant).map((ship) => ({ x: ship.x, y: ship.y, angle: ship.angle, design: compiled.get(ship.design)! }));
    });
    this.capacities = placed.map((ships) => ships.reduce((sum, ship) => sum + hullCapacity(ship.design), 0));
    const count = entrants.length;
    this.count = count;
    const sides = placed.length;
    this.sides = sides;
    const ring = ringRadius(placed.slice(0, count), placed[count], settings);
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
        const owners: number[] = [];
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
        // Taking turns between entrants, so no side is always first to act.
        const longest = placed.reduce((most, list) => math.max(most, list.length), 0);
        for (let k = 0; k < longest; k++) {
          for (let i = 0; i < sides; i++) {
            const ship = placed[i]![k];
            if (ship === undefined) continue;
            // Evenly round a ring. Every entrant is the same distance from every
            // other and from the goal, so a slot is worth what any other is. The
            // boss is where the goal would be, turned by the same draw.
            const isBoss = i === count;
            const bearing = (math.TAU * i) / count;
            const ox = isBoss ? 0 : math.cos(bearing) * ring;
            const oy = isBoss ? 0 : math.sin(bearing) * ring;
            const heading = isBoss ? turned : bearing + math.PI + turned;
            // A lone ship stands exactly where the entrant does.
            const alone = ship.x === 0 && ship.y === 0;
            const c = math.cos(heading);
            const s = math.sin(heading);
            slots.push(
              ships.spawn(world, {
                design: ship.design,
                x: alone ? ox : ox + ship.x * c - ship.y * s,
                y: alone ? oy : oy + ship.x * s + ship.y * c,
                angle: ship.angle === 0 ? heading : heading + ship.angle,
                // Every entrant on one side against a boss.
                team: boss === null ? i : isBoss ? BOSS_TEAM : 0,
              }),
            );
            owners.push(i);
          }
        }
        return { slots, owners, marker };
      },
    );

    // Counted in steps rather than accrued in seconds: a sum of `dt` over two
    // minutes at sixty hertz comes to a shade over the duration it is divided
    // by, and a survival score of 1.0000000000000073 makes a liar of every
    // sentence saying these run from nothing to one.
    const fielded = this.battle.slots.length;
    this.survival = new Float64Array(sides);
    this.race = new Float64Array(sides);
    this.nearness = new Float64Array(fielded);
    this.began = new Float64Array(fielded);
    this.start = new Float64Array(sides);
    this.best = new Float64Array(sides);
    this.lifetime = new Float64Array(sides);
    this.fightingNow = new Uint8Array(sides);
    this.dealt = [];
    this.disabled = [];
    for (let i = 0; i < sides; i++) {
      this.dealt.push(new Float64Array(sides));
      this.disabled.push(new Float64Array(sides));
    }
    this.startCapability = new Float64Array(sides * EFFECTS);
    this.capability = new Float64Array(sides * EFFECTS);
    this.hull = new Float64Array(fielded);
    for (let k = 0; k < fielded; k++) {
      const design = this.battle.ships.design(this.battle.slots[k]!);
      addCapability(this.startCapability, this.battle.owners[k]! * EFFECTS, design, null, -1);
      this.hull[k] = hullCapacity(design);
    }
    this.working = new Float64Array(sides);
    for (let i = 0; i < sides; i++) this.working[i] = workingShare(this.startCapability, this.startCapability, i * EFFECTS);
    this.functional = new Float64Array(sides);
    this.lost = new Float64Array(sides);
    this.delivered = new Float64Array(sides * sides);

    // Where everyone began, taken before a single step so that nothing has had
    // a chance to shove anybody: a craft knocked off its mark by a neighbour in
    // the first instant would otherwise be scored from somewhere it never was.
    const { ships, world } = this.battle;
    const goal = settings.goal;
    if (goal !== null && goal.scale > 0 && ships.isAlive(this.battle.marker)) {
      const at = world.bodies.indexOf(ships.body(this.battle.marker));
      for (let i = 0; i < fielded; i++) {
        const body = world.bodies.indexOf(ships.body(this.battle.slots[i]!));
        const dx = world.bodies.x[body]! - world.bodies.x[at]!;
        const dy = world.bodies.y[body]! - world.bodies.y[at]!;
        this.began[i] = goal.scale / (goal.scale + math.length(dx, dy));
        this.nearness[i] = this.began[i]!;
        const owner = this.battle.owners[i]!;
        this.start[owner] = math.max(this.start[owner]!, this.began[i]!);
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
    const fightingNow = this.fightingNow;
    fightingNow.fill(0);
    const best = this.best;
    best.fill(0);
    this.capability.fill(0);
    this.lost.fill(0);
    for (let k = 0; k < this.battle.slots.length; k++) {
      const ship = this.battle.slots[k]!;
      const i = this.battle.owners[k]!;
      if (!ships.isAlive(ship)) continue;
      const body = world.bodies.indexOf(ships.body(ship));
      this.entrantOf.set(body, i);
      const design = ships.design(ship);
      const hull = hullLeft(ships, design, body);
      this.lost[i]! += math.max(0, this.hull[k]! - hull);
      this.hull[k] = hull;
      if (!ships.hasControl(ship)) continue;

      // Nobody is flying a hull whose cores have gone (DESIGN.md §4), and it
      // scores nothing more for being wreckage that has not been finished off.
      fightingNow[i] = 1;
      this.survival[i]! += hull / this.capacities[i]!;
      addCapability(this.capability, i * EFFECTS, design, ships, body);
      this.lifetime[i]! = this.step + 1;

      const goal = settings.goal;
      if (goal !== null && goal.scale > 0 && ships.isAlive(this.battle.marker)) {
        const at = world.bodies.indexOf(ships.body(this.battle.marker));
        const dx = world.bodies.x[body]! - world.bodies.x[at]!;
        const dy = world.bodies.y[body]! - world.bodies.y[at]!;
        // One at the goal, a half at `scale`, and never quite nothing however
        // far off — so every metre closed is worth something.
        this.nearness[k]! = goal.scale / (goal.scale + math.length(dx, dy));
        best[i] = math.max(best[i]!, this.nearness[k]!);
      }
    }
    // Entrants only: a boss left alone has nobody to score.
    let fighting = 0;
    for (let i = 0; i < this.count; i++) {
      fighting += fightingNow[i]!;
      // By its nearest ship: more ships help only by covering the one that gets there.
      if (fightingNow[i] === 1 && this.measured) this.race[i]! += best[i]! - this.start[i]!;
    }

    // Who hit whom, this step. A hit whose shooter or whose victim is not a
    // competitor — wreckage, or a piece that has come off something — is
    // nobody's credit: it is neither a ship damaged nor an entrant doing it.
    const credit = this.battle.credit;
    const sides = this.sides;
    this.delivered.fill(0);
    for (let h = 0; h < credit.count; h++) {
      const attacker = this.entrantOf.get(credit.attacker[h]!);
      const victim = this.entrantOf.get(credit.victim[h]!);
      if (attacker === undefined || victim === undefined) continue;
      this.delivered[attacker * sides + victim]! += credit.energy[h]!;
      if (attacker !== victim) this.dealt[attacker]![victim]! += credit.energy[h]!;
    }

    // Function lost this step goes to each attacker by its share of everything
    // the victim took — its own fire and its own exhaust included, which are
    // nobody's credit — so hurting yourself never pays anyone, least of all you.
    for (let v = 0; v < sides; v++) {
      const now = workingShare(this.capability, this.startCapability, v * EFFECTS);
      const drop = this.working[v]! - now;
      this.working[v] = now;
      this.functional[v]! += now;
      if (!(drop > 0)) continue;
      let credited = 0;
      for (let a = 0; a < sides; a++) credited += this.delivered[a * sides + v]!;
      const taken = math.max(this.lost[v]!, credited);
      if (!(taken > 0)) continue;
      for (let a = 0; a < sides; a++) {
        if (a !== v) this.disabled[a]![v]! += (drop * this.delivered[a * sides + v]!) / taken;
      }
    }

    this.step++;
    if (fighting === 0) this.ending = 'annihilated';
    else if (sides > this.count) {
      // Against a boss, it is over once the boss can no longer fight.
      if (fightingNow[this.count] === 0) this.ending = 'decided';
    } else if (this.count > 1 && fighting === 1) this.ending = 'decided';
  }

  /** What every entrant was worth. Call once it is `done`. */
  result(): MatchResult {
    const settings = this.settings;
    const { ships, world } = this.battle;
    const count = this.count;
    const sides = this.sides;
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
    const functional = Float64Array.from(this.functional);
    const race = Float64Array.from(this.race);
    const left = this.total - this.step;
    if (left > 0) {
      for (let i = 0; i < count; i++) functional[i]! += this.working[i]! * left;
      const best = new Float64Array(sides);
      const fighting = new Uint8Array(sides);
      for (let k = 0; k < this.battle.slots.length; k++) {
        const ship = this.battle.slots[k]!;
        const i = this.battle.owners[k]!;
        if (!ships.isAlive(ship) || !ships.hasControl(ship)) continue;
        const body = world.bodies.indexOf(ships.body(ship));
        survival[i]! += (hullLeft(ships, ships.design(ship), body) / this.capacities[i]!) * left;
        best[i] = math.max(best[i]!, this.nearness[k]!);
        fighting[i] = 1;
      }
      if (this.measured) {
        for (let i = 0; i < count; i++) if (fighting[i] === 1) race[i]! += (best[i]! - this.start[i]!) * left;
      }
    }

    const scores: Score[] = [];
    for (let i = 0; i < count; i++) {
      let hurt = 0;
      let disabling = 0;
      // Against a boss, the boss is the whole of the opposition: a hit on
      // another entrant is on one's own side, and pays nothing.
      const against = sides > count;
      for (let v = 0; v < sides; v++) {
        if (v === i) continue;
        taken[i]! += this.dealt[v]![i]!;
        if (against && v !== count) continue;
        // Capped per victim: a ship can only be destroyed once, and without the
        // cap the best thing a gun could do is go on firing into a hull that has
        // already stopped — which is exactly the habit a fitness function must
        // not pay for.
        hurt += math.min(1, this.dealt[i]![v]! / this.capacities[v]!);
        disabling += math.min(1, this.disabled[i]![v]!);
      }
      const opposition = against ? 1 : math.max(1, count - 1);
      const parts = {
        survival: survival[i]! / this.total,
        functional: functional[i]! / this.total,
        damage: hurt / opposition,
        disabling: disabling / opposition,
        // Signed, and bounded by how much ground there was to gain or lose.
        race: this.measured ? race[i]! / this.total : 0,
      };
      scores.push({
        ...parts,
        total:
          parts.survival * settings.weights.survival +
          parts.functional * settings.weights.functional +
          parts.damage * settings.weights.damage +
          parts.disabling * settings.weights.disabling +
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
export function runMatch(entrants: readonly Entrant[], config?: Partial<MatchConfig>): MatchResult {
  const match = new Match(entrants, config);
  while (!match.done) match.advance();
  return match.result();
}

/** What a hull could still absorb, joules, in the units of `hullCapacity`. */
function hullLeft(ships: Ships, design: ShipDesign, body: number): number {
  let left = 0;
  for (let m = 0; m < design.modules.length; m++) {
    left += design.modules[m]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG * ships.damage.integrity(body, m);
  }
  return left;
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
