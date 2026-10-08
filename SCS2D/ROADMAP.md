# Space Combat Simulation — Roadmap

What is not built yet, and what is not settled yet. The design these serve is in
[DESIGN.md](DESIGN.md); the record of decisions already taken is in [DECISIONS.md](DECISIONS.md).

**Status — what exists today — lives in [DESIGN.md](DESIGN.md) and is the single source of truth for it.**
This file says what is *left*, and only mentions what exists where the work left depends on it.

**Three documents, split by why you would read them.** Section numbers are global and stable across all
three, so a reference such as "§12" means the same section wherever it is written — which is why the numbering
inside any one file is not contiguous.

| File | Holds | Read it when |
| --- | --- | --- |
| **[DESIGN.md](DESIGN.md)** | Status, §§1–7 and 9–11 — what the game is, how it works, and why | Deciding how something should behave |
| **[ROADMAP.md](ROADMAP.md)** | §8 build order, §12 open questions | Picking up work, or deferring a decision |
| **[DECISIONS.md](DECISIONS.md)** | The Decision Log | Asking why something ended up the way it is |

## How this document is maintained

**§8 is kept in three parts, so that what to build next is the first thing you read.**

- **Partly built** lists only what is *left* of a step that has started. When a piece lands, delete it from
  here and describe it in Status; when nothing is left, the step moves to the table as built.
- **Not started** is the plan proper: the steps to come, in order, each with the reason it comes where it
  does.
- **Notes on what is built** holds what a finished step settled that later work has to respect — a constraint,
  a shape to follow, a trap already found. A note earns its place by naming the future work it bears on.
  It is not a history: measurements and the story of how something was arrived at belong in DECISIONS.md, and
  a description of what the code does belongs in Status. Delete a note once nothing left depends on it.

**§12 empties on answer, and this one is strict.** An answered question is a decision. Leaving it here does
not merely clutter, it misinforms: anything in §12 reads as still open, so a settled question left in place
invites it to be re-litigated — which is the exact failure these documents exist to prevent. Remove it and
put the answer in DECISIONS.md, in the same change that settles it. No strikethrough, no "settled" markers:
an entry is either still open or it is gone.

---

## 8. Build order

| Step | What | State |
| --- | --- | --- |
| Slice 0 | Two ships fight, deterministically | Built |
| 1 | Blueprint editor | Built |
| 2 | Terminal ballistics and the damage model | Built |
| 3 | Doctrine and orders | Partly built |
| 4 | Headless evolution and analysis | Built |
| 5 | v1: skirmish | Partly built |
| 6 | Editor restructuring | Built |
| 7 | Two layers | Partly built |
| 8 | Fuel | Partly built |
| 9 | Fuel harvesting | Not started |
| 10 | Raw material | Not started |
| 11 | Power | Not started |
| 12 | In-battle construction | Not started |
| 13 | Harvesting wrecks | Not started |
| 14 | Mining | Not started |
| 15 | Campaign | Not started |

### Partly built — what is left

**Step 3 — Doctrine and orders.** What the step deferred, plus one thing using it turned up:

- **Withdrawal** — a craft breaking off. **And keeping clear in the first place**: an unarmed ship — a fuel
  tanker, once there is fuel to carry — wants a doctrine that moves it away from armed enemies rather than
  towards a target, a weight against each by how dangerous it is and how close, so a support ship stays
  behind its fleet without being ordered to. An unarmed ship with a ram doctrine already picks targets (a
  torpedo); one without one currently does nothing at all.
- **More pickers**: ship-type. Hemisphere as a hard discard too, if `facingWeight`'s
  soft version — astern scores against — turns out not to be enough.
- **How much a mount cares about its ship's orders, as a weight of its own.** An order is currently a
  mandate: every mount that can train on the ordered target takes it. That is right for a main battery and
  wrong for a close-in mount, which should go on swatting whatever is about to hit the ship while the hull is
  ordered onto something big. The shape is the one the rest of targeting already has: a weight scoring the
  ordered target alongside every other candidate, defaulted high enough that an ordinary mount obeys and set
  low on a CIWS. It replaces the mandate rather than sitting beside it, so it moves the goldens of every
  scenario that issues an order — which is why it is a piece of work of its own.

**Step 5 — v1: skirmish.** A fixed budget of *materials* rather than of points (§12), and designed
scenarios. *This is the first thing worth giving people to play.* Designed scenarios are where the §12
entry on authored data stops being optional, since a scenario to share has to be a file.

Built: **the fleet file** (`sim/fleet.ts`, `sim/fleetFile.ts`), **a battle from fleets**
(`scenarios/fleetBattle.ts`), proved by `standoff` flying a fleet file with its checksum unchanged, **the
fleet editor** (`dist/fleet.html`), and **a custom battle** on the viewer — fleets or single ships from the
libraries, a file, or handed over by either editor's Battle link,
range, closing and crossing speeds, a rotation and a seed, saved and loaded as a battle file (`scenarios/customBattle.ts`)
and shared as a link that carries the file (`scenarios/battleLink.ts`),
set up paused and live, and decided once no more than one side can still fight.
**Fleet evolution** is built, headless (`evolution/fleetMutate.ts`, `npm run evolve -- --fleet`) and on the
evolution page: a match
takes fleets as entrants, a lone blueprint being a fleet of one, survival scored on the whole fleet's hull
capacity left and ground gained by its nearest ship. Every operator has its inverse — mutate a design, fork and merge, add and remove, move and turn, and swap a ship onto another of the fleet's designs, which is its own —
and a mutant over the total dry mass, the deployment radius or the ship count, or with hulls overlapping, is
refused. Evolving against a fixed ship or fleet is co-evolution with a side B that does not evolve, which
replaced the boss battle.

Not planned: per-ship doctrine overrides in a fleet (fork the design instead), and a group's own doctrine or
lead, which waits for standing orders. Velocity stays out of the fleet file; the battle setup holds it.

**Step 7 — Two layers.** The layers, depth and trigger masks are built. Three things make them make sense,
in this order, and all three come before fuel: nothing in the resource steps needs them, but every design
and evolution run does, and a ship tuned to half the rules is tuned twice.

