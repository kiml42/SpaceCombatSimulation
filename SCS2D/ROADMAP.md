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
| Slice 0 | Two ships fight, deterministically | Built, bar weld on slow contact |
| 1 | Blueprint editor | Partly built |
| 2 | Terminal ballistics and the damage model | Built |
| 3 | Doctrine and orders | Partly built |
| 4 | Headless evolution and analysis | Built |
| 5 | v1: skirmish | Not started |
| 6 | Editor restructuring | Not started |
| 7 | Salvage and in-battle construction | Not started |
| 8 | Mining and the two-resource economy | Not started |
| 9 | Campaign | Not started |

### Partly built — what is left

**Slice 0 — weld on slow contact.** A slow contact is still a gentle bounce; nothing welds. It is what makes a
dock a dock and decides ram from landing (§4, §3). See the §12 entry.

**Step 1 — Blueprint editor.** One thing, not blocking:

- **Unlinking one copy of a shared part while the others stay linked.** Unlink today dissolves every copy at
  once, because the editor cannot yet name a single instance.

Deliberately left out of the editor's first iteration, and still unclaimed by any step: **test flight** (the
editor could have a throwaway sim of its own; it does not need the battle page's), **fleets and budgets**,
and **interval-based firing arcs** (the §12 entry on traverse and firing permission).

**Step 3 — Doctrine and orders.** What the step deferred, plus one thing using it turned up:

- **Withdrawal** — a craft breaking off.
- **More pickers**: line-of-sight, hemisphere, looking-at, and ship-type.
- **How much a mount cares about its ship's orders, as a weight of its own.** An order is currently a
  mandate: every mount that can train on the ordered target takes it. That is right for a main battery and
  wrong for a close-in mount, which should go on swatting whatever is about to hit the ship while the hull is
  ordered onto something big. The shape is the one the rest of targeting already has: a weight scoring the
  ordered target alongside every other candidate, defaulted high enough that an ordinary mount obeys and set
  low on a CIWS. It replaces the mandate rather than sitting beside it, so it moves the goldens of every
  scenario that issues an order — which is why it is a piece of work of its own.

### Not started — in order

5. **v1: skirmish** — a fixed budget of *materials* rather than of points (§12), designed scenarios,
   shareable by URL. *This is the first thing worth giving people to play.* Designed
   scenarios are where the §12 entry on authored data stops being optional, since a scenario to share has
   to be a file.
6. **Editor restructuring — dissolving a group, and grouping what is already grouped.** Making a group is
   what building a symmetrical ship needs; unmaking one, nesting one inside another and adding a group to a
   group are what *reworking* a ship needs, and that pressure only arrives once there are ships people want
   to keep and rebuild rather than replace. Until then the way out of a group is undo and the way to a nested
   one is the file, which is a poor tool and an adequate stop-gap. What is missing today: a group cannot be
   dissolved (`unlink` takes one module out at a time); grouping modules already in different assemblies is
   refused, as is grouping a group; and adding to a group takes loose modules only. The format allows nesting
   — only the editor does not build it. Evolution's mutation operator already dissolves the plain case (one
   copy, no extras, nothing nested), so what the editor is short of is the interface rather than the
   arithmetic.
7. **Salvage and in-battle construction** — wrecks from the current battle as the resource. The natural
   bridge to an economy: no map features needed, and it ties income directly to combat.
8. **Mining and the two-resource economy** — metals for hulls, volatiles for propellant, so maps can have
   economic character and scarcity changes behaviour. *Note: this is a re-balance, not an addition — it
   lengthens battles and replaces "did I spend 500 points well?" with "did I manage income well?". Scenarios
   will need revisiting.*
9. **Campaign** — Homeworld-shaped, with the adaptive enemy. Last, because it's mostly *authoring* (scripted
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
- **How one copy differs from another is additive**: an instance may carry `extra` modules in the
  assembly's frame. That is the whole divergence mechanism, and unlinking one copy (above) should be built
  from it rather than from anything new in the format. Unlink has two shapes today — a module that is its
  whole assembly is expanded back inline, exactly; one that shares its assembly leaves the definition and
  every instance gets it as an `extra`, which drops it from any *new* instance and moves it down the
  expansion order.
- **Module order is part of the ship, so restructuring is not bit-free.** Thruster allocation and firing both
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
  transposed consistently, which is invisible while every arc is symmetric. The interval mask in §12 has to
  keep this.

#### Damage model (step 2)

- Anything that comes off a ship is a body that collides, as a severed chunk is.
- Which piece is a ship is settled: a piece with a working core is a ship, and one without is debris,
  currently only a navigational hazard. What the step leaves open is balance — the dials are in §12.

#### Doctrine and orders (step 3)

The remaining pickers and the order weight should follow the shape already there:

- **Doctrine is a block in the blueprint file**, shared by reference and copied only when overridden — the
  same copy-on-write split the thruster layout uses. A mount's own block holds only its *differences* from
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

## 12. Open questions

Deliberately unresolved; decide when they block something.

