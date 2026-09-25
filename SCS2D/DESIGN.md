# Space Combat Simulation — Design

A planar, physics-driven fleet-tactics game with deep ship design, built in TypeScript.
This is the successor to the Unity project in `SpaceCombatSimulation/`, which is archived
in place and no longer developed.

**These are living documents.** Amend them when decisions change, and record the change in
[DECISIONS.md](DECISIONS.md). Their job is to stop already-settled questions from being re-litigated
after a gap — which is why the record is of *why*, not just *what*.

**Three documents, split by why you would read them.** Section numbers are global and stable across all
three, so a reference such as "§12" means the same section wherever it is written — which is why the numbering
inside any one file is not contiguous.

| File | Holds | Read it when |
| --- | --- | --- |
| **[DESIGN.md](DESIGN.md)** | Status, §§1–7 and 9–11 — what the game is, how it works, and why | Deciding how something should behave |
| **[ROADMAP.md](ROADMAP.md)** | §8 build order, §12 open questions | Picking up work, or deferring a decision |
| **[DECISIONS.md](DECISIONS.md)** | The Decision Log | Asking why something ended up the way it is |


---

## Status

- **Built and tested:** deterministic maths (own transcendentals), seeded RNG,
  structure-of-arrays body store with generational handles, kick-drift-kick leapfrog
  integrator, gravity wells, state checksums, a uniform-grid spatial index with segment
  and circle queries, swept-segment projectiles with impact reporting, per-blueprint
  thruster allocation, kinematic turrets with lead and traverse arcs, parametric modules
  with their scaling laws, blueprint compilation — mass properties, thruster layout
  and firing arcs all derived from a layout, with four ships authored to it as validated
  JSON files, one of them built from a repeated wing segment — and ships
  built from those blueprints fighting: flying their layouts to hold an ordered range
  band, training their turrets with lead, and firing salvoes that recoil. A ship
  holds a *queue* of orders rather than one order, each naming what would finish
  it — the target disarmed, stranded, both, or simply gone — so a plan can be
  given in advance and worked through as targets are put out of the fight. A Canvas2D
  viewer draws snapshots of all of it — ships, turret bearings, tracers and the wells
  bending them — with pause, single-step, time scaling, and zoom and pan over an
  auto-framing camera. Each ship also carries an arrowhead in its team's colour, which
  fades in as its hull becomes too small on screen to read, so that zooming out to see a
  battle does not lose the small ships in it or which way they are facing. **What the picture asks
  about a ship is whether anybody is aboard it, not whether it can fight**: a hull with a sound core and
  neither gun nor engine is somebody's ship, so it is framed and drawn in its own colours, where asking
  whether it could fight drew a whole generation of engineless craft as wreckage and left them out of shot.
  Grey is for a core that is out, and a severed piece gets no arrowhead at all. A blueprint editor on a second page of its own draws a layout
  through that same renderer and reports what it bought: mass, inertia, the
  acceleration available in each direction — as figures, and as a pair of
  envelope curves separating what a layout can project from what it can use
  while holding a heading — and each turret's calibre, rate of fire, muzzle
  speed and arc. Modules are
  clicked to select, dragged to move on a snapping grid a tenth of the grid drawn on screen —
  so the step follows the zoom, from tens of metres on a Star Destroyer down to centimetres on a
  drone — sized by dragging a corner
  or an edge with the opposite one held still — carrying whatever sits against the moving face along with it,
  unless Ctrl is held — and turned by dragging a knob beyond the bow, while two touching modules selected
  together get a bar on their shared face that grows one as it shrinks the other; every snap is escaped by
  holding Alt —
  with the rest of their values typed into a panel beside the module's own mass,
  capacity, armour and gun, and a selected engine burns and a selected gun fires at the
  rate its own figures claim; a module can be duplicated into a shared part placed
  twice, and a shared part unlinked back into separate modules, with position, dragging
  and deletion belonging to the copy and everything else to all of them; several modules can be
  picked at once and grouped into one part, which is then placed again and reflected
  to build a symmetrical ship out of one side and a mirror of it, and clicked, dragged
  and added to as one thing, carries a name of its own, and is placed in a row or round
  an arc by a count and a step rather than by placing it again and again;
  every problem with the layout is listed rather than enforced — including a module
  that is attached to nothing, which a ship is checked for by tracing every module back
  to the first one through what it touches — and each module a problem names is drawn
  in red on the ship, so the list says what is wrong and the picture says where. Undo and
  redo run throughout. Ships are opened from the built-in library or from browser
  storage, saved back to it, and exported and imported as blueprint files. Each page
  builds to one self-contained HTML file.
  A shot's path through a ship is resolved to the modules it crosses, in order,
  with the face each is entered by — the geometry both halves of the damage
  model are built on, and the first thing the bounding circles the broad phase
  stops at cannot answer. **Rounds and beams land on that hull**: the circle is
  the broad phase's question and a module's face is the answer, so a shot
  through the empty part of a ship's circle carries on to whatever is behind it,
  and one that lands reports the module it struck and the face it came in by.
  **Terminal ballistics is built on it**: de Marre's
  perforation law, obliquity as line-of-sight thickness and a critical angle,
  deciding perforate, embed or deflect from a round, a plate and the angle
  between them, and returning the residual speed and the energy the plate took.
  `sim/math.ts` grew the deterministic `exp`, `log` and `pow` the law needs.
  **Hulls are solid**: ships meet each other module box against module box, and the impulse that comes
  out of it shoves them apart and sets them tumbling. What a ram *costs* is not modelled yet — a
  collision trades momentum and does no damage.
  **The damage model spends what it returns**: a round walks the modules along
  its path, each taking the energy its armour stopped, until it embeds, skids
  off or comes out the far side; a beam pours its power into what it is burning
  through, and bores deeper as it destroys. A module that has taken all it can
  stops working and goes on stopping shells, so a battered ship is sluggish and
  quiet rather than lighter, and a ship that can neither move nor shoot drifts
  as a hulk. Hits flash on the canvas and wrecked modules are drawn as wreckage.
  **An engine is a weapon at close quarters**: a plume reaches back as far as the thrust it is carrying,
  and whatever stands in it burns — its own hull if a nozzle was pointed into one, anything that drifts
  behind a burning stern if not. It is the same flame the renderer draws, so what is on the screen is what
  is doing the damage, and it shoves as well as burns. An engine can also be *meant* as one: a thruster
  ticked as a weapon in the editor lights up by itself when an enemy is close enough behind it to take a
  real share of the flame, and the hull pays for it in the push, which the rest of the layout spends the
  step cancelling. An engine that fires part of its exhaust into its own ship gets no thrust for that
  part, so a buried nozzle is a weak engine rather than a free one, and the editor says so beside the
  engine that is paying.
  A weapon engine counts as armament to doctrine: a ship with one is not a hulk, and its reach includes
  the inner half of the flame, where the burn is worth firing — so a craft whose only weapon is an engine
  closes to where it burns rather than parking against the hull or sitting out at the plume's tip. The
  `torchRun` scenario is the demonstration: small Torch ships with a big engine on the bow close fast on a
  gunship, planning to stop against its hull on that engine, and the burn that brakes them scorches it
  and then shoves them back out, so they hit and run without any rule saying so.
  **Hulls come apart, and it takes a blow to do it.** A ship is held together by welds derived from where
  its modules touch, each rated by its section. Damage decides how much of a weld is left; what spends it
  is the impulse that has to cross it, so a hit on an outlying module takes it off and the same hit
  amidships takes nothing. A round also cuts the welds it passes through, which is a gun shearing a wing
  off at the root rather than knocking it off. A beam carries no momentum, so nothing it does can *tear*
  anything: what it does instead is boil along every seam its tunnel crosses until one of them is gone,
  and whatever that seam was holding is then simply no longer attached. What comes away is a body of its own with its share of the momentum, the spin
  and the scars — a piece of ship with nobody aboard, which collides and takes damage like any other hull.
  **Craft carry a doctrine, and fight without being told to.** A blueprint can hold a block of named
  numbers saying what its craft picks a fight with and how it wants to fight it; a ship with an empty
  order queue chooses a target through a stack of preferences — what is close, what can still shoot
  back, what can still get away, what is its own size, what is coming at it, and what it is already
  fighting — and closes to a range that is a fraction of what its own guns are good for. A ship still
  worth shooting at earns neither of the first two if it is only *nearly* a hulk, which puts it behind
  every live one without a rule saying so; a ship that is a hulk outright — no working core, or no guns
  and no engines — is dropped from the list before it is scored at all, both a chooser's own target and
  each of its mounts', because a hulk can never be finished off and a fleet with nothing better in range
  would otherwise park on one forever. What size of target a craft goes for is a ratio to its own mass — one meaning
  "something my own size", which sends a fighter after fighters and a capital after capitals without
  either being told. An order given always outranks it, so doctrine is a fallback and never
  a second voice. How it closes is doctrine too, down a stopping curve: it speeds up on `accelerate` of
  the thrust it has towards the band, holds `approachSpeed`, and starts braking where `brake` of what it
  has the other way will just stop it at the edge — both read off the layout in the heading it is
  holding, so a hull that keeps its guns on target brakes on its retros. The `standoff` scenario is the evidence: two fleets a kilometre apart, not one order
  between them, and a battle anyway.
  **Every mount picks its own target**, through the same preferences the hull uses but from the mount's
  point of view: its own gun's reach, and nothing outside the arc it can train through — so a ship with an
  enemy on each beam fights both, and a gun that cannot reach what its ship is fighting fights what it can
  instead of sitting pinned against the edge of its arc. A further preference, for what the ship as a whole
  is fighting, is what keeps a broadside concentrated without tying it together; an order given is still
  obeyed by every mount that can train on it. How often a mount reconsiders is derived from the mount:
  half a circle of traverse plus a firing cycle, which is what it costs to swing onto something new and
  get a shot away. **A mount can carry targeting preferences of its own**, written beside it in the
  blueprint as only what it wants differently from its ship — so the gunship's eight-barrelled beam guns go
  after whatever is small, close and still dangerous while its bow gun fights its own weight class, and a
  hull whose doctrine changes takes its guns with it except where a gun has an opinion. Everything a mount
  asks is measured from the gun rather than from the hull it is bolted to, which is both the truth and
  what leaves a pair of beam guns taking a threat each rather than both piling onto one.
  **A gun holds its fire rather than shoot through its own side**: a straight cast from the muzzle at
  this instant, ignoring everyone's velocity, out to a moment of the round's flight for a gun and the
  whole length for a beam — which arrives instantly along all of it. What it is shooting at is never in
  the way, whoever's side it is on, and neither is wreckage. Whether it matters is a question about
  formation: fleets meeting line abreast have their friends beside them, and the `column` scenario is the
  same fleets in line ahead, where the opening ten seconds go from twenty hits on one's own side to none.
  **A doctrine also says which part of a ship to shoot at**, as a weight per kind of module. The default
  is the core first, then guns, then engines, and structure a long way behind all three: a ship whose core
  is out has stopped fighting altogether, one that cannot shoot has stopped being a threat, one that cannot
  move has stopped being a problem, and structure is what is left when there is nothing better to hit.
  Picking a part costs accuracy — a part is a smaller thing to miss — so a fleet trades fewer hits for
  hits that matter, and a core is the smallest and best-buried target of the four. It is also amidships,
  which is where the seams are: aiming there cuts spines, so hulls come apart far more often than they
  did when everyone shot at the guns. A doctrine that would rather not choose sets all four weights to
  zero and shoots at the ship. Away from the default is where crippling beats killing: the Dinky puts
  engines first, because a fighter that cannot destroy a capital can still strand one.
  **A ship is flown from a core** (§4), and one whose cores have been shot out is a hulk with sound
  engines and sound guns — so a mission kill is a place on the hull rather than a tally of mounts, and a
  ship worth its mass carries a second core, because a hull cut between two of them is two ships. The
  `split` scenario is that sentence made visible: the Catamaran is two hulls joined by a footbridge of thin
  structure with a core in each, a corvette is sent through the bridge at sixty metres a second, and the
  two halves pick up the enemy across the field on their own doctrine without being told anything.
  **Ships breed.** A blueprint is mutated into another: the numbers in its modules, the numbers in its
  doctrine, and its shape — a module added, copied onto a free face, or taken off. What decides whether a
  mutant is a ship is the layout rules themselves, which refuse a candidate rather than repair it, since a
  repair rule would be a second opinion about what a ship is. Two things make that affordable on a hull
  that is a tight packing of boxes: a size changes by moving *one* face, so the opposite face stays against
  whatever it was attached to, and whatever sits against the face that moves goes with it, so a module can
  grow into a neighbour rather than be refused; two touching modules can also trade the face between them,
  one growing into space the other gives up; and everything moves in whole grid steps, so faces that were
  flush land flush. A module written inside an assembly is written once however many copies are placed, so mutating it
  changes every copy and a wing that grows a gun grows it on both wings. Whether a generation is structural
  is settled before the retrying starts rather than inside it, which is what stops the rare, hard edit being
  crowded out by the common, easy one; and a child is written back to a file the editor opens. **What it reaches for is
  weighted by kind, and the weights are a run's to set.** They are not equal things at the half-metre a
  guess arrives in: thrust follows the nozzle's area, so six small engines are six small engines' worth of
  push and, spread about the hull, torque as well — where six small guns are six peashooters that one grown
  mount beats outright, and six small plates are ballast. Guns and hulls want *size*, which the operator
  reaches by growing one module over many generations rather than by adding more, so engines are what it
  tries most often. The same weights govern a module *refitted* into another kind, which is the only route
  to a large module of a new kind; a run that asked for engines and went on turning its engines into gun
  mounts half the time would be answering a question nobody asked. A refit keeps the space rather than the
  coordinates, because a thruster's position is where it is attached and every other kind's is the middle
  of its box — left alone, the numbers slide the module half its own length into its neighbour, which
  refused every refit into an engine there was. **The grouping is bred as well as the
  modules.** A lineage can make a part of a module, dissolve one back into the layout, take a neighbour into
  a part, grow one with a new module — on its outer edge by preference, which is the face likely to be free
  at every instance rather than at one, and the only way a part placed twice grows at all — place another
  instance of one — reflected as often as merely moved, since a ship is symmetric or
  it flies crabwise — drop an instance, and turn one over. Making a part and dissolving one change nothing
  about the ship at all: what they change is what the next generation can do, and there is no single
  mutation that both invents a grouping and pays off at once. Every operator has its inverse, because one
  that can only add structure is a ratchet a lineage has no way down from. A doctrine number
  is perturbed by a fraction of its *default* rather than of what is held, so nothing that has reached zero
  is stuck there — and where the default is zero too, by a fraction of what a number is worth in that half
  of the doctrine, since otherwise every draw is a fraction of nothing and the field is not slow to find but
  unreachable. **A run can start from nothing**: the Bare Core is a single control compartment that cannot
  move, shoot or turn, so everything a lineage from it ever has is something selection paid for — where a
  seed with an engine on it has already been told which way a ship is meant to go.
  **A match is fought and scored.** A handful of designs are put in an arena together — every entrant its
  own side, evenly round a ring, on a heading it did not choose — and the battle is run until one of them is left or
  the clock runs out. Three things are scored in the one match rather than in separate kinds of match,
  because the trade between them is the interesting part: surviving, damage done, and and **ground gained** on a point
  worth reaching — that last measured from where a craft started rather than against the goal outright, so
  standing still is nothing, closing is positive and drifting away is negative. It falls away with distance
  for ever rather than stopping at a range, since a flat region is one selection cannot see across and a
  hull whose engine is too feeble to cross it would score exactly what a hull with no engine scores. Each is scaled to run from nothing to one before it is weighted — a
  whole match survived, the whole of the opposition destroyed, a match spent sitting on the goal — so a
  weight says what an outcome is worth rather than what a joule is worth. **What keeps a ship in the match
  is a working core and nothing else**: not whether it still has a gun or an engine, since those are meant
  to pay for themselves by doing something, and a score that pays for merely carrying them makes the
  cheapest possible improvement to any design a weapon it never fires. Survival is weighted by what is left
  of the core rather than counted while it holds out, so a hull being shot to pieces scores less every step
  it takes it, and armour and layout are worth something before the moment they save a ship outright. Damage is credited to whoever
  fired, which is the one thing a fitness function cannot get from what a hull has taken, and it is capped
  per victim, since a gun must not be paid for firing into something it has already killed. What is left of
  a match that ends early is credited to whoever is still standing: without it, winning outright scores less
  than failing to land a shot for the full two minutes. **A match ends early only when nothing more can be
  scored**: with nobody left, or with one left and the goal not counting. While the goal counts, a survivor
  still has it to fly, and is scored on flying it rather than frozen where the last kill left it. One ship to
  a match is allowed, and is a test of piloting alone. A four-ship match runs in a quarter of a second,
  about three hundred times faster than the battle it simulates.
  **The objective is an object, and a ship goes to it because its doctrine says to.** The goal is a marker
  hull on a side nobody is on and nobody is against: never shot at, and protected, because an objective that
  can be destroyed stops being one and a doctrine that has learnt to ignore a wreck would learn to ignore
  this. It is a hull rather than a coordinate so that it is solid — sheltered behind, run into, and shoved
  out of somebody's way — and so that a ship can be *told* to go to it, every order in this game being
  relative to an object. It can instead be a **ghost**, a ship still there to be escorted and scored against
  that nothing collides with, shoots through or moves, so ships either side of it can still fight across it. What takes a ship there without being told is **escorting**: a weight saying how
  much a craft would rather be with something it will never shoot at than at the best fight it can find, so
  covering a consort is one preference argued against the rest rather than a mode the ship is put into.
  A craft escorting stations on its charge and fights on with whatever its mounts can reach, since where the
  hull goes and what the guns do are different questions, and it holds a band of its own rather than the
  gunnery standoff — where you sit to *shoot* at something being the wrong answer by an order of magnitude
  for something you are covering.
  **Where a craft goes is several wants added up.** Holding the station it has been given, staying with what
  it is covering, and keeping out of everybody's way are not alternatives to choose between: each is a
  velocity it would like to have and how much it would like it, and the pilot flies their weighted average.
  One want is exactly that want, so a craft with nothing to avoid and nobody to cover flies its orders as it
  always did. Weighing them as *target scores* instead cannot work, and the reason is worth keeping: a
  target's score is a ranking rather than a measure of desire — a craft flies at the nearest enemy whether
  or not its score says it is worth anything, and at four kilometres that score is far below zero, so any
  positive pull at all wins and a fleet locks in place. Measured, every escort weight from 2 to 200 then
  produced the identical battle. Added as velocities, in a currency they all share, a craft does both at
  once: asking for a formation half as tight costs three per cent in closing on the enemy, and the knob
  means something all the way along instead of having a cliff in it.
  **A range band is measured from a hull, not from the middle of one.** A gun's reach is how far it can
  throw a round past its own muzzle and what it is shooting at is the hull, which is the same thing on ships
  of a size and nothing like it when a fighter attacks a capital: left centre to centre, a TIE's doctrine
  sent it to 460 metres from the middle of a Star Destroyer whose own radius is 1,073, so the station it was
  holding was a third of the way inside the ship and it flew into it.
  **Craft keep out of each other's way by where they will be**, not by where they are: how long until a pair
  is at its closest and how much room that will leave, since a bubble cannot tell a consort holding station
  a hull's width away from something crossing at two hundred metres a second. It is never applied to the
  thing a craft is flying at — where it wants to be relative to *that* is already decided, and a second
  opinion would have a ship told to ram sheer off at the last moment and call it seamanship. It costs a
  quarter of the contacts in the Star Wars scene and a third of those between a fighter and a capital, half
  in the swarm and two thirds in the column; what it does not do is stop fighters flying through each other,
  whose bubbles are as small as they are.
  **Generations are bred and run.** A population is seeded from the ships a run is started with and mutants
  of them; matches are drawn until every design has had its hearing — fewest meetings with whoever is
  already in the match, then fewest matches played, then the draw, since a design that has only ever met one
  opponent has been measured against that opponent rather than against its generation; and what breeds is
  drawn by score against a uniform number rather than taken off the top, so a design that drew a hard group
  is not thrown away on the strength of one battle and the worst is never impossible. The winners carry over
  unchanged as well as breeding, so a design that won on a lucky draw has to win again. `npm run evolve`
  fights a run headlessly and writes it down: every generation, every design in it with the blueprint it
  flew, and every match with the seed it was fought under — which is all it takes to watch any one of them
  again, and a test fights every match of a run a second time to prove it. Three hundred matches take twenty
  seconds.
  **A run is measured against something that does not evolve.** Fitness is scored against the rest of the
  generation, so a rising mean says the population beat itself and a flat one says nothing — a fleet getting
  uniformly worse looks exactly like one getting uniformly better. Every design of every generation is
  fought one against one against a fixed opponent, under seeds paired by slot so that two generations differ
  by their designs and by nothing else. It is measured *afterwards and never during*: it must not reach
  selection, or a run learns to beat that one ship (§7), and a record already holds every design it ever
  bred, so the measurement can be taken again with a different opponent whenever the question changes. A run
  measured against the ship it started from says how far it has come; the same run measured against **its
  own final design** says how bad things used to be, which is the only yardstick available to a run that
  started from nothing.
  **A run is set going and watched on a page.** What a run is scored on, how big it is and how long a match
  lasts are settings on a form rather than flags on a command; it is fought in slices a few milliseconds
  long between frames, so the page goes on answering while it runs, and what is drawn is the match the run
  is fighting rather than a re-enactment of it. The chart is the way in to a generation as well as a picture of the run:
  pointing at it reads off what every line was worth there and names the generation under the cursor, and
  clicking takes the table, the matches and the ships to it — held down and dragged, it seeks, and the ships
  redraw as it goes, so a run can be scrubbed through and watched changing. One button says *latest*, and
  puts the panel back to following the generation being fought — there is no list of generations to pick
  from, a thousand of them being a worse way of doing what the chart does better. The three sources of score are plotted apart as
  well as together, because they move at different times — a population learning to fly reaches the goal long
  before it learns to shoot, and a total hides that behind one rising line. **What the page shows while a run
  grinds is the population, not the fight.** A run fights hundreds of times faster than real time, so a window
  on whichever match is in progress is a fraction of a second of each and a flicker to the next — a picture of
  nothing, refreshed. A generation drawn as its ships, best first, changes at a pace worth watching: bare cores
  growing an engine, a wing appearing on one design and then on half of them. Every ship is drawn at one
  scale, the one that fits the largest on show, and it eases rather than jumps, so seeking through a run
  shows the ships growing rather than each refitting to its own tile; the editor eases between ships the
  same way. The battle view is still there
  and is for *whole* battles: any match of any generation is
  fought again from its seed at whatever speed suits, which is the same match that was scored rather than a
  second one assembled to look like it, and one finishing puts on the run's most recently finished match —
  or holds, if nothing newer has finished — so what it shows is a sample of recent battles rather than the
  opening moment of all of them; and the design a run arrived at goes to the editor's library to be
  looked at and taken apart. **What the page will not do is name a best design across generations**, because
  no such number exists: a fitness is a score against that generation's opponents, so a population that
  learns to fly before it learns to shoot peaks while nothing can shoot back and reads as declining while it
  improves. The yardstick is offered instead, fought on the page in the same slices as the run and drawn as
  its own line over the ones that only mean something within a generation. **Settings are a file.** A run is decided entirely by its seed and its
  configuration, so those few numbers are the whole record of what was tried: they are written out and read
  back as JSON, by the page and by `npm run evolve` alike, so an experiment can be kept beside its result,
  sent to somebody, or designed on the page and then fought overnight headlessly. Every field is optional
  and anything left out is the default, angles are degrees as they are in a blueprint file, and no budget is
  `null` because JSON has no infinity.
  **A weapon can be let into a hull rather than sat on top of it.** A hull gun and a hull beam are a
  block with a barrel or a lens out of the front, welded on by the block alone, training about the
  root of the barrel through whatever angle the opening leaves them — which is single figures for a
  row of guns and twenty-odd degrees for one. They carry two and a half times a turret's bore on the
  same width and five times its muzzle energy, and they can point it almost nowhere. Measured on a
  beam, the opening turns out barely to constrain one at all: a lens is a fraction of the width a row
  of tubes is, so what holds a hull beam is the mounting limit until its housing runs most of the
  length of the module.
  **An engine has a nozzle rather than being one.** A thruster's length divides between a machinery block
  and a bell, and the bell's share is the knob: a long one is lighter, keeps more of the thrust pointed
  the right way and throws a longer flame, while the block is what has hit points and what the engine is
  welded on by — on any face but the exhaust. The exit may be divided between several nozzles, on the same
  field a gun counts barrels with, and the count buys expansion rather than power. It cost the shipped
  fleet thrust: their engines are wide and short, which is a bad bell, and a corvette lost 3% of its
  acceleration and a fighter 19%. That is the law being right about hulls drawn before it existed — the
  answer for them is a cluster of small bells, which is a change to the ships rather than to the law.
