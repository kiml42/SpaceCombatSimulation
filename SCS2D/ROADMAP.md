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

### Quick fixes to do next
 - Allow rotating assemblies (possibly scaling as well, but only isometrically makes sense)

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
   this is the first point at which a real answer is possible. Two of the three pieces exist:
   `sim/hull.ts` resolves a shot to the modules it crosses with the face each is entered by, and
   `sim/ballistics.ts` decides penetrate/embed/deflect against a plate by de Marre's law and returns the
   residual. What is left is the half that spends it — walking that path, taking each module's armour
   from its own figures, and deciding what the energy does to it. Until then, Slice 0 stands in with a
   flat "everything penetrates and is absorbed", which is enough to watch ships come apart but tells you
   nothing about armour design.
3. **Doctrine and orders** — make configuration visibly change behaviour.
4. **Headless evolution and analysis** — balance testing plus sandbox mode.
5. **v1: skirmish** — a fixed budget of *materials* rather than of points (§12), designed scenarios,
   shareable by URL. *This is the first thing worth giving people to play.*
6. **Editor restructuring — dissolving a group, and grouping what is already grouped.** Making a
   group is what building a symmetrical ship needs; unmaking one, nesting one inside another and
   adding a group to a group are what *reworking* a ship needs, and that pressure only arrives once
   there are ships people want to keep and rebuild rather than replace. Until then the way out of a
   group is undo and the way to a nested one is the file, which is a poor tool and an adequate
   stop-gap.
7. **Salvage and in-battle construction** — wrecks from the current battle as the resource. The
   natural bridge to an economy: no map features needed, and it ties income directly to combat.
8. **Mining and the two-resource economy** — metals for hulls, volatiles for propellant, so maps can
   have economic character and scarcity changes behaviour. *Note: this is a re-balance, not an
   addition — it lengthens battles and replaces "did I spend 500 points well?" with "did I manage
   income well?". Scenarios will need revisiting.*
9. **Campaign** — Homeworld-shaped, with the adaptive enemy. Last, because it's mostly *authoring*
   (scripted missions, pacing, narrative), which is the largest volume of work in the least-proven
   discipline.

**Scenario packs** are the cheapest way to make it a game with goals rather than a sandbox, and they
teach the mechanics. Each scenario is a data file, not code.

### Slice 1 — blueprint editor, first iteration

§8 step 1, scoped down to one iteration: **lay out a ship, see what the layout bought, save it, get it into
a file.** Flying what you built is deliberately the *second* iteration. What remains of it is below; Status
says what the editor already does.

**Assemblies are how a ship stops being edited twice.** A blueprint holds a table of named groups of
modules, and places them by reference — so the gunship's eight lateral thrusters are one thruster placed
eight times, and making them all bigger is one edit with no state in which seven of them are. An assembly
of a single module is the ordinary shared-part case and deliberately not a separate concept; an assembly
containing other assemblies is what lets a whole wing, or a whole side of a ship, be one thing.

The format has all of this and the editor reads it: selecting one copy of a shared part selects the
*placement*, says how many copies it draws, and edits every one of them together — except position, which
belongs to the copy, since a shared module sits at its assembly's origin and each instance carries a pose of
its own. Duplicate makes a shared part out of a module and unlink dissolves one, so the editor can make and
unmake an assembly of a single module. What it cannot do is **restructure** anything larger than that.
Everything below is that gap.

**Grouping exists, and reflection with it.** Several modules are picked with Shift-click and made into an
assembly placed once where they were; the group is then selectable in its own right, placed again, moved,
turned and reflected. That is the whole of what replaces a mirrored editing mode: symmetry is structural
rather than something the editor keeps in step — build a side once, place it twice with one instance
mirrored, and the two cannot disagree about anything but which side they are on. No mode, no state, and no
question about a module straddling the centreline.

**A group is built around the first module picked**, not around the centre of the selection. A group is
usually a thing hanging off one connecting module — a wing off its root — and that module is the one whose
position means something, so reflection turns the group about the part that joins it to the ship.

