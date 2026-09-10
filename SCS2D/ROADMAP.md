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

## How this document is maintained

**Nothing here is ever ticked off.** No "done" markers, no strikethrough, no ✅. Status records what exists,
and a second progress record in this file would be the one that goes stale — nobody re-reads a roadmap after
a merge. An entry is either still doing work here or it is gone.

The two sections leave by opposite rules, because they are opposite kinds of thing.

**§8 is an ordering argument, not a task list.** Almost every step justifies its position by reference to the
ones before it — armour properties only exist once modules are parametric, the campaign comes last because it
is mostly authoring. Delete a completed step and the next step's reasoning dangles from a premise that is no
longer written down. So a step stays while it still explains something about work *not yet done*, whether or
not it is finished. It leaves only once that reasoning has been fully cashed: when nothing remaining depends
on knowing why it came where it did. If the argument has lasting value beyond the sequencing — a statement
about how this project is approached rather than about what to build next — move it to DESIGN.md §1 or §9
rather than deleting it. Otherwise DECISIONS.md already has the record.

**§12 empties on answer, and this one is strict.** An answered question is a decision. Leaving it here does
not merely clutter, it misinforms: anything in §12 reads as still open, so a settled question left in place
invites it to be re-litigated — which is the exact failure these documents exist to prevent. Remove it and
put the answer in DECISIONS.md, in the same change that settles it.

The division across the three files, then, is: **what is not done and not settled** here, **what exists** in
Status, **what happened and why** in DECISIONS.md. Nothing about the past needs to live in this file once its
reasoning is spent.

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
5. **v1: skirmish** — a fixed budget of *materials* rather than of points (§12), designed scenarios,
   shareable by URL. *This is the first thing worth giving people to play.*
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

### Slice 1 — blueprint editor, first iteration

Specified but not built. §8 step 1, scoped down to one iteration: **lay out a ship, see what the layout
bought, save it, get it into a file.** Flying what you built is deliberately the *second* iteration.

**What the player does.** Opens a separate page, picks a ship from a library or starts a new one, drags
modules around a canvas, and watches the numbers change. Modules are placed and sized by direct
manipulation — drag to move, corner handles to resize, a handle to rotate — while the values that are not
spatial (reinforcement, barrel count, notes) are typed into a panel for the selected module. Position snaps
to a grid and rotation to 15°, with a modifier held to escape both. Undo and redo throughout.

**Assemblies are how a ship stops being edited twice.** A blueprint holds a table of named groups of
modules, and places them by reference — so the gunship's eight lateral thrusters are one thruster placed
eight times, and making them all bigger is one edit with no state in which seven of them are. An assembly
of a single module is the ordinary shared-part case and deliberately not a separate concept; an assembly
containing other assemblies is what lets a whole wing, or a whole side of a ship, be one thing.

An instance says only *where*: position, facing, and whether it is reflected. It cannot override any value
of the assembly it places, so "linked" means identical with no exceptions to track, and wanting one copy
different means forking it into its own assembly — an explicit act rather than a quiet divergence.

**Reflection is what replaces a mirrored editing mode.** Symmetry becomes structural rather than something
the editor keeps in step: build a side once, place it twice with one instance mirrored, and the two cannot
disagree about anything but which side they are on. That removes a mode, its state, and the question of
what happens to a module straddling the centreline. What the editor owes instead is making assemblies easy
to *create* — select some modules, make them an assembly, place another copy — since the tedium moves from
placing modules to structuring them.

**What it tells you** is the point of the whole thing: total mass and inertia, the manoeuvring envelope
(`ThrusterLayout.support` already exists to draw it — §4 anticipated this), linear acceleration and turn
rate available in each direction, and per turret its calibre, rate of fire, muzzle speed and round mass.
Firing arcs are drawn on the canvas, which is the mechanism §12 wants a player to be able to read.

**Validity is shown, not enforced.** A layout may be invalid while it is being worked on — you often have
to move one module through another to get it past — so `blueprintProblem`'s complaints appear as a problems
list, and only export and save-to-library are blocked. A crude connectivity warning rides along with it:
modules that touch nothing else are flagged using the snap grid. That is deliberately *not* the graph with
per-edge strengths that §12 describes; it catches the obvious mistake without answering an open question
inside a UI task.

#### Where it lives

**Its own page and its own bundle**, `dist/editor.html` beside `dist/index.html`, linked both ways.

The reasoning is worth recording because it is stronger than it first appears. The editor's inputs and
outputs are both blueprints, so it needs to know nothing about a battle in progress: no shared clock, no
snapshots, no `SharedWorker` — which means this slice does not have to build the worker architecture §5
describes, and the question of whether views subscribe to a shared sim stays open until something actually
needs it.

But the claim has an exact boundary, and stating it loosely invites the failure it is meant to prevent.
**The editor is independent of the running simulation and tightly coupled to the simulation's laws.** Mass,
inertia, thrust, traverse rate, gun statistics and firing arcs all come from `moduleStats`, `gunStats`,
`compileBlueprint` and `firingArc`. If the editor ever computes one of those itself, the editor and the
battle disagree about the same ship, which is the worst thing this tool can do — its entire value is that
the picture and the numbers are true.