- **Next:** §8 step 3 is done bar what it deliberately deferred — withdrawal, and the line-of-sight,
  hemisphere, looking-at and ship-type pickers. Evolution is built and runs both headlessly and on a page
  of its own; what it has left open is in ROADMAP.md §12, the arena radius being an absolute where a ratio
  belongs chief among them. ROADMAP.md §8 lists what is left of each partly built step, then the steps not started. Slice 1 has one
  thing left in it, not blocking: unlinking one copy of a shared part while the
  others stay linked. Restructuring a group — dissolving one, or nesting one inside another —
  is deliberately not part of it and is §8 step 6, after v1.
- **Blocked on:** nothing.
- **Owed:** nothing outstanding. The `duel` golden scenario discharges the coverage that was owed
  for thruster allocation and turrets: it drives both through the same loop the game uses, so a
  change in either moves its checksum. Blueprint compilation is not owed one — it is pure derivation
  with no state to drift, and is pinned by unit tests against independently worked values.
- **Measured:** breeding is neutral about how big a ship is — 800 generations deep, a gunship's line
  added 62 modules and took off 59, at 3.7 candidates drawn per child, with a structural edit landing in
  121 of the 800. That balance is a calibration and not a coincidence: a module is harder to bolt on than
  to take off, so drawing the two evenly breeds a line that loses a module whenever it gains one and ends
  as a hull with no guns on it.
  Integration costs ~0.19 microseconds per body-step. Ray queries
  against 140 bodies at 2,000 casts per step cost 0.16 ms through the grid versus
  0.79 ms brute-force — 5x, and about 1% of a 16,667 microsecond frame budget at
  60 Hz. Neither is the bottleneck at this scale; the gap widens with projectile
  count, which is the direction of travel. A whole gunnery step — bodies, index
  rebuild, and projectiles under gravity — costs ~7 microseconds with 9 bodies and
  ~65 rounds in the air. Listing a ship's modules in a different order moves it
  8.2e-13 m over 3,000 steps of manoeuvring and gunnery, and grouping them into
  assemblies moves it not at all, bit for bit: module order reaches thruster
  allocation and firing, but both are order-independent in substance. Shots fired
  and hits scored are identical too. Measured by `scenarios/ordering.ts`, which
  flies three gunships of one geometry both stacked in one battle and one to a
  battle each.
