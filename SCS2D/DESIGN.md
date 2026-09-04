# Space Combat Simulation — Design

A planar, physics-driven fleet-tactics game with deep ship design, built in TypeScript.
This is the successor to the Unity project in `SpaceCombatSimulation/`, which is archived
in place and no longer developed.

**This is a living document.** Amend it when decisions change, and record the change in the
Decision Log at the bottom. Its job is to stop already-settled questions from being
re-litigated after a gap — most entries therefore record *why*, not just *what*.

---

## Status

- **Built and tested:** deterministic maths (own transcendentals), seeded RNG,
  structure-of-arrays body store with generational handles, kick-drift-kick leapfrog
  integrator, gravity wells, state checksums, a uniform-grid spatial index with segment
  and circle queries, swept-segment projectiles with impact reporting, per-blueprint
  thruster allocation, and kinematic turrets with lead and traverse arcs.
- **Next:** the two hard-coded blueprints and the Canvas2D debug viewer, which
  completes Slice 0.
- **Blocked on:** nothing.
- **Measured:** integration costs ~0.19 microseconds per body-step. Ray queries
  against 140 bodies at 2,000 casts per step cost 0.16 ms through the grid versus
  0.79 ms brute-force — 5x, and about 1% of a 16,667 microsecond frame budget at
  60 Hz. Neither is the bottleneck at this scale; the gap widens with projectile
  count, which is the direction of travel. A whole gunnery step — bodies, index
  rebuild, and projectiles under gravity — costs ~7 microseconds with 9 bodies and
  ~65 rounds in the air.
- **Last updated:** 2026-09-04

---

## 1. Goal

A game I'd enjoy playing and want to show people. Hobby scale is a success; a small
release is the hope. The research/sandbox side that the original project grew into is
kept as a *mode*, not as the point.

**Non-goals:** empire-scale RTS, base building, resource-management-as-main-verb, real-time
competitive multiplayer, photorealistic art, mobile phones.

---

## 2. Game shape

Real-time with pause. Homeworld-structured: a mothership plus a small fleet. Depth lives in
**ship design, target prioritisation and manoeuvre doctrine** — all configurable while paused,
so decisions are never under time pressure.

| Aspect | Decision |
| --- | --- |
| Capitals | ≤ 10, including the mothership. Each one precious; losing one always hurts. |
| Strike craft | Up to ~100. No hard distinction between fighter and guided torpedo — one has a gun, the other a warhead. |
| Production | Edit a blueprint and *future* production uses it. Fleets transition gradually, so design changes are visible as a shifting mix rather than a step change. |
| Doctrine | Editable per craft, with "propagate to all identical craft" as a tactical verb — flip a whole swarm from defensive to aggressive mid-battle. |
| Scarcity | Ammunition and propellant are limited. This is what makes engagement-range and manoeuvre doctrine matter rather than being sliders nobody touches. |
| Orders | Every order is *(target object, allowed distance range, allowed approach-angle range)*, mostly defaulted from doctrine — so issuing one collapses to picking a target. Fixed points in space rarely make sense; orders are relative to objects. |
| Scale rationale | Small numbers are a design requirement, not a technical limit: you must be able to attribute a battle outcome to a design change. |

---

## 3. World model

**Planar simulation, deck-plan projection.** The plane is a deck plan viewed from above —
hull has unmodelled thickness — *not* a cross-section slice.

**Two layers:**

- **Hull layer** — capital structural hull and internals (power, magazines, fuel, computer cores).
- **Weapons layer** — all weapons, all strike craft, all ordnance, all projectiles.

Implemented as **one physics simulation plus a per-capital internals data structure**, not as two
simulations. Penetrating ordnance walks the internals along its ray. There is no moment where a
projectile changes layer, so no discontinuity to reason about.

Rules:

- Guns fire over friendly and enemy decks alike. Per-mount **firing arcs**, derived from the ship's
  own layout, are what constrain them — which is how naval gunnery actually works.
- **Guns mission-kill; ordnance destroys.** Guns strip mounts, sensors and engines and leave a
  drifting hulk. HE shells give small guns light hull damage (lasers cannot), so the asymmetry is a
  *loadout choice* rather than a hard immunity — hard immunities frustrate players.
- A **turret module includes the bit of hull it mounts to**, so the blueprint editor stays a single
  2D view and "is this shootable by guns" is a property of the module you picked.
- Large modules may be flagged as **protruding** into the weapons layer: useful, but gun-vulnerable.
- **Strike craft fly in the weapons layer; a committed craft occupies both.** Under a deck-plan
  projection the weapons layer is *above the deck* and the hull layer is *the deck and below*. A
  strafing run skims the deck, so its gunfire stays in the weapons layer and can only strip mounts and
  protruding modules.

  A craft that **commits** drops to deck height and occupies *both* layers, so it can strike hull.
  Whether to commit is a doctrine choice.

  **Occupancy is added, never swapped.** A committed craft does not leave the weapons layer, so
  everything that could shoot at it still can — every weapon in the game is weapons-layer, and a craft
  that dropped *out* of that layer would become untouchable by CIWS and lasers exactly when it ought to
  be most exposed.

  **Occupancy may only change while clear of every hull**, in either direction. This one rule does a
  great deal of work:

  - It stops a craft committing while already over a capital's interior and striking the citadel
    without ever meeting the armoured edge. An attacker has to come in from outside, so the perimeter
    is always the first thing it reaches.
  - Being symmetric, it governs waving off too: a craft cannot abort while overlapping a hull, and so
    cannot slip back out of one it has already struck.
  - It supplies the fiction for nothing: **commit is arming.** A torpedo leaving a bay cannot commit
    until it is clear of its own mothership, so a launching ship is never endangered by its own
    ordnance, with no special case for it.

  What committing costs is worth stating precisely, because it is *not* extra incoming fire:

  - The craft flies a **predictable terminal course** with its evasion given up, so it is far easier to
    hit. That is a consequence of the doctrine, not of the layer.
  - It can now **collide with turrets** it would previously have overflown, so dense mount coverage
    obstructs a dive just as it obstructs a strafing run.
  - Reaching a hull without ordnance therefore usually costs the craft, which is the right price.

  This is what makes "a torpedo is a fighter that crashes into things" literal — the crash is how a
  craft reaches the hull layer — so a pure kinetic-kill vehicle needs no warhead at all.

  **Ram versus dock needs no new mechanism**: the weld-on-slow-contact threshold in §4 already decides
  it. A craft closing slowly welds — it has landed. One closing fast delivers an impulse — it has
  rammed. Same rule.

  In implementation this is one bit per body — *hull collision enabled* — read by the collision filter,
  plus a guard on changing it. **Projectiles carry no such state**: they are weapons-layer without
  exception, and which layer an impact lands in is pure geometry.
