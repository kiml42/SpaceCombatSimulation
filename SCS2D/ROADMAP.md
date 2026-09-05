# Space Combat Simulation — Roadmap

What is not built yet, and what is not settled yet. The design these serve is in
[DESIGN.md](DESIGN.md); the record of decisions already taken is in [DECISIONS.md](DECISIONS.md).

**Status — what exists today — lives in [DESIGN.md](DESIGN.md) and is the single source of truth for it.**
Deliberately not repeated here: two places recording progress means one of them is quietly wrong.

**Three documents, split by why you would read them.** Section numbers are global and stable across all
three, so a reference such as "§12" means the same section wherever it is written — which is why the numbering
inside any one file is not contiguous.

| File | Holds | Read it when |
| --- | --- | --- |
| **[DESIGN.md](DESIGN.md)** | Status, §§1–7 and 9–11 — what the game is, how it works, and why | Deciding how something should behave |
| **[ROADMAP.md](ROADMAP.md)** | §8 build order, §12 open questions | Picking up work, or deferring a decision |
| **[DECISIONS.md](DECISIONS.md)** | The Decision Log | Asking why something ended up the way it is |

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

## 12. Open questions

Deliberately unresolved; decide when they block something.

- **Exact scaling laws for parametric modules.** A first cut exists in `sim/modules.ts`, with each
  constant calibrated against real hardware — an RS-25's thrust per unit of exit area, a 16"/50's
  muzzle energy per unit of bore volume — so the figures a ship compiles to can be argued with rather
  than merely preferred. What is *not* settled is whether they make a good game. Two are known soft
  spots: rate of fire, which one constant cannot make plausible for both a battleship rifle and a
  light mount, and the counter-pressures against scale. Enclosed area grows faster than the wall that
  encloses it, so bigger is cheaper per cubic metre, and at present the only pushback is that
  stretching a module costs wall. Damage locality and gun vulnerability are the two intended
  counter-pressures and neither exists yet, so "one enormous module" is currently under-punished.
  Expect the GA to say so.
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
- **Whether a turret's traverse limit and its firing permission are the same thing.** Today they are:
  `firingArc` returns one half-width about the rest bearing, and a mount may fire wherever it may point.
  Two separate things will break that, and they are worth keeping apart.
  - **Asymmetry.** A single half-width means an obstruction on one beam costs the clear sector on the
    other too. Every ship authored so far is symmetric, which hides it. Small fix: two bounds in the
    turret store instead of one, and a clamp between them.
  - **Traversing through what you may not fire through.** A barrel can usually sweep *past*
    superstructure or a neighbouring mount and reach clear bearings beyond it — it simply must not shoot
    while crossing them. So these are two different quantities. The **traverse limit** is mechanical:
    where the barrel can go before it fouls something. **Firing permission** is a *set* of allowed
    bearing intervals — one gap per obstruction, so a mount ringed by neighbours has several. That is a
    mask, not a half-width, and it is why the `min` over obstructions in `firingArc` can only ever be
    pessimistic: it collapses the set to its narrowest member and throws away every clear sector past
    the first blockage.

  Shape of the fix when it comes: each mount compiles a short sorted list of blocked intervals from the
  layout, alongside its two traverse bounds. §4's `blocked` test becomes an interval lookup rather than a
  comparison against one arc, and target selection has to prefer a target lying in a *permitted* interval
  over merely the nearest reachable bearing. Slew is untouched, and it stays compile-time work — the mask
  is a property of the layout, so it costs a build step, not a per-step one.

  Waiting is still right, for the reason the symmetric version gave: this is the mechanism that makes a
  layout's field of fire legible, and it wants the blueprint editor there to show a player what their
  arrangement bought. The bearing-only assumption is worth revisiting in the same pass — whether a barrel
  clears a low module is the same question asked about height, and both turn on what the barrel actually
  sweeps.