- **Last updated:** 2026-09-23

---

## 1. Goal

A game I'd enjoy playing and want to show people. Hobby scale is a success; a small
release is the hope. The research/sandbox side that the original project grew into is
kept as a *mode*, not as the point.

**A second goal, and a real one: this should stay useful for work.** The stack was picked partly to
learn TypeScript, React and WebGL — the day job is moving that way and this project gets there first
(see §5). So where a technical choice is otherwise balanced, the one that teaches something
transferable wins, and running *ahead* of the work toolchain is a feature rather than a risk.

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
| Cost | **There is no abstract cost value for anything.** A ship costs the materials that make up its dry mass, the time to build it (from a module-complexity metric, deliberately not yet pinned down), and the propellant and raw materials it consumes running. Those are the only currencies, and every budget — a skirmish allowance, an evolution fitness penalty, the price of a better material — is denominated in them. Points values are what a game reaches for when it has not decided what a thing really costs. |
| Scarcity | Ammunition and propellant are limited. This is what makes engagement-range and manoeuvre doctrine matter rather than being sliders nobody touches. |
| Orders | Every order is *(target object, allowed distance range, allowed approach-angle range)*, mostly defaulted from doctrine — so issuing one collapses to picking a target. Fixed points in space rarely make sense; orders are relative to objects. A ship holds a **queue** of them and works through it in the order given, each carrying the condition that finishes it. |
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
  *loadout choice* rather than a hard immunity — hard immunities frustrate players. The mechanism
  under that, and the engine split that decides how thoroughly a stripped ship is disabled, are in
  ROADMAP.md §12.