- Strike craft carry **edge-mounted weapons**, because a craft is small enough that its own hull is in
  the way of anything else.
- Docks on capital surfaces let strike craft land, rearm and recharge.

### Why not 3D

- Player-facing modular ship design is a hard, unsolved UI problem in 3D and a pleasant, solved one
  in a plane. The current project dodges this entirely because ships are *grown from a genome* and
  never authored by a human. Making design a player verb inherits the problem.
- RTS control in 3D space remains unsolved 25 years after Homeworld's move-disc.
- Legibility: occlusion and depth ambiguity hide exactly the information needed to judge a design —
  range bands, arcs, who is shooting whom.
- Thruster allocation is 3 constraint equations instead of 6, with a scalar moment of inertia
  instead of a tensor. See §4.
- **Accepted loss:** strike craft have one lateral evasion axis instead of two, and the
  three-dimensional shell of fighters around a capital is gone. Mitigated by nested range bands,
  per-squadron approach angles and orbit directions, and by fast-pass attack profiles (approach,
  fire at closest approach, retreat) which suit a plane well. A fully 3D sequel is a possible
  long-term outcome, not a near-term option.

---

## 4. Simulation model

**Units are SI: metres, kilograms, seconds.** Forces in newtons, impulses in newton-seconds, densities in
kg/m³, accelerations in m/s². Chosen so that thrust figures, delta-v and propellant fractions can be
sanity-checked against real spacecraft — which matters a great deal when the scaling laws below are being
invented rather than measured. Keep battle coordinates in the 10³–10⁴ range (ships 50–200 m, arenas a few
kilometres) where double precision is a non-issue; it only degrades past about 10¹².

**One planar rigid body per ship. Modules are data, not physics bodies.**

- **Connectivity graph** per hull. When damage disconnects a subgraph, spawn a new body for the
  detached chunk inheriting `v + ω × r`, and recompute mass properties on both sides. This gives
  ships breaking in half, losing engines and tumbling, and wrecks to salvage — the good part of the
  old jointed-assembly model — without a constraint solver.
- **Destruction is a state change, not a removal. Matter is conserved.** A "destroyed" module becomes
  *non-functional* — an engine gives no thrust, a magazine holds no rounds, a turret does not fire — but it
  keeps its mass, its place in the layout, and its ability to stop a shell. Mass leaves a ship only by being
  **severed** (the connectivity graph above), never by being shot to nothing.

  This is worth more than its realism:

  - **Wrecked structure is free armour**, which is exactly right. A mission-killed capital is a drifting
    hulk that still soaks rounds, so the mission-kill/kill distinction in §3 gets teeth: stripping a ship's
    function does not make it easier to finish off.
  - **Damage never changes topology.** The connectivity graph is only edited by severing, so it cannot be
    invalidated by a hit — and mass properties, which are expensive to recompute, change only when a chunk
    actually detaches.
  - **The thruster allocation matrix does still need recomputing** when a thruster is destroyed, since the
    geometry of what can push is what changed. Mass properties do not. Two different triggers.
  - **A battered ship gets sluggish rather than lighter**, because it is carrying its own wreckage. That is
    both correct and a better feel than a ship growing nimbler as it loses modules.
  - It gives salvage something to be: the matter is all still accounted for somewhere.

  The open question is whether "destroyed" is even a distinct state, or just the bottom of a continuous
  damage scale — a heavily damaged engine at 10% thrust, a magazine that cooks off, armour that is still
  there but no longer resists as well. Continuous is the more interesting design; it is deferred with the
  damage model rather than decided here.
- **No joints anywhere.** The joint solver was the cost centre, the main obstacle to determinism,
  and the direct cause of the turret-control problems in the old project.
- **Turrets are kinematic**: slew toward the lead-corrected bearing under rate and acceleration
  limits; apply reaction torque to the parent analytically as `−I·β̈`. Three bodies per turret become
  zero, and there are no gains to tune.
  - The slew is **braking-limited**, using the *discrete* safe rate
    `sqrt(2·a·|e| + (a·dt/2)²) − a·dt/2` rather than the continuous `sqrt(2·a·|e|)`, capped at the rate
    that lands exactly in one step. Three properties have to hold together and each obvious fix breaks
    one of the others: no overshoot (the continuous rate is slightly too fast once time is discrete);
    no violation of the acceleration limit (clamping the rate at the last moment to stop overshoot
    breaks it, and that limit is a property of the mount rather than a guideline); and no dead band
    (subtracting `a·dt/2` from the continuous rate stops correcting below `a·dt²/8`, which leaves a
    brisk mount parked short and unable to close a tracking error). The discrete form is zero at zero
    error and strictly positive elsewhere, so it satisfies all three.
  - Tracking uses **velocity feed-forward**: a command carries the rate its bearing is sweeping at, and
    the hull's own angular velocity is subtracted, so holding a world bearing on a turning ship needs
    no separate correction. Without it a turret trails a moving target by about one step of the target's
    angular motion — metres of miss at gunnery range.
  - **Command turrets before advancing the world.** The feed-forward cancels the hull's rotation over
    the coming step, so the slew and the rotation must cover the same interval. Command from a hull that
    has already turned and the turret holds its bearing exactly one step of rotation behind.
  - Firing needs **both** `onTarget` and not `blocked`: a turret whose target lies outside its traverse
    arc slews as close as it can and sits there, on target with respect to its command but not aimed at
    anything.