**A group is boxed once per copy**, so a group placed twice is two boxes rather than one round both, with the
copy that was clicked solid and the rest dashed — the same distinction the module highlight makes between the
copy under the pointer and the ones it moves with. A module selected inside a group keeps its group's box,
drawn faintly: it says which thing the part belongs to without competing with the part itself. The panel
shows what the group weighs, and what all its copies weigh together; mass is the only figure that means the
same thing about a bag of modules as it does about one, since capacity, armour, hit points and thrust each
describe something a group has no single answer for.

**A group carries a name**, editable on its panel and renamed everywhere it is used at once, since the name
is a reference rather than a label. It is the only thing about a group that says what it is *for*, and it is
what a palette of groups to place would list, if one is ever built.

**A group is handled as one thing on the canvas.** Clicking a module inside a group selects the group, not
the module; clicking again, with that group already selected, drills into the module — so reaching a part is
deliberate rather than accidental. A selected group drags as a whole, and its own outline is drawn round
everything it places, which is what distinguishes it at a glance from several modules picked one by one.
Modules picked alongside a single group can be put into it, which is the other way to build a group up: they
are re-expressed through the instance's pose on the way in, and a group placed more than once gains one per
copy, which the panel says out loud.

What a group cannot do is be **restructured**. It cannot be dissolved — `unlink` takes one module out of an
assembly at a time, and there is no inverse of grouping that puts a whole assembly back inline — and
grouping several modules already in different assemblies is refused, as is grouping a group; both would
nest, which the format allows and this does not build. Adding to a group takes loose modules only, for the
same reason. All of it is §8 step 6, deliberately after v1: it is what reworking a ship needs rather than
what building one needs.

**How one copy of a group differs from another is additive.** An instance may carry `extra` modules of its
own, placed in the same frame as the assembly's, so they move and reflect with it. That is the whole of the divergence
mechanism, and the editor's unlink is built from it rather than from anything new in the format. Unlink
takes the shape the layout makes necessary: when the module is the whole of its assembly, each instance is
replaced by what it expanded to and the assembly goes, which is exact down to module order; when the
assembly holds other modules too, the module leaves the definition and every instance is handed its own copy
as an `extra`. The second has a cost the button states — the part is gone from the assembly, so a *new*
instance will not have it, and extras land after the assembly's own modules, so the part moves down the
expansion order and the ship changes very slightly even though nothing about its geometry has.

What is *not* built is unlinking **one** copy while the others stay linked. Both shapes above unlink every
copy at once, because the editor cannot yet name a single instance.

**Module order is part of the ship, so restructuring a layout is not bit-free.** Thruster allocation solves
over the columns in order and turrets fire in order, so the same modules listed differently compile to a
ship that is not bit-identical: reordering the gunship moved the duel checksum while leaving the expanded
geometry identical. It is why the authored ships place symmetric *pairs* adjacently rather than grouping
each whole side. How much of that is *behaviour* is now measured rather than assumed, by
`scenarios/ordering.ts`: 8.2e-13 m of drift over 3,000 steps of manoeuvring and gunnery, with identical
shots fired and hits scored, because both mechanisms are order-independent in substance and merely add their
numbers up in list order. So the word the
editor owes the player when a restructuring action reorders something is about reproducibility — a saved
ship will not check-sum the same — and not about the ship fighting differently. Adding a module appends,
which is the one placement that leaves even the bits alone.

#### Deliberately not in this iteration

