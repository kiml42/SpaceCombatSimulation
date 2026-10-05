import { assert, describe, expect, it } from 'vitest';
import {
  BeamHits,
  math,
  Beams,
  compileBlueprint,
  ProjectileHits,
  Projectiles,
  joints,
  RayHit,
  Ships,
  SpatialGrid,
  type BodyId,
  World,
  type ShipDesign,
} from '../sim/index.js';
import { BEAM_CORVETTE, DINKY } from '../scenarios/blueprints.js';
import { TURRET_CORVETTE } from './fixtures.js';
import { column } from '../scenarios/column.js';

/**
 * Not shooting through your own side.
 *
 * A straight cast from the muzzle at this instant, ignoring everyone's
 * velocity: the question a gunner actually asks is whether somebody is
 * *there*, and a gun that tried to work out where its friends would be would
 * be solving the firing problem twice over.
 *
 * How far it looks is the difference between the two weapons. A shell is slow
 * and a battle is wide, so a gun looks only a moment ahead — far enough for
 * the consort that has just crossed its muzzle, not so far that a fleet never
 * fires. A beam arrives instantly along its whole length, so anything in the
 * line is hit, and it looks the whole way.
 */

const DT = 1 / 60;
const corvette = compileBlueprint(TURRET_CORVETTE);
const beamCorvette = compileBlueprint(BEAM_CORVETTE);
const dinky = compileBlueprint(DINKY);

interface Shot {
  rounds: number;
  beams: number;
}

/**
 * One ship firing on an enemy dead ahead, with whatever else is put between
 * them, and what came out of its guns.
 *
 * The world is never stepped: turrets train, and the hulls stay exactly where
 * they were placed, so what is in the line of fire is what the test says is.
 *
 * The enemy stands inside the reach of every gun tested here — a mount
 * ignores what lies beyond its own range, so a mark further off would measure
 * that rather than the discipline this file is about. Reach is measured
 * against the mark, and the mark is a corvette: the Dinky's gun is the
 * shortest at 909 m against one.
 */
function salvo(design: ShipDesign, between: { design: ShipDesign; x: number; team: number }[]): Shot {
  const world = new World({ dt: DT, seed: 6 });
  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());
  const projectiles = new Projectiles(64);
  const beams = new Beams(64);
  const beamHits = new BeamHits();
  new ProjectileHits();
  const grid = new SpatialGrid(64);

  const mine = ships.spawn(world, { design, x: 0, y: 0, team: 0 });
  const enemy = ships.spawn(world, { design: corvette, x: 850, y: 0, team: 1 });
  for (const other of between) {
    ships.spawn(world, { design: other.design, x: other.x, y: 0, team: other.team });
  }
  ships.pushOrder(mine, enemy, 750, 950, 10);

  let rounds = 0;
  let beamsLit = 0;
  for (let i = 0; i < 60 * 20; i++) {
    ships.command(DT, world);
    grid.rebuild(world.bodies);
    const report = ships.fire(world, projectiles, beams, grid, beamHits);
    rounds += report.projectilesFired;
    beamsLit += report.beamsFired;
    beams.clear();
    beamHits.clear();
  }
  return { rounds, beams: beamsLit };
}