- **Projectiles are not bodies.** A projectile is `(position, velocity, payload)` in a flat array,
  resolved by testing the swept segment `p → p + v·dt` against the broadphase. Tunnelling is
  structurally impossible rather than patched, it is cheaper than a body per bullet, and it is
  the natural formulation for penetration through internals.
  - **But a torpedo is a body, not a projectile.** Per §2 a torpedo is a strike craft with a warhead in
    place of a gun, so it thrusts, steers, picks targets, obeys doctrine and collides — none of which a
    swept segment can do. The discriminator is **propulsion and guidance, not lethality or size**: a
    one-tonne kinetic penetrator is a projectile, a small guided munition is not. Projectiles are launched
    and thereafter only fall. Beams are neither — a laser is an instantaneous cast with no store and no
    flight time.
- **Impacts are resolved outside ballistics.** A round that hits is parked at the point of contact and
  marked *pending*. A separate **terminal ballistics** model — a pure function of (round, surface,
  incidence) — decides *penetrate*, *embed* or *deflect* and returns a residual; only then does the damage
  model spend that residual walking the internals. Ballistics reports the impact and nothing more, because
  consuming a round is itself an outcome. The split works because the decision needs only *local* surface
  properties (armour thickness, hardness, incidence angle) and none of the damage model's bookkeeping.
  - **Deflections take effect from the following step**, not as a within-step substep, so the projectile
    phase stays one pass and the damage model stays out of the inner loop. Carrying the remaining
    `(1 − t)·dt` as a substep is the richer option if deflection ever needs to chain inside one step; it
    would need a cap on deflections per step, and each re-cast would have to ignore the body just struck.
  - **A round parked exactly on a surface must not re-hit it.** `segmentCircleT` therefore treats only
    *strictly* inside as an immediate hit, and settles the exactly-on-surface case by direction of travel.
    Otherwise a deflected round strikes the same hull again on its very next step, forever.
  - **Two rounds hitting the same module in one step** are both stopped by it, even if the first destroyed
    it. Not a phase-ordering compromise but the physical answer: a wrecked module's matter is still there,
    so it still stops a shell. This falls out for free from the rule below.
- **Collision:** impulse-based, single pass. Stacking and resting contact are artefacts of a
  persistent force pressing bodies together; in space there isn't one, so the hard case never arises.
- **The spatial index is for queries, not collision pairing.** At a few hundred bodies, testing every body
  against every other is cheaper than building an index to avoid it. What is expensive is thousands of
  projectiles, turret line-of-sight checks and blast radii each interrogating a small region every step —
  body count multiplied by query count. A uniform grid (rather than a tree) because everything moves every
  step, so the index is rebuilt in one linear pass with no hierarchy to rebalance, and cell traversal is
  plain ascending order, which keeps damage application order reproducible.
- **Weld on slow contact:** two bodies touching below a relative-velocity threshold (and, where
  relevant, within an alignment tolerance) merge into one compound body with recomputed mass
  properties. One rule covers debris clumping into larger salvage, ship-to-ship docking,
  tractor-beam harvesting terminating cleanly, and strike craft landing on docks — and every case
  *removes* bodies rather than adding sustained contacts. A tractor beam stops pulling at contact
  and welds instead.
- **Thruster allocation** is solved **once per blueprint**, not per tick: given desired body-frame
  force and torque, find non-negative throttles minimising propellant, subject to
  `Σ uᵢTᵢdᵢ = F` and `Σ uᵢTᵢ(rᵢ × dᵢ) = τ`. Three constraints in a plane. Per-tick control is then
  a matrix multiply; recompute only when modules are lost. This is what makes 100 strike craft cheap.
  - **The achievable (Fx, Fy, τ) set is a 3D polytope that can be drawn for the player.** For a game
    whose depth is ship design, showing what a thruster layout actually bought is a headline feature.
    In 3D the envelope is 6-dimensional and undisplayable.
  - This is the exact problem ("RCS engines") that stalled the old project.
- **Integrator:** symplectic (velocity Verlet / leapfrog), fixed timestep, with substepping near
  deep gravity wells. Semi-implicit Euler visibly precesses and spirals orbits.
- **Trajectory prediction** by running the integrator forward on a copy of the state — one sim, not
  a second predictor that disagrees with it.

### Parametric modules

A small set of archetypes with continuous parameters rather than a catalogue of discrete parts:
size, aspect ratio, constant wall thickness (so scale reads honestly), reinforcement level.
Mass from wall volume, capacity from interior area, strength from thickness and reinforcement.

- Balancing becomes **designing scaling laws**, not tuning a table of hundreds of part stats.
- The existing genome already emits continuous scaled numbers, so evolution can search *shape*
  rather than a discrete part index.
- **Watch for degenerate optima.** If capacity scales as r² and mass as r, bigger is always better and
  everyone builds one enormous tank. Counter-pressures: structural stress rising with span, damage
  locality (one big tank means one hit loses everything), and protruding large modules becoming
  gun-vulnerable.
- **The GA is an automated exploit-finder** for these scaling laws — any mispricing gets discovered
  in your own game within a few generations. This is a strong argument for building headless
  evolution early.

### Determinism

Target: **bit-exact on the same machine and build**; code shaped so cross-platform is a swap, not a
rewrite.

- Fixed timestep. Seeded PRNG threaded explicitly — never a global random.
- No `Date.now()`, `performance.now()`, `Math.random()` or wall-clock anything inside the sim.
- **Write our own `sin`, `cos`, `tan`, `atan2`, `exp`, `pow`, `log`, `hypot`** from `+ - * /`
  (~200 lines of polynomial approximation) from day one. These are *explicitly
  implementation-defined* in the ECMAScript spec and differ between V8, SpiderMonkey and
  JavaScriptCore, and V8 has changed its own between versions. `Math.sqrt` and basic arithmetic
  are exactly specified and safe. This is cheap and it buys portable replays and async PvP.
- Determinism pays for: replay and scrubbing ("why did my design lose?"), reproducible evolution
  (otherwise a real fitness gain is indistinguishable from noise), and golden regression tests.