- A **turret module includes the bit of hull it mounts to**, so the blueprint editor stays a single
  2D view and "is this shootable by guns" is a property of the module you picked.
- **A weapon may be let into the hull instead of sitting on it.** A hull gun and a hull beam are a
  block with a barrel or a lens out of the front of it, and the block is the only part other modules
  may be welded to — a gun is not a girder. They carry a far bigger bore than a turret of the same
  width, because a turret's is small in order to fit inside a ring and then be swung, and they pay for
  it in having almost nowhere to point: a hull mount trains about the root of its barrel, and the
  barrel has to stay inside the opening it comes out of.
- Large modules may be flagged as **protruding** into the weapons layer: useful, but gun-vulnerable.
  *Not implemented.* Firing arcs, traverse limits and projectile hits currently treat every module as
  though it were in the weapons layer, which contradicts this section in three different ways —
  ROADMAP.md §12 tabulates them.
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

- **Connectivity graph** per hull, and it is built (`sim/connectivity.ts`). Two modules are welded
  where their faces touch, and the weld is worth its section — the contact by the thinner wall meeting
  there — rated as an impulse. **Damage weakens a weld; a blow parts it**, and the load through a weld
  is the impulse that has to cross it: the far side's mass by the velocity change there. A weld cut
  through its section by rounds passing along it parts with no blow at all, since a cut weld is not a
  weak one but an absent one. When damage
  disconnects a subgraph the detached chunk becomes a body of its own inheriting `v + ω × r`, with
  mass properties recomputed on both sides, so momentum and angular momentum come out where they went
  in. This gives ships breaking in half, losing engines and tumbling, and wrecks to salvage — the good
  part of the old jointed-assembly model — without a constraint solver. **Which pieces keep being ships
  is a question about cores**: every piece with a working core goes on being a ship, and the piece
  holding the lowest-numbered one is the ship that was already there.