1. **Exploding shells — built.** A gun's rounds burst on a timer, which is how a turret reaches the hull
   layer at all (§12's fuse entry is the reasoning). As built, each turret and hull gun has a **shell**:
   - `fragments` (8 by default, at most 64). One or fewer fires **solid shot**, all metal and never
     bursting, which is the switch for whether any of the round is charge at all.
   - `burstSpeed` (650 m/s by default): the most a fragment's velocity differs from the round's. It sizes
     the charge, since the casing's kinetic energy is what the charge's yield supplies (`chargeShare`), and
     charge is far less dense than steel: a gentle burst is nearly solid, a fierce one light and fast. Solid
     shot keeps the mass every round had before shells; at the default a fifth of a shell is charge, so it
     is about 84% of that.
   - `fuse` (0.02 s by default): how long before the aim point it bursts. Zero bursts at the aim point,
     which still counts on a miss or on what lies behind the target. The pattern is about the burst speed
     times the fuse across, so the default is a tight one and a flak gun wants many fragments on a long fuse.
   Fragments share the casing (the charge goes to gas) and the metal of the bore, so their areas sum to
   the share that was not charge. They live twice the fuse and at least half a second,
   and are marked (`Projectiles.fragment`). Evolution counts fragments, swapping to or from solid shot one
   draw in five, and nudges the fuse and burst speed of a gun that fires shells.
   - The fuse is set when the round is fired, to go off shortly before it would reach its aim point:
     `interceptTime` already knows when that is. How much before is a per-mount setting in the editor
     (`fuse`, seconds), so a mount can be tuned between bursting well short and bursting at the aim point. A
     round that hits something before its fuse goes off hits as it does now.
   - A burst replaces the round with sub-munitions: a fixed number, sharing its mass, each leaving with the
     round's velocity plus a spread in a random direction from the battle's seeded RNG, in opposed pairs so
     the burst keeps the round's momentum. They are hull-layer
     rounds, so they meet every module, deck and weapons layer alike; that is what "in both layers" comes
     to under the rule that a hull-layer shot meets everything.
   - No area cloud yet. **Beams stay in their own layer**: a laser has no fuse, which is the asymmetry §3
     asks for.
2. **Fighters — built.** A ship-level *fighter* flag, a checkbox in the editor's Role section. It follows
   DESIGN.md §3's strike craft rather than inventing a new rule. As built: shots, beams and hull casts carry
   a layer mask (`HULL_LAYER`, `WEAPONS_LAYER`, both for fragments), and a fighter's modules are all in
   the weapons layer, or both once committed (`Ships.layersOf`). **Ramming is a doctrine decision any ship
   can make**: `approach.ramRadii` (how close the target's edge must be, in its radii; 0, the default,
   never rams) and `approach.ramArmed` (the share of its own guns still working at or below which it
   will). A ramming ship flies into its target, ignoring the rest of its movement doctrine, and once its doctrine has decided to ram it sees it through; a fighter commits whenever it is ramming, by that
   decision or by a ram order (`Ships.pushRam`), not by an ordinary order to close to nothing. "Clear of
   every hull" is clear of its modules, not its bounding circle: committing is rare, and a circle would
   keep a fighter alongside a long hull from committing. Docking is not a decision yet. No stock ship is a
   fighter yet: flagging the Dinky, TIE and X-Wing is the obvious first move of item 3.
   - **A fighter may carry no turret and nothing thick.** The editor disables both while the flag is set.
     It flies in the **weapons layer**, where turrets and CIWS reach it, so a fighter is never out of their
     reach the way the Dinky is today.
   - **Its doctrine decides when it also occupies the hull layer**: that is a decision to ram, or to dock on
     another ship's side. Occupancy is added, never swapped, so it only ever makes the fighter more
     exposed; that is why there is no limit on how quickly it can change. It changes only while clear of
     every hull (§3), which is what stops a fighter committing inside a capital's perimeter. Its hull
     weapons fire in whichever layers it occupies.
   - **The flag can evolve**, and a ship that evolves a turret or a thick module flies as an ordinary ship,
     its flag ignored rather than refused, so a mutation that breaks the rule costs the design its role
     rather than its place in the run.
3. **Redesign the stock ships** Done.

**Step 8 — Fuel.** Tanks, burning and the editor's figures are built (DESIGN.md Status). What is left:

- **Lining the stock tanks.** Leaks and sealing are built (DESIGN.md Status), and no stock ship has a lining,
  so every hole in one stays open while there is fuel behind it. How thick a lining each wants is a design
  call about the fleet.
- **Pilots that know their fuel.** Nothing flies differently for running low, so a ship spends its tanks
  as freely as ever. Short-legged ships show it: the Dinky carries 68 kg (13 s flat out), the TIE and the
  Torch little more for what they push, and in `swarm` every Dinky is dry before it reaches the gunships.
  Bigger tanks or a pilot that husbands what it has; the second belongs with withdrawal (step 3).
- **Fuel in the materials budget** (step 5). Fleet and evolution budgets count full tanks in a ship's mass,
  and that is as far as it goes.

### Not started — in order

Steps 9 to 13 walk into the resource system one resource and one use at a time, fuel first (partly built,
above): it is the scarcity every battle feels (§2), and some of §12 was parked until it existed — the dead
zone on attitude hold, propellant-optimal allocation, and running cost. *Note: fuel is a re-balance, not an addition — tank mass moves the golden checksums, battles become
about managing what a ship carries, and scenarios will need revisiting.*

**The core carries a little of each resource as it arrives** — a built-in tank, store and generator, scaled
with its size — so a bare core with one engine or one weapon can act, and a bigger core is worth its bulk.
Today the best core is the smallest, most armoured one that can hide from a hit; this gives size a price in
both directions.

9. **Fuel harvesting** — siphoning what is left in a wreck, the first salvage, since pumping a liquid needs no
   construction. It needs a part that holds a wreck to drain it, and a pilot that goes after one: an order or
   picker for a wreck with fuel left, and a judgement about when to break off for it, close to step 3's
   withdrawal. The pilot may cost more than the part.
   Also ships running out of fuel should be able to dock with a ship that has plenty an take some. Particularly relevant for fighters. Fighters should be able to dock on pads in the hull layer. Ships docking together should have docking fixtures on the side of the hull.
10. **Raw material** — a store of metal, spent as ammunition and on repair. It answers §12's ammunition
    granularity and brings in the other half of §2's scarcity.
11. **Power** — a generator that beams draw on, refilling each mount's bank at what the plant can spare, and a
    module to hit to silence them. Straight after raw material, because once guns spend ammunition and beams
    spend nothing, beams win by default; a plant gives them a resource to run short of and a part to lose.
12. **In-battle construction** — new modules made from raw material during a battle, and new ships budded off.
    The largest of the steps: it needs the build-time and complexity metric §2 leaves open, and build doctrine.
13. **Harvesting wrecks** — metal regained from wreckage, with the grapple step 9 built. The natural bridge to
    an economy: no map features needed, and income tied directly to combat.
14. **Mining** — metal and fuel from map features, so maps have economic character. By here both resources
    exist, so this step is the map and the income, not the resources. *It replaces "did I spend 500 points
    well?" with "did I manage income well?"*
15. **Campaign** — Homeworld-shaped, with the adaptive enemy. Last, because it's mostly *authoring* (scripted
    missions, pacing, narrative), which is the largest volume of work in the least-proven discipline.

**Scenario packs** are the cheapest way to make it a game with goals rather than a sandbox, and they teach the
mechanics. Each scenario is a data file, not code.

**Multiplayer** is not a step, and nothing is being built for it — but nothing forecloses it either: the pure
sim, fixed timestep, explicit seeding and commands-in/snapshots-out contract *are* the lockstep architecture.

- **Async fleet-vs-fleet is nearly free** and stays open: a fleet file (blueprints + doctrine + build
  priorities) plus a seed, run deterministically, produces a replay both sides can watch. No server, no
  netcode, no rollback. The variant where the budget arrives as *starting resources on a mothership with
  build priorities* is better than a pre-built fleet, because build doctrine becomes part of what's being
  competed on. Requires portable determinism — hence own transcendentals.
- **Real-time PvP is ruled out**: it is incompatible with pause-to-think, which is core.
- **Co-op** is the only sensible real-time shape, and it's also the easiest — everyone pauses together.

### Notes on what is built

Only what later work has to respect. What each step built is in Status; how it was arrived at is in
DECISIONS.md.

**Why the order starts where it does.** Slice 0 went first because it attacked the real risks (does planar
Newtonian combat feel good? do the scaling laws hold?) rather than the known ones, kept the sim boundary pure
by construction, and put something on screen within days. The same test still picks the next step: the one
that answers the question most likely to change the design.

#### Editor (step 1)

- **Assemblies are how a ship stops being edited twice.** A blueprint holds named groups of modules and
  places them by reference; an assembly of one module is the ordinary shared-part case, not a separate
  concept. Position belongs to the copy, everything else to all of them. Symmetry is structural — build a
  side once, place it twice with one copy mirrored — so there is no mirrored editing mode, and none should be
  added.
- **A group is built around the first module picked**, not the centre of the selection, because a group is
  usually a thing hanging off one connecting module and reflection should turn it about that joint.
- **Copies of an assembly do not differ.** An instance places its assembly and nothing else, so "linked"
  means identical. To make copies differ, a part is **taken out of the assembly**: it leaves the
  definition, and every copy gets a loose one of its own, written just after it in the list it sits in, in
  the same place — the geometry is unchanged, the part moves down the expansion order a little, and a *new*
  copy will not have it. A loose part does not move with the copy it came out of; wrapping the two in a new
  assembly is how to have that. Dissolving one copy is the other way out, and changes neither geometry nor
  order: its contents are written where it was, one level at a time.
- **Module order is part of the ship, so restructuring is not bit-free.** Engine allocation and firing both
  run in list order, so a reordered layout does not check-sum the same — though `scenarios/ordering.ts`
  measures the behavioural difference as round-off (8.2e-13 m over 3,000 steps, identical shots and hits),
  too small to be worth warning about when an edit reorders a layout. Adding a module appends, which leaves even the bits alone; the authored ships place symmetric *pairs* adjacently for
  the same reason.
- **The editor's animation is not a start on test flight.** A selected engine burns and a selected gun fires
  at its own rate, but nothing integrates or collides, so it cannot grow into a test flight by accident.
- **No cost line, now or ever.** Dry mass is not standing in for a cost; it *is* the materials a ship is made
  of, one of the three real costs (§2). Build time needs a complexity metric and running cost needs a fuel
  model; until they exist, mass is the whole of what the editor can honestly show.
- **Firing arcs are measured as sweeps**, how far a mount turns to reach each edge, not as signed bearings: an
  obstruction wholly to port has both edges at positive bearings, and one dead astern is reached by turning
  either way. Every consumer must agree which bound is which — the clamp and the renderer once had them
  transposed consistently, which is invisible while every arc is symmetric. Step 7's interval mask has to
  keep this.