**Cross-platform determinism appears to be already achieved, without fixed-point arithmetic.** As of
2026-09-03 the golden checksums hold bit-identically on x64 Linux, x64 Windows and **ARM64 macOS**, across
Node 20, 22 and 24 — see the CI matrix in §9. That is the expected outcome rather than luck: IEEE-754 mandates
correct rounding for `+ - * /` and `sqrt` on any conforming hardware, and the simulation is built from nothing
else, with the implementation-defined functions replaced by our own.

The practical consequence is that the target above is conservative: portable replays and async fleet-vs-fleet
work today, and the fixed-point option may never need to be exercised.

Treat this as strong evidence, not proof. CI verifies the *current* fixture scenarios, which do not yet exercise
`atan2`, collisions or the thruster solver. The claim gets stronger as scenarios are added — which is a reason to
add a golden scenario alongside each new subsystem rather than at the end.

**Deferred:** light structural stress simulation for plastic buckling under load. Cheap to add later
— the connectivity graph is already the right substrate (nodes and beams, static load solve, sever
or flag on yield). Deferred because long thin hulls are already punished by being easy to sever.

---

## 5. Technical architecture

TypeScript throughout. Four layers, one contract: **commands in, snapshots out.**

```
SCS2D/
  sim/      pure TS. No DOM, no renderer, no timers, no engine types.
            Typed arrays, allocation-free hot loops, deterministic.
            Runs unchanged in the browser and in Node.
  render/   WebGL. Consumes state snapshots. Knows nothing about game rules.
  ui/       React. UI state only. Sends commands, samples telemetry.
  host/     Window and worker lifecycle, tab/window management.
  scenarios/  Data files.
```

- **The sim runs in a `SharedWorker`.** Not only to enable multi-window: browsers throttle
  background tabs to roughly 1 Hz and stop `requestAnimationFrame`, so a main-thread sim freezes
  when its tab is minimised. In a worker it keeps running.
- **Multi-window is nearly free** given that boundary — every window is a view subscribing to
  snapshots. Blueprint editor on one monitor, battle on another, evolution graphs on a third.
  (Fall back to a dedicated worker plus leader election if `SharedWorker` support is a problem.)
- **`SharedArrayBuffer` requires cross-origin isolation** (`COOP: same-origin`,
  `COEP: require-corp`). **GitHub Pages cannot set those headers**; Netlify, Cloudflare Pages and
  Vercel can. Otherwise use `postMessage` with transferable `ArrayBuffer`s, which works anywhere.
- **React holds UI state only** — which panel is open, which ship is selected, editor values.
  Never per-frame sim state: a 60 Hz re-render over hundreds of entities is a performance
  catastrophe. The battle view is a `<canvas>` React mounts and then ignores. Sample selected-ship
  telemetry at ~10 Hz. (React StrictMode double-invokes effects in dev — expect to accidentally
  start two simulations at least once.)
- **Rendering:** procedural 2D vector art generated from each module's shape data, colour and
  metadata. **Triangulate a blueprint once, instance per ship** — the same precompute pattern as the
  thruster matrix. WebGL, because ~4,000 filled paths per frame is beyond Canvas2D.
  - **Exception:** the Slice 0 debug viewer uses Canvas2D. At twenty bodies it's fine and it's a
    tenth of the code. Keep the renderer behind an interface so the swap is contained.
  - Procedural art means **adding a module type costs zero art**, and module variety *is* the
    content. It also guarantees the picture matches the simulation, which matters when the picture
    is the instrument you read design failures from.
  - Later polish is *better procedural* — bevels, panel lines, greebles, decals and logos derived
    from module metadata, damage states from hit points — not hand-made assets bolted alongside,
    which would look inconsistent. Procedural 3D remains possible later as a skin; the sim boundary
    is what keeps that option open.

### Why TypeScript rather than Godot or Unity

- The dominant cost in this game is **application UI** — blueprint editor, internals view, order
  layer, doctrine config, fleet management, evolution graphs — with a real-time canvas in the
  middle. The web platform is the best UI toolchain available.
- Distribution by URL. Sharing a link matters for a project whose goal includes showing people.
- Owning the physics is required for the integrator choice, trajectory prediction, regional physics
  and determinism; no engine allows that. See §4.
- Learning TypeScript, React and WebGL has direct professional value, which on a long-timeline
  hobby project may matter more than any technical factor.
- **Accepted cost:** currently productive in Unity 6 on another project; that productivity is being
  given up deliberately. Also: allocation-free typed-array code is less pleasant than C# structs,
  and this is the main technical tax being accepted.

---

## 6. Data and persistence

- **SQLite via `wa-sqlite` on OPFS**, inside the worker, for evolution and analysis data. SQL is
  genuinely the right tool for "filter individuals by run, order by generation and score" — those
  queries already exist in `DebuggingScripts.sql`. The result is a real SQLite file, openable in any
  SQLite tool.
- **Files on disk** for saves and blueprints. Blueprint sharing as a file or URL-encoded string is
  a cheap and strong social mechanic, and it doubles as the import path for async PvP fleets.
- **Browser storage can be evicted** — by storage pressure, privacy settings, or the user clearing
  site data. Call `navigator.storage.persist()`, keep an "export database" action prominent, and
  prompt after long runs. Anything you'd be upset to lose must end up as a file on disk.
- **No server** until there's a concrete reason. A static site never rots and costs nothing to keep
  alive through dormant periods.

---

## 7. Evolution

Tiered, because the two tiers have completely different sample economics.

**Strike craft — in-battle, continuous.** Craft carry variant configurations; the mothership
produces mutated copies of high scorers during the battle.

Fitness must be **cohort-relative and exposure-normalised**, or it selects for luck, not design:

- Normalise by exposure — damage per second under fire, or per shot fired, not absolute totals.
- Compare only within cohorts: craft that spawned in the same window with the same order type.
- Require a minimum sample count before a variant may reproduce.
- Keep concurrent variants few (4–8) so each accumulates meaningful samples.