- **Whether blueprints and other authored data live in files rather than in code.**
  `scenarios/blueprints.ts` and `tests/fixtures/scenarios.ts` are hand-written TypeScript. §9 already promises
  `npm run battle -- scenarios/duel.json`, so the intent is settled; what is open is when, and what the format
  is. `ModuleSpec` is plain numbers and a kind string, so the conversion stays mechanical however long it waits,
  which is the reason there is no hurry.
  Do it **with the blueprint editor** (§8 step 1). An editor has to serialise what it produces, so its save
  format *is* the file format; designing one before the other means designing it twice. Two pieces of work come
  with the move and do not exist yet: a **validator**, since today a malformed blueprint is a compile error and
  parsed JSON needs shape checking that `blueprintProblem` does not do, and a **loader outside `sim/`**, which
  has no ambient types and cannot read a file. One format decision belongs to that moment rather than this one:
  angles are `HALF_PI`/`PI` expressions today, and a hand-edited file wants degrees converted at load.
  What the move costs is the prose. `blueprints.ts` explains that the corvette's wings hold its manoeuvring
  thrusters out where the moment arm is worth having *and* foul the bow gun, which is the trade that layout is
  making. JSON has no comments, so that reasoning needs somewhere to go — a design note field in the file, or a
  sidecar beside it — and losing it would leave a set of numbers nobody can argue with.
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
  the mispriced exponent `modules.ts` warns about, arriving through a different door. And a material file is an
  **input to the golden checksums** exactly as a scenario is, so editing one moves pinned results and needs the
  discipline §9 asks for.
  Earliest sensible point is §8 step 2, terminal ballistics and the damage model: hardness, density and
  thickness are what it decides penetration against, so that is where per-material properties stop being
  decoration and start deciding outcomes.
- **Where a hull's connectivity graph comes from.** §4 requires one per hull — severing is how mass leaves a
  ship, and it is the entire return on not having a joint solver — but nothing in a blueprint expresses it.
  `ModuleSpec` is a position and a size, `DesignModule` adds the body-frame transform, and neither says which
  modules hold which. `compileBlueprint` derives mass, inertia, thrust and firing arcs from the layout;
  connectivity is the one structural property it does not derive.
  Derive it rather than author it, for the reason firing arcs are derived: a layout should not be able to claim
  an attachment its shape does not support. Two modules are joined when their boundaries touch — which is the
  near-miss of the check `blueprintProblem` already has, since modules may not *overlap*. Contact is therefore
  exact abutment, a knife-edge no floating-point layout lands on reliably: the corvette and gunship manage it
  only because they are hand-drawn on round numbers, and nothing from the editor or from a mutation will. So
  the rule needs a tolerance, and that tolerance is a game parameter — how close counts as welded — rather than
  an implementation detail.
  What it has to be, beyond a set of edges:
  - **A graph, not a tree.** A ring of structure has two load paths to every part of it, and surviving a cut is
    exactly what makes that layout worth its mass. Parent pointers would make severing trivial and delete the
    design decision.
  - **Edges carry strength**, derived from the contact between the two modules. Without it the graph says which
    joints exist but not which one gives way, and severing has nothing to choose with.
  - **Components are recomputed only on a sever event**, never per step — which is what §4's "damage never
    changes topology" is worth. A flood fill or union-find over a static array is enough, and it must be
    order-deterministic like everything else in `sim/`.

  Two loose ends this exposes. `blueprintProblem` does not currently require a layout to be connected *at all*:
  a module floating clear of the ship compiles, contributes its mass and flies along in formation, and nothing
  will notice until severing exists. That check cannot be written until "joined" is defined, which is this
  question. And when a hull does split, something must decide which component keeps being the ship — its
  controller, its identity, its orders — which is the sibling of the existing question above about how severed
  chunks divide fuel, ammunition and power.
  Do it with the damage model (§8 step 2), the first thing that can sever anything.
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