- **A collision costs both hulls the energy the bounce did not give back**, spent from the faces that
  met and working inward until it runs out, so a ram folds a nose in rather than putting a neat hole
  through a ship. Half to each hull, which needs no rule about which is the harder: a module's capacity
  goes with its mass, so the same energy that dents a capital ship destroys the fighter that flew into
  it. That is what makes §3's strike craft literal — a torpedo is a fighter that crashes into things.
- **A hull weapon is a block with a barrel out of the front of it**, which is an engine the other way
  round and answers the same questions the same way. The block is the breech and the loading gear, or
  the bank and the plant; it is what has walls, an interior and hit points, and it is the only part
  the ship may be welded to. How the length divides between the two is the designer's, and it is the
  archetype's one real knob: barrel length is what a charge accelerates a shell down, so a long barrel
  is a fast shell — and a long barrel sweeps further for the same angle, so it is also a weapon with
  almost no traverse left.
- **A hull weapon trains about the root of its barrel**, because that is where the trunnions of such a
  mount are: the block is welded into the ship and only the tube moves, so it trains briskly through
  very little. **How little is geometry rather than a number** — the barrel has to stay inside the
  opening it comes out of, so the far corner of the swung tube must not pass the mount's own edge.
  A longer barrel trains less, a fatter one trains less, a wider mount trains more, and a mounting
  limit holds the whole archetype well short of a turret's field of fire however small its barrel,
  since a bed that takes recoil faces one way. On top of that sits the same question every mount is
  asked — what the ship itself is in the way of — and the narrower of the two wins.