*Rationale: a craft's damage dealt and received depends far more on when it spawned and what it was
sent at than on its configuration. Naive scoring selects for soft assignments.*

**Capitals — between-battle, directed search** over doctrine parameters. Small population,
expensive evaluation.

**Campaign enemy: constrained search space, not free-form.** Legible axes only — standoff range,
armour fraction, point-defence fraction, aggression, weapon-type mix — with **bounded edit
distance** per generation (at most K parameters changed, each by at most X%, at most one module
added or removed). Variants arrive **named**, using the existing species/subspecies taxonomy
generated from the module tree. The target is TIE-fighter-variant family resemblance: obviously the
same lineage, obviously specialised differently.

*Rationale: unconstrained evolution produces inventive, illegible ships — delightful in a sandbox,
useless as an antagonist. If the enemy gets quietly 5% better nobody notices, and the headline
feature becomes invisible.*

**Free-form genome search** — the circular genome, jumps, emergent species — is retained for the
**sandbox mode**, where weirdness is the entertainment.

**Scheduling and fairness:**

- Run the next enemy generation in **workers during the current battle**, not in a loading screen.
  A browser game with procedural art has nothing to load; a fabricated progress bar would be worse
  than free.
- **Evolve against a distribution**, not a point: the current fleet plus perturbations plus the last
  few missions' fleets, so counters generalise rather than snipe.
- **Select for "better than last generation"**, not "optimal against the player".
- **Lag by a mission**, so a new idea gets a window in which it works.
- **Surface it as intel** — "the enemy is fielding more armour". Adaptive opposition is fun exactly
  when it is visible and anticipatable; invisible adaptation reads as cheating.
- Let the player inspect captured enemy designs, including a **diff against the previous variant**.

---

## 8. Build order

**Slice 0 — "two ships fight, and I can prove it's deterministic."**
Pure sim module: fixed timestep, planar bodies, symplectic integrator, uniform-grid broadphase,
swept-segment projectiles, kinematic turrets, per-blueprint thruster allocation, hit points,
connectivity severing, weld-on-slow-contact, seeded PRNG, own transcendentals. Two blueprints
hard-coded. One target-picker stack (proximity, line-of-sight, correct-hemisphere) ported in design
from the old project. Crude Canvas2D viewer with pause and time scaling. A Node test running a fixed
battle and asserting the outcome bit-for-bit.

*Why first: it attacks the real risks (does planar Newtonian combat feel good? do the scaling laws
hold?) rather than the known ones; it keeps the sim boundary pure by construction, because there is
no DOM to leak; and it puts something on screen within days, which is what buys the next session.*

Then, in order:

1. **Blueprint editor** — parametric modules; ships stop being hard-coded.
2. **Terminal ballistics and the damage model** — armour properties exist once modules are parametric, so
   this is the first point at which a real answer is possible. Terminal ballistics decides
   penetrate/embed/deflect from local surface properties and returns a residual; the damage model spends
   that residual walking the internals. Until then, Slice 0 stands in with a flat "everything penetrates
   and is absorbed", which is enough to watch ships come apart but tells you nothing about armour design.
3. **Doctrine and orders** — make configuration visibly change behaviour.
4. **Headless evolution and analysis** — balance testing plus sandbox mode.
5. **v1: skirmish** — fixed fleet budget, designed scenarios, shareable by URL. *This is the first
   thing worth giving people to play.*
6. **Salvage and in-battle construction** — wrecks from the current battle as the resource. The
   natural bridge to an economy: no map features needed, and it ties income directly to combat.
7. **Mining and the two-resource economy** — metals for hulls, volatiles for propellant, so maps can
   have economic character and scarcity changes behaviour. *Note: this is a re-balance, not an
   addition — it lengthens battles and replaces "did I spend 500 points well?" with "did I manage
   income well?". Scenarios will need revisiting.*
8. **Campaign** — Homeworld-shaped, with the adaptive enemy. Last, because it's mostly *authoring*
   (scripted missions, pacing, narrative), which is the largest volume of work in the least-proven
   discipline.

**Scenario packs** are the cheapest way to make it a game with goals rather than a sandbox, and they
teach the mechanics. Each scenario is a data file, not code.

### Multiplayer

- **Async fleet-vs-fleet is nearly free** and stays open: a fleet file (blueprints + doctrine +
  build priorities) plus a seed, run deterministically, produces a replay both sides can watch.
  No server, no netcode, no rollback. The variant where the budget arrives as *starting resources on
  a mothership with build priorities* is better than a pre-built fleet, because build doctrine
  becomes part of what's being competed on. Requires portable determinism — hence own transcendentals.
- **Real-time PvP is ruled out**: it is incompatible with pause-to-think, which is core.
- **Co-op** is the only sensible real-time shape, and it's also the easiest — everyone pauses together.
- Nothing is being built for multiplayer now, but nothing forecloses it: the pure sim, fixed
  timestep, explicit seeding and commands-in/snapshots-out contract *are* the lockstep architecture.

---

## 9. Practices

Five things, and deliberately nothing more — plus a sixth held back until there is something to show:

1. **Golden battle tests from Slice 0.** Fixed scenarios with bit-exact pinned outcomes. This is the
   entire return on buying determinism: after a gap, one command tells you the sim is intact.
   Without it you'll be afraid to touch the physics, which is where the interesting work is.
2. **This document, kept current**, with the Status section at the top actually updated.
3. **CI running tests on push**, so the repo reports its own state without an environment setup.
   `.github/workflows/ci.yml` runs the suite on **Linux across Node 20, 22 and 24, plus Windows and macOS on
   Node 24**.
   The Node axis is not redundancy: the golden tests pin exact checksums, so passing them on three V8 versions is
   what actually verifies the hand-written transcendentals are doing their job. A row that passes on one Node and
   fails on another means determinism has broken across engine versions — the failure mode that ruled out an
   engine's built-in physics in §11. The Windows row is there for a different reason: development happens on
   Windows and the *tooling* is OS-sensitive (path separators, line endings), so it catches a break in either
   direction. Rows run in parallel and the repository is public, so extra rows cost neither time nor money.
   Path-filtered to `SCS2D/**`, so tinkering with the archived Unity tree queues nothing.

   **The macOS row is the ARM one, and the most valuable of the five.** It is the only GitHub-hosted runner on a
   different CPU architecture, so it is the evidence that the arithmetic is genuinely platform-independent rather
   than merely consistent across x64. Its consequence is recorded in §4: the golden checksums holding there means
   cross-platform determinism is *already* true in practice, not just a possible later upgrade. Do not delete
   this row to save time — the five run in parallel and cost nothing, and losing it would quietly downgrade a
   verified property to an assumed one.