describe('a gun with somebody in the way', () => {
  it('fires when the line is clear', () => {
    expect(salvo(dinky, []).rounds).toBeGreaterThan(0);
  });

  it('holds its fire with a consort across the muzzle', () => {
    expect(salvo(dinky, [{ design: corvette, x: 200, team: 0 }]).rounds).toBe(0);
  });

  it('shoots past a consort far enough down the line to be its own problem', () => {
    // Deliberately not a rule about the whole flight of the round: a shell is
    // slow and a battle is wide, and a gun that asked about the whole of where
    // its round could go would never fire.
    expect(salvo(dinky, [{ design: corvette, x: 650, team: 0 }]).rounds).toBeGreaterThan(0);
  });

  it('shoots at an enemy standing in front of a consort', () => {
    // The cast stops at the nearest hull, so what is behind it never comes up.
    const shot = salvo(dinky, [
      { design: corvette, x: 150, team: 1 },
      { design: corvette, x: 250, team: 0 },
    ]);
    expect(shot.rounds).toBeGreaterThan(0);
  });

  it('does not hold fire for wreckage of its own side', () => {
    // Nobody is aboard it, and holding fire for it would make every broken
    // ship a shield. A chunk is a ship in every other way, so this is the one
    // place the difference has to be said out loud.
    const world = new World({ dt: DT, seed: 7 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const grid = new SpatialGrid(64);
    const projectiles = new Projectiles(64);
    const beams = new Beams(64);
    const beamHits = new BeamHits();

    const mine = ships.spawn(world, { design: dinky, x: 0, y: 0, team: 0 });
    // Inside the Dinky's 909 m reach against a corvette, as above: past it
    // the gun ignores the mark and there is no shot for the wreckage to fail
    // to stop.
    const enemy = ships.spawn(world, { design: corvette, x: 850, y: 0, team: 1 });
    // A consort well clear of the line, broken in two, with the piece pushed
    // into the line — which is how wreckage gets in the way for real.
    const consort = ships.spawn(world, { design: dinky, x: 0, y: 2000, team: 0 });
    // Its gun, cut free of everything it is welded to.
    const welds = joints(dinky);
    const gun = dinky.modules.findIndex((m) => m.spec.kind === 'hullGun');
    welds.forEach((j, w) => {
      if (j.a !== gun && j.b !== gun) return;
      ships.damage.cutWeld(world.bodies.indexOf(ships.body(consort)), w, j.width);
    });
    expect(ships.sever(world)).toBe(1);
    const chunk = ships.highWater - 1;
    expect(ships.isDerelict(chunk)).toBe(true);
    const chunkBody = world.bodies.indexOf(ships.body(chunk));
    world.bodies.x[chunkBody] = 200;
    world.bodies.y[chunkBody] = 0;

    ships.pushOrder(mine, enemy, 750, 950, 10);

    let rounds = 0;
    for (let i = 0; i < 60 * 20; i++) {
      ships.command(DT, world);
      grid.rebuild(world.bodies);
      rounds += ships.fire(world, projectiles, beams, grid, beamHits).projectilesFired;
    }

    // The premise: a shot really does pass through the chunk, so this is a
    // ship firing *despite* wreckage rather than one with a clear line.
    const hit = new RayHit();
    expect(
      grid.raycast(world.bodies, 0, 0, 300, 0, hit, world.bodies.indexOf(ships.body(mine)), ships.hulls),
    ).toBe(true);
    expect(hit.bodyIndex).toBe(chunkBody);
    expect(rounds).toBeGreaterThan(0);
  });

  it('fires on one of its own when that is the order', () => {
    // A rule about what is in the way, not about who may be shot at.
    const world = new World({ dt: DT, seed: 8 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const grid = new SpatialGrid(64);
    const projectiles = new Projectiles(64);
    const beams = new Beams(64);
    const beamHits = new BeamHits();

    const mine = ships.spawn(world, { design: dinky, x: 0, y: 0, team: 0 });
    const mark = ships.spawn(world, { design: corvette, x: 800, y: 0, team: 0 });
    ships.pushOrder(mine, mark, 700, 900, 10);

    let rounds = 0;
    for (let i = 0; i < 60 * 20; i++) {
      ships.command(DT, world);
      grid.rebuild(world.bodies);
      rounds += ships.fire(world, projectiles, beams, grid, beamHits).projectilesFired;
    }
    expect(rounds).toBeGreaterThan(0);
  });
});

describe('a beam with somebody in the way', () => {
  it('lights up when the line is clear', () => {
    expect(salvo(beamCorvette, []).beams).toBeGreaterThan(0);
  });

  it('holds for a consort a gun would have shot past', () => {
    // The whole length, because a beam arrives instantly along all of it:
    // anything in the line is hit rather than possibly hit.
    expect(salvo(beamCorvette, [{ design: corvette, x: 650, team: 0 }]).beams).toBe(0);
    expect(salvo(dinky, [{ design: corvette, x: 650, team: 0 }]).rounds).toBeGreaterThan(0);
  });
});

/** Which ship a body belongs to, or -1 if none of the live ones do. */
function shipOf(run: { ships: Ships; world: { bodies: { indexOf(id: BodyId): number } } }, body: number): number {
  for (let s = 0; s < run.ships.highWater; s++) {
    if (run.ships.isAlive(s) && run.world.bodies.indexOf(run.ships.body(s)) === body) return s;
  }
  return -1;
}

describe('a fleet in line ahead', () => {
  /**
   * Same fleets as `standoff`, turned ninety degrees: every ship but the
   * leader has one of its own in front of its guns. It is the formation the
   * rule exists for, and the one no other scenario produces.
   */
  it('does not shoot up its own line while the formation holds', () => {
    const run = column();

    let ownSide = 0;
    let landed = 0;
    // Rounds rather than hits: one that goes on through a hull into the next
    // step's module registers twice, and it is one decision to fire.
    const lastHit = new Map<number, number>();
    // Ten seconds: long enough for the columns to open fire on each other,
    // short enough that they are still columns. After that it is a melee, and
    // what a melee does to a fleet's own side is a question about the melee.
    for (let step = 0; step < 600; step++) {
      run.step();
      for (let h = 0; h < run.hits.count; h++) {
        const shooter = shipOf(run, run.projectiles.owner[run.hits.projectile[h]!]!);
        const victim = shipOf(run, run.hits.body[h]!);
        if (shooter < 0 || victim < 0) continue;
        landed++;
        const round = run.hits.projectile[h]!;
        const again = lastHit.get(round) === step - 1;
        lastHit.set(round, step);
        if (!again && run.ships.teamOf(shooter) === run.ships.teamOf(victim)) ownSide++;
      }
    }

    // The fleets really are shooting: this is a rule holding fire, not a
    // scenario where nothing happens. A floor rather than a figure, because
    // how many rounds this window catches depends on how fast the columns
    // close, and that moves with every change to what an engine delivers.
    // Few rounds and many hits, because a shell that bursts lands as several.
    expect(run.totalProjectilesFired).toBeGreaterThan(20);
    expect(landed).toBeGreaterThan(25);
    // Not zero, because the check is made at the trigger and over the half
    // second the gun looks ahead rather than for the whole flight of the
    // round: a consort can be walked into a line that was clear when the gun
    // fired, and holding fire for that would mean holding fire for the
    // battle.
    //
    // **And the half second is a distance, which the column is deeper than.**
    // The gunship's pom-poms throw at 928 m/s, so they look 464 m ahead —
    // past the two consorts immediately in front of them and short of the
    // leader three intervals away, who is hit. That is the rule's shape
    // rather than a failure of it: what it covers is measured in seconds of
    // flight, and a file can be longer than that. Most of the count below is
    // those shots.
    expect(ownSide).toBeLessThanOrEqual(25);
    // The rule is still doing the work it is for: the two ships a gun really
    // is looking past stay unhit, so own-side fire is a small fraction of
    // what lands rather than the bulk of it.
    expect(ownSide).toBeLessThan(landed * 0.2);
  });
});

describe('a gun and the target it was trained on', () => {
  /**
   * **A gun fires at what its barrel is pointing at.** Turrets are trained
   * before the world steps and fired after it, and a hull turns in between —
   * so a gun that worked out its target afresh at the trigger could name one
   * the barrel was never brought round to, and put the round somewhere over
   * its own shoulder. What it was trained on is therefore recorded when it is
   * trained, and that is what fires.
   */
  it('never fires wide of what it is aiming at', () => {
    // Measured on the rounds that actually leave, rather than on the mounts
    // that could fire: a mount held at the end of its arc reads as on target,
    // because what it is on is the bearing it was *commanded*, and sampling
    // those makes this a test of where a fighter's nose happens to be
    // pointing. What the rule is about is the round.
    //
    // Flown as a column rather than a swarm because a swarm of fighters whose
    // guns are let into their hulls barely fires: a mount that trains five
    // degrees waits for the nose to come round, and a few rounds in a
    // thousand steps cannot say where rounds go. Turreted ships shooting
    // steadily are what this needs, and what they are shooting at is the
    // same question.
    const run = column();
    const bodies = run.world.bodies;
    const projectiles = run.projectiles;
    const seen = new Set<number>();
    let worst = 0;
    let worstAt = '';
    let rounds = 0;

    // Forty seconds, since most of what fires here is the two gunships.
    for (let step = 0; step < 2400; step++) {
      run.step();
      for (let k = 0; k < projectiles.highWater; k++) {
        // A slot is reused once its round is gone, so a slot falling empty is
        // what says the next round in it is a new one.
        if (projectiles.alive[k] === 0) {
          seen.delete(k);
          continue;
        }
        if (seen.has(k)) continue;
        seen.add(k);
        // A fragment flies wherever its burst threw it; this is about aim.
        if (projectiles.fragment[k] === 1) continue;
        const shooter = shipOf(run, projectiles.owner[k]!);
        if (shooter < 0) continue;
        const own = bodies.indexOf(run.ships.body(shooter));
        if (own < 0) continue;
        const design = run.ships.design(shooter);
        const heading = Math.atan2(projectiles.vy[k]!, projectiles.vx[k]!);
        // Against the nearest of what the ship's mounts are aiming at: which
        // mount fired is not recorded on the round, and a round that lines up
        // with none of them is the failure this is looking for.
        let off = Math.PI;
        for (let t = 0; t < design.turrets.length; t++) {
          const target = run.ships.targetOfTurret(bodies, shooter, t);
          if (target < 0) continue;
          const tb = bodies.indexOf(run.ships.body(target));
          if (tb < 0) continue;
          const wanted = Math.atan2(bodies.y[tb]! - bodies.y[own]!, bodies.x[tb]! - bodies.x[own]!);
          off = Math.min(off, Math.abs(math.angleDelta(heading, wanted)));
        }
        rounds++;
        if (off <= worst) continue;
        worst = off;
        worstAt = `${design.name}, step ${step}`;
      }
    }

    // Leading a crossing target is a real angle off its present position — a
    // few degrees for a fighter shooting across a battle — but pointing the
    // other way is not lead, it is a stale answer, and that is what the bound
    // is set to catch rather than the lead itself.
    // Asserted with a message, because a bare number here says nothing about
    // which ship put a round somewhere over its own shoulder.
    assert.isBelow(worst * (180 / Math.PI), 20, `worst was ${worstAt}`);
    expect(rounds).toBeGreaterThan(100);
  });
});