Test flight — putting a ship in a scene and letting it fly. The editor can have its own throwaway sim
later; it does not need the battle page's. What is there instead is an **animation**, not a start on one: a
selected engine burns and a selected gun fires at its own rate, with rounds flying straight at the muzzle
speed and being forgotten. Nothing is integrated, nothing collides, and the ship does not move however hard
its engine burns — so it cannot grow into a test flight by accident, and it claims nothing the panel beside
it does not already state.
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
- **A beam's optics: spot size, intensity, wavelength and what armour does about them.** The beam laws derive an
  aperture, a power and a dwell, and stop there — because everything past that point needs a damage model to
  land on. What is deferred is one equation and its consequences. A beam leaving an aperture `D` at wavelength
  `λ` spreads at `1.22 λ / D`, so its spot at range `R` is `D + 2.44 λ R / D` and the intensity that actually
  burns is `P` over that area.

  Three things follow, none of them yet built. **Aperture is a two-sided choice**: a small optic concentrates
  far harder at short range and spreads sooner, a large one never concentrates but holds its spot to any range.
  For a 100 MW beam at 1.06 µm, a 0.1 m aperture delivers about 5500 MW/m² at 2 km against a 1 m aperture's 126,
  and the two cross over at roughly 40 km — so the choice is a range band rather than a quality. **Wavelength
  moves the same curve**, halving the spread for half the wavelength, and pays for it in the efficiency of
  generating it, which is waste heat. It is deliberately *not* a parameter yet: with focus unmodelled and armour
  absent, its only live consequence would be the cost, so every design would pick the longest wavelength going
  and the knob would be dead. It arrives with the optics, and it brings a beam's colour with it. **Reflective
  armour is the counter**, wavelength-dependent and weak to kinetics, which is why `BeamHits` already reports a
  surface normal: incidence angle is half of what decides whether a beam couples in or skids off.

  Until then `BEAM_APERTURE_FRACTION` is the constant carrying all of this. It is calibrated so that the spread
  range `D²/2.44λ` lands between about 9 km and 190 km across the shipped mounts, which puts the interesting
  part of the curve inside the engagement ranges this game means to reach. It is the number to revisit first
  when intensity acquires a consumer.
- **What a beam mount's duty cycle should be.** `BEAM_DUTY_CYCLE` is a flat fraction standing in for two
  systems that do not exist. The bank refills at whatever the ship's plant can spare, which is a power model;
  and the mount can keep firing until its heat sinks are full, which is a heat model and is properly a
  *cumulative* limit across an engagement rather than a per-shot one — a beam mount should warm up over minutes
  and eventually have to stop, not reload. Worth knowing how large that problem is: radiating 300 MW of waste
  heat at 500 K needs something like 88,000 m² of radiator, which is why a laser warship is a hard ship to
  build and why the heat model will have real consequences for hull layout rather than merely for rate of fire.
- **Firing several emitters at once.** A mount with `n` emitters currently fires them in turn, which a gun does
  for good reasons — the loading gear and the recoil are both sequential — and a laser does for none. The
  shared bank then feeds one emitter at `1/n` the power for `n` times as long, so the beam gunship's eight-way
  mounts hold a weak beam for fifteen seconds and then sit dead for forty-four. Nothing is wrong with the
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
- **Whether a turret's traverse limit and its firing permission are the same thing.** Today they are: a
  mount may fire wherever it may point. That is one of the two things this question was about; the other,
  asymmetry, is done.
  - ~~**Asymmetry.**~~ Settled. `firingArc` returns a bound each way and the turret store carries both, so
    an obstruction off one beam costs the sweep that way alone. Worth recording what made it hard to get
    right rather than just that it is: the limits have to be measured as *sweeps* — how far the mount must
    turn to reach an edge — and not as signed bearings, because an obstruction wholly to port has both
    edges at positive bearings while one dead astern is reached by turning either way. And every consumer
    has to agree which bound is which. Both the clamp and the renderer had them transposed, consistently
    with each other, so the picture and the behaviour agreed and were both wrong — which is invisible while
    every arc is symmetric, and every arc was.
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
  arrangement bought.

  **What is implemented is knowingly inconsistent, and the three parts disagree in different directions.**
  §3 already settles the principle — the weapons layer is above the deck, guns fire over friendly and enemy
  decks alike, and large modules may be flagged as *protruding* into the weapons layer at the cost of being
  gun-vulnerable. Nothing implements that flag, so every module is treated as though it were raised in one
  place and flat in another:

  | | Today | Should be |
  | --- | --- | --- |
  | **Trigger arc** | Blocked by any module within *barrel length* | Blocked by raised modules and other turrets' domes, at **any** range down the round's path |
  | **Traverse limit** | Blocked by any module within barrel length | Blocked by **raised** modules within barrel length |
  | **Projectile hits** | Strike any module of any ship | Strike **raised** sections only |

  Three things follow that are worth having written down.

  **The trigger mask is a superset of the traverse mask**, so the traverse limit never decides whether a
  mount may fire — anything the barrel fouls is also on the round's path, at a range shorter than the
  barrel. Its only job is deciding which way round the mount has to turn, which is real but narrow.

  **Barrel length buys no reach past an obstruction.** To point along a bearing a long barrel has to occupy
  the space a short barrel's round would have flown through, so it fouls rather than clearing. Length
  matters only in the other direction: an obstruction *beyond* barrel reach stops the round while leaving
  the barrel free, which is exactly why the two masks differ in range and not in kind.

  **The trigger mask can stay bearing-only rather than a ray cast per shot.** Under the fast-projectile
  assumption it is a property of the layout, so it compiles once. That is also the more conservative
  model, and conservative is right here: a mount should not be firing along a bearing with its own hull
  downrange whether or not a particular round would have cleared it, because misses and penetrations both
  come home.

  **A transition that keeps today's behaviour** is to add the flag, have the trigger and traverse masks read
  it, and mark most existing hull as raised. Worth being clear that this is deliberately vacuous rather
  than a model: with everything raised, arcs and hits are exactly as they are now, and the flag carries no
  information until something is *un*-raised. The two effects then arrive together and cannot be tuned
  apart — un-raising a module both opens every arc across it and makes it immune to gunfire. That is
  coherent, and it is what §3 intends by "guns mission-kill; ordnance destroys", but it is a large step to
  take by accident.

  One default is not free to choose: §3 has guns stripping "mounts, sensors and engines", so turrets and
  thrusters have to be raised. Only `structure` is genuinely optional, which is also where all the arc
  behaviour comes from.

  Still open beyond all of this: **hull-layer side-mounted guns**, which by their own definition are blocked
  by the whole ship rather than by its raised parts, and whose projectiles then travel in the hull layer.
  What that means for what they can hit is undecided — see the deck-versus-edge-gun question above.