4. **Single-command headless runs** — `npm run battle -- scenarios/duel.json`. Re-entry from a cold
   checkout should be one command.
5. **A `CLAUDE.md`** for this project.
6. **A GitHub Pages preview deploy — to be added as soon as there is something worth showing off.**
   Not yet: there is no viewer to load. Once Slice 0's viewer draws a battle, add a job to `ci.yml` that
   builds `SCS2D/` and publishes it to Pages on green master. The repository is public, so Pages costs
   nothing, and the point of it is the URL: the game becomes something to open on a phone or hand to
   someone, instead of something that needs a checkout and a toolchain. It is also the only honest way to
   try the real thing — worker boundary, host lifecycle, touch input — on a device that is not the
   development machine. A cloud dev container has no inbound route to its dev server, and a single-file
   bundle would drop exactly the worker boundary §5 is built around, so neither substitutes for this.

Two mechanisms enforce the non-negotiables automatically, so they do not depend on remembering them:

- **`sim/tsconfig.json` gives the simulation no ambient types** (`lib` omits DOM, `types` is empty), so
  `window`, `document`, `console`, `process` and every Node API are compile errors inside `sim/`.
- **`tests/architecture.test.ts` scans the simulation's source** and fails on any reference to `Math.` outside
  `sim/math.ts`, on the implementation-defined `Math` functions anywhere, on host globals, and on imports that
  escape `sim/`. Comments are stripped first, so documentation may discuss a forbidden API. This catches the
  class of violation the compiler cannot: `Math.sin` type-checks perfectly and silently destroys replay.

**Anti-recommendation:** no elaborate tooling before the doctrine/orders slice. Editor
infrastructure, asset pipelines and clever abstractions are the most seductive form of
procrastination available to a programmer and they feel like progress.

---

## 10. The old Unity project

Left in `SpaceCombatSimulation/`, pinned at Unity 2022.3.15f1, **not** upgraded and not maintained.
Installed editors on this machine are 6000.3.2f1 and 6000.3.9f1 — **opening it with either converts
the project in place, irreversibly**. To tinker, either install the pinned editor via Unity Hub or
do the conversion on a branch and never merge it.

Nothing ports as code: 12,685 lines across 158 files, 120 of which reference `UnityEngine`, plus 106
prefabs and 12 scenes that could only be re-authored. What ports is the **design**. Worth reading
rather than reinventing (paths relative to repo root):

| What | Where |
| --- | --- |
| Circular-genome-with-jumps encoding | `SpaceCombatSimulation/Assets/Src/Evolution/GenomeWrapper.cs` |
| Competitor selection (fewest matches first, avoid repeat pairings) | `SpaceCombatSimulation/Assets/Src/Evolution/Generation.cs` |
| Species/subspecies naming from the module tree | `SpaceCombatSimulation/Assets/Src/ModuleSystem/ModuleRecord.cs` |
| The *taxonomy* of target pickers — proximity, approaching, hemisphere, line-of-sight, mass, previous-target, looking-at, ship-type, has-tag | `SpaceCombatSimulation/Assets/Src/Targeting/TargetPickers/` |
| Priority-ordered picker stack (ascending priority; a low-priority discard hides targets from higher ones) | `SpaceCombatSimulation/Assets/Src/Targeting/TargetPickers/CombinedTargetPicker.cs` |
| Spawn positioning, orientation, velocity | `SpaceCombatSimulation/Assets/Src/Evolution/MatchConfig.cs` |
| Evolution schema and analysis SQL | `SpaceCombatSimulation/Assets/StreamingAssets/CreateBlankDatabase.sql`, `DebuggingScripts.sql` |
| Roadmap and known-issue history | `ToDo.txt` |

Specific failures worth not repeating:

- `Turret/UnityTurretTurner.cs` drives a `HingeJoint` motor with a pure proportional controller on
  velocity, and `Turret/TurrertTurningMechanism.cs` hands the gains to the **genetic algorithm** to
  search. Asking a GA to find stable PD gains for a jointed chain through a physics solver produces
  exactly the huge torques and damping forces observed. Turrets are kinematic now.
- `Controllers/HighSpeedProjectile.cs` lets Unity move a rigidbody clean through its target, then
  raycasts the swept segment afterwards and teleports back to the hit point. Right algorithm, wrong
  layer. Projectiles are swept segments now.
- `ObjectManagement/TimeDialationDevice.cs` drives the *global* `Time.timeScale` and auto-scales from
  render frame time, which is why "Autotime doesn't work with batchmode" is in `ToDo.txt`. Sim speed
  is now "how many fixed steps per rendered frame", identical headless and at 100×.

**Deletion trigger:** delete the Unity tree once the new sim runs an evolution generation headlessly
and the old files have stopped being opened. Otherwise it lingers as a guilty artefact.

---

## 11. Rejected alternatives

Recorded so they aren't reopened without new information.