#### Damage model (step 2)

- Anything that comes off a ship is a body that collides, as a severed chunk is.
- Which piece is a ship is settled: a piece with a working core is a ship, and one without is debris,
  currently only a navigational hazard. What the step leaves open is balance — the dials are in §12.

#### Doctrine and orders (step 3)

The remaining pickers and the order weight should follow the shape already there:

- **Doctrine is a block in the blueprint file**, shared by reference and copied only when overridden — the
  same copy-on-write split the engine layout uses. A mount's own block holds only its *differences* from
  its ship's.
- **Targets are chosen by a stack of preferences**, each discarding a candidate or adjusting its score, with a
  discard hiding a target from everything above it. A new picker is a new weight, not a new mechanism.
  Hysteresis (preferring what it is already fighting) is a picker, not flavour.
- **The ship picks a manoeuvre target and each mount picks its own firing target**, through the same stack,
  measured from the gun rather than the hull. Re-picking runs on an interval *derived* from the hull or mount
  rather than configured.
- **An order always outranks doctrine**, which is strictly a fallback: when doctrine landed, only the
  scenarios that give no orders moved.
- **A gun fires at what its barrel was trained on**, recorded when it is trained — the hull turns between
  training and firing, and working the target out afresh at the trigger once had fighters firing over their
  own shoulders.
- **A part is led by its hull's velocity, not its own**; tracking rate is still the part's own.

#### Evolution (step 4)

- **Mutants that fail `blueprintProblem` are refused, not repaired** — a repair rule is a second opinion about
  what a ship is. Edit distance per generation is bounded (§7), so a descendant is recognisably one.
- **One evolution core, importing nothing from the host**, driven headlessly by `npm run evolve` and by its
  page. A run is a JSON file; §5's SharedWorker, React and wa-sqlite stack is not built and nothing so far has
  needed it. It is wanted when a campaign needs to *query* runs.
- **One match scores survival, damage and ground gained together**, so a design has to make the trade
  between fighting and running for the goal. Small free-for-all groups, drawn fewest-meetings-first.
- **The mass budget is dry mass**, the only real cost that exists (§2). When materials arrive (§12) it will
  want to become a budget of materials, which is step 5's currency too.
- What evolution has left open — selection pressure, draw noise, arena size, clever piloting — is in §12.

---

#### Two layers (step 7)

- **The trigger mask covers everything the traverse limit covers**, so the traverse limit never decides
  whether a mount may fire — anything the barrel fouls is also on the round's path. Its only job is which
  way round the mount has to turn.
- **Barrel length buys no reach past an obstruction.** A long barrel pointing past something occupies the
  space a short barrel's round would have flown through. Length matters only the other way: an obstruction
  *beyond* barrel reach stops the round while leaving the barrel free.
- **The mask is bearing-only rather than a ray cast per shot.** It compiles once, and it is the
  conservative model: a mount should not fire along a bearing with its own hull downrange, since misses
  and penetrations both come home. Each sector is widened by the mount's barrel spread and half its bore,
  because a mask measured from the mount's centre let an outer barrel's beam clip its own engine.
- **A shot skips only the module that fired it**, rather than its whole ship, so the mask is all that
  keeps a mount off its own hull. A lit beam is committed for its duty cycle and used to sweep across its
  own engines after its target, so a lit beam's drive stops at the edge of a masked sector.

## 12. Open questions

Deliberately unresolved; decide when they block something.

- **Whether the editor needs a test flight of its own.** A throwaway sim inside the editor, flying the ship
  being edited without leaving the page. The Battle link already takes that ship into a custom battle, which
  is a good enough way into testing it; what an in-editor sim would add is a faster loop, and that is worth
  deciding once the round trip is what slows design down. Whatever it is, it must not grow out of the
  editor's animation (§8's notes on the editor).

- **Which of its main guns a ship should fly to the range of.** A ship flies to the *best* reach among its
  main guns, so marking point defence secondary answers the case of point defence
  out-ranging it. What is left is a battery of guns with different
  reaches: the best, the shortest, or weighted by mass of gun or damage per second. Each changes every
  such ship's standoff, so it wants measuring against the fleet scenarios. A gun's `fireRange` already
  lets a design pull one mount's reach in or out by hand.

- **How far a gun should look for a consort in its line of fire.** It casts for half a second of the
  round's flight, on the reasoning that a gun asking about the whole flight would never fire. That covers
  the consort that has just crossed the muzzle and not the one holding station three intervals ahead: in
  `column`, a gunship's pom-poms look 596 m and their own leader is 627 m in front, so they shoot it. The
  alternative is to cast the whole way to the target, which is honest — the round really does go there —
  and would mean the rear ships of a file genuinely cannot shoot, which is what a line ahead costs in
  reality. It would want measuring against the fleet scenarios before it is taken, since it holds fire
  much more widely than the present rule.

- **Whether a flame should grow with its nozzle's width or with the square root of it.** Linear is the
  physics — a jet runs a fixed number of its own widths — and is what is built, to be looked at before it is
  argued with. It gives the Star Destroyer's mains a 2.4 km flame and a Dinky's engines under 2 m. The
  square root keeps every trend and squashes both ends, to about 400 m and 12 m. One line in `plumeReach`.
- **Braking on the mains between two craft that are both closing.** A craft whose doctrine would turn
  to burn plans its approach on its mains when that gets it there sooner, turn included, and once on that
  curve is held to it. Against something standing still that is quicker into the band and steadier in it
  for every stock hull measured. Two Dinkies closing on each other from 600 m fire later than before (about
  14 and 25 s against 8.5 s), since each flips to brake on a run in that the other is shortening. The
  plan reckons with a target that holds still; reckoning with its closing too is what is left, and
  `BRAKE_FLOOR` in `sim/ships.ts` still stands for the plan with the guns held on.
- **Whether a beam should have an opinion about where it hits.** Each archetype now carries its own
  targeting, and a beam turret's is the one where the obvious default was left untaken. The argument for
  taking it is good: picking a part costs accuracy, a beam turret is the mount that answers what is small
  and quick, and a fighter is already a small thing to miss — so all four aim weights at zero, meaning
  *shoot at the ship*, reads as the honest default for the archetype. Measured, it is not a small change:
  `beamVGun` goes from 123 rounds and 204 hits to 262 and 451, because a beam that stops stripping mounts
  starts boiling through seams and cutting hulls into pieces, and there are then more things to shoot at.
  That is a balance decision about what beams are *for*, and it wants the fleet in front of it rather than
  a place in a change about where a mount's defaults come from. The same question hangs over `hullBeam`,
  which has the same physics and a hull's aiming.
- **Which part a hull points at.** The attack bearing points the battery at the target's centre, led by its
  shot's time of flight. **The Dinky is the worked example**: its gun trains five degrees, so what it
  actually shoots is whatever the *hull* is pointed at. **Which part a hull points at is a setting on the
  ship**, decided by the author against the alternative of deriving it from what the ship's weapons want: a
  hull with several limited-traverse guns has no single answer to derive from. So a hull gets an aim
  preference of its own — the thing this codebase deliberately does *not* have today, a ship choosing a part
  of another ship rather than a ship — and a gun that cannot train far follows it on `focusWeight` alone,
  which is what that weight already does. Until it lands, such a preference belongs on the gun, since on a
  hull it would be a number nothing reads.
- **What a target's presented aspect is worth.** A weapon decides whether to fire from the bounding circle
  of what it is shooting at, so a ship end-on is taken to be as wide as it is long. The error is in the
  forgiving direction — a shot at a hull rather than a shot at nothing — but it means a fleet in line ahead
  is no harder to hit than one abeam, which is a difference that ought to exist. What it needs is the
  silhouette of a hull from a bearing, which the damage model's geometry can already answer for a ray and
  would have to answer for a cone.