- **Engines split by layer, into two archetypes.** A single `thruster` kind cannot express the choice the
  weapons layer creates, so it becomes two — a new *archetype* rather than a new coefficient, which is the
  distinction the materials question above already draws.
  - A **raised main engine**: high thrust, efficient, heavy. In the weapons layer, so guns can strip it.
  - A **hull-layer thruster**: small, and therefore low absolute thrust. Guns cannot reach it.

  **Settled in direction: the hull-layer one is lighter in absolute terms and *worse* per unit of thrust.**
  Lighter because it is smaller; worse because a bank of them must outweigh one main engine of the same
  total thrust. That sign is the whole point, and getting it the other way round would be the exploit
  `modules.ts` warns about in its own words: a hull-layer engine cheaper per newton, with nothing bounding
  how many fit, means every evolved ship is a raft of RCS units and the main engine is never built. The
  reason to fit them is not that they are cheap. It is that gunfire cannot reach them.

  Low thrust need not be stipulated — thrust is already exit area times a constant, and exit area is width
  times deck height, so an engine that does not rise above the deck gets less exit and less thrust out of
  the geometry. Efficiency has nowhere to live yet, since there is no propellant model, so for now the two
  differ in thrust and mass alone.

  What the split buys is a better mission kill than "disabled". A ship stripped of its main engines still
  has manoeuvring thrusters on long moment arms, so it can still *rotate* well while barely translating: a
  fixed battery that can bring guns to bear but cannot close, break off, or dictate range. That is a state
  worth fighting rather than a formality, and it is the drifting hulk §3 wants and the salvage §8 step 6
  feeds on. Worth knowing that `hasFullAuthority()` is called only from tests and never at run time, so a
  damaged ship failing it costs nothing — it looks like it would matter and does not.
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
  Belongs with §8 step 2: a fuse is a delivery mechanism, and the damage model is what it delivers into.
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

  A crude version of the *check* now exists ahead of the graph: a layout is rejected when some module cannot
  be traced back to the first one in the list through modules touching within `ATTACHMENT_TOLERANCE`, and the
  editor draws the stragglers in red. It answers "is this one ship or several" and nothing else — no edges are
  kept, no strengths derived, and contact at a corner counts — so it does not pre-empt any of the above. What
  it does pre-empt is the tolerance: change that constant and the layout rule and the graph move together,
  which is the point of there being one.

  Two loose ends this exposes. **Which module is the ship** is answered by a stand-in: the first in the list,
  because a layout has no core module to be the real answer. It is arbitrary and deliberately so — the check
  only asks whether a layout is one piece, and the size of a piece says nothing about which of them is the
  ship — but it is the same question a *core module* would settle, and it will want revisiting when one turns
  up. And when a hull does split, something must decide which component keeps being the ship — its
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