- **The block behind a hull gun's barrel is its loading gear, so how deep it is sets the rate of
  fire.** Depth is counted in calibres of the round the machinery has to move, so the same
  proportions mean the same rate whatever size the mount is drawn at, and a share that leaves the
  expected depth loads at exactly a turret's rate for that bore. Part of a cycle is fixed however
  much machinery stands behind it — the breech, the ram, the run-out — so the knob approaches a
  ceiling of about four times that rate rather than running away with it. **That is what makes the
  barrel/block split a real trade rather than a slider with one good end**: every metre given to the
  barrel is muzzle velocity bought with rounds per minute, and traverse falls out on the velocity
  side. Sustained throughput therefore peaks in the middle, at a little over half the module given to
  the barrel.
- **A hull beam's block is its bank and its cooling, so depth buys duty rather than only burst.** The
  burn grows with the bank behind it and the recovery does not — the plant and heat sinks that refill
  it scale with the same machinery, so the volume cancels and the recovery is a property of the
  technology rather than of the mount. A deep mount therefore spends more of its time firing, which is
  the only figure that matters over a battle; a flat duty cycle would have made a bigger bank buy a
  longer shot and an exactly proportionally longer wait, and so buy nothing. The lens housing earns
  the beam nothing in return, since the aperture comes from the mount's width — so the knob on a hull
  beam is one-sided today, the minimum housing being the best housing, and what would make it a trade
  is the housing buying focus, which ROADMAP.md §12 holds with the rest of the optics.
- **A weapon carries the gear that trains it, and a layout may say how much arc to build for.** Until
  this a mount weighed its barrels and the machinery that loads them, as though it were pointed by hand.
  The `traverse` a layout asks for is a *limit* — the archetype's own arc and whatever the ship is in the
  way of still apply on top — and what it costs is where the two archetypes differ, by the machine rather
  than by a rule. **A turret's ring goes all the way round whatever it is told to do with it**, so
  limiting one is programming and weighs exactly the same. **A hull weapon's bed is built for the arc it
  sweeps**, so a narrower one is a simpler machine and a lighter one, and a mount told to train nothing at
  all is a gun welded to the ship carrying no training gear — which is how a very light hull affords a
  very large bore.
- **A hull mount's outlets share one weapon, as a turret's barrels do.** Tubes divide the bore, so
  more of them trade weight of shell for rate of fire and muzzle speed; lenses divide the optic's
  area, so total power is unchanged and each lens is `1/√n` as wide. A capped fraction of the mount's
  width still bounds the row, and keeps room for the barrel to swing into.
- **An engine is a machinery block with a bell on the back of it**, not a nozzle with a plume coming out.
  The block holds the chamber and the pumps, is what the engine is welded to the ship by, and is the part
  that has walls, an interior and hit points; the bell is sheet metal in the exhaust that can be bolted to
  nothing. How the engine's length divides between them is the designer's, and it is the one knob on a
  thruster that is not simply "make it bigger". **Its length buys expansion**: gas leaving a bell of
  half-angle `a` keeps `(1 + cos a) / 2` of its momentum along the axis and throws the rest sideways, so a
  bare throat loses half of everything and length recovers it — steeply at first and then barely, which is
  what stops an engine being all nozzle. The same number sets how far the flame carries, since a jet
  already flying apart spreads to nothing close in. **The exit face may be divided between several
  nozzles**, counted by the field a turret's barrels are counted by and called Nozzles in the editor. They
  share one chamber and divide one exit area, so the count is never free power — what a cluster buys is
  that a narrow bell collimates in a fraction of the length a wide one needs, which is how a stubby engine
  gets a good nozzle, and a flame combed into fingers rather than thrown as one sheet.
- **How hard the nozzle is fed is the machinery's business, so the split has a best answer in the
  middle.** Thrust is the exit face's area times what the chamber and pumps behind it can drive through
  the throat, and that machinery is the block the bell was cut out of: a shallow bell leaves a deep
  chamber and more flow, a deep bell leaves an engine with nothing behind it. A throat chokes rather than
  passing whatever is pushed at it, which is what stops a long thin engine being unbounded thrust. So the
  two halves of the knob pull opposite ways — flow gained is aim lost — and the best engine is neither
  all bell nor all chamber. An engine whose nozzle has fallen off throws its gas sideways however hard it
  is pumping.
- **An engine is bolted on like any other module.** It carries the machinery it needs, so it may be held
  on by any face, to anything, the same way a gun mount or a plate of hull is — the only rule about where
  one may go is the one every module obeys, that it is attached to the ship. An engine mounted with its
  exhaust into its own hull is a bad design rather than an impossible one, and what says so is the plume:
  it burns what it is pointed at, and the thrust fired into the ship is thrust the ship never gets.