The same argument applies to drawing. The editor **builds a one-ship `Snapshot` at rest and hands it to the
existing `render/canvas2d.ts`**, adding only selection handles, the grid and the problems overlay on top.
`Snapshot` is a plain class with a no-arg constructor, so this costs nothing. A second renderer would drift
from the first exactly the way a second copy of the duel would have drifted from the golden one, which is
why `scenarios/duel.ts` exists.

**Plain DOM, no React**, for a canvas and a properties panel. This is a decision with a known expiry rather
than a position: §5 says application UI is the dominant cost of this game and assumes React for it, and the
second or third iteration of this editor is probably where that stops being deferrable.

#### The file format

An editor has to serialise what it produces, so this settles the format question §12 has been holding.

- **JSON, one file per blueprint**, and the two authored ships convert. The conversion must not move the
  golden checksums — if it does, it is wrong, and that is the test worth writing first.
- **`notes` on the blueprint and on each module**, optional free text, round-tripped by the editor. Without
  it the conversion silently destroys the only record of *why* each ship is shaped as it is, which is a
  worse loss than it sounds: "outriggers with small, fast firing, multi-barrelled guns" is not recoverable
  from the numbers.
- **Angles in degrees in the file**, radians everywhere inside `sim/`, converted by the parser. A file
  people hand-edit should not contain `1.5707963267948966`.
- **Assemblies and their instances are in the file**, normalised: shared values are written once and
  referred to, rather than repeated with a link tag. Copies then cannot disagree even in a hand-edited
  file, which a tag-and-duplicate scheme could not promise. `expandBlueprint` resolves them, and everything
  downstream works on the flat result, so an assembly is a way of *writing* a layout rather than a property
  a compiled ship has.
- **Module order is part of the ship, so restructuring a layout is not free.** Thruster allocation solves
  over the columns in order and turrets fire in order, so the same modules listed differently compile to a
  ship that behaves differently. It is why the authored ships place symmetric *pairs* adjacently rather
  than grouping each whole side: the tidier structure reorders the modules, and reordering the gunship
  moved the duel checksum while leaving the expanded geometry bit-identical. Worth knowing before
  reorganising a working ship, and worth the editor saying out loud when a restructure would reorder.
- **A `formatVersion` field**, since the library lives in browser storage and will outlive a format change.
  Named that way and not `version` deliberately: a campaign will eventually need a *blueprint* revision, so
  that existing ships keep flying the layout they were built to while new production uses the upgraded one.
  Two different quantities, and letting them share a word now would be expensive to unpick later.
- **Parsing splits from loading.** `parseBlueprint(unknown)` is pure shape-checking and unit conversion, so
  it belongs in `sim/` alongside `blueprintProblem`; reading a file or `localStorage` is the host's job.
  This is the distinction behind §12's "a loader outside `sim/`" — the *loader* is outside, the *parser*
  need not be.
- The built-in ships are **imported as JSON rather than read at runtime** (`resolveJsonModule`, which
  `tsconfig.base.json` does not yet set), so esbuild inlines them into the bundle and Node resolves them in
  tests. No asynchronous loading, no fetch, no divergence between the two environments.

**A ship is identified by its name**, not by an index or a generated id. Indexes collide across players
immediately — everyone has a ship at index 0 — and an opaque id, while collision-free, would be a second
identity nobody uses: the file stops being readable and diffable, and a shared ship's identity really is
"here's my Corvette". This matches the same instinct as degrees-in-the-file.

The cost is worth stating plainly, because it comes due later rather than now: **renaming is
re-identifying**. Once a campaign fleet references blueprints, changing a ship's name orphans every ship
flying one, which is the exact problem generated ids exist to solve. A rename will have to be forbidden,
propagated, or treated as a fork; that is a campaign-slice decision, not this one, but it is a bill this
choice runs up.

Names therefore collide, and importing a friend's ship is where it happens. Import **asks** — rename,
replace, or cancel, with the rename box pre-filled — rather than deciding for the player. Auto-renaming
quietly turns a re-import of a friend's updated ship into a fourth copy, and replacing destroys an
afternoon's work on a name match, which "Corvette" guarantees.

**A new ship starts blank.** No seed module: the first thing you do is choose what the ship is built around,
and starting you with a structure module quietly makes that choice for you.

**Saving** goes to `localStorage` so that iterating has no friction, with explicit Export and Import moving
a `.json` in and out. The browser cannot write to a checkout, so export is how a ship reaches the repository
or another person.

#### What has to change outside the editor

- `scripts/build.ts` grows a second entry point and shell; the Pages job publishes both pages.
- `tsconfig.base.json` gains `resolveJsonModule`.
- `ModuleSpec` and `Blueprint` gain optional `notes`.
- `scenarios/blueprints.ts` becomes JSON plus a thin module re-exporting the parsed ships, so `duel.ts`,
  `swarm.ts` and the golden tests keep importing a `Blueprint` and do not notice.

#### Deliberately not in this iteration