| Rejected | Why |
| --- | --- |
| Modernise the Unity project | Nothing ports; the RTS is ~100% new work regardless; the 2022.3 → 6.3 upgrade is an unrewarding slog paid for a codebase being replaced. |
| Stay 3D | Player-facing 3D modular ship design is unsolved; 3D RTS control is unsolved; occlusion hides the information needed to judge designs; 6-DOF thruster allocation and an undisplayable envelope. |
| Strict single plane, perimeter weapons only | Weapon frontage grows as r while internal area grows as r², so big ships end up worse-armed per tonne — directly attacking the "another capital is a big deal" fantasy. |
| Two genuinely separate physics planes | Collapses to one sim plus an internals structure with identical expressive power and a fraction of the machinery. |
| Keep jointed module assemblies | The joint solver is the cost centre, the determinism obstacle, and the cause of the turret problems. Connectivity-graph severing gives the good part without it. |
| Engine physics (Box2D via Unity or Godot) | Deterministic only for an identical binary on an identical platform, and not across engine versions — one editor upgrade silently invalidates every replay and regression test. Also no choice of integrator, no trajectory prediction, no regional physics. |
| Godot 4 with C# | Genuinely close second, and MIT solves the licensing concern. Lost on UI toolchain, distribution by URL, and professional learning value. |
| MonoGame / Silk.NET + Dear ImGui | ImGui is excellent for tools and will make a game you want to show people look like a debug build. |
| Raster sprites | Rotating ships carry baked highlights around under a directional star; fixing it means normal maps, which is 3D work in disguise. |
| 3D meshes | Art cost per module gates content, and module variety *is* the content. There were only ever 3 mesh files in the old project; there is nothing to preserve. |
| Canvas2D for the real renderer | ~4,000 filled paths per frame is past where Canvas2D falls over. (Kept for the Slice 0 debug viewer.) |
| Hand-modelled hero ships alongside procedural ones | Looks inconsistent, not aspirational. Polish is *better procedural*. |
| Evolution in a loading screen | Procedural art means there is nothing to load; a fabricated progress bar is worse than free. Run it in workers during the current battle. |
| Free-form evolution for the campaign enemy | Produces illegible weirdness. Kept for the sandbox. |
| Real-time PvP | Incompatible with pause-to-think. |
| A backend server | Hosting, auth and sync are ongoing work and cost for a project that goes quiet; a static site never rots. |
| Campaign first | Mostly authoring — scripted missions, pacing, narrative — in the least-proven discipline. Skirmish is a complete loop and a better environment for the adaptive enemy anyway (hundreds of battles, not fifteen). |

---

## 12. Open questions

Deliberately unresolved; decide when they block something.

- Exact scaling laws for parametric modules (mass, capacity, strength) and the counter-pressures
  that stop "one enormous tank" being optimal.
- How severed chunks divide fuel, ammunition and power.
- Whether module destruction is a discrete state or simply the bottom of a continuous damage scale (§4).
- **Gimballed thrusters** fit, with one change of variable. A gimbal makes the thrust *direction* an
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
    thrusters precomputed and treat gimbals as a small dynamic addendum — ships have a few gimbals and
    many fixed thrusters, not the reverse.
  - **The envelope survives exactly.** The achievable set stops being a zonotope, but support functions
    add under Minkowski sum whatever the summands are, and a sector's support function is trivial. So
    `support`, `maxThrustAlong` and `hasFullAuthority` keep working unchanged.
  - It is a good design axis too: one large gimballed engine against many small fixed thrusters trades
    mass and module count for slower response and a torque coupling that cannot be switched off.
- **Throttle response is currently instantaneous**, which suits small RCS thrusters and badly misrepresents
  a large main engine. Rate limits belong **inside** the solve as per-thruster bounds —
  `uᵢ ∈ [uᵢ⁻ − rᵢ·dt, uᵢ⁻ + rᵢ·dt]` intersected with `[0,1]` — not as a post-processing step. Limiting
  afterwards would break the wrench: fast thrusters would reach their targets while a slow one lagged,
  leaving a net torque nobody asked for. As bounds it stays a box constraint, so the active set is
  structurally unchanged; generalising means shifting by the lower bound (`u = lo + v`) and subtracting
  `A·lo` from the demand up front, after which the solver is identical.
  - **This constrains one thing now:** the `throttles` array is *per ship*, not per blueprint, and must
    persist between steps for any of this to be possible. `ThrusterLayout` is shared between every ship of
    a blueprint, so throttle state cannot live there. Do not turn `throttles` into a shared scratch buffer.
- **Binary (on/off) thrusters** should be handled *after* allocation, not inside it. As a constraint they
  would make the problem mixed-integer — 2ⁿ combinations, non-convex, inexpressible in least squares — which
  is far harder than the continuous version rather than simpler. Instead allocate continuously and let each
  binary thruster interpret its throttle as a **duty cycle**, ideally with delta-sigma modulation so the
  rounding error accumulates and is corrected on the following step; that tracks the demanded average much
  more closely than plain pulse-width modulation and stays deterministic. The allocator needs no change, and
  the envelope stays valid as a statement about *average* capability, which is the honest thing to show a
  player anyway.
- **Whether thruster allocation needs to be exact.** It currently minimises Σuᵢ² by clamped least squares
  with redistribution, which is smooth and fast but neither propellant-optimal nor exact: measured mean
  shortfall 0.016% and worst 5.4% against randomised, near-adversarial geometry. Two separate upgrades are
  available if either ever matters. Propellant-optimal allocation is a linear program, but its solutions sit
  on vertices, so it burns fewer thrusters harder and switches abruptly as the demand rotates — cheaper in
  fuel, worse to fly. Exactness means bounded-variable least squares, releasing pinned thrusters when the
  gradient says they would help *with a line search to guarantee progress*; releasing without the line
  search was tried and made the worst case far worse, because the active set oscillates. Neither is worth
  doing until a ship visibly misbehaves or propellant accounting proves too generous.
- **Whether capitals may mount hull-layer guns.** Not needed for torpedoes — §3 settles those — but it is
  an appealing separate axis. Deck turrets are **area**-limited: many of them, arcs unconstrained, but they
  can only strip mounts. Edge-mounted hull-layer guns would be **perimeter**-limited: few, narrow arcs, but
  able to hole a hull directly. Big ships would then have to *specialise* rather than simply scale, and the
  "guns mission-kill, ordnance destroys" line in §3 would become "deck turrets mission-kill; edge guns and
  ordnance destroy", with edge guns paying for it in coverage. The cost is a second mounting concept in the
  blueprint editor, so decide it when building the editor rather than before.
