# Render performance: what to try next

Measured on 2026-10-31 on one laptop (AMD Radeon 860M, 1600×900 at 1×, frame rate uncapped), in Chrome and in
Firefox 158, after the WebGL view's first round of fixes (PR #558: cached fleet strips, gradients banded by
size, square caps on thin lines, robots as dots when small). Figures are frames a second with the battle held
at 5 s, so they are drawing alone. Super Swarm moves ±20% from run to run.

| Scene | Chrome WebGL | Chrome Canvas2D | Firefox WebGL | Firefox Canvas2D |
| --- | ---: | ---: | ---: | ---: |
| Duel | 538 | 700 | 142 | 172 |
| Rival Mines | 382 | 508 | 109 | 196 |
| Star Wars | 33.4 | 27.0 | 15.9 | 38.1 |
| Super Swarm | 25.6 | 20.4 | 12.8 | 25.6 |

WebGL wins in Chrome's heavy scenes and loses everywhere in Firefox, where it is about half as fast as
Canvas2D. In both browsers its cost is the main thread (JavaScript), not the GPU: Pixi rebuilds every shape's
geometry each frame. Firefox runs that JavaScript about half as fast as Chrome, and its Canvas2D is the faster
of the two browsers' in the heavy scenes.

To measure (benchmarks/README.md):

```sh
pnpm bench:render --scenes "Duel,Rival Mines,Star Wars,Super Swarm" --browser chrome --paused
pnpm bench:render --scenes "Star Wars" --renderers webgl --browser firefox --paused --profile
```

## What to try, roughly in order of payoff for the work

### 1. Fleet strips on a canvas of their own, or as pictures of the design

The strips are the biggest single cost left in Firefox, in both renderers, and a large one in Chrome.

- Chrome, WebGL: hiding them takes Star Wars from 33 to 42 fps and Duel from 538 to 639.
- Firefox, Canvas2D: the strips are 42% of Rival Mines' main thread and 26% of Star Wars'. Most of it is
  `StripCache.copy`, a `drawImage` of the whole offscreen cache each frame (37% and 16%).
- Firefox, WebGL: the cache goes up as a texture the size of the whole view each frame, 25% of Rival Mines.

The cache is the size of the view and is copied in full every frame because the view under it is cleared.
Cheaper ways, smallest first:

- Put the strips on their own `<canvas>` over the view, which is never cleared, and redraw only the tiles that
  are due. Nothing is copied or uploaded, in either renderer, and the look is the same.
- Show each tile as a picture of the ship's design rather than a live view, as the author suggested. That is
  close to free, but loses the live damage and plumes in the tile.

**Done, the first way.** The strips are on a canvas of their own over the view, and a tile not due a redraw is
left as it is. Measured against master side by side (`--app`, medians of 2–3 rounds, held at 5 s):

| | Firefox WebGL | Firefox Canvas2D | Chrome WebGL | Chrome Canvas2D |
| --- | ---: | ---: | ---: | ---: |
| Duel | 140 → 229 | 155 → 426 | 550 → 517 | 488 → 806 |
| Rival Mines | 115 → 223 | 169 → 508 | 397 → 384 | 552 → 555 |
| Star Wars | 17.5 → 19.2 | 38.5 → 44.6 | 31.6 → 34.9 | 31.5 → 31.7 |
| Super Swarm | 10.4 → 13.7 | 24.7 → 28.3 | 22.2 → 22.6 | 25.8 → 21.8 |

Chrome's figures are within its noise, except that Star Wars in WebGL steadied (34.0–36.2 against
28.0–34.5); in Canvas2D its main thread halved there (22 to 11 ms) and the frame rate did not move, so Chrome
is waiting on drawing there, not on the script.

### 2. Less garbage in `PixiCanvas`

Minor GC is 17% of Firefox's WebGL main thread in Star Wars and 23% in Super Swarm, and 12–20% in Chrome.
`render/pixiCanvas.ts` allocates a fresh array for every subpath, every clipped piece, every closed stroke
(`[...sub.points, …]`) and every dash pattern, plus a `Gradient` per gradient. Reusing scratch buffers would
cut most of that. Pixi adds its own: `handleFillObject` / `toFillStyle` make a style object for each `fill` and
`stroke` call, which caching the style per colour and alpha would avoid.

**Tried, no gain.** Saved states reused, the matrix set in place, no dash pattern made for a plain stroke, and a
whole stroke's points handed to Pixi uncopied: no difference beyond the noise in Firefox. Most of the garbage
is Pixi's own: every `fill` and `stroke` clones the path, and every `poly` makes a `Polygon` that keeps the points
it is given until the frame is drawn, so a path's points cannot be reused either. Only fewer shapes a frame
(item 5) will cut it. Not merged.

### 3. Plumes as a stretched texture