Test flight (the editor can have its own throwaway sim later — it does not need the battle page's).
Fleets and budgets. The real connectivity graph. Asymmetric or interval-based firing arcs. Any of §12's
open scaling questions.

**No cost line, now or ever** — see §12. Dry mass is not standing in for a cost until a cost model turns
up; dry mass *is* the materials a ship is made of, which is one of the three things a ship actually costs.
The other two are build time, which needs a complexity metric nobody has pinned down, and the propellant
and raw materials it consumes running, which needs a fuel model. Both are absent, so mass is the whole of
what the editor can honestly show, and it is not a placeholder.

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
- **What a barrel should cost.** Splitting a turret's bore across `n` barrels trades weight of shell
  for rate of fire, and at present it does so at a discount: the tubes' steel falls away as `n^-3/2`
  while `MECHANISM_MASS_PER_CALIBRE`, being linear in calibre, holds the loading machinery exactly
  invariant — the mount's bore budget sizes it, not how the budget is divided. So a multi-barrel mount
  has a mass floor but no penalty, and it is lighter than the single-barrel mount of the same size.
  Whether that is right is a balance question rather than a physical one, and the exponent on calibre
  is the dial: below linear the machinery total rises with `n`, above it it falls. One neighbouring
  thing is unsettled with it: `BARREL_CALIBRES * sqrt(n)` lets a barrel reach 141 calibres, which no
  real gun approaches. Settle them together, and let the GA weigh in.
- **Barrel harmonisation.** A multi-barrel mount fires its barrels parallel, so a barrel `d` off the
  centreline misses the aim point by `d` at every range — spreading the barrels across the mount face
  made that a metre or two rather than a few centimetres. It costs nothing measurable today, ships
  being far wider than the row, but it is a real effect against small targets, and converging the
  barrels at a chosen range (paying for it at every other range) is a genuine design axis rather than
  a correction.
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
- **Whether the remaining authored data lives in files rather than in code.** Blueprints do: they are JSON,
  parsed by `sim/blueprintFile.ts`, and the shipped ships go through exactly the validation a stranger's file
  does. What has not moved is `tests/fixtures/scenarios.ts`, and §9's promise of
  `npm run battle -- scenarios/duel.json` — a *scenario* is more than a list of modules, since it also carries
  spawn poses, teams, wells and a seed, so it needs a format of its own rather than a reuse of this one.
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
  an implementation detail. One now exists: `ATTACHMENT_TOLERANCE` in `sim/blueprint.ts`, a centimetre, added
  for the thruster-attachment rule. Connectivity should use that same constant rather than introducing a
  second, and if a centimetre turns out to be the wrong answer it is the wrong answer for both.
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
- **What a thruster firing into its own hull should cost.** Narrowed, not closed. A thruster mounted *back to
  front* is now a rejected layout: `blueprintProblem` requires the face opposite the nozzle to be against a
  structure module, because an engine held on by its nozzle is not an assembly question about how well the
  ship runs but about whether it is a ship. That is the same kind of rule as modules not overlapping, and it
  is discrete for the same reason.
  What stays open is the continuous case, and it is the one this question was really about: a *correctly
  mounted* engine whose plume runs into something further aft. Thrust is still produced whatever the exhaust
  hits, so such a layout flies exactly as well as a clear one and merely looks absurd. Both authored ships
  were drawn wrong and nobody noticed until the viewer started drawing plumes — which is the argument for the
  viewer in miniature, and the reason the authored layouts also have a ray-cast test that the attachment rule
  does not replace.
  It matters more than tidiness once §7's evolution is running. A buried nozzle is thrust with no penalty
  attached, which is precisely the shape of exploit `modules.ts` warns about: the search will find it, and
  every evolved ship will end up with its engines pointing into itself because that packs a layout tighter
  for free.
  **Settled in direction, open in timing:** a blocked nozzle will lose thrust in proportion to how much of
  its exhaust is obstructed, *and* deliver damage and heat to whatever is in the way. Not rejecting the
  layout outright, which would turn a continuous quantity into a hard edge a mutation cannot cross, and the
  search wants a gradient. That argument is about *obstruction* and does not reach the attachment rule above,
  which is discrete however it is modelled: a mount is on the hull or it is not, and there is no gradient
  between. Doing both means a plume becomes something a designer can point deliberately —
  and something an attacker can exploit — rather than merely a thing to avoid.
  The deadline is §7's evolution rather than any particular slice: until then a buried nozzle is a drawing
  error, and afterwards it is an exploit the search will find and build every ship around.
- **A dead zone on the pilot's attitude hold.** A ship parked on its target bearing still twitches its
  thrusters continually, correcting an alignment error of almost nothing. Today that is only cosmetic — the
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
- Whether fighter-vs-fighter collision matters at swarm density, or whether only capitals and
  turrets are solid.
- Ammunition model granularity — per-mount magazines, shared bunkerage, or both.
- Whether the mothership's build priorities are a doctrine blob (so async PvP competes on them) or
  a player-driven queue.
- Concrete values, now that the units are settled: budgets, engagement ranges, timestep, weld
  velocity threshold, edit-distance bounds, muzzle velocities, armour densities.
- Project name.
