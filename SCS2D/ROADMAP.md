# Space Combat Simulation — Roadmap

What is not built yet, and what is not settled yet. The design these serve is in
[DESIGN.md](DESIGN.md); the record of decisions already taken is in [DECISIONS.md](DECISIONS.md).

**Status — what exists today — lives in [DESIGN.md](DESIGN.md) and is the single source of truth for it.**
This file says what is _left_, and only mentions what exists where the work left depends on it.

**Three documents, split by why you would read them.** Section numbers are global and stable across all
three, so a reference such as "§12" means the same section wherever it is written — which is why the numbering
inside any one file is not contiguous.

| File                             | Holds                                                            | Read it when                                |
| -------------------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| **[DESIGN.md](DESIGN.md)**       | Status, §§1–7 and 9–11 — what the game is, how it works, and why | Deciding how something should behave        |
| **[ROADMAP.md](ROADMAP.md)**     | §8 build order; §12 points at the open questions, now issues     | Picking up work, or deferring a decision    |
| **[DECISIONS.md](DECISIONS.md)** | The Decision Log                                                 | Asking why something ended up the way it is |

## How this document is maintained

**Work items and open questions are GitHub issues**, not entries here: ideas, bugs, the pieces left of a
step, and every open question. This file keeps the build order and what a finished step settled that later
work has to respect.

- **Labels.** One type: `bug`, `feature`, `balance`, `refactor`, `perf` or `question`. Any number of
  `area:` labels (`sim`, `weapons`, `pilot`, `doctrine`, `economy`, `evolution`, `editor`, `fleet-editor`,
  `battle-ui`, `render`, `livery`, `skirmish`, `campaign`). `idea` marks something recorded but not
  committed to.
- **A step in progress is a parent issue**, what is left of it its sub-issues.
- **A `question` closes with its answer in DECISIONS.md**, in the same change that settles it; the PR says
  `Closes #n`. An open issue reads as still open, so a settled one left open invites it to be re-litigated.
- **An idea that will not be done is closed as "not planned"**, so it stays findable rather than being
  proposed again.

**§8 is kept in three parts, so that what to build next is the first thing you read.**

- **Partly built** lists only what is _left_ of a step that has started, and links its issue. When a piece
  lands, describe it in Status; when nothing is left, the step moves to the table as built.
- **Not started** is the plan proper: the steps to come, in order, each with its issue.
- **Notes on what is built** holds what a finished step settled that later work has to respect — a constraint,
  a shape to follow, a trap already found. A note earns its place by naming the future work it bears on.
  It is not a history: measurements and the story of how something was arrived at belong in DECISIONS.md, and
  a description of what the code does belongs in Status. Delete a note once nothing left depends on it.

---

## 8. Build order

| Step    | What                                       | State        |
| ------- | ------------------------------------------ | ------------ |
| Slice 0 | Two ships fight, deterministically         | Built        |
| 1       | Blueprint editor                           | Built        |
| 2       | Terminal ballistics and the damage model   | Built        |
| 3       | Doctrine and orders                        | Built        |
| 4       | Headless evolution and analysis            | Built        |
| 5       | v1: skirmish                               | Built        |
| 6       | Editor restructuring                       | Built        |
| 7       | Two layers                                 | Built        |
| 8       | Fuel                                       | Built        |
| 9       | Docking, fuel transfer and fuel harvesting | Built        |
| 10      | Raw material                               | Built        |
| 11      | Power                                      | Built        |
| 12      | In-battle construction                     | Built        |
| 13      | Harvesting wrecks                          | Built        |
| 14      | Orders                                     | Built        |
| 15      | Mining                                     | Built        |
| 16      | React UI                                   | Built        |
| 17      | WebGL viewer (PixiJS)                      | Partly built |
| 18      | Campaign                                   | Not started  |

### Partly built — what is left