- **An engine burns and shoves what it is pointed at.** A plume reaches back from each nozzle as far as the
  thrust being produced and the bell allows, and the first thing standing in it takes the engine's power —
  at full strength against the nozzle, falling off to nothing at the flame's end — and the exhaust's
  momentum with it, so a plume on a hull's flank spins it as well as drives it away. Each flame is sampled
  by **three rays across its own nozzle**, each carrying an equal share of the gas and reaching as far as
  the drawn plume does at its own offset, which is a third of the way out for the two at the edges. So a
  plume is wide at the nozzle and a thin core further out, and something beside the axis is burnt rather
  than missed. Per nozzle rather than per engine, because three rays stretched across a cluster's whole
  face would fall in the gaps between its flames.
- **An engine gets no thrust for exhaust it fires into itself.** A ray that runs into the ship's own hull
  hands its momentum back to the hull it was pushing: the push on the blocked module and the thrust off
  the nozzle are the same newton-seconds with opposite signs, so that third of the engine is not thrust at
  all. A nozzle's own obstruction is fixed geometry — damage stops a module working without moving it — so
  it is worked out when the design is compiled, and what comes out is the fraction of the exhaust that
  escapes. **`ThrusterLayout` flies the engine at that fraction**, so the allocator, the manoeuvring
  envelope and everything the editor claims about a ship all read the honest figure without knowing why.
  A blocked ray still *burns* what it is buried in; what it no longer does is push. That is what makes a
  buried nozzle cost something instead of being free, and it is why the plume the renderer draws is the
  rating rather than the delivery: the gas is thrown either way.
- **An engine can be pointed at things on purpose.** A thruster marked `weapon` in the blueprint burns
  flat out on its own account whenever an enemy is in the half of its plume that still delivers real
  power, whether or not the pilot wanted thrust — and the ship wears the push, which is what the weapon
  costs. A flag rather than a kind of module, because an engine used this way is the same engine: it is
  still what moves the ship, still costs what an engine costs, and may still be the only thing holding a
  heading. What a designer chooses is a *role* for a mount already on the hull, which is why breeding can
  flip it. What it will not burn is what a gun will not shoot: its own hull, a friend, wreckage, or a hulk
  that can never be finished off and is not worth being shoved about for. It is **opportunistic and not
  aimed** — nothing manoeuvres to bring an exhaust to bear, so this is a weapon for whatever gets behind
  you rather than a second gun. §12 has the aimed version.
- **Matter is conserved in a hull, not in the world.** Everything conservation buys — wreckage as free
  armour, a topology damage cannot change, a battered ship that gets sluggish rather than lighter — is
  about what a *hull* keeps, and none of it needs a shard to persist once it has left the ship. So a
  severed piece too small to be worth harvesting is never created, and one that has drifted clear of the
  fighting is let go. How far is "clear" grows with the piece's mass, so a shard goes as soon as it
  leaves and a serious chunk effectively never does — which makes "worth hunting down" fall out of the
  rule rather than being declared. What is discarded is counted, mass and momentum both, so the books
  can still be balanced.
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

  **Settled with the damage model: neither a step nor a smooth slide, but a list of responses.** A module
  carries the failure modes it is subject to, each saying how much of one capability survives at a given
  integrity — so an engine's thrust falls away and then cuts out with a third of the engine left, and a gun
  loads slower and slower before it stops. A module goes on absorbing damage after its last response has
  given out, because matter does not stop being matter. The list is the extension point: a jammed traverse,
  a broken barrel, a magazine that cooks off and widening dispersion are all responses that have not been
  written yet, rather than code that has to be restructured to admit them (§12).
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
  - **Both limits come from one drive.** The mount ring delivers torque proportional to the turret's
    mass, so acceleration is `torque / inertia`, and the rate limit is simply what that acceleration
    reaches in a fixed spin-up time. They are one mechanism described twice, not two numbers to balance:
    a mount cannot be sluggish off the mark and fast at the top end.
    - What makes that discriminate between mounts is **inertia**, which counts each barrel as a rod
      running out from the pivot rather than as part of the box the module is declared as. Mass cancels
      out of `torque / inertia` exactly, so without the barrels a mount's agility would depend on
      nothing but its footprint, and lengthening its gun would be free. With them, buying muzzle
      velocity costs traverse — a point-defence mount trains at over a degree a frame and holds a
      bearing against its own ship's manoeuvring, while a capital gun needs a steady platform.
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
  Built in `sim/collision.ts`, and geometry is the same two-stage question shots ask: bounding circles
  say which pairs *could* have met, module boxes say whether they did. Three approximations, all of
  them affordable because a collision here is a rare violent event rather than a pile of resting
  bodies: **one contact per pair of hulls**, the deepest module against the deepest module, where a
  manifold of two points would be needed to hold two hulls flat together; the contact acts through the
  **middle of the overlapping face** rather than a corner, so two ships meeting squarely shove rather
  than spin; and the overlap left after the impulse is corrected out over a few steps rather than
  resolved at once. A body with no hull does not collide at all — everything in a battle is a ship or
  the wreck of one, and a bare mass with a radius is not a shape.
- **The spatial index is for queries, not collision pairing.** At a few hundred bodies, testing every body
  against every other is cheaper than building an index to avoid it. What is expensive is thousands of
  projectiles, turret line-of-sight checks and blast radii each interrogating a small region every step —
  body count multiplied by query count. A uniform grid (rather than a tree) because everything moves every
  step, so the index is rebuilt in one linear pass with no hierarchy to rebalance, and cell traversal is
  plain ascending order, which keeps damage application order reproducible.
- **Weld on slow contact:** Heavily damaged modules are treated as having ragged edges and can become locked together on a slow contact. This merges them into one body for the simulation to track. This will work well with the wreckage harvesting mechanic as it creates larger chunks worth chasing down and harvesting instead of lots of tiny fragments.
  Similarly, ships can have docking ports that will allow them to connect to each other deliberately by bumping together gently. This could be used for refiling fighters or other larger craft, for example. Every case *removes* bodies rather than adding sustained contacts.