`drawPlumes` is 13% of Firefox's WebGL main thread and 7–15% of Chrome's. Each plume is a linear gradient,
which `PixiCanvas` fills as several clipped bands. A small gradient texture, drawn once and stretched and
turned for each plume, would make each one a single quad.

**Done.** Each plume is now one image, `flameSprite` in `render/sprites.ts`, stretched over it in both
renderers: a single quad, or three strips where a plume is cut short on a hull, and no clip. The image also
shades the flame smoothly in every direction, its hot core blended in rather than a second, narrower triangle.
Measured headless here (software WebGL, one run each, so only a sign of the direction), the main thread's
median per frame with the battle held fell from 59.7 to 49.9 ms in Star Wars and from 7.6 to 6.4 ms in Torch
Run in WebGL, and from 23.6 to 19.3 ms in Star Wars in Canvas2D.

### 4. `berthOf` is quadratic, every frame

`Ships.robotViews` (sim/ships.ts), called by `capture` for every snapshot, places each robot with `berthOf`,
which counts every robot before it on the same ship. That is n² a ship a frame: 5.5% of Firefox's Canvas2D
main thread in Star Wars, with `robotViews` at 9.5% in all, and it costs both renderers alike. One pass
counting robots per bay would make it linear. It is in `sim/`, but every caller (`robotViews`, `robotsDocked`,
`berthSpot`) is on the snapshot's path, not the step's, so no golden battle should move.

**Tried, no gain.** Counted in one pass, Star Wars and Super Swarm measured no faster in either renderer, side
by side with master over three rounds: a ship's robots are few, so the quadratic loop was cheap after all, and
the earlier share was likely the profiler's sampling. Not merged.

### 5. Keep geometry between frames (the large one)

Pixi's own work, from collecting renderables to triangulating and filling buffers (`render`,
`updateGpuContext`, `buildContextBatches`, `triangulateWithHoles`), is 35–45% of the WebGL main thread in both
browsers. It is all rebuilt every frame, because `PixiCanvas` replays `canvas2d.ts`'s drawing calls into fresh
`Graphics`. The fix is to stop rebuilding what has not changed:

- A ship's hull and modules look the same in its own frame from one frame to the next, unless damaged.
  `HullLayer` already keeps capital ships' fills this way; doing the same for every ship's design, kept by
  design and damage state and drawn with the ship's transform, would remove most of `drawShip`'s geometry.
- Shots, flashes and robots are many copies of a few shapes: instanced quads or sprites rather than paths.

This is the change that would let WebGL beat Canvas2D in Firefox too, and the most work.

What makes it hard is that `drawShip` mixes what never changes with what does, module by module: fills and
outlines sit between gauges, robot berths and lighting. The lighting (`shadeBells`, `shadePort`, `shadeDome`)
follows the ship's angle in the world, so it changes as the ship turns; line widths are floored in screen pixels
and arcs are cut into chords by their size on screen, so both change with the zoom. Two ways in:

- **Small ships as pictures.** A ship a few pixels long on screen shows none of that detail. Drawn once into an
  image of its design, by side and damage, and stamped with its position and angle, it costs one quad. Most of
  Super Swarm's ships are this small. It works the same in both renderers, and nothing large changes.
- **Every ship's still parts kept.** Split `drawShip` into what is fixed in the ship's frame and what is not,
  keep the first as a `GraphicsContext` in metres per design and damage state, and draw the rest live. Its
  choices are the author's: whether lighting is drawn live over the kept parts, which changes what is over
  what, and how far the zoom may change before the kept geometry is rebuilt.

### 6. Pick the renderer per browser

Until WebGL is faster there, Firefox players are better off on Canvas2D: twice the frame rate in every
scene measured. Defaulting to Canvas2D in Firefox, or choosing by a short measurement when the view starts,
would give them that now. It is a choice for the author, as WebGL is where the effects are meant to go.

### 7. The simulation when it falls behind

Running, rather than paused, a slow frame steps the battle further to catch up (up to
`MAX_STEPS_PER_FRAME`), which makes the next frame slower still. In Super Swarm (300 ships) that is 45–60 ms of
stepping a frame once it is behind, and the frame rate swings between runs. Two options:

- Catch up less and let the battle slow down rather than lurch.
- Step the battle in a worker, which non-negotiable 1 already allows, so that stepping and drawing run side by
  side.

## What has not been measured

- **GPU time.** The benchmark times the main thread only. `EXT_disjoint_timer_query` would show whether any
  scene is GPU-bound, which nothing here suggests on this machine.
- **High-DPI screens.** Everything above is at 1×. `--dpr 2` draws four times the pixels, which matters more
  to Canvas2D, and to the strips' texture upload.
- **Other machines.** One laptop, one GPU. A discrete GPU, or integrated Intel graphics, could change the order
  of the browsers and the renderers.
- **Repeats.** Each figure is one run. Taking the median of three would make the smaller differences
  trustworthy.