- **A ship should say which way it fights as well as which way it accelerates.** A blueprint has one
  orientation, so the heading a pilot holds is the heading its engines push along — which is exactly wrong
  for a broadside, whose guns bear ninety degrees off the line it wants to travel. Two orientations in the
  design, an attack one and an acceleration one, would let a hull be flown along one and pointed along the
  other. It also subsumes a case that otherwise wants a mechanism of its own: **a small ship with fixed guns
  cannot currently choose a module on a large one**, because aiming a fixed gun is a question for the pilot
  rather than the mount, and a pilot that knew what its guns wanted to hit would steer to put it under them.
  Both are the same missing idea — that where a ship points is a decision, not a consequence of where it is
  going. **The Dinky is the worked example**: its gun trains five degrees and its doctrine says engines, so
  what it actually shoots is whatever the *hull* is pointed at, and the hull points at its target's centre.
  **Which part a hull points at is a setting on the ship**, decided by the author against the alternative of
  deriving it from what the ship's weapons want: a hull with several limited-traverse guns has no single
  answer to derive from, and picking one would mean guessing which the designer meant as the main battery.
  So a hull gets an aim preference of its own — the thing this codebase deliberately does *not* have today,
  a ship choosing a part of another ship rather than a ship — and a gun that cannot train far follows it on
  `focusWeight` alone, which is what that weight already does. Until it lands, such a preference belongs on
  the gun, since on a hull it would be a number nothing reads.
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
  happens to point the right way: the allocator fires a thruster when the force being asked for has a
  component along its thrust, so a first engine is worth 0.23 on one face and exactly nothing on the other
  three, and mounting it off-centre to give it torque changes nothing measurable. A lineage gets there by
  collecting engines until enough of them point usefully, which works and is slow.
  A cleverer pilot would make every one of them useful. Any off-axis thruster can be flown with if you do
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
- **How severed chunks divide fuel, ammunition and power.** Which piece goes on being a ship is settled —
  the one holding a working core, and every other piece with one becomes a ship of its own (DESIGN.md §4)
  — but what a piece takes *with* it is not. The interesting case is a magazine cut off from the gun it
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
  One way it *did* visibly misbehave has been closed in the answer rather than in the search: a pair of
  thrusters that exactly undo each other could both come out alight, because pinning one at full and never
  reconsidering it left the other free to claw back what it was overproducing. That is taken off afterwards,
  where it is exact and cheap. What remains open is the general shape of the same fault — three or more
  thrusters wasteful together without any two of them being opposites — which no layout drawn or bred so far
  does, and which is a linear program rather than a loop to find.
- **Whether capitals may mount hull-layer guns.** Not needed for torpedoes — §3 settles those — but it is
  an appealing separate axis. `hullGun` and `hullBeam` exist and have the narrow arcs and heavy bore this
  imagines, but they fire in the weapons layer like any turret — there are no layers in the sim yet — so
  what they can hit is still the open part. Deck turrets are **area**-limited: many of them, arcs unconstrained, but they
  can only strip mounts. Edge-mounted hull-layer guns would be **perimeter**-limited: few, narrow arcs, but
  able to hole a hull directly. Big ships would then have to *specialise* rather than simply scale, and the
  "guns mission-kill, ordnance destroys" line in §3 would become "deck turrets mission-kill; edge guns and
  ordnance destroy", with edge guns paying for it in coverage. The mounting concept now exists in the editor; what
  is left to decide is the layer, and it arrives with the raised flag below.
- **Whether a turret's traverse limit and its firing permission are the same thing.** Today they are, bar
  firing discipline's friendly-hull cast: a mount may fire wherever it may point. Arcs are asymmetric
  already — a bound each way, measured as sweeps (see §8's notes on the editor).
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

  It was waiting on the blueprint editor, to show a player what their arrangement bought; the editor now
  draws each mount's arc, so nothing blocks it.

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
  worth fighting rather than a formality, and it is the drifting hulk §3 wants and the salvage §8 step 7
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
- **What a bell should buy once there is fuel.** A nozzle's length already buys thrust and reach, both out
  of the one divergence factor, because both are about how much of the gas is going the right way. The
  thing it should buy and cannot yet is **efficiency**: expansion is what a real bell is for, and a long
  one gets more delta-v out of the same propellant rather than only more push. There is no propellant, so
  there is nothing for it to be efficient with, and pricing it now would mean inventing a second currency
  to spend. When fuel arrives the number is already sitting in `ThrusterGeometry.divergence` and wants no
  new law — which is also the argument for the shape the bell was given: one physical quantity with three
  consequences, two of them already paid for.
  The neighbouring question is what a *stubby* engine should do about it. A wide exit cannot be collimated
  in a short length, so the shipped hulls — whose engines are much wider than they are long — sit well
  below one and lost thrust when this landed. The designed answer is a cluster of narrow bells, which the
  nozzle count already gives them; whether the shipped ships should be re-drawn to take it, or left as
  evidence of what the law says about a hull drawn before it, is a decision about the fleet rather than
  about the model.
- **Whether a ship should manoeuvre to bring an engine to bear.** A thruster marked as a weapon fires when
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
- **Whether a crush should spread sideways as well as inward.** A collision spends its energy along the
  contact normal, module by module, which folds a nose in convincingly and leaves the metal *beside* the
  impact untouched. A real crush spreads: the plating either side of a rammed bow buckles too. Doing it
  needs a rule for how much reaches a neighbour and a way to walk the connectivity graph outward from the
  contact, neither hard, and neither worth guessing at before there is something to watch it on.
- **Weld on slow contact, which is what makes a dock a dock.** §4 has the rule and §3 leans on it — a
  craft closing slowly has landed, one closing fast has rammed, same threshold — but nothing welds yet:
  a slow contact is simply a gentle bounce. The threshold is one of the concrete values below.
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
- Concrete values, now that the units are settled: budgets, engagement ranges, timestep, weld
  velocity threshold, edit-distance bounds, muzzle velocities, armour densities, and how hard a plume
  burns (`PLUME_POWER_PER_NEWTON`, chosen for a timescale rather than derived).
- Project name.