- **Thruster allocation** is solved **once per blueprint**, not per tick: given desired body-frame
  force and torque, find non-negative throttles minimising propellant, subject to
  `Σ uᵢTᵢdᵢ = F` and `Σ uᵢTᵢ(rᵢ × dᵢ) = τ`. Three constraints in a plane. Per-tick control is then
  a matrix multiply; recompute only when modules are lost. This is what makes 100 strike craft cheap.
  - **The achievable (Fx, Fy, τ) set is a 3D polytope that can be drawn for the player.** For a game
    whose depth is ship design, showing what a thruster layout actually bought is a headline feature.
    In 3D the envelope is 6-dimensional and undisplayable.
  - **A pilot only asks for torque from thrusters whose lever arms make it worth having.** An arm is
    torque bought per newton of unwanted force, so an engine nearly in line with the centre of mass is
    a dreadful way to turn: a sliver of twist, and a whole engine's thrust for the rest of the layout to
    cancel. Worth less than nothing once there is fuel to burn and a plume that burns what stands behind
    it. Useful is a fraction of the ship's own reach rather than any fixed distance, so the rule means
    the same thing on a fighter and on a capital. It bounds the *demand* and nothing else: the arm is
    real, the ship feels it, the allocator still trims it with the engines that do turn the ship, and the
    envelope drawn for the player is the same envelope.
  - **No two thrusters that undo each other ever burn together.** A pair whose whole wrench cancels can
    do nothing as a pair that either could not do alone, so whatever throttle they are spending on each
    other comes off — which matters beyond the fuel, since an engine burns what its plume is pointed at.
    Judged on the wrench and not on which way each pushes: a bow thruster and a stern one pushing
    opposite ways are a *couple*, which is how a ship turns on the spot, and are left alone.
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
- **A ship is flown from a core, and may carry more than one.** A core is the archetype that makes a
  layout a ship rather than a hull: a compartment of computing, priced by the floor it fills, and the
  anchor every rule about how a layout hangs together is stated against. It buys no capability, so what
  stops a ship carrying five is that each one is dead mass and a small one is fragile — and it is worth
  carrying two, because a hull cut between its cores is **two ships** rather than a ship and a wreck.
  A ship with no working core neither manoeuvres nor lays a gun, whatever is left of its engines and
  mounts, which is what makes a hit amidships worth more than stripping a battery one mount at a time;
  the floor on a core's machinery is low enough that half a metre square is a working one, since every
  craft here is computer-flown.
- **A module's position is where it is attached, which is its middle for every kind but a thruster.**
  A thruster is the one module with a side that means something: it is held on by the face it pushes
  from and exhausts out of the other, and a layout only cares where that mounting face is. So a
  thruster's position is the middle of that face and the engine runs back from it along its own
  facing — which is what makes an engine scalable by one number, since a longer one grows into its
  exhaust rather than half into the hull it is bolted to. Everything geometric goes through
  `moduleCentre`; the mounting face and the box's middle lie on the same line of action, so which of
  them thrust is applied at makes no difference to the force or the torque.

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
- **Deliberately a major ahead of the work toolchain.** `VEL.Wordwall4A` pins TypeScript 5.6; this
  pins 7, which is a larger jump than a usual bump because the compiler itself was rewritten. That is
  the point rather than an oversight: work will reach it eventually, and meeting its rough edges here
  first is exactly the transferable value §1 asks for. The same holds for React and WebGL, which the
  work repo does not use at all yet — so this project is the proving ground for both.
- **Accepted cost:** currently productive in Unity 6 on another project; that productivity is being
  given up deliberately. Also: allocation-free typed-array code is less pleasant than C# structs,
  and this is the main technical tax being accepted.

---

## 6. Data and persistence

- **SQLite via `wa-sqlite` on OPFS**, inside the worker, for evolution and analysis data. SQL is
  genuinely the right tool for "filter individuals by run, order by generation and score" — those
  queries already exist in `DebuggingScripts.sql`. The result is a real SQLite file, openable in any
  SQLite tool.
- **A blueprint places assemblies, not just modules** — named groups referred to rather than repeated, so
  that every copy of a part is the same part, a reflected instance makes symmetry structural, and a repeat
  count makes a long row of identical bays a single number. Resolved by `expandBlueprint` into the flat list
  everything downstream works on.
- **Blueprints are JSON** (`sim/blueprintFile.ts`), with angles in degrees so a file can be hand-edited and
  nothing derived stored, so a corrected scaling law reaches old files rather than being frozen into them.
  A file arriving from elsewhere is parsed rather than trusted, and the ships that ship with the game go
  through the same parser so that path can never rot unnoticed.
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

## 9. Practices

Seven things, and deliberately nothing more:

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
4. **The viewer driven in a real browser**, in `tests/browser/`, on one CI row. A renderer typechecks
   perfectly while drawing a black rectangle, and a control can be wired to nothing; neither shows up in a
   unit test or a checksum. These deliberately do not re-check the physics — the viewer and the golden
   `duel` run the same code — so they stay quick, a few seconds including the build. Kept out of `npm test`
   because that has to run from a cold checkout without a browser.
5. **Single-command headless runs** — `npm run battle -- scenarios/duel.json`. Re-entry from a cold
   checkout should be one command.
6. **A `CLAUDE.md`** for this project.
7. **A GitHub Pages deploy of the viewer**, published from `ci.yml` on green master. The point of it is
   the URL: the game is something to open on a phone or hand to someone, rather than something that needs a
   checkout and a toolchain. It is also the only honest way to try the real thing — worker boundary, host
   lifecycle, touch input — on a device that is not the development machine.
   Built in the job rather than committed. A bundle in the tree conflicts on every branch that touches a
   source file, and nothing would guarantee it matched the source it claims to come from, so it goes stale
   silently. It publishes only after the typecheck, test and browser jobs pass, because the published page
   is the one people are handed.

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
| The largest piece of a severed hull keeps being the ship | Size says nothing about which piece is still a ship; a core does. The piece holding the lowest-numbered working core is the ship, and every other piece with one becomes a ship too. |
| A core as a flag on an ordinary module (`core: true`) | Cheap, and it makes "is this an archetype, and what does it cost" two questions instead of one. A core is a compartment of computing with a mass of its own, which is what stops a ship carrying five. |
| One blueprint describing several craft that spawn already apart | A blueprint is one ship: two cores in two separate pieces is two designs, and allowing it means every rule about how a layout hangs together loses its anchor. |
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