- **Whether each core should carry a doctrine of its own.** The editor edits a ship's one doctrine from
  whichever core is selected, which is where it belongs for a ship that has one. A hull cut between two
  cores is two ships (§3's `split`), and those two halves currently fly away with the same doctrine — so a
  ship whose halves are meant to fight differently cannot say so. The shape is already there, since a core
  is a module and could carry a block like any mount; what is not settled is which doctrine a ship with two
  sound cores then flies by, and whether that is worth a rule.

- **How hard armour is: `DE_MARRE_K`.** De Marre's exponents are the physics and are not ours to choose;
  its constant is the *material*, and it is the one number in terminal ballistics that is a decision. It
  stands at 91,460, calibrated so that a 16-inch rifle — a 1,225 kg shell of 0.406 m calibre at 700 m/s —
  gets through 0.40 m of belt, which is the Iowa class against its own protection at battle range.
  Everything else follows: the corvette's 160 mm main gun beats 12 cm, so against the 20 mm walls modules
  carry today every round perforates, and the reinforcement dial spans "paper to that gun" at 1 and
  "immune" at about 6. Whether that is the *game* anyone wants is the open part, and the honest test needs
  the damage model behind it and the GA shooting at it. Move the constant, not the exponents.
- **Two refinements terminal ballistics leaves out on purpose.** The critical angle is one constant at 65°,
  where the literature makes it depend on the plate's thickness relative to the round's calibre — a thin
  plate is easier to skid off than a thick one. And a deflected round is mirrored about the normal, where
  the honest answer is along the face; the two agree at the grazing angles a ricochet actually happens at,
  which is why mirroring is enough for now. Both want test data this project does not have, so one constant
  that is honestly a constant beats two that are honestly neither.

- **Exact scaling laws for parametric modules.** A first cut exists in `sim/modules.ts`, with each
  constant calibrated against real hardware — an RS-25's thrust per unit of exit area, a 16"/50's
  muzzle energy per unit of bore volume — so the figures a ship compiles to can be argued with rather
  than merely preferred. What is *not* settled is whether they make a good game. Two are known soft
  spots: rate of fire, which one constant cannot make plausible for both a battleship rifle and a
  light mount, and the counter-pressures against scale. Enclosed area grows faster than the wall that
  encloses it, so bigger is cheaper per cubic metre, and at present the only pushback is that
  stretching a module costs wall. Damage locality and gun vulnerability were the two intended
  counter-pressures, and both now exist — damage lands module by module and doctrine aims at guns — but
  whether they punish "one enormous module" enough is unmeasured. Expect the GA to say so.
- **A turret's mount is its bank and its loading machinery too, and does not yet pay like one.** A hull gun's
  block sets its rate of fire, since that is where the hoist, the rammer and the heat go: depth in
  calibres of the round, a fixed part of the cycle no machinery shortens, and a ceiling of about four
  times a turret's rate. A turret's mount holds exactly the same gear, and its reload is calibre-only
  — a long turret loads no faster than a stubby one of the same width, and its length is presently
  worth nothing but the barrel the calibre asks for. The asymmetry is deliberate for now rather than
  overlooked: a turret's barrel is *derived* rather than authored, so the same law would arrive as a
  side effect of mount size rather than as a knob anybody chose, and every shipped ship's rate of fire
  would move with it. The same holds for a beam turret, which still runs on the flat
  `BEAM_DUTY_CYCLE` where a hull beam's recovery is a fixed time and so pays for depth. What settles
  both is whether the fleet wants rebalancing at the same time — do them together, since one law over
  both archetypes is the point.
- **What a barrel should cost.** Splitting a turret's bore across `n` barrels trades weight of shell
  for rate of fire, and at present it does so at a discount: the tubes' steel falls away as `n^-3/2`
  while `MECHANISM_MASS_PER_CALIBRE`, being linear in calibre, holds the loading machinery exactly
  invariant — the mount's bore budget sizes it, not how the budget is divided. So a multi-barrel mount
  has a mass floor but no penalty, and it is lighter than the single-barrel mount of the same size.
  Whether that is right is a balance question rather than a physical one, and the exponent on calibre
  is the dial: below linear the machinery total rises with `n`, above it it falls. Shared bracing is
  now the one place a row is cheaper by design, and it only bites past fifty calibres. Let the GA weigh
  in.
- **Barrel harmonisation.** A multi-barrel mount fires its barrels parallel, so a barrel `d` off the
  centreline misses the aim point by `d` at every range — spreading the barrels across the mount face
  made that a metre or two rather than a few centimetres. It costs nothing measurable today, ships
  being far wider than the row, but it is a real effect against small targets, and converging the
  barrels at a chosen range (paying for it at every other range) is a genuine design axis rather than
  a correction.
- **A beam's optics: spot size, intensity, wavelength and what armour does about them.** The beam laws derive an
  aperture, a power and a dwell, and stop there: the damage model spends a beam's power, not its intensity, so
  nothing yet consumes a spot size. What is deferred is one equation and its consequences. A beam leaving an aperture `D` at wavelength
  `λ` spreads at `1.22 λ / D`, so its spot at range `R` is `D + 2.44 λ R / D` and the intensity that actually
  burns is `P` over that area.

  Three things follow, none of them yet built. **Aperture is a two-sided choice**: a small optic concentrates
  far harder at short range and spreads sooner, a large one never concentrates but holds its spot to any range.
  For a 100 MW beam at 1.06 µm, a 0.1 m aperture delivers about 5500 MW/m² at 2 km against a 1 m aperture's 126,
  and the two cross over at roughly 40 km — so the choice is a range band rather than a quality. **Wavelength
  moves the same curve**, halving the spread for half the wavelength, and pays for it in the efficiency of
  generating it, which is waste heat. It is deliberately *not* a parameter yet: with focus unmodelled and no reflective
  armour, its only live consequence would be the cost, so every design would pick the longest wavelength going
  and the knob would be dead. It arrives with the optics, and it brings a beam's colour with it. **Reflective
  armour is the counter**, wavelength-dependent and weak to kinetics, which is why `BeamHits` already reports a
  surface normal: incidence angle is half of what decides whether a beam couples in or skids off.

  Until then `BEAM_APERTURE_FRACTION` is the constant carrying all of this. It is calibrated so that the spread
  range `D²/2.44λ` lands between about 9 km and 190 km across the shipped mounts, which puts the interesting
  part of the curve inside the engagement ranges this game means to reach. It is the number to revisit first
  when intensity acquires a consumer.
- **What a beam turret's duty cycle should be.** `BEAM_DUTY_CYCLE` is a flat fraction standing in for two
  systems that do not exist. (Hull beams have moved off it to a fixed recovery time, `BEAM_RECHARGE_TIME`;
  the turret entry above says why turrets have not.) The bank refills at whatever the ship's plant can spare, which is a power model;
  and the mount can keep firing until its heat sinks are full, which is a heat model and is properly a
  *cumulative* limit across an engagement rather than a per-shot one — a beam mount should warm up over minutes
  and eventually have to stop, not reload. Worth knowing how large that problem is: radiating 300 MW of waste
  heat at 500 K needs something like 88,000 m² of radiator, which is why a laser warship is a hard ship to
  build and why the heat model will have real consequences for hull layout rather than merely for rate of fire.
- **Firing several emitters at once.** A mount with `n` emitters currently fires them in turn, which a gun does
  for good reasons — the loading gear and the recoil are both sequential — and a laser does for none. The
  shared bank then feeds one emitter at `1/n` the power for `n` times as long, so a many-emitter mount holds a
  weak beam for a long time and then sits dead for longer. Nothing is wrong with the
  arithmetic; the sequencing is what a laser has no reason to inherit. Firing them together needs `Ships.fire`
  to emit a salvo rather than a shot, which is a change to the firing loop rather than to the scaling laws.
- **Reflected beams, and the trap waiting at the surface.** A beam that is deflected rather than absorbed
  resumes from the point it struck, which is now a point *on a module's face* rather than on the ship's
  bounding circle — and makes the trap worse rather than better, since a module the beam is sitting on is met
  again by any heading that leads back into it, and a concave hull has faces that look at each other. The
  beam sticks: a grazing deflection — exactly the case reflection exists to model — is the worst one. The tie
  has to be broken deliberately, by nudging the origin along the new heading or by carrying the struck body
  as the resumed beam's owner, and the second is tidier because the store already has an owner field and
  already skips it. Neither is free: the first invents a length scale, and the second stops a beam bouncing
  between two faces of the same concave hull, which is a thing a real one would do.

  Two further pieces belong with it. `Beams.detectHits` casts once per beam, so reflection makes it a loop
  and needs a bound — reflections per beam, energy remaining, or both — or a pair of facing mirrors runs for
  ever. And the store's `pending` flag exists precisely so a struck beam survives for something to decide
  what happens to it; nothing does yet, so today every beam is cleared at the start of the next step and the
  flag is carrying a contract that has no second party. Reflection is that second party.

  What decides whether a beam reflects at all is the target's reflectivity and the angle of incidence, and
  the hit already reports the surface normal for exactly that reason. Where reflectivity lives — a material
  property, per module, per armour facing — is part of the materials question above rather than settled here.
- **How a blueprint is versioned, once there is a campaign.** Editing a design must not silently re-equip
  ships already built to it: §2's Production rule is that a fleet transitions gradually, so existing ships
  keep flying the layout they were built to and only new production uses the revision. That makes a ship in
  the world reference an immutable *revision* rather than a mutable library entry, and the editor's Save
  becomes "publish a revision" rather than "overwrite". The file format leaves room for it — the schema
  field is `formatVersion` precisely so `revision` stays free — but nothing else is decided: whether
  revisions are a linear history or a tree, whether an old revision with no ships left is garbage, and
  whether a refit is a distinct operation from building new.
  Entangled with it: **identity is a ship's name**, so renaming re-identifies. Once revisions are
  referenced by fleets, a rename has to be forbidden, propagated, or treated as a fork. Decide both
  together, at the campaign slice.
- **How hard selection should press.** Standing is worth a fifth at the bottom and one at the top, which
  makes the best of a field of twelve about half likely to breed against a seventh for the tail. Whether
  that is the right pressure is not settled and is not really settleable by argument: too hard and a
  population converges on the first thing that works, too soft and it drifts. Three seeds of a bare-core
  run put ranked and score-weighted selection inside each other's noise — 0.167 against 0.197 on a spread
  of 0.11 to 0.31 — so nothing about *run outcome* chose between them, and what did was the failure modes
  one of them has and the other has not. The same will be true of the floor: it wants a benchmark that can
  tell two runs apart before it is tuned, which is the entry below.
- **How much of a design's score is the draw rather than the design.** A design plays a handful of matches
  and is ranked on the mean, so anything that varies between matches and is not the ship — which opponents
  it drew, which slot it started in, what shoved it — is noise the ranking cannot tell from signal. It is
  the thing that decides how small a difference a run can see, and nothing here measures it.
  What would sharpen it is the trick the yardstick already uses: hold constant whatever can be held
  constant, so two designs are compared under the same conditions rather than under two draws. The match
  geometry is already fair — one ring, everyone equidistant, and one heading for the whole match rather than
  one each — and the remaining variation is the opponents, which is the part a free-for-all is *for*. More
  matches each is the blunt answer and costs time linearly; a stratified draw, where every design meets the
  same spread of opponents rather than a random sample of them, is the sharp one. Worth doing before
  anything is concluded from a small difference between two runs.
- **How clever a pilot should be.** A bare core bred against the goal and nothing else *does* learn to move,
  given three hundred generations and a heading it did not choose — so the question is no longer whether a
  run can start from nothing. What is still true is that a hull with one engine can only use it if it
  happens to point the right way: the allocator fires an engine when the force being asked for has a
  component along its thrust, so a first engine is worth 0.23 on one face and exactly nothing on the other
  three, and mounting it off-centre to give it torque changes nothing measurable. A lineage gets there by
  collecting engines until enough of them point usefully, which works and is slow.
  A cleverer pilot would make every one of them useful. Any off-axis engine can be flown with if you do
  not mind spinning: fire it to start the hull turning, then pulse it whenever the nose comes round to the
  heading you want. That is a real technique and a long way past what this controller does — it holds a
  demanded velocity through a linear allocation, and spinning deliberately is the opposite of everything
  else it is for. The choice is between that and accepting that propulsion is assembled rather than
  invented.

  Two suggestions, neither a decision, for making the spin-and-pulse trick *expensive* rather than
  impossible — so a clever pilot could still find it, but only where it genuinely pays. Both are the
  author's, recorded here rather than acted on. A **throttle rate limit** on engines, and possibly a
  **dead band between off and the minimum throttle**, the way a real engine has one: together they would
  leave the trick working only at lower spin rates and with smaller engines, which throttle deeper and
  quicker than large ones. And allowing parts to be **damaged or severed by the G force of spinning**,
  which prices the spin itself rather than the pulsing. Both would also bear on ships that never try the
  trick, which is the part to think about before building either — a rate limit is a change to every
  manoeuvre, and a spin load is a change to every hull.
- **Whether every effect should count alike in the functional scores.** Thrust, firepower and control are
  each a third, so losing a small gun battery costs what losing every engine does. A design with no guns
  averages over two effects and has none to lose, which it pays for only in damage it cannot do.
- **Function lost to severing is barely credited.** A piece cut off takes its hull capacity with it, and
  that counts as loss nobody delivered, which dilutes the credit of whoever cut the weld.
- **How big an arena should be.** A match's ring is five hundred metres because that is where the shipped
  corvettes fight each other to a finish — put four of them a kilometre apart and they settle at the
  standoff their doctrine asks for and plink, and no match is ever decided however long it runs, so two of
  the three terms in the fitness function have no gradient and a run measures nothing. That threshold is a
  property of the ships, not of the game, so the ring wants deriving from what the entrants can shoot rather
  than being a constant that will be wrong for the first fleet of capitals anybody evolves.
- **What keeping clear cannot do as it stands.** Steering by time to closest approach takes a quarter of the
  contacts out of the Star Wars scene and two thirds out of the column, and leaves two things undone. It is
  one want among several and is *averaged* with the rest, so a craft whose orders say to be where it is
  cannot be shouted down by it however urgent it gets — which is right for a lean and wrong for the last
  half-second. And the room it asks for is a multiple of the two hulls' radii, so two fighters ask for
  forty-five metres of clearance while closing at two hundred metres a second, and fighter-on-fighter
  contacts do not improve at all. Both point the same way: clearance wants to be measured in *time* rather
  than in hull radii, and the urge wants a way to dominate rather than merely to vote. Neither is a large
  change; both want a scene to tune against, and the crowded ones are the Star Wars fleet action and the
  super-swarm.
- **The sealing dials: `SEAL_SPEED`, `SEAL_REACH` and `SEALANT_DENSITY`.** Set so a 20 mm rubber lining closes
  a fragment's pinhole in under a second and a shell's 200 mm gash in ten, and goes no wider than ten times
  its own thickness. A lining closes whether or not fuel is against it, where a real one swells only where
  fuel reaches it; the difference shows only in a tank that empties before its holes close.
- **Which holes a round leaves.** Only the face it went in by, and only where that face is open to space: a
  round on through a bulkhead into the next module, and the hole it makes going out of the far side, open
  nothing. Fuel through a bulkhead would fill the next compartment rather than space, which wants a model
  of compartments; the far side is a second hole the walk has no face for yet.
- **How hard a leak pushes.** The jet leaves at what the tank's pressure gives it, a few tens of metres a
  second, so a shell's gash pushes with about 20 kN, a twentieth of a corvette's manoeuvring engine. Fuel that boils
  as it leaves would go faster and push harder; nothing models what the fuel does once it is out.
- **Whether a grapple is a dock.** Step 9's hold on a wreck is a deliberate dock. Suggested: build it as a
  claw on the ragged-metal weld (`Ships.weld`), with the claw's own rules for what it may grip — or decide
  on purpose that a tether is something else.
- **Whether harvesting wrecks should come before construction.** Once metal has uses (rounds and repair) and
  a grapple exists, harvesting could come straight after step 10, keeping each step small and leaving
  construction, the largest, until last. The order built puts construction first, as the big use metal is
  harvested for.
- **How severed chunks divide ammunition and power.** Which piece goes on being a ship is settled —
  the one holding a working core, and every other piece with one becomes a ship of its own (DESIGN.md §4)
  — and fuel goes with the tank it is in. The interesting case left is a magazine cut off from the gun it
  fed. Nothing consumes either yet, so there is nothing to divide; decide it when stores exist.
- **What scrap and salvage reach are worth: `SCRAP_MASS` and `SALVAGE_REACH`.** They encode an economic
  judgement — what is too smashed to harvest, and how far is too far to go for — against an economy that
  does not exist yet, so they will want revisiting when it does. Worth knowing before tuning them: the
  shipped fleet's *capital* modules weigh five to nine tonnes apiece, and the only modules under a tonne
  anywhere are a fighter's, so the scrap floor reaches fighter debris and nothing else. Culling capital
  wreckage at all is entirely `SALVAGE_REACH`'s doing.
- **More failure modes than a fading capability.** A module carries a list of damage responses and two are
  written: thrust fades and cuts out, rate of fire stretches. What the shape is for, and what is not built,
  is the interesting half — a turret whose traverse jams, leaving it stuck or cut down to part of its arc; a
  barrel broken outright; a magazine that cooks off; dispersion widening with damage, once there is
  dispersion to widen. Those want a *likelihood* per response rather than a curve, rolled on the damage an
  event delivers as well as the total, which needs the world's seeded RNG threaded into the damage pass and
  the rolls taken in a fixed order — determinism is the whole constraint on how that arrives.
- **How much a module can take: `DAMAGE_ENERGY_PER_KG`.** A module stops working when it has absorbed about
  a kilojoule per kilogram of its structure — the energy of its own mass at 45 m/s. It is the sibling of
  `DE_MARRE_K`: that one decides how much energy gets *in*, this one how much a module can swallow, and both
  are dials rather than derivations. What makes them hard to set separately is that armour thickness decides
  the split: against today's 20 mm walls a heavy round overpenetrates and leaves most of its energy on the
  far side, so the figure that matters is what a hit *deposits*, not what it arrived with.
- **A beam bores a tunnel and then shines through it.** A spent module no longer stops a beam, which is what
  lets a beam ship kill anything; the consequence is that a beam holding on one spot eventually reaches
  clear space beyond the hull and stops doing damage at all. Cutting takes some of the sting out of it — a
  beam that has bored that far has been burning the seams along the way, and may well have cut the far part
  free before the tunnel opens — but not all of it. Two ways out, both wanted for their own sake: a
  **heat model**, where the beam heats the wreck it is burning and the heat conducts into what is still
  alive, and **sublimation**, where a module being burned loses mass until it is gone from the layout
  entirely — which is also how matter finally leaves a ship without being severed.
- **A beam aimed at a seam.** A beam cuts the welds its tunnel crosses, but nothing *aims* it at one: the
  gunnery points a mount at a body and the cutting is whatever the line happens to pass through. Deliberately
  choosing a seam — cutting a named piece off a named ship — is a targeting question rather than a damage one,
  and the shape exists: doctrine already weights which *kind* of module to aim at, and a seam would be one more
  aim point beside those. It is the point at which a beam ship stops being
  a gun that burns and starts being a surgeon.
- **Gimballed engines** fit, with one change of variable. A gimbal makes the thrust *direction* an
  unknown, and the wrench then depends on sin and cos — nonlinear, and fatal to fixed columns and normal
  equations. The fix is to solve for the thrust **vector** `(Fx, Fy)` rather than a scalar throttle: the
  force is that vector and the torque is `px·Fy − py·Fx`, both linear again. The nonlinearity moves out of
  the objective and into the constraint set, where `u ∈ [0,1]` becomes `F ∈ sector` — a circular wedge,
  convex for any real gimbal arc. The active-set structure survives: clamping a scalar to an interval
  becomes projecting a vector onto a sector, which is "clamp the angle to the arc, clamp the magnitude".
  - **Slew rate makes this easier, not harder.** A gimbal angle is a *state* that slews toward a target,
    like a turret bearing, so the sector reachable in one step is a degree or two wide and linearising
    about the current angle (`d(θ+Δ) ≈ d(θ) + Δ·d⊥(θ)`) is very accurate. The unknowns become `(u, Δ)`
    with box bounds, which the existing solver already handles.
  - **Cost:** gimballed columns move, so they cannot be precomputed per blueprint. Keep the fixed
    engines precomputed and treat gimbals as a small dynamic addendum — ships have a few gimbals and
    many fixed engines, not the reverse.
  - **The envelope survives exactly.** The achievable set stops being a zonotope, but support functions
    add under Minkowski sum whatever the summands are, and a sector's support function is trivial. So
    `support`, `maxThrustAlong` and `hasFullAuthority` keep working unchanged.
  - It is a good design axis too: one large gimballed engine against many small fixed engines trades
    mass and module count for slower response and a torque coupling that cannot be switched off.
- **Throttle response is currently instantaneous**, which suits small RCS engines and badly misrepresents
  a large main engine. Rate limits belong **inside** the solve as per-engine bounds —
  `uᵢ ∈ [uᵢ⁻ − rᵢ·dt, uᵢ⁻ + rᵢ·dt]` intersected with `[0,1]` — not as a post-processing step. Limiting
  afterwards would break the wrench: fast engines would reach their targets while a slow one lagged,
  leaving a net torque nobody asked for. As bounds it stays a box constraint, so the active set is
  structurally unchanged; generalising means shifting by the lower bound (`u = lo + v`) and subtracting
  `A·lo` from the demand up front, after which the solver is identical.
  - **This constrains one thing now:** the `throttles` array is *per ship*, not per blueprint, and must
    persist between steps for any of this to be possible. `EngineLayout` is shared between every ship of
    a blueprint, so throttle state cannot live there. Do not turn `throttles` into a shared scratch buffer.
- **Binary (on/off) engines** should be handled *after* allocation, not inside it. As a constraint they
  would make the problem mixed-integer — 2ⁿ combinations, non-convex, inexpressible in least squares — which
  is far harder than the continuous version rather than simpler. Instead allocate continuously and let each
  binary engine interpret its throttle as a **duty cycle**, ideally with delta-sigma modulation so the
  rounding error accumulates and is corrected on the following step; that tracks the demanded average much
  more closely than plain pulse-width modulation and stays deterministic. The allocator needs no change, and
  the envelope stays valid as a statement about *average* capability, which is the honest thing to show a
  player anyway.
- **Whether engine allocation needs to be exact.** It currently minimises Σuᵢ² by clamped least squares
  with redistribution, which is smooth and fast but neither propellant-optimal nor exact: measured mean
  shortfall 0.016% and worst 5.4% against randomised, near-adversarial geometry. Two separate upgrades are
  available if either ever matters. Propellant-optimal allocation is a linear program, but its solutions sit
  on vertices, so it burns fewer engines harder and switches abruptly as the demand rotates — cheaper in
  fuel, worse to fly. Exactness means bounded-variable least squares, releasing pinned engines when the
  gradient says they would help *with a line search to guarantee progress*; releasing without the line
  search was tried and made the worst case far worse, because the active set oscillates. Neither is worth
  doing until a ship visibly misbehaves or propellant accounting proves too generous.
  One way it *did* visibly misbehave has been closed in the answer rather than in the search: a pair of
  engines that exactly undo each other could both come out alight, because pinning one at full and never
  reconsidering it left the other free to claw back what it was overproducing. That is taken off afterwards,
  where it is exact and cheap. What remains open is the general shape of the same fault — three or more
  engines wasteful together without any two of them being opposites — which no layout drawn or bred so far
  does, and which is a linear program rather than a loop to find.
- **Whether capitals may mount hull-layer guns.** Not needed for torpedoes — §3 settles those — but it is
  an appealing separate axis. `hullGun` and `hullBeam` exist, have the narrow arcs and heavy bore this
  imagines, and fire in the hull layer, so they are the only guns that can reach a core below deck. What is open is
  whether that earns them a place. Deck turrets are **area**-limited: many of them, arcs unconstrained, but they
  can only strip mounts. Edge-mounted hull-layer guns would be **perimeter**-limited: few, narrow arcs, but
  able to hole a hull directly. Big ships would then have to *specialise* rather than simply scale, and the
  "guns mission-kill, ordnance destroys" line in §3 would become "deck turrets mission-kill; edge guns and
  ordnance destroy", with edge guns paying for it in coverage.
- **Whether a pilot hooked to an enemy should fly as though it were one.** Its mounts shoot at the other
  ship on the body, but the ship-level choice of what to fight still skips anything on its own body,
  since steering towards something at no range means nothing. Worth revisiting if hooked pairs start
  leaving each other alone in ways that look wrong.
- **Whether exhaust should know about layers.** A plume burns every module it reaches, in either layer, and
  a thick engine's exhaust is still blocked by deck structure behind it. Left as it was, because nothing
  yet makes the difference matter.
- **How turret fleets fight craft they cannot see.** A thin engine is in the hull layer only, so a ship
  whose engines are all under a deck across can be disabled only by hull weapons, and a craft built
  wholly of such modules, like the Dinky, cannot be touched by a turret at all. Designs answer it for
  now: the Corvette and Gunship carry hull guns at the bow, and turret tests use fixture ships
  (`tests/fixtures.ts`) with a turret in place of the hull gun. Step 7's exploding shells and fighter
  flag are the answer (§8).
- **What a ship does about an enemy none of its guns can reach.** Choosing what to fight ignores layers,
  so a ship can pick an enemy every one of its mounts finds nothing reachable on. It then holds its band
  round that enemy, holding fire, for as long as the enemy lasts. The alternatives are to pass such an
  enemy over when choosing, to close and ram it where the doctrine allows, or to keep it as a target
  while something else on the same side does the shooting. Which depends on whether an unreachable enemy
  is worth anything to a ship that cannot hurt it — screening, say — so it wants a fleet scenario where it
  happens before it is decided.
- **Engines split by layer, into two archetypes.** A single `engine` kind cannot express the choice the
  weapons layer creates, so it becomes two — a new *archetype* rather than a new coefficient, which is the
  distinction the materials question above already draws.
  - A **thick main engine**: high thrust, efficient, heavy. In the weapons layer, so turrets can strip it.
  - A **thin engine**: small, and therefore low absolute thrust. Turrets cannot reach it.

  **Settled in direction: the hull-layer one is lighter in absolute terms and *worse* per unit of thrust.**
  Lighter because it is smaller; worse because a bank of them must outweigh one main engine of the same
  total thrust. That sign is the whole point, and getting it the other way round would be the exploit
  `modules.ts` warns about in its own words: a hull-layer engine cheaper per newton, with nothing bounding
  how many fit, means every evolved ship is a raft of RCS units and the main engine is never built. The
  reason to fit them is not that they are cheap. It is that gunfire cannot reach them.

  Low thrust need not be stipulated — thrust is already exit area times a constant, and exit area is width
  times depth, so a thin engine gets less exit and less thrust out of the geometry than a thick one. A small throat
  also loses efficiency to its walls (`SMALL_ENGINE_LOSS`), so the thin one pays in fuel as well.

  What the split buys is a better mission kill than "disabled". A ship stripped of its main engines still
  has manoeuvring engines on long moment arms, so it can still *rotate* well while barely translating: a
  fixed battery that can bring guns to bear but cannot close, break off, or dictate range. That is a state
  worth fighting rather than a formality, and it is the drifting hulk §3 wants and the salvage of §8 steps 9 and 13
  feeds on. Worth knowing that `hasFullAuthority()` is called by the editor's stats and tests and never by
  the sim, so a damaged ship failing it costs nothing — it looks like it would matter and does not.
- **How a gun reaches the hull layer at all: proximity fuses.** §3 says HE shells give small guns light hull
  damage and lasers cannot, which is a stipulated asymmetry with no mechanism under it. A fused round has
  one: it detonates at a point, the blast reaches down into the hull layer, and the damage disperses with
  distance, so guns hurt hulls slowly rather than not at all — a gradient rather than the hard immunity §3
  says frustrates players.
  It is worth preferring for a reason beyond that. A laser has no fuse, and therefore no mechanism to reach
  the hull layer, so §3's asymmetry stops being a rule and becomes a consequence. And self-damage stays
  geometric rather than arbitrary: a fuse going off near a target that is close to your own hull will blast
  your own hull, which makes point-blank defensive fire genuinely risky without any "once it is clear of its
  own ship" rule to write.
  Two notes for whoever builds it. The primitives exist: `segmentCircleT` already answers "at what fraction
  along this swept segment do I come within `r` of this point", and the grid already has `queryCircle` for
  the blast. And there is a fork worth deciding early — a **timed** fuse is nearly free, since `interceptTime`
  already computes when the round should arrive, but it detonates in the wrong place on a miss, which is
  exactly when a fuse was supposed to earn its keep; a true proximity fuse costs a check per round per step.
  The cheap middle is to arm on the timer and detonate on first proximity within a short window, so the
  check runs only while armed.
  A fuse is a delivery mechanism and the damage model it delivers into exists, so nothing blocks it.
  **Decided (§8 step 7): timed first**, set shortly before the aim point, bursting into sub-munitions in
  the hull layer. Proximity detonation and an area cloud wait until the timed version shows they are
  wanted.
- **Whether the remaining authored data lives in files rather than in code.** Blueprints do: they are JSON,
  parsed by `sim/blueprintFile.ts`, and the shipped ships go through exactly the validation a stranger's file
  does. What has not moved is `tests/fixtures/scenarios.ts`, and §9's promise of
  `npm run battle -- scenarios/duel.json` — a *scenario* is more than a list of modules, since it also carries
  spawn poses, teams, wells and a seed, so it needs a format of its own rather than a reuse of this one.
  The battle file (`scenarios/customBattle.ts`) is the start of one — fleets, a range, speeds and a seed —
  but has no wells and no orders, so the scripted scenarios cannot be written in it yet.
  No hurry: a fixture that is a compile error when malformed is not costing anything.
- **Whether a module's properties come from its material rather than from a universal constant.** `modules.ts`
  currently fixes both halves of every scaling law: the *form* (structure mass is wall volume times density) and
  the *coefficient* (`HULL_DENSITY = 7800`, which is steel; `CHARGE_ENERGY_PER_BORE_VOLUME = 1.4e8`, which is a
  chemical propellant). Only the form is a law. Freezing the coefficients quietly forecloses better technology
  and materials — a composite hull, a denser shell, an alloy that trades hardness for toughness — which is a
  whole axis of ship design and the natural spine of a campaign's progression. Three tiers, and the test for
  which one a change belongs in is whether the *formula* survives it:
  - **The functional form stays code.** Mass scales with wall volume; cycle time scales with calibre. This is
    what an archetype *is*.
  - **The coefficients become a material**, referenced per module (`{ kind: 'structure', material: 'steel' }`)
    with the properties themselves in a data file. Same archetype, different numbers.
  - **A new technology is a new archetype, not a new material.** A railgun is not a chemical gun with better
    coefficients: its muzzle energy comes from stored electrical energy and rail length, and it drags a power
    supply into the mass budget. Different formula, so new code, with its own material-shaped data beside it.

  Two consequences to settle before building it. Materials must be **priced, not merely better**, or §7's
  evolution picks the best one every time and material choice stops being a decision — the same failure mode as
  the mispriced exponent `modules.ts` warns about, arriving through a different door. Priced in the three real
  currencies, though, not given a points value: a better material is scarcer, or slower to work, or heavier.
  There is no abstract cost number anywhere in this game. And a material file is an
  **input to the golden checksums** exactly as a scenario is, so editing one moves pinned results and needs the
  discipline §9 asks for.
  The damage model already decides penetration from hardness, density and thickness, so per-material
  properties would decide outcomes the moment they exist; §8 step 5's budget of materials is the latest it
  can wait until.
- **What a weld is worth: `JOINT_IMPULSE_PER_AREA`, and the three constants around it.** A weld's section
  is the faces in contact by the thinner wall meeting there, rated as an impulse; `WRECK_STRENGTH` is how
  much of it survives the metal at its ends being wrecked; `SHOCK_REACH` is how far a blow carries before
  it has half spent itself; `HOLE_CALIBRES` is how much wider than itself a round's hole is, which decides
  how many rounds along a seam cut it. Set so that an undamaged hull shrugs off the bumps of a crowded
  battle, a ram takes pieces off, and a gun that keeps putting rounds through one seam cuts it. Dials, with
  `RESTITUTION`, `DE_MARRE_K` and `DAMAGE_ENERGY_PER_KG`, and the ones that decide how the game *looks*
  most directly.
  **The thing they cannot reach** is a shell tearing a sound part off by momentum alone: a 90 kg round at
  900 m/s carries 81 kN·s and a 177-tonne corvette merely drifting at 3 m/s carries 530, so any weld weak
  enough to fail to a shell comes apart when two ships nudge each other. That is why a gun's way through a
  weld is to cut it rather than to shove it, and it is worth remembering before anyone tries to tune it.
- **How time travel in the viewer works — and it needs no stored state.** Determinism pays for this one
  outright: rewinding to any earlier step is *re-simulating* from the seed, not restoring a snapshot. At the
  measured cost of roughly 15 µs per step, winding a 3,000-step battle back to its start is about 50 ms, which
  is interactive, and a ten-minute battle is under a second. So a scrub bar wants no ring buffer of world
  states, and nothing needs to be serialisable for time travel to work. Worth recording because the obvious
  implementation — keep the last N states — is the one that shapes the architecture badly and would be hard to
  undo. If re-simulation ever does become slow, occasional checkpoints are a later optimisation rather than a
  starting design.
  The real consequence is on the other half of the contract. Re-simulation reproduces a battle only if the
  battle is a pure function of its seed and its opening conditions — which stops being true the moment a player
  issues an order mid-fight. So **the command intake has to be recorded as a timestamped log**, and replay
  means feeding those commands back at the steps they arrived. That is the "commands in" half of
  non-negotiable 6 turning out to be load-bearing for something other than what it was written for, and it
  is also exactly what a replay file needs (§8's async fleet-vs-fleet), so the two features want the same
  mechanism built once.
- **How finely a plume should be sampled, and whether it carries heat.** Settled in shape: the flame is
  three rays across the nozzle, each a third of the gas, which is the cheapest count that tells the middle
  of a jet from its edges and is what gives a buried nozzle a thrust penalty to lose in thirds rather than
  an on/off. Whether thirds are a fine enough gradient for §7's search to climb is a question for a
  generation that actually evolves its engine placement; the count is one constant, and nothing but cost
  argues against raising it. Heat was part of the answer when a plume's bite was first settled in
  direction and is still owed, but it waits on there being a heat model to put it in rather than on
  anything about exhaust.
- **What the stock ships' stubby engines should do about their bells.** A wide exit cannot be collimated
  in a short length, so the shipped hulls — whose engines are much wider than they are long — keep well
  under all of their gas pointed aft (`divergence`), and pay for it in thrust and in fuel. The designed answer is a cluster of narrow bells, which the
  nozzle count already gives them; whether the shipped ships should be re-drawn to take it, or left as
  evidence of what the law says about a hull drawn before it, is a decision about the fleet rather than
  about the model.
- **Whether a ship should manoeuvre to bring an engine to bear.** An engine marked as a weapon fires when
  something worth burning is already behind it, and nothing turns the ship to put it there — so it is a
  weapon for what gets behind you rather than one you attack with. Aiming it is a genuinely different
  problem from aiming a gun and is the reason this was left out rather than forgotten: a turret is a small
  mass that trains independently of where its ship is going, while pointing an *exhaust* means choosing a
  heading, which is the same quantity the pilot is already using to keep its guns on target and its range
  band. So the two wants have to be blended rather than one of them winning, and the shape that blend
  wants is probably the same weighted-average of urges §4's pilot already uses for position — a heading
  urge per reason, rather than one `wantAngle` that the last caller wins.
  Worth doing only once there is a hull that wants it. A ram-and-burn strike craft is the obvious one, and
  §3 already says a torpedo is a fighter that crashes into things.
- **Whether the editor should flag a weapon engine that fires into its own hull.** Where an engine's
  exhaust runs into its own ship is worked out when the design is compiled, so the answer is in hand; what
  is missing is that the problem list works on a layout's *specs* rather than on the compiled design. It
  is a real mistake to make — an engine marked as a weapon and buried in the hull is a mount that can only
  ever eat its own ship — and it is the kind of thing the editor exists to catch, since nothing about the
  picture says it.
- **A dead zone on the pilot's attitude hold.** A ship parked on its target bearing still twitches its
  engines continually, correcting an alignment error of almost nothing. Today that is only cosmetic — the
  ships have no fuel to waste — but it is the same behaviour that will empty a propellant tank while
  station-keeping, and §2 makes scarcity one of the things that gives manoeuvre doctrine its teeth. The fix
  is a dead zone taken over *both* orientation error and angular rate, since either alone lets a ship drift
  slowly off and then correct hard, which costs more than holding.
  Worth flagging the tension it creates, because the two look contradictory read side by side. §4 records
  that the *turret* slew law deliberately has **no** dead band, and that the obvious way of adding one leaves
  a brisk mount parked short of where it was asked to point. That reasoning still stands: a turret is a small
  mass on a mount and pays nothing to hold a bearing, so it should hold it exactly. A hull burns propellant
  to do the same thing, so it should not. The rule is that a dead zone belongs wherever holding position
  costs something, and nowhere else.
- **Whether a downed craft's wreck falls onto the deck it was attacking.** Physically it should, and debris
  raining on a capital is evocative; it may also be an irritation. Cheap either way, so leave it until
  there is something to watch.
- **Whether a crush should spread sideways as well as inward.** A collision spends its energy along the
  contact normal, module by module, which folds a nose in convincingly and leaves the metal *beside* the
  impact untouched. A real crush spreads: the plating either side of a rammed bow buckles too. Doing it
  needs a rule for how much reaches a neighbour and a way to walk the connectivity graph outward from the
  contact, neither hard, and neither worth guessing at before there is something to watch it on.
- **Docking ports and claws.** Welding is built for ragged metal only: two bodies meeting at under
  `WELD_SPEED` with a module on either torn past `RAGGED_INTEGRITY` become one body joined by a seam that
  carries no command, and two ships hooked that way both ride it (DESIGN.md §4). A port or a claw is how a
  live ship joins on purpose, with rules of its own — which parts
  mate, whether the pair shares command, how a dock lets go — and is what makes §3's landing a landing.
- **What else decides a ram.** Only range and remaining armament for now, to see how it behaves first.
  Candidates: the target's mass against the rammer's, how much damage either has taken, the doctrine's
  aggression.
- **Ramming a mount without committing.** A fighter going for a turret or a thick module is after
  something in the weapons layer already, so it could ram it without taking the hull layer. Waits on
  targeting picking modules rather than ships.
- **When a ship decides to dock.** Docking is a commit at a low closing speed, but nothing wants to dock
  until fuel gives it a reason (step 8 on). Decide with the docking ports below.
- **What a bigger core is for.** A core needs a cubic metre for its computing and the rest of it is fuel
  tank, so past that size it is a tank that also flies the ship, paying for its computing by the floor it
  fills (`CORE_MASS_PER_AREA`). A tank does the fuel's job for less, so the best core is the smallest that
  will do and every other cubic metre goes into tanks. Something has to grow with a core for size to be a
  choice: more control the more it holds (faster rethinking, more mounts it can direct, command reaching
  further through a battered hull), the other resources' built-in stores as they arrive (§8), or a core
  that is simply harder to kill for being bigger.
- **Whether a ship's centre of mass should move as it burns.** Its mass and inertia fall with the fuel,
  and its centre of mass stays where the full ship's was. Draining every tank in proportion keeps the
  fuel's own centre still, so the true one slides along a single line, but following it means re-centring
  the body and its engine allocation as severing does. Worth doing if a ship flies visibly wrong late in a
  battle.
- **The fuel dials: `EXHAUST_VELOCITY`, `FUEL_DENSITY` and `CORE_COMPUTING_VOLUME`.** A stock ship's fuel,
  tanks and core together, is a seventh to a quarter of its mass and lasts two to eight minutes with every
  engine flat out. Liquid
  methane rather than water because at water's density a deck-high module of fuel outweighs the ship
  around it several times. How many battles a tankful should last is a question for the fleet's balance.
- **How hard fuel is to shoot through.** `FUEL_DRAG_COEFFICIENT` is water's figure for a fast projectile,
  and everything a round loses to it is damage to the tank. A tank is then armour of a sort that thins as it
  empties, which may want weighing against plating once leaks make holing one costly.
- **Whether chamber pressure should buy efficiency.** A real engine gains specific impulse with chamber
  pressure; here the machinery depth behind a throat (`supply` in `moduleStats`) buys flow and nothing
  else. It would be a reason for deep machinery beyond thrust.
- **Whether collision pairing wants an index after all.** §4 says to test every body against every
  other, and at the scale the game is designed for that holds: the 21-ship swarm pays about 3% for
  solid hulls. The 301-ship stress fixture pays **82%** (2.8 s to 5.1 s over 3,000 steps), and almost
  all of it is the 45,000 pair tests per step rather than the geometry behind them. A sweep over one
  axis would cut that to a few thousand without building anything persistent. Not worth doing until
  the game is played at a scale where it shows, which by §3's own scale rationale it should not be.
- Whether fighter-vs-fighter collision matters at swarm density, or whether only capitals and
  turrets are solid. Now measurable rather than speculative: the 301-ship fixture logs 6,642 contacts
  over 3,000 steps, most of them swarm craft brushing each other.
- Ammunition model granularity — per-mount magazines, shared bunkerage, or both.
- Whether the mothership's build priorities are a doctrine blob (so async PvP competes on them) or
  a player-driven queue.
- Concrete values, now that the units are settled: budgets, engagement ranges, timestep, the weld
  dials (`WELD_SPEED`, `RAGGED_INTEGRITY`, `WELD_SETTLE`, `HOOK_SHARE`), edit-distance bounds, muzzle velocities, armour densities, and how hard a plume
  burns (`PLUME_POWER_PER_NEWTON`, chosen for a timescale rather than derived).
- Project name.