- **Whether a downed craft's wreck falls onto the deck it was attacking.** Physically it should, and debris
  raining on a capital is evocative; it may also be an irritation. Cheap either way, so leave it until
  there is something to watch.
- Whether fighter-vs-fighter collision matters at swarm density, or whether only capitals and
  turrets are solid.
- Ammunition model granularity — per-mount magazines, shared bunkerage, or both.
- Whether the mothership's build priorities are a doctrine blob (so async PvP competes on them) or
  a player-driven queue.
- Concrete values, now that the units are settled: budgets, engagement ranges, timestep, weld
  velocity threshold, edit-distance bounds, muzzle velocities, armour densities.
- Project name.

---

## Decision Log

| Date | Change |
| --- | --- |
| 2026-09-02 | Initial version. All decisions in §§1–11 settled in a single design session, superseding the 2017–2021 Unity project. |
| 2026-09-03 | Slice 0 foundation built. Added the two automatic enforcement mechanisms to §9 (empty `types` in `sim/tsconfig.json`, and the source-scanning architecture test) — the design called for the purity boundary but not for how it would be held. |
| 2026-09-04 | Kinematic turrets built, replacing the archive's worst mechanism (GA-searched PD gains driving hinge motors, §10). Braking-limited slew with velocity feed-forward, no gains. Three findings recorded in §4, each of which cost an attempt: the braking rate must be the *discrete* safe rate, since the continuous one overshoots, clamping the rate to stop that breaks the acceleration limit, and subtracting half a step leaves a dead band that a brisk mount parks inside; tracking needs feed-forward, without which a turret trails a moving target by a step of its angular motion and lags a rotating hull entirely; and turrets must be commanded *before* the world advances, or the slew and the hull's rotation cover different intervals. |
| 2026-09-04 | Recorded in §12 how thruster allocation extends, so it need not be re-derived: **gimbals** work by solving for the thrust vector rather than a scalar throttle, which keeps the wrench linear and turns the bound into a sector projection; **throttle rate limits** belong inside the solve as per-thruster bounds, never as post-processing, which would break the wrench; and **binary thrusters** belong after it as a duty cycle with delta-sigma modulation, since as a constraint they would make the problem mixed-integer and far harder rather than simpler. Also noted the one thing this constrains today: the throttles array is per ship and must persist between steps, so it cannot become shared scratch. |
| 2026-09-04 | Thruster allocation built. Three findings worth keeping: the torque row must be **preconditioned** (mount arms are metres, so torque outweighs force by ~10⁴ in the normal equations, and once thrusters pin the solve quietly fits torque and ignores force — 75% shortfall on achievable demands); the normal equations must **switch form** with the number of free thrusters, `A Aᵀ` when underdetermined and `Aᵀ A` when fewer than three remain, since the 3×3 form is singular there; and only the **worst violator** may be pinned per pass, because pinning all of them collapses a nine-thruster layout to two and never reconsiders. Together these took the worst-case shortfall from >100% to 5.4%, mean 0.016%. |
| 2026-09-03 | Tightened the commit model (§3), which had two holes. A craft could commit while already over a capital's interior and strike the citadel without meeting the armoured edge; and a craft that *moved* to the hull layer would stop being hittable by CIWS and lasers exactly when it should be most exposed. Fixed by making occupancy *added, never swapped* — a committed craft is in both layers — and by allowing occupancy to change only while clear of every hull, in either direction, which also governs waving off and gives "commit is arming" for free. Corrected the earlier claim that the transition is an event rather than a state: true of projectiles, false once commit exists, which is one bit per craft. Also corrected the unearned claim that committing draws more fire — every weapon is weapons-layer, so the real costs are a predictable terminal course and being collidable with turrets. |
| 2026-09-03 | Resolved how a torpedo reaches a hull (§3). A collision with a hull is a hull-layer event, projectile fire is a weapons-layer event, and nothing migrates between layers. A strafing run skims the deck; a terminal dive strikes it. So a kinetic-kill vehicle needs no warhead, "a torpedo is a fighter that crashes into things" becomes literal, and overfly-versus-commit becomes a doctrine choice priced in evasion. Ram versus dock needed no new mechanism — the §4 weld threshold already decides it. Capital hull-layer edge guns were kept as a separate open question, since torpedoes do not need them. |
| 2026-09-03 | Units locked to SI (§4), removing the open question. Terminal ballistics and the damage model became build-order step 2 (§8), positioned after the blueprint editor because armour properties only exist once modules are parametric. And destruction became a *state change rather than a removal*: a wrecked module keeps its mass and still stops shells, so matter is conserved, damage never edits the connectivity graph, and wreckage is free armour — which also answers the two-rounds-one-step question physically rather than by phase ordering. |
| 2026-09-03 | Impact resolution split out of ballistics (§4). A round that hits is parked and marked pending rather than consumed, so terminal ballistics — penetrate/embed/deflect, a pure function of local surface properties — can live outside the projectile step and the damage model can stay out of the inner loop. Required adding projectile mass, and `t` plus the surface normal to the hit record. Found and fixed the exactly-on-surface case that would have made every deflection re-hit its own hull. |
| 2026-09-03 | Swept-segment projectiles added. Impacts are *reported*, not applied: ballistics fills a hit buffer and the damage model drains it, so what a hit does to a hull is decided elsewhere. Projectiles get plain indices rather than generational handles, because nothing holds a reference to a round across steps. Scenario fixtures became a step/checksum pair so a golden scenario can pin more than a world; the `orbit` and `tumble` checksums were unchanged by that refactor, which is what confirmed it was behaviour-neutral. |
| 2026-09-03 | Uniform-grid spatial index added. Recorded in §4 that it is a *query* structure, not collision pairing: at a few hundred bodies all-pairs is cheaper than indexing, and the grid earns its place against thousands of ray and radius queries per step. |
| 2026-09-03 | CI added, and it moved a §4 assumption: golden checksums hold bit-identically across x64 Linux, x64 Windows and ARM64 macOS on Node 20/22/24. Cross-platform determinism was filed as a deferred upgrade needing fixed-point arithmetic; it appears already true with doubles. Target left conservative, evidence recorded. |