17. **WebGL viewer (PixiJS)** (#659) — Draw the battle with PixiJS v8 (WebGL) instead of Canvas2D, behind
    `BattleCanvas`, with Canvas2D kept as a setting until Pixi matches it. Wanted, roughly in order:
    - **Performance.** Large fleets are slow to draw even when paused, because Canvas2D fills every module as
      its own path every frame.
    - **Better hulls.** Decals and colour patterns on designs.
    - **Lighting**, mainly so the step up from the weapons layer to the fighter layer reads on a ship.
    - **Effects** (particles, glows), lower priority: Canvas2D's already look good.

    Pixi rather than raw WebGL, WebGPU or three.js — DECISIONS.md 2026-10-28 has why. The plan:
    - **One Pixi scene, drawn in true order**, not a WebGL canvas stacked under the Canvas2D one. Stacking can't
      draw fighters over robots over decks, which is why #522/#531 were closed. Canvas2D stays only as an
      overlay where it is simpler: the editors' handles and guides. Evolution charts and fleet thumbnails are
      not this step's concern.
    - **Most of it is canvas2d.ts drawing through an adapter** (`render/pixiCanvas.ts`), a Canvas-shaped
      facade over Pixi `Graphics`, so canvas2d.ts stays the one source for what everything looks like and
      runs in its true order; its paths are rebuilt each frame. What is hot moves to shared geometry
      instead, one thing at a time, as the hull fills have (DECISIONS.md 2026-10-29).
    - **Geometry is built once and shared**, which is DESIGN §5's "triangulate once, instance per ship":
      a `GraphicsContext` per module spec and colours, shared by every module drawn with them, so a ship
      that is severed or loses a module needs nothing rebuilt. `render/moduleFills.ts` is the one source
      for what a module is filled as, read by both renderers so they can't disagree.
    - **Positions go to Pixi relative to the camera**, worked out in doubles, so float32 on the GPU stays
      steady far from the origin (as #522's backdrop did).
    - **Input and picking stay as they are** (`render/picking.ts`, the engine's handlers); Pixi's event
      system is off on the battle canvas.

    Stages, each behind the setting: (1) **built** — **Draw: WebGL** in the battle's view options (kept for
    every page, Canvas2D by default) puts a Pixi canvas under the Canvas2D one, drawing the field, grid and
    wells (`render/pixiView.ts`, from `render/backdrop.ts`) while Canvas2D leaves its field clear; (2) **built** — capital ships' module fills
    (`render/hullLayer.ts`), which Canvas2D then leaves unfilled while drawing what goes over them; fighters
    stay Canvas2D, as they are drawn over robots and decks. Until stage 3, a ship's trigger band (arcs:
    trigger) draws over its fills rather than under them; (3) **built** — everything else, in draw order, through
    `render/pixiCanvas.ts`: details, robots, fighters, rounds, beams, plumes, flashes, icons, names, orders,
    strips and close-ups, with Canvas2D's canvas left clear for the selection box and placing ring. Its
    approximations: gradients are filled in bands, a fill is not cut to the outside of a shape (only a
    stroke is), and the strips are drawn afresh each frame rather than from their cache. The trigger band
    still draws over capital fills;
    (4) **built** — WebGL is the default, and then the only way: **Draw: 2D** was retired on
    2026-11-01, once WebGL ran well on a laptop and a phone (stage 5's second item); (5) how it looks — lighting, the editors in Pixi, liveries, part art, marks
    and effects, in the order and form set out below; (6) a pass over the stop-gaps, done properly alongside a refresh of how those things
    look rather than fixed in place: strips drawn afresh each
    frame without their cache, fills not cut by an outside clip, lines thinner than a pixel drawn a pixel
    wide and fainter, and whatever else is still drawn through `render/pixiCanvas.ts` that would be better
    as shared geometry.

    Settled for the Pixi version:
    - **No seams between modules.** Canvas2D's faint line between touching modules is an antialiasing
      artefact, and losing it is fine: plates of one colour merge. Edges come back with more detailed part art,
      such as rounded engine blocks, not with outlines drawn to imitate the seam.
    - **Text on a hull is in the Pixi scene**, in the ship's frame, so it is drawn on and turns and scales with
      the ship (a ship's name on its core today). `BitmapText` with a distance-field font, so it stays sharp at
      any zoom rather than blurring as a rasterised `Text` would.
    - **Overlay text** (range labels, labels over points, tile counts) is Pixi `Text` in a screen-space layer at
      the top of the same scene: one canvas, and fixed-size text never needs re-rasterising for zoom.

    **Lighting**, part of stage (5), in passes, the first of them alone to start with:

    - **Where the light comes from.** A battle carries its own light: a direction and a tint, with an
      ambient level, so each level or scenario can feel like somewhere different. A default for battles
      that set none. The camera never turns, so a direction fixed in the world is fixed on screen too.
    - **Two depths.** The scaling laws treat modules as many thicknesses; lighting treats them as two —
      thin (the hull layer) and thick (the weapons layer, the compiled `weaponsLayer` flag) — so the step is
      easy to read and simple to draw. Fighters are a third, higher depth.
    - **What is never lit:** gauges, icons, names, selection, orders and arcs are information, not surface,
      and a side's colours stay readable however deep the shadow. Emissive parts (engine bells, core
      lights) stay bright in it.
    - **Pass 1: environmental light and thick-module shadows.** The hull layer splits into thin and thick,
      still sharing each spec's geometry. Between them, a shadow layer draws the thick modules again in
      shadow, offset away from the light by a **fixed distance in metres** (so it scales with zoom like
      the hull), with **hard edges** — softened with one blur over the layer only if they look wrong. One
      mask made of every thin module keeps shadows off empty space, and lets a ship docked or hooked over
      another shade it. The details canvas2d.ts draws over thin modules (gauges, berth pads) are drawn
      after, so stay unshadowed, which suits them being information.
      **Fighters cast shadows in the same pass**: the shadow layer takes their modules' shared geometry
      too, offset further for their greater depth and masked to the thin hull alone, as the thick
      modules' are: a fighter flies at a thick module's height, so never over one. A
      shadow needs only the outline, so the fighters themselves stay drawn where they are, over robots and
      decks; the longer offset is what leaves the shadow apart from the fighter, so it reads as flying.
    - **Later passes**, in the order and form item 7 of stage (5) sets out below: leaks in shadow,
      dynamic lights, then lights shading bevels and rounded parts, and last and limited, shadows
      from dynamic lights.
    - **Lighting is the battle's**, render-only, so it never changes a result, but kept with a battle so a
      replay or export looks as it did. Scenarios set it; the skirmish draws a new one each round, so each
      round is somewhere new; evolution may draw one per match, which matters little.

    **The order of stage (5)**, each its own pull request or several:

    1. **Lighting, pass 1**, with fighter shadows — **built**. `render/light.ts` holds a battle's `Light`
       (`Battle.light`, the default where a battle sets none) and the two shadow lengths, 1.5 m for a
       thick module and 2.5 m for a fighter, judged by eye on ships of tens of metres; on a ship a kilometre
       across they barely show, the price of a fixed length. `render/hullLayer.ts` draws thin fills, thick
       modules' and fighters' shadows masked to thin hull, then thick fills, each
       shadow layer darkened through one filter so overlaps are no darker. A thick module is a block, so
       its shadow is each of its shapes swept away from the light (the hull round the shape and the shape
       moved), joined to its foot and made afresh each frame; a fighter's is its outline moved, apart from
       it, as it flies — 2.5 m, or 0.75 m for one on its carrier's pad, whether part of it or parked there (a step, until a fighter's
       height is drawn as it lands and lifts). Asteroids stand higher than any ship: thin rock twice a thick
       module's height, or 8% of the asteroid's radius on a large one, so the steps show on rock hundreds of
       metres across, shading ships' hulls beside it; thick rock twice as high, shading the thin; and a
       kernel a step higher again, shading its rock (on thin rock a little short, to spare a layer).
       Each shadow is as long as the caster stands above what it falls on. A pad's landing square is part of the
       pad's fill, so shadows fall on it. A capital ship's turrets' barrels stand on their domes as high as a
       thick module (a hull mount's are at the deck and cast nothing), their shadows (lines from `render/barrels.ts`, which the barrels are drawn from too) on the
       thin hull with the thick modules'. Still to do: rock shading a fighter flying close by, which needs
       a shadow layer over the fighters, above everything the adapter draws.
       **Each scene sets its own light**, from a palette in `scenarios/lights.ts` spanning the directions,
       tints and ambients from black shadows to soft, and **each skirmish round draws one from its seed**
       (`roundLight`), so a replayed round looks as it did. Neither is held to keeping a side's colours readable in
       shadow, as a ship is rarely all in shadow, so a light may be as dark as looks right.
       Only the hull layer is tinted: fighters, strips and close-ups, drawn through the adapter, are not,
       until they move to shared geometry with the rest of stage (2). The evolution page and custom battles
       keep the default.
    2. **The editors and fleet pictures in Pixi**, then **Canvas2D retired**.
        - The ship should look in the editor as it does in battle: its colours, bevels and so on, under a
          builder's light — white, from nearly straight on — rather than a battle's. One day the editor may
          be the battle itself, the camera turning to frame the ship; not yet.
          **Built**: the ship and fleet editors draw through a Pixi layer under their canvas
          (`pixiUnder`, as the battle does), handles and guides through the adapter, under `BUILDER_LIGHT`:
          white, from the default's bearing but nearly overhead, its `slant` shortening every shadow to a
          third. The fleet pictures share it.
        - The fleet pictures (evolution's kinds, the skirmish timeline) share **one**
          renderer drawing to images, since a page may hold only about sixteen WebGL contexts. **Built**
          (`host/fleetPicture.ts`): one `pixiView` on a canvas off the page, each picture copied out after it renders, once it has started.
        - The editors' handles and guides move into Pixi with the rest; evolution's charts
          (`render/chart.ts`) are not ships and stay as they are.
        - **Draw: 2D retired — built.** The battle view, the editors and the fleet pictures draw only
          through Pixi, nothing until it has started; the setting and its storage key are gone, and so is
          the benchmark's Canvas2D run. canvas2d.ts stays as what the adapter draws, until what it describes
          moves to shared geometry. Where WebGL is missing, Pixi's own Canvas2D renderer is the fallback
          (`preference: ["webgl", "canvas"]`), without what is done with filters (lighting, bevels,
          patterns); it is not expected to be used. The browser tests read what a view shows from a
          screenshot (`shownPixels`), and draw WebGL in software, waiting up to ten seconds by default for
          it to start. Still on 2D canvases of their own: the fleet strips down the battle's edges, and the
          fleet pictures' copies; moving the strips into Pixi is a stage (6) stop-gap.
    3. **Liveries.** A fleet sets a base colour, a highlight colour and a pattern, applied to every ship in
       it, replacing the side colours. Settled with the author on 2026-11-01 (DECISIONS.md).
        - **Whose livery.** A `Livery` lives on a `Fleet`, and on a `Blueprint` for a ship flying alone. A
          fleet's livery always wins: a ship's own is never used inside a fleet, and a fleet that sets none
          flies the side colours, not its ships' liveries. `shipFleet` copies a lone ship's livery onto the
          fleet it makes, so in the sim only a fleet's livery is ever read.
        - **The default livery is the side colours of now**, for a ship or fleet that sets none. Icons,
          strips and orders show a side by its base colour.
        - **Two sides too alike**: where a side's base colour is within some perceptual distance of an
          earlier side's, it flies its side colours instead, and the player's side is never the one to fall
          back. The editors give no warning, since the only known enemy there is a skirmish's, which the
          player cannot change.
        - **Markers — built.** A liveried side is told apart off its hull — its arrows, labels, strips,
          shots, swatches and name — by its marker (`liveryMarker` in `render/teams.ts`): its base made
          vivid, hue kept, or its highlight where the base is too grey to have a hue. Two sides are too alike
          by their markers, not their hulls, so two grey fleets with different accents are two sides, and a
          grey fleet's fighters still read as alive.
        - **Colours** are free choices of base and highlight; the trim and dark pivot tones a module needs
          are worked out from the base, as the side palettes' are now.
        - **Patterns**: none, stripes, spots or chevrons of the highlight, each with a few numbers — size,
          spacing, offset and, for stripes and chevrons, angle; for chevrons also how far each arm bends from
          straight and how far apart a zigzag's points are, none being a single chevron pointing at the
          design's middle — so evolution can drift them as it drifts colours. **Chevrons — built**: a
          zigzag's tile is a period across and a period of its points down, a single chevron's a hull's width
          down (`render/livery.ts`); evolution drifts the bend and the points' spacing, a single chevron
          staying one. A pattern is laid over the whole hull in the design's frame, so it runs on across
          modules. **Its sizes are shares of each ship's radius**, as bevels are, so a fighter and its
          carrier carry about as many stripes as each other; they will not line up across docked or welded
          ships.
        - **Parts that take the highlight on their own**, by fixed rule: a band across each engine block
          near the bell; turret domes, in place of today's trim; and pads' and ports' markings. Everything
          else, cores included, takes only the pattern on the base.
        - Drawn by a shader from each fragment's place in the design, so a module's geometry stays shared
          however the pattern falls on it.
        - **Fighters** show their fleet's pattern, in a darkened version of its colours, perhaps darkened
          less once edges are drawn on purpose and hulls look smoother. Rock, wreckage and ships without
          control keep colours of their own.
        - **A Livery panel**, collapsible, in both the ship and fleet editors: two colour pickers, a pattern
          picker and its sliders. The fleet editor edits the fleet's livery. The ship editor edits the
          design's own, unless it was opened from a fleet: then the panel says it is the fleet's livery, and
          edits go back to the fleet with the design.
        - **The library**: saving a fleet's design to the library copies the fleet's livery onto the saved
          blueprint, so it looks as it did while edited. A new fleet takes the livery of the first ship put
          in it, and never again after that.
        - **An enemy's livery evolves**: every mutant drifts its parent's a little — colours, pattern
          numbers, now and then the pattern itself — leaning away from the player's colours so the two sides
          stay told apart. A chimera or graft keeps its first parent's. The drift draws on a stream of its
          own split from the mutant's seed, so no search result and no golden moves. A skirmish enemy's
          first livery is drawn from the round's seed, far from the player's; each entrant of a
          single-ship run starts with a random one, drifting the same way.
        - **In four pull requests**, in this order:
            1. **Data and flat colours — built.** `Livery` (`sim/livery.ts`) on `Fleet` and `Blueprint`,
               read and written in files; `shipFleet` copies a lone ship's. A battle carries its fleets'
               (`Battle.liveries`), which `sidesOf` in `render/teams.ts` resolves to each team's palette
               and name, a side too like an earlier one (`TOO_ALIKE`, ΔE 30) taking the first stock
               colours unlike them all. The battle view draws inside `withSides`, so the module-level
               lookups (`shipColours`, `teamName`) answer for its sides and fall back to stock outside it;
               the swatches on the custom battle, skirmish and timeline pass their sides explicitly. A side
               is named by the nearest of a short list of named colours. The editors and fleet pictures
               still draw undecided ships grey, until the panel.
            2. **The Livery panel — built** (`features/livery/LiveryPanel.tsx`), in both editors: colour
               pickers, a pattern and its sliders, a drag one undo step. Opened from a fleet, the ship
               editor's design wears the fleet's livery (`wearingFleets`), and `backToFleet` gives it back
               to the fleet, the design keeping its own; saving it to the library from there saves the
               fleet's with it. `addShip` gives an empty fleet with none its first ship's. A livery never
               makes a design differ from its library copy (`differs`). Both editors and the fleet
               pictures draw in it; a ship with none is still drawn grey in its editor.
            3. **The pattern and the parts' highlights — built.** Not a shader in the end but a texture:
               `render/livery.ts` makes one tile per pattern, share and colour, and `patternTransform`
               lays it in the frame of the design a module was built in, a period `spacing` stripe widths
               across (at least one: spots that touch still leave gaps, and stripes are kept a little apart), so it runs on across modules
               and stays put on a piece cut away. The hull layer fills each module's hull-coloured
               polygons a second time with it (one shared context per module of a design, rather than
               per spec, where a side has a pattern); fighters, drawn through the adapter, take it by
               `createPattern`, which `render/pixiCanvas.ts` now has. A livery's
               highlight is a `Palette`'s `highlight`, which side colours lack: it bands each engine
               block a band's width in from its bells, fills turret domes, hull guns' mantlets and beam
               lenses' discs in place of the pivot tone, and marks pads' landing squares and ports'
               collars. The pattern falls on every part in the hull's three tones, thick modules and
               cores included, in the highlight itself, untinted; engines and hull mounts take none, so
               they stay told apart (`patternColour`).
               Engine bells are dark grey whatever the side.
            4. **Evolution — built** (`sim/liveryDrift.ts`). Every child `mutateFleet` or `offspring`
               makes drifts its parent's livery: hue, saturation and lightness of both colours, the
               pattern's numbers, and one time in twenty the pattern itself. Of two drifts it keeps the
               one further from its rivals' colours (a skirmish's player, a co-evolution run's other side),
               which is the lean away. It draws on a generator split from the breeding one without
               moving it, so a run or an answer is bred exactly as without liveries. `newSkirmish` paints an
               unpainted enemy from the skirmish's seed, the best of eight draws from the player's colour;
               `seedPopulation` paints every unpainted founder, a fleet's or a lone ship's, unlike the
               founders before it; and a match's battle wears each side's first entrant's livery. A
               skirmish saved unpainted stays so, its answers drifting nothing. Distances here are
               "redmean" RGB, arithmetic and a square root, so a run's file is the same on every engine.
    4. **Part art, first pass:** bevels on the hull's outside edges, and on the thick parts' edges, lit by
       the battle's light, and engine bells, barrels and turret domes shaded as rounded. Richer procedural
       parts come later.
       - **Rounded parts — built.** Engine bells and every mount's barrels are shaded as cylinders across
         them, and a turret's dome as a flattened hemisphere on a short cylinder, each by one image laid over
         the part (`render/shading.ts`): black where it turns from the light, white where it turns to it,
         clear where it faces up as the deck does, so it shades whatever colour the part is. Made once per
         angle of the light across the part, rounded to a twelfth, and kept. Drawn in WebGL only, as the
         shadows are. A hull mount's barrels run back into its block under a clip the adapter does not apply
         to images, so they are shaded only where they are out of the block, worked out from the line itself. With Draw: 2D
         retired, hull mounts' barrels, their shading and their mantlets belong in the hull layer under their
         module's fill, so the block covers a barrel's root however far it trains, and neither the clip nor
         `throughBox` in `render/canvas2d.ts` is needed.
         Docking ports are shaded as rounded across, block and collar. The dome's shadow is still the cylinder's; a softer edge to it
         waits on soft shadows.
       - **Bevels — built** (`render/bevels.ts`, drawn by `render/hullLayer.ts`): a strip inside each
         bevelled edge, as wide on every module of a ship as `BEVEL_OF_RADIUS` (1.75%) of its radius as built
         (0.3 m on a Corvette) and at most a quarter of how far the module reaches in from that edge, so a thin plate's short ends
         take the ship's bevel while its long sides keep a face, lighter as the edge faces the light
         and darker as it faces away; skipped under a pixel wide, so a battle seen whole pays nothing. An edge
         is bevelled where nothing beside it stands as high (asked every half metre along it), so a thick
         module's edge over thin hull is, and the thin hull's edge against it is not; an engine's and a hull
         mount's block only, and no asteroid's nor docking port's, which are round. Worked out once per compiled design and found through a
         module's `originOf`, which is how a piece keeps the edges it was built with. Where two bevels turn a corner,
         on one module or two, they are mitred rather than overlapping; a gap narrower than a bevel between
         modules is a seam; no bevel is deeper than its edge is long. Fighters' are drawn the same way by
         `render/canvas2d.ts`, which draws their hulls.
        - **Each edge of a module is bevelled or not**, settled once for the design as built: an edge on its
          outline is, an edge it shares with a neighbour is not, so module edges inside the hull stay unseen.
          A little simpler than bevelling the outline itself, and it should look as good.
        - **Severing keeps them**: the pieces, and the rest of the ship, keep the edges they were built
          with, so nothing looks bevelled just because something broke off it.
        - Open: whether a split edge should look rough.
    5. **Marks for damage — built**, in place of fading and wreckage grey: wear for how hurt a module is, and scars
       for the hits that mattered.
        - **Wear** — grime, dents and scuffs — is one texture in which every spot has a threshold of its
          own, shown once the module's damage passes it, by a small shader, the hull layer's first. Wear so
          spreads smoothly as damage rises and recedes in exact reverse as it is mended. Laid in the
          design's frame and offset by the module's id, as the livery is, so two modules hurt alike look
          different and a piece cut away keeps its wear; sized as a share of the ship's radius, so a fighter
          and a capital ship look as worn at the same share of damage.
        - **Scars** are kept by the sim, beside each module's damage, so a checkpoint carries them and a
          rewind, a replay or a link shows the same ones. They change nothing in the battle and are left out
          of the golden checksums, and the snapshot carries them out. Each holds where on the module it is,
          its kind, its direction, its size and the module's damage when it was made; mending below that
          takes it off, so mending peels scars off in reverse.
        - **A hit scars if it delivers at least a share of what breaks its module** (a tenth to start), so a
          round that craters a fighter's plate is only wear on a capital ship's armour. A scar's size is the
          cube root of the hit's energy, as a flash's is. A module holds scars by its area, about one per few
          square metres, at least one and at most about eight; when full, a new scar replaces the smallest
          if it is larger than it.
        - **Kinds**, each drawn along the direction of travel, since a hit arrives edge-on to the view:
            - **A round** leaves a gouged channel as long as it got into the module and as wide as the
              round, with a raised lip at the far end; one that went through ends in a hole.
            - **Fragments** of a burst join a peppering scar near where they land rather than being judged
              alone, which scars once what has joined it passes the threshold: a spray of small streaks
              along their travel. The burst itself does nothing to a hull, so leaves no scar.
            - **A beam or a plume** leaves a burn: blackened, with a glazed core. One held on a spot grows
              its burn rather than adding another; one that moves draws it out into a streak, up to a limit.
            - **A collision** leaves a gouge of scraped bright metal with buckled edges, along the way the
              hulls slid.
          Each scar's shape is drawn from the module's id and its slot, so scars vary but every replay
          draws them alike.
        - **A destroyed module is burnt out** rather than grey: its shape, scars and fullest wear, darkened
          to a sooty near-black that full wear never reaches, its livery faint through it, and its lights
          out — a core's glow, a gun's load, a gauge. A ship without control, a hulk and wreckage keep
          colours of their own, as liveries have them, and a ship's icon can still turn grey once it is
          out of the fight.
        - **Skipped under a pixel**, as bevels are: wear on a ship seen whole, and each scar by its own
          size, so a small one on a big ship goes before a big one as the view zooms out.
        - With no grey or fading, a ship looks the same for longer, so more of it is shared, and marks go
          on top. Nothing much leans on the grey: most modules already show whether they work (a core's
          light, a gun's load). Zoomed out, how hurt a ship is was never readable and need not be: picking
          it shows it larger.
        - **A module being built is bare metal — built**, not marked: its base colour and pattern are
          paint, so its walls (a shell) and then the module waiting for its fittings are drawn in greys
          close together (`BARE_TEAM`), lights out, and take all their paint at once when the last
          fitting is in. Wear, soot and scars follow damage alone, so the snapshot carries how much of
          each module is fitted (`ShipView.fitted`) beside its integrity rather than folded into it.
          A wreck being taken apart goes bare the same way as its fittings come out. Wanted, later: an
          animation of its paint going on.
        - Not settled: the threshold, the scars a module holds and how far a burn may streak are first
          guesses, to be set by eye.
        - **In three pull requests**, in this order:
            1. **Scars in the sim — built** (`sim/scars.ts`, held by `Damage`, so registered, carried
               through severs and remade hulls, copied into checkpoints and forgotten with it, and left
               out of `checksumDamage`). Rounds scar in `walkRound`, a fragment's as peppering; beams and
               plumes burn where they land, along their direction; a collision gouges each module the
               crush reaches, along the other hull's slide at the contact. A burn, peppering or gouge
               joins one of its kind within a quarter of the module's narrower side, drawn out no
               further than a quarter of its longer. The snapshot carries the scars showing
               (`ShipView.scars`, `SCAR_VIEW_STRIDE` apiece) and a version that counts changes. No golden
               moved.
            2. **Wear and burnt-out modules — built** (`render/wear.ts`), in place of fading and
               wreckage grey. Not a shader in the end but `WEAR_LEVELS` (16) textures cut from one
               threshold field, a sixteenth of damage apiece, so every module still batches; a shader
               taking each module's damage would draw each alone. Grime comes in broad patches, dents
               and scuffs in small clusters. The hull layer folds wear and soot into each module's
               cached fills, keyed by level, so thin and thick depths, shadows and patterns are as they
               were; fighters and the fleet strips take the same through `render/canvas2d.ts`. Wear is
               left out once a texel is under about a third of a pixel, soot never. A destroyed module
               keeps its livery under the soot. Its lights were already out — a core's, a generator's,
               a bay's — except the store gauges, which stay on a wreck so a salvager can see what it
               holds.
            3. **Drawing scars — built** (`render/scars.ts`). Each scar is a few ragged polygons in its
               module's frame, as wide as `WIDTH_PER_CBRT_JOULE` (4 mm) a joule's cube root, at least
               5 cm and at most 45% of the module's narrower side, and kept inside the box its drawn
               fills lie in, on an engine its block alone, so none lies on a bell or barrel: a round's dark channel ending in a hole or a light lip, peppering's spray of
               short streaks, a burn's scorch with a glazed core and a sheen across it, and a gouge's
               scraped metal between buckled edges. The hull layer builds each ship's scars into two
               contexts in its own frame, one over its thin hull and one over its thick modules,
               rebuilt only when `scarsVersion`, its design or the zoom's power of two changes, and
               leaves out a scar under 1.5 pixels wide. Not drawn on fighters, nor on rock.
        - **Leak holes — built** (`render/leakHoles.ts`). Each leak is drawn where its round went in, a
          dark hole as wide as it is open now, so it shrinks as its lining or a patch closes it, in a patch
          of scratched and buckled plate reaching 1.6 times the width it opened. The scratches stay for good
          once a lining has sealed it, and fade over `LEAK_SCRATCH_FADE` (3 s) once a robot or a pad has
          patched it; the snapshot keeps a hole until then, with its module and when it closed
          (`leakModule`, `leakClosed`), and the vapour is drawn only while it leaks or `LEAK_LINGER` after.
          Built like scars, into a context over the thin hull and one over the thick modules, rebuilt only
          when a hole narrows, fades, comes or goes. Not settled: the scratches' reach and fade, by eye.
    6. **Particles and glows.** Render-only throughout: nothing in `sim/` changes and no golden moves.
        - **The only explosions are shells bursting**, a cosmetic flash over the fragments that do the
          damage, and muzzle flashes are their kin. Both already look good; worth a look at whether WebGL
          draws them better or more cheaply, and both should light what is near them once there are
          dynamic lights. Modules exploding is a separate piece of work, sim and render together.
        - **One list of light sources a frame — built** (`render/glows.ts`): points and lines in canvas
          pixels, each recorded under the transform its pass draws in, and drawn as one additive pass at
          the end of the scene: a halo for a point, a capsule for a line (a band capped with a halo's
          halves). Flashes and bursts give a point each, a nozzle a point at its exit, a muzzle flash and
          a beam a line, and a burn a short line along the hull it is boiling off. Each emitter still
          draws its own core; the list is only the light round it, and the dynamic lights of step 7 read
          the same list. Plumes are lit as points at their nozzles until then, not yet as lines.
          Beams' lines are drawn after the glows, so the light does not wash out their colour. Burns and
          leaks are sprites now, so the adapter has no gradients left to fill in bands.
        - **Muzzle flashes — built**: one sprite per eighth of their growth, made from the discs the
          wedge was drawn with, so a flash is one or two quads rather than up to 64. A burst was already
          two sprites, and only its glow moved to the list.
        - **Short-lived particles are a function of their event and age**, not stored state: a straight
          line from where and how fast the event's hull was going, everything else drawn from the event's
          id. So pause, step, scrub and replay come free and look alike. Capped by dropping the oldest
          events. Sparks for round and burst impacts, bits of metal for collisions in place of their
          flashes, vapour from leaks (a steady emitter on a fixed grid of birth times).
        - **Leaks pinched off**, with the vapour particles: a self-sealing lining or a mending robot's patch
          narrowing a hole shrinks the plume back into the hole (the Effects page's Leaks scene shows
          both), where the fuel already out should drift on and thin while the source narrows. Vapour
          particles that each carry the rate their fuel left at do that without asking the sim for anything more.
        - **Leaks in shadow** were left over from the vapour particles, and are item 7's second step.
        - **A space look**: sparks and metal fly straight and fade; vapour comes only from leaks, spreading
          and thinning; no smoke and no lingering fireball.
        - **Zoom** as bevels and scars: a particle under a pixel is not drawn; glows keep a pixel floor, as
          flashes do.
        - **From a first look on the Effects page — built**: a hit's core is white-hot in its middle and fades
          to its edge; a muzzle flash's back leaves the muzzle slowly, so it is seen coming out of the
          barrel, and a bigger gun's lasts longer; bursts are brighter and a bigger one lasts up to a quarter
          of a second; a beam's core is lit across as a rod, with a small glow at its emitter, its glow under
          its core and the flashes where it lands over it; a plume's glow is the flame's own shape blurred, a
          cone of light (the third kind in `render/glows.ts`) from its nozzle to where it ends or lands; and a
          leak is densest at its hole and lit in the battle's light.
        - **Leaks grow out of their holes — built**: a hole counts how long it has been open (`Leak.age`,
          read by nothing in the sim, so no golden moved), and the snapshot carries that and how fast its fuel
          leaves (`leakAge`, `leakSpeed`), so its plume reaches out at that speed, about 49 m/s from a full
          tank, rather than appearing whole: its full width from the start, with a soft front for fuel
          leaving at a spread of speeds, made at 24 fronts along it and cross-faded between them.
        - **The Effects route** (`#/effects`) shows each effect on its own, drawn by the battle's renderer, looped,
          slowed and scrubbed: the place to look at a change to how one is drawn, and to add a scene for a new one.
        - **In pull requests**, in this order: (1) the list of sources and glow sprites, replacing today's
          banded glows, with the bursts and muzzle flashes looked at again — built; (2) the short-lived
          particles, themselves in steps:
            1. **Sparks from hits — built.** The sim logs a flash at every surface a round meets that can
               be seen (`IMPACT_ROUND` going in, `IMPACT_EXIT` coming out), with the way it was going and
               the face's normal; a crossing into a module as thick as the one it left is inside and adds
               to the flash before it. A flash is kept as an event while its sparks fly (`Flashes.kept`),
               and `render/particles.ts` works each spark out from the event's seed and age: thrown back off
               the face, leaning the way the round glanced, or on out of the far side, flying straight at
               the hull's velocity plus its own and cooling from white to red. Its flash is a cone opening the
               same way, a muzzle flash's wedge held at the face with a hot spot where it struck. Drawn as streaks in one
               additive Pixi `ParticleContainer` a scene (`PixiCanvas.particles`), in their turn among the
               rest. A beam's flashes throw one now and then.
            2. **Metal from collisions, with a smaller flash — built.** A collision logs how the hulls slid
               across each other, the normal between them and how fast they closed (`ImpactLog.speed`), and
               its flash is half a hit's of the same energy (`COLLISION_FLASH_SHARE`). Up to 20 bits of metal
               fly out along the contact either way, leaning the way the hulls slid, at up to six-tenths of
               the closing speed, tumbling and glinting in the battle's light: jagged shards, laid over what
               is under them in a second batch. Each throws some of the other's too: a hit knocks out a
               few bits of metal the way its sparks go, a fifth as many as a collision of its energy, and
               a collision grinds out a few sparks along the contact, a third as many as a hit's.
            3. **Leak vapour — built** (`render/vapour.ts`), in place of the plume image. A hole records
               what it has been (`Leak.opened`, `liningClosing`, `liningFloor`, `patched`, `closed`, read
               by nothing in the sim), so its width at any age is a formula, and the snapshot carries them
               and keeps a closed hole for `LEAK_LINGER` seconds. Puffs leave every fortieth of a second, as
               many as the hole's rate then calls for, at the fuel's speed give or take a sixth, spreading
               and thinning as they go: so a new leak grows out of its hole with a soft front, and one
               narrowing or shut sends out less or nothing while what is out drifts on.
            4. **Vapour from where the hole was — built** (`render/poses.ts`). The renderer keeps each
               leaking ship's pose and velocity, frame by frame on the battle's clock, cut back when the
               battle is wound back; each puff sets out from where its hole was when it left, at the
               hull's velocity then, so the stream trails behind a ship that turns or speeds up. Older
               than what is kept, as just after a jump, it falls back on the oldest pose, and with none
               on the hull's frame as it is now.
        - **Lingering debris**, settled with the author on 2026-11-04 (DECISIONS.md), in three pull requests:
            1. **Debris — built** (`sim/debris.ts`). Kept by the sim, since bits that stay a while must
               bounce off hulls and curve in the wells, which a formula of age cannot do, and so that pause,
               scrub, rewind and replay show the same bits; but only drawn, changing nothing, left out of
               the golden checksums, and made only while a viewer watches (`Debris.watched`, from the
               impact log's), so a headless run pays nothing. A piece the sim does not keep breaks up
               rather than vanishing: one too light to be made when it is severed (`SCRAP_MASS`), and loose
               wreckage let go out of everyone's way (`LOOSE_MASS`); wreckage drifted far off is let go
               unseen as before. It breaks into bits that between them cover 0.4 of its footprint, so a
               capital module leaves a field of wreckage rather than a handful of confetti: a few large
               and many small, the longest half the side of a square of its footprint and no longer than
               6 m (`DEBRIS_LONGEST`), up to 400 a piece (about 20 for a fighter's, 140 for a Star
               Destroyer's bow triangle), each from somewhere inside its module's outline with the velocity that
               point had and a kick of up to 3 m/s, tumbling. A bit carries its module's side, and two in five
               keep their paint, drawn in that side's hull colour a little weathered; rock is never painted.
               One born in a blast (a module shattered, or a piece too small to keep blown off) glows
               white-hot and cools through orange in 0.4 s (`DEBRIS_HOT`), its glow reaching three times its
               length, so between them they cover the module and it flashes rather than turning into
               pieces between frames; a loose wreck let go is not blown apart, and does not. A module
               shattered is thrown too: 5% of the blow's energy (`THROW_SHARE`) over its mass gives a speed,
               up to 60 m/s, about 17 m/s for one just shattered. Where the blow came from somewhere, as a
               round's or a crush's does, each bit is thrown at up to that speed along the blow's line and
               half that across it, and pushed away from where it struck near it and towards it at the far
               side, by up to three-quarters of it: what was at the impact rebounds off what struck it, and
               what was furthest from it has not been stopped when the module comes apart. `Damage` keeps
               each blow's point and line in the step's account for this (`struck`). A beam's, from
               nowhere in particular, throws evenly. The store
               grows as it fills, to 4,096. A bit looks
               eight steps ahead and casts again only once that is spent or something is in its way, since a
               cast through a capital hull tests every module in it: the Crash scene's 1,100 bits cost
               about 3 ms a step. Each step a bit is pulled by the wells and cast along its way through the
               grid and the hulls' narrow phase, as a round is, bouncing off the first hull or rock it
               meets (keeping 0.4 of its speed into it, 0.7 along it, off the hull's own velocity there);
               bits do not meet each other, and nothing feels them. Each lasts 30 to 60 s, fading over its
               last 10; at most 2,048 are kept, a new one taking the oldest's place. Drawn as the hits'
               bits of metal are: jagged shards of dull steel glinting in the battle's light and lit by the
               dynamic lights. The Effects page's Debris scene shows a piece breaking up over a slab.
            2. **Keeping less: `SCRAP_MASS` raised — built**, from 300 kg to 2 t: above every fighter
               module but the Dinky's 2.1 t gun, and under every capital one, so a fighter's wreckage goes
               to debris as it comes off. `SALVAGE_REACH` counts from it, so a piece's reach falls by the
               same 8.5 km. The Torpedoes, Super Swarm and Rival Mines goldens moved: no spent torpedo's
               pieces are made at all now; and in Rival Mines a Dinky shot down to its core, engines and
               tank comes home and burns against its Replicator's hull for the rest of the battle rather
               than landing, a crippled landing the new path exposes rather than causes.
            3. **Shattering — built.** Any module that takes more than `SHATTER` (3) times what breaks it
               in one step is removed, its mass and what it held counted as discarded and broken into
               debris, and the rest of the hull split into the parts still welded together without it, so
               it may sever; a hull of nothing else goes. `Damage` totals what each module hit takes in a
               step; `Ships.sever` shatters first, through the same `breakUp` as a cut, with the shattered
               mass discarded inside it so the piece that stays takes up no momentum for it. Robots
               rebuild a shattered module as any module lost. Not for a body more than one ship rides.
               A collision's crush stopped at what each module could still absorb, so it never shattered
               anything, and it ran the whole length of the hull. Now a module passes on inward no more
               than it could take itself (`CRUSH_PASS`), and what it cannot pass on crumples it, as far
               as shattering it: the front gives way and spares what is behind. The Crash scene (a Star
               Destroyer into a major asteroid at 20 m/s) shows it: the first contact shatters the two
               bow triangles and slows it, and it drives on through the engine and then the structure
               and first turret behind, slower each time, until it comes to rest against the rock, the
               hull 450 m back untouched. The bow is very light beside the ship, so crumpling it hardly
               slows it: what stops it is the rock, layer by layer.
               DESIGN.md §4 is amended. The Rival Mines, Super Swarm, Torpedoes and Line Ahead goldens
               moved: more scrap and fewer ships at the end, as modules are blown away rather than kept as
               wreckage (Line Ahead 19 ships to 15, its scrap 177 t to 229 t); and Rival Mines' Dinky no
               longer ends up against its Replicator.
    7. **The later lighting passes.** Settled with the author on 2026-11-04 (DECISIONS.md). Each is its own
       pull request, in this order:
        1. **Leaks in shadow — built** (`render/blocks.ts`). Vapour hangs above the deck, so a thick
           module's shadow darkens it where it passes through, and the hull layer's shadows, drawn
           underneath, cannot reach it. Each puff asks whether anything its own ship has standing a thick
           module's height (thick modules and turrets' domes, not fighters) lies between it and the light
           within a shadow's length, the same region the hull layer sweeps, tested against each module's box
           first; where it does, the puff is drawn at the light's ambient share, as the hull in shadow is. The
           vapour is taken to be at deck height, and a puff is in shadow or not, by its middle. Being at deck
           height, it is drawn under the thick modules (`HullLayer.deck`, a place in the hull layer between
           the thin hull's shadows and the thick fills, where `PixiCanvas.particles` puts a batch drawn
           `onDeck`), so a puff drifting over the block that shadows it goes under it. The Effects
           page's "Leaking in shadow" scene shows it. Another ship's shadow on the vapour waits on shadows
           cast at the vapour's height, with the shadows from dynamic lights.
        2. **Dynamic lights.** Engines, flashes, bursts, muzzle flashes, beams and plumes light what is
           near them, read from the one list of sources (`render/glows.ts`), so a light is still defined
           once.
            - **The light buffer and the hull — built** (`render/lightBuffer.ts`). `draw` keeps every
              light the main view gave off (`seenLights`, not a close-up's), and at the end of the frame
              they are drawn, as their glows are, into a texture at half the canvas's size
              (`LIGHT_RESOLUTION`), each reaching further than its glow, the further the brighter it
              is: `LIGHT_REACH` (6) times at full brightness, as the square root of its brightness, since
              light thins as the square of the distance, and at most four times that. A glow is the halo
              round a light, and the hull beside an engine is lit well past it. A muzzle flash lights
              from one small, very bright point at the muzzle (`MUZZLE_TIP_BRIGHTNESS`), unseen, its
              wedge's glow lighting nothing, so its light reaches back along a barrel of 40 to 50
              calibres to the front of the gun's block as it leaves, and less far as it fades. The hull layer
              fills every module again, untinted and sharing its fills' geometry (`HullLayer.lit`), and
              that pool is drawn through a filter multiplying its colour by the buffer where it lies on
              screen, times `LIGHT_GAIN` (1), added over the hull. Lights go into the buffer at a quarter
              of their brightness (`LIGHT_HEADROOM`), so where several overlap, as along a big beam, their
              sum is not clipped flat at white, and the filter eases it towards full (1 − e^−L) rather than
              cutting it off. The bevels are drawn over the lit fills too, sharing their geometry, so the
              light added to a bevel turned from the battle's light is dimmer and to one turned to it
              brighter, keeping the hull's shading. So a hull takes the light in its own
              colour, in the battle's shadows as out of them, and empty space stays dark. Thin and
              thick modules and rock are lit; WebGL only, as Pixi's Canvas2D fallback has no filters;
              and nothing is drawn while there are no lights. The glows' halos are still drawn over the
              hull as before. The reach and gain were set by eye on the Effects page's Engines and Hits
              scenes.
            - **Fighters, vapour and metal — built** (`render/lightField.ts`), lit a piece at a time from
              the list itself rather than read back from the buffer, so nothing waits on the GPU: the same
              halos, capsules and cones, at the same reach, summed at a point, clipped and eased as the
              buffer and its filter have them. A fighter's modules are filled once more, added over themselves in their colour
              times the light at each module (a burnt-out one stays dark); a puff of vapour or a bit of
              metal adds its own colour times the light where it is to its tint. Each is drawn before its
              frame's lights are all known, so is lit by its view's lights in the frame before, put back
              in the world through that frame's camera, so a panning view does not move the light; a frame
              late, which a light lasting a few frames hides.
            - **Seen best under `LIGHTS.eclipse`**, a dim, cold sun and no ambient at all, so a ship is a
              dark shape lit mostly by its own engines, guns and the hits on it: Beam Duel for beams, Torch
              Run for plumes and Broadside for guns are seen in it.
            - **Never lit**: gauges, icons, names, selection, orders and arcs, as with the battle's light.
        3. **What is left** — lights shading bevels and rounded parts (#833), shadows from dynamic
           lights (#834) and decals placed in the editor (#835) — is in #659's sub-issues.

### Not started — in order

18. **Campaign** (#836) — last, because its screens would otherwise be built in plain DOM and then
    rewritten in React.

**Scenario packs** (#837).

**Multiplayer** is not a step, and nothing is being built for it — but nothing forecloses it either: the pure
sim, fixed timestep, explicit seeding and commands-in/snapshots-out contract _are_ the lockstep architecture.

- **Async fleet-vs-fleet is nearly free** and stays open: a fleet file (blueprints + doctrine + build
  priorities) plus a seed, run deterministically, produces a replay both sides can watch. No server, no
  netcode, no rollback. The variant where the budget arrives as _starting resources on a mothership with
  build priorities_ is better than a pre-built fleet, because build doctrine becomes part of what's being
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

#### React UI (step 16)

**The app is one page, `dist/index.html`, routed by the hash**, every screen a route; an old viewer link
(`#battle=`, `#fleet=`) is rewritten to the Battle route as it opens. **The battle view is `BattleCanvas`,
the seam step 17 puts Pixi behind**: a canvas React mounts and leaves to an engine, which owns the clock, the
camera and the input; the editors' canvases are engines of the same kind. What else is settled:

- **A route is `app/routes/<name>/`**, listed in `app/routes.tsx` and shown inside `app/Shell.tsx`, which
  holds the links between them. `app/App.stories.tsx` renders the whole app at a path, on a memory router
  with storage of its own, which is how a route gets its story.
- **Storage goes through `useLibrary` and `useViewSettings`** (`features/storage/`), never `localStorage`,
  so a save anywhere re-renders whatever shows it. View settings are keyed by the old page's name, so a
  route that replaces a page keeps its settings.
- **A battle is shown through `BattleCanvas`** (`features/battle/`), which creates a `battleView` on mount
  and disposes of it on unmount; the clock, camera and input stay the engine's. A figure read off the
  battle goes through `useSampled`, 10 times a second, and every-frame callbacks write to a ref, never to
  state (non-negotiable 5). The scenes are `scenarios/scenes.ts`.
- **What the order controls show is sampled as one piece of text** (`features/orders/orderState.ts`): the side,
  the picked ships, the armed verb, one ship's orders, an asteroid's contents. They re-render only when it
  changes, and read anything heavier off the last snapshot then. A doctrine box is uncontrolled and tells
  its field when left or on Enter, re-keyed by its value so it shows what the ships go by after.
- **A setting is a `NumberField`** (`ui/fields/`), with its ± where it has one, holding its box's text as
  typed; the page turns the text into numbers, defaults for what does not read, as `customSetup.ts` does.
- **Work that outlives a route lives in a provider above the router**, as the skirmish's does
  (`features/skirmish/`): the skirmish, its history and the enemy's search, which runs in a worker the
  app inlines (`?worker&inline`) and goes on while the player is elsewhere. The route subscribes to
  what it hears and shows it; a route never owns a worker.
- **Settings cards are `SettingFields`** (`features/settings/`): a group of `SettingField`s as
  `NumberField` rows, each box's text kept as typed and read by `settingValue`.
- **A box that edits as it is typed is a `LiveText` or `LiveNumber`** (`ui/fields/`): the page applies
  every key it can read, and the box keeps what was typed until it is left. A gesture is one undo step:
  the first edit applies, the rest amend it, until the box is left.
- **A button is `ui/buttons/Button`**, or `ToggleButton` for one that stays pressed, both Base UI's
  underneath: `variant` says whether it is plain, the one thing to do next (`primary`) or a small one
  holding a symbol (`icon`). Never a bare `<button>` in React.
- **Edit is a pencil**: `EditButton`, or `EditLink` where it goes to an address, named for what it opens
  ("Edit Corvette"). One pencil for a ship and a fleet alike; the row it is on says which.
- **An editor's canvas is an engine of its own** (`editor/fleetCanvas.ts`), as `battleView` is: the
  pointer, the keys and the drawing, over a document it shares with the page. The route holds the
  document, which is changed in place with its undo, and re-renders the panel by a counter the engine
  and the panel bump on every change. A name or note is a `CommitText` (`ui/fields/`), one undo step
  when finished rather than one a key.
- **axe does not fail a story on colour contrast**, only on what it is sure of: contrast it marks for
  review, so a token change wants looking at in Storybook's accessibility panel.

#### Mining (step 15)

Metal and fuel from asteroids, so maps have economic character; only a way to get resources mid-battle, since
mining is too slow to matter with an enemy there from the start, and the campaign will add lulls to set up a
mine in. What is left of it is in §12, for later.

- **Majors and minors.** A major has a **kernel**: a module kind of its own, not a ship's core. It is
  indestructible, unminable, on no side and never a ship. Its outline is a convex polygon of up to about
  12 corners. Corners live on a module's spec, so only scratch is sized for twelve; ship modules keep
  `MAX_CORNERS` at 4. A minor is rock
  alone, an ordinary free body.
- **A kernel carries a well and a rail.** Its GM is set from a surface gravity, not from its mass, which
  only sets how it spins. It is pinned to its rail and free to rotate. A rail is a Kepler ellipse, a
  function of the step count, in a hierarchy of two-body pairs: three or more majors are laid out so
  pairs can be treated as one body orbiting another. The generator keeps closest approaches clear.
  Wells move with their kernels, so a `WellSpec` stops being constant.
- **Rock** is one module kind with ore, ice and worthless fractions, varied across an asteroid. Its
  colour shows the mix: white for ice, grey for ore, brown for the rest. An asteroid is a disc, 10 m
  deep, its outermost ring a deck deep. It is cut in rings of wedges
  round the kernel (or a minor's centre), bounded per asteroid. It is damaged like structure, what is
  shed is lost, and its seams are hull strength or weaker, like a rubble pile, so a chunk knocked off is
  a free minor. Rock strips completely; the kernel stays.
- **Waste is the worthless fraction**, plus the existing conversion loss. No hidden refining loss.
- **Robots mine both**, metal and fuel, into one 1,000 kg hold with a movable partition, and the bay
  takes it aboard. It costs more power than stripping scrap. The claw is only an anchor, so how far the
  robots walk is what makes a miner move.
- **A claw with no robots heats rock** with power and drinks the melt: fuel only, slower and dearer
  than robots. The module stays until stripped.
- **A miner moors to an asteroid**, as a fighter parks on a pad: it keeps its own body and design, pinned
  to the rock and riding its rail with it, and its robots cross onto the rock to mine it. A blow beyond
  its claw's grip knocks it off; robots it leaves there are stranded and go aboard the next ship of their
  side to moor there with a berth for them. Rock meeting rock slowly welds, a minor onto a major riding
  its rail.
- **Scavenging covers rock.** No new verb; an evolvable doctrine weight sets rock against wrecks.
- **Maps are generated from the seed, in every mode, defaulting to none**, so no golden moves. Settings:
  major count and size, minor count and size (a radius with a spread), eccentricity (a most, drawn per
  pair), surface gravity, and richness in metal and in fuel separately. Sides are placed as now and the
  generator keeps clear of them. A plain evolution run draws a new map every match; the skirmish has
  one map per round, from its seed, the enemy bred on it, and each round's settings drawn from ranges
  the player sets.
- **In the viewer** an asteroid is never framed automatically and gets no arrowhead or tile. Picking
  one shows the metal, fuel and worthless rock left, and Fit frames it; with Scavenge armed a click gives
  the order. The kernel is drawn distinctly.
- **Fit frames a picked ship with what it is about**: what it is fighting, escorting, and the asteroid
  or hulk it is scavenging. Picking a ship moves the camera only while it is fitted; once moved by hand, only Fit (F) does.

#### Orders (step 14)

- **A command is logged, and replayed, by the simulation's ship indices,** which a deterministic battle
  keeps; a blueprint a command carries is written once into the log's `designs`, so a link or a history
  replays wherever it is opened. Anything new told mid-battle is a `Command` (`scenarios/commands.ts`).
- **Orders and doctrine are two things.** An order goes in a ship's queue and is worked through; doctrine,
  build counts and remodelling are settings, told over the blueprint's from the doctrine panel. An order
  left untold on a number follows doctrine live.
- **Rewinding copies the whole battle** at checkpoints (`Rewind`, `cloneBattle`) and replays the command log
  from there, which costs one rule: nothing in a battle may be a closure over state that changes, since a
  copy would go on reaching into the original. Designs, and caches keyed on them, are shared, never changed.
- **Add ship is a sandbox tool**, on the viewer only: no game mode offers it.
- **The skirmish's enemy answers the player's fleet as doctrine flies it,** by `answerMargin`; orders are
  the player's edge over it, and a page that gives orders names the one side that may take them.

#### Skirmish (step 5)

- **An endless loop against an enemy that evolves to beat the player.** The first enemy's bill is the
  player's budget, and stays it; the enemy's grows a round at a time, to half as much again as it was —
  metal, fuel, build time and ships, though always one ship more — and by as much again each time 20
  generations go by without an answer (`evolution/answer.ts`).
- **A round is one seed**, so a retry is the same battle and what changes it is the player's edit; a round
  won is answered on that seed and the next round takes a new one.
- **A battle is decided** once one side has fired, hit or rammed in the last 30 s and the other has not,
  counted only once both sides have fired, a
  side with nothing armed or ramming being out at once; a stalemate ends at 600 s, and a draw is the
  player's loss (`scenarios/decision.ts`).
- **The enemy evolves under evolution's rules**, an enemy ahead at a match's time limit taken to win, and a
  winner is confirmed by fighting the round itself to the skirmish's decision before it is the answer
  (`evolution/answer.ts`). It runs in a worker, and the page replays each generation's best.
- **Pages stay separate**, the skirmish carried in the link between them and kept in browser storage, its
  history beside it (`scenarios/history.ts`): every match, each fleet kept once, the oldest runs' fleets
  let go when storage is full. Editing a ship in place within its fleet (#684) would merge the editors.
- **The fleet file and a battle from fleets** are what the skirmish fights with: fleets or single ships
  from the libraries, a file, or an editor's link, as the custom battle on the viewer also takes them, and
  bred by fleet evolution with every operator's inverse. Not planned: per-ship doctrine overrides in a
  fleet (fork the design instead), and a group's own doctrine or lead, which waits for standing orders.
  Velocity stays out of the fleet file; the battle setup holds it.

#### In-battle construction (step 12)

- **A ship always aims at exactly one blueprint.** Rebuilding aims at the design it set out with; a refit
  changes which design that is. An order to remodel is `Ships.refit` and nothing else: never a ship growing
  past its design.
- **A refit matches modules by stable id**, then by identical layout, so anything that makes or edits a
  design an order points a ship at should keep ids (`settleIds`), as the editor and evolution do.
- **Pads and slipways keep a count, not a queue.** An order to build a fighter or a ship sets a `craft` and a
  `keep`; a menu of designs is open (§12).

#### Power (step 11)

- **Docks pass charge as they pass fuel**: a pad from its carrier to what has landed, a port into whichever ship
  is refuelling, each at `DOCK_POWER_PER_METRE` of the part's width (a port's, the narrower), from what the
  giver can spare above its own `rechargeBelow`. A dock holds until fuel, metal (on a pad) and charge are all
  full or can be spared no more.
- **A beam's reload is paid for in charge** (`Ships.recharged`): over its reload a beam draws the energy its
  bank holds, and its reload timer runs only as fast as its piece of hull supplies it, the main battery
  served first. Its own gear's rate (`BEAM_DUTY_CYCLE`, `BEAM_RECHARGE_TIME`) stays the fastest it can go.
- **Charge is the third store** (`sim/charge.ts`), per module and per piece of hull like fuel and metal, but
  weightless and with a rate: a load calls `Charge.draw` between `open` and `close` in `Ships.command`, and
  gets the piece's generation first and then its batteries'. A new consumer of power is a call to `draw`.

#### Raw material (step 10)

- **A gun takes its round in one place**: `Metal.load`, called as the gun fires. A magazine (§12) goes
  between the two — the gun loads from its own magazine, and the magazine refills from the hold — without
  anything else that reads metal having to change.
- **Fuel and metal are one store** (`sim/store.ts`), so power, or anything else a module holds, is a
  capacity and a priority rather than a third copy of the bookkeeping.

#### Docking and fuel (step 9)

- **Every join is a weld made by a part, and the seam names it** (`Seam.dock`: claw, pad or port). A new kind
  of dock is a kind there, a part, and a branch in `Ships.pump` saying which way fuel goes and when it lets go.
- **The smaller of two docked ships idles.** Whether the larger should fly the smaller's engines is in §12.
- **A tanker has nowhere to be.** Unarmed, it picks no fight and holds where it is; keeping it clear of one is
  withdrawal (§12), not anything of step 9's.
- **A ship refuels until it is full.** The plan had a second share to stop at; nothing has needed it.

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
  the same place — the geometry is unchanged, the part moves down the expansion order a little, and a _new_
  copy will not have it. A loose part does not move with the copy it came out of; wrapping the two in a new
  assembly is how to have that. Dissolving one copy is the other way out, and changes neither geometry nor
  order: its contents are written where it was, one level at a time.
- **Module order is part of the ship, so restructuring is not bit-free.** Engine allocation and firing both
  run in list order, so a reordered layout does not check-sum the same — though `scenarios/ordering.ts`
  measures the behavioural difference as round-off (8.2e-13 m over 3,000 steps, identical shots and hits),
  too small to be worth warning about when an edit reorders a layout. Adding a module appends, which leaves even the bits alone; the authored ships place symmetric _pairs_ adjacently for
  the same reason.
- **The editor's animation is not a start on test flight.** A selected engine burns and a selected gun fires
  at its own rate, but nothing integrates or collides, so it cannot grow into a test flight by accident.
- **No cost line, now or ever.** Dry mass is not standing in for a cost; it _is_ the materials a ship is made
  of, one of the three real costs (§2), and fuel and build time are the other two: evolution's budget and
  the editors' Cost readouts are all three (`sim/bill.ts`). Running cost needs a fuel model.
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

What is left of the step should follow the shape already there:

- **Doctrine is a block in the blueprint file**, shared by reference and copied only when overridden — the
  same copy-on-write split the engine layout uses. A mount's own block holds only its _differences_ from
  its ship's.
- **Targets are chosen by a stack of preferences**, each discarding a candidate or adjusting its score, with a
  discard hiding a target from everything above it. A new picker is a new weight, not a new mechanism.
  Hysteresis (preferring what it is already fighting) is a picker, not flavour.
- **The ship picks a manoeuvre target and each mount picks its own firing target**, through the same stack,
  measured from the gun rather than the hull. Re-picking runs on an interval _derived_ from the hull or mount
  rather than configured.
- **An order outranks doctrine for every mount that takes it** — the main battery — doctrine being strictly a fallback: when doctrine landed, only the
  scenarios that give no orders moved.
- **A gun fires at what its barrel was trained on**, recorded when it is trained — the hull turns between
  training and firing, and working the target out afresh at the trigger once had fighters firing over their
  own shoulders.
- **A part is led by its hull's velocity, not its own**; tracking rate is still the part's own.

#### Evolution (step 4)

- **Mutants that fail `blueprintProblem` are refused, not repaired** — a repair rule is a second opinion about
  what a ship is. Edit distance per generation is bounded (§7), so a descendant is recognisably one.
- **One evolution core, importing nothing from the host**, driven headlessly by `pnpm evolve` and by its
  page. A run is a JSON file; §5's SharedWorker, React and wa-sqlite stack is not built and nothing so far has
  needed it. It is wanted when a campaign needs to _query_ runs.
- **One match scores survival, damage and ground gained together**, so a design has to make the trade
  between fighting and running for the goal. Small free-for-all groups, drawn fewest-meetings-first.
- **The budget is three real costs** (§2): metal, fuel and build time, each limited on its own
  (`sim/bill.ts`). When materials arrive (§12) metal will want to become a budget of materials, which is step
  5's currency too.
- What evolution has left open — selection pressure, draw noise, arena size, clever piloting — is in §12.

---

#### Two layers (step 7)

- **The trigger mask covers everything the traverse limit covers**, so the traverse limit never decides
  whether a mount may fire — anything the barrel fouls is also on the round's path. Its only job is which
  way round the mount has to turn.
- **Barrel length buys no reach past an obstruction.** A long barrel pointing past something occupies the
  space a short barrel's round would have flown through. Length matters only the other way: an obstruction
  _beyond_ barrel reach stops the round while leaving the barrel free.
- **The mask is bearing-only rather than a ray cast per shot.** It compiles once, and it is the
  conservative model: a mount should not fire along a bearing with its own hull downrange, since misses
  and penetrations both come home. Each sector is widened by the mount's barrel spread and half its bore,
  because a mask measured from the mount's centre let an outer barrel's beam clip its own engine.
- **A shot skips only the module that fired it**, rather than its whole ship, so the mask is all that
  keeps a mount off its own hull. A lit beam is committed for its duty cycle and used to sweep across its
  own engines after its target, so a lit beam's drive stops at the edge of a masked sector.
- **A ship's own hull should block its exhaust by layer too** — not built, and not wanted soon. A plume
  meets other ships only in its engine's layers, but its own hull blocks it in both, so a thick engine's
  flame is stopped by deck structure behind it when its weapons-layer half should pass over. Whoever builds
  it: the own-hull slices are worked out once per design, so they will want working out once per layer.

## 12. Open questions

**Open questions are [issues labelled `question`](https://github.com/kiml42/SpaceCombatSimulation/issues?q=is%3Aissue+is%3Aopen+label%3Aquestion).** Deliberately unresolved; decide when they
block something. Each kept the title it had here, so a reference such as "§12, 'Ambient occlusion'"
finds its issue by title. Answering one is a decision: record it in DECISIONS.md and close the issue in
the same change.
