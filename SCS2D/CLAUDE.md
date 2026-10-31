# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this directory.

## Read this first

**[DESIGN.md](DESIGN.md) is authoritative** for what this game is, how it works and why. This file covers
only how to *work* in the codebase. If the two disagree, DESIGN.md wins — and fix this file.

The design is three documents, split by why you would read them. Section numbers are global and stable across
all three, so "§12" means the same section wherever it is written:

| File | Holds | Read it when |
| --- | --- | --- |
| **[DESIGN.md](DESIGN.md)** | Status, §§1–7 and 9–11 | Deciding how something should behave |
| **[ROADMAP.md](ROADMAP.md)** | §8 build order, §12 open questions | Picking up work, or deferring a decision |
| **[DECISIONS.md](DECISIONS.md)** | The Decision Log | Asking why something ended up the way it is |

Before proposing a change that reverses a design decision, check **DESIGN.md §11 Rejected alternatives**.
Those were settled deliberately with reasons recorded. Reopen one only with new information, and if it is
reopened, update §11 and add an entry to [DECISIONS.md](DECISIONS.md).

Before starting a piece of work, make sure you have the latest version checked out of the branch you're starting 
from (usually master, and if not, make sure master has been merged into the branch). Work goes on a new
branch named for the feature, never the session's own branch (root [CLAUDE.md](../CLAUDE.md), "How changes land"). Create a Pull Request once the work is complete (possibly create
several stacked PRs along the way for particularly complex changes).

## Where things stand

**DESIGN.md's Status block is the single source of truth** for what exists and what comes next. Read it first,
and update it as work proceeds — it is the re-entry point after a gap. Deliberately not duplicated here: two
places recording progress means one of them is quietly wrong.

## Non-negotiables

These protect the architecture. Everything else is negotiable; these are not, without an explicit DESIGN.md
amendment.

1. **`sim/` imports nothing from the host.** No DOM, no React, no renderer types, no `window`, no timers, no
   Node APIs. It must run unchanged in a browser worker and in Node. This boundary is what keeps the host
   swappable, the sim testable, and evolution fast.
2. **The simulation is deterministic.** Fixed timestep. A seeded PRNG threaded explicitly through call sites —
   never a module-level or global random. No `Date.now()`, `performance.now()` or `Math.random()` inside `sim/`.
3. **Use our own transcendentals, never `Math.sin`/`cos`/`tan`/`atan2`/`exp`/`pow`/`log`/`hypot`.** Those are
   implementation-defined in the ECMAScript spec and differ across engines and versions. `Math.sqrt` and basic
   arithmetic are exactly specified and safe to use.
4. **No allocation in simulation hot loops.** State lives in typed arrays with index arithmetic, not in objects
   with `{x, y}` fields. GC pauses are the real performance risk, and retrofitting this is miserable.
5. **React never holds per-frame simulation state.** UI state only — open panel, selected ship, editor values.
   The battle view is a `<canvas>` React mounts and then ignores. Sample telemetry at ~10 Hz, not 60.
6. **Commands in, snapshots out.** The sim exposes a command intake and a read-only state snapshot. Nothing
   else reaches across the boundary in either direction.

## Layout

```
sim/        pure TS simulation (see non-negotiables 1–4)
render/     the view; consumes snapshots, knows no game rules
            (camera.ts is DOM-free arithmetic, so it is unit-tested)
editor/     the blueprint and fleet editors' models and canvases; only shipCanvas.ts,
            overlay.ts, fleetCanvas.ts and fleetOverlay.ts touch the DOM, so the edit
            models, the stats and the library are unit-tested
app/        the React app, one page with a hash route per screen under
            app/routes/ (ROADMAP.md §8 step 16)
features/   React components and hooks more than one route uses
ui/         presentational React components, plain props only, and the
            design tokens (ui/tokens/); React holds UI state only
            (non-negotiable 5)
host/       the DOM engines the routes mount and leave alone — the battle view
            on the wall clock, the timeline, the fleet pictures — and the
            answer worker
scenarios/  the battles, and the blueprints they fly, under blueprints/
            (battle.ts holds the assembly and the step order they share);
            README.md there says which scene to open to see or test what
evolution/  breeding and running a generation; imports sim/, never the host,
            and is bound by the same determinism rules
benchmarks/ measuring tools, not part of the game: nothing imports from here
            (benchmarks/README.md)
notes/      write-ups of investigations, with their measurements, linked from
            ROADMAP.md §12
```

**The editor is independent of the running simulation and tightly coupled to the simulation's laws.** It
never runs a battle — its inputs and outputs are both blueprints — but every mass, thrust, gun figure and
firing arc it shows comes out of `compileDraft`, and it draws through `render/canvas2d.ts` rather than
through a renderer of its own. If it ever works one of those out for itself, the editor and the battle
disagree about the same ship, which is the worst thing the tool can do.

Keep these working — they are the cold-start re-entry path:

- `pnpm test` — unit tests, determinism tests and the golden scenario checksums
- `pnpm typecheck` — all four TS projects on TypeScript 7 (`sim/` has no ambient types; `render/`,
  `editor/` and `host/` have the DOM; `tsconfig.app.json` is the React app). The `typescript` package is
  6, for the tools that need a compiler API TypeScript 7 does not have (typescript-eslint, Storybook)
- `pnpm format` — format the TypeScript, CSS and config files with Prettier (`.prettierrc.json`); CI fails
  on anything `pnpm format:check` finds, so run it before pushing
- `pnpm lint` — ESLint over everything, with typescript-eslint's `recommended` rules, and Stylelint over the
  React app's CSS. A name starting with `_` is a deliberate discard and may go unused. In `app/`, `features/`
  and `ui/`, imports flow one way, app → features → ui, and `ui/` imports nothing above it; a boundary error
  means the file is in the wrong layer, so move it rather than disable the rule. There, import across folders
  through `~/`, and no barrel `index.ts` files
- `pnpm golden` — after a *deliberate* behaviour change, write the new golden checksums into `tests/golden.test.ts`,
  with each battle's outcome and time per step as the baseline the next run is reported against; `pnpm golden
  <scenario> …` for only those
- `pnpm evolve` — fight a headless evolution run and write it to `runs/`, rewritten after every generation; `--from <stock ships or blueprint files>`, `--fleet <stock fleet
  or fleet file>`, `--deploy <radius>`, `--ships <most>` (ship founders grow into fleets unless it is 1), `--generations`,
  `--population`, `--group`, `--matches`, `--budget`, `--duration`, `--radius`, `--closing`, `--crossing` (each with a `-spread` either side, drawn per match), `--quiet-limit` (seconds every side must go without fighting or closing in before a match ends; 30 unless set), `--map` (asteroids each match is fought among, drawn from its seed, as `majors=2,minors=8,fuel=0.3`), `--seed`, `--kinds`, `--doctrine`, `--build`, `--structural`, `--geometry`, `--thrusters`,
  `--versus <stock ships or blueprint files>` and `--versus-fleet` for co-evolution, with `--hall`, `--phase-win`,
  `--phase-cap`, `--shielded-drills`, `--bare-core-drills`, `--versus-group` (side B's entrants a match, where not `--group`) and `--versus-fixed` (side B does not evolve),
  `--out` (beside the `--config` file if there is one, `x.evo.json` → `x.run.json`, else `runs/run.json`), and `--config` / `--save-config` for the settings file the Evolution route reads and writes, which carries its founders whole
- `pnpm yardstick` — measure a finished run against a ship that does not evolve; `--run`, and
  `--against latest | founder | <stock ship> | <blueprint or fleet file>`; a co-evolution run is measured as
  a grid of each side's round champions against the other's, `--samples` a side and `--seeds` matches a cell
- `pnpm bench:render` — time the battle view's frames, scene by scene, in WebGL and Canvas2D, in a browser
  window on this machine's graphics (benchmarks/README.md)
- `pnpm build` — bundle the React app to `dist/index.html`, one file with nothing external
- `pnpm dev` — Vite's dev server for the React app. Also runs `sync-fleets` on start
  and whenever a blueprint is saved
- `pnpm storybook` — every component's stories, at `localhost:6006`; `pnpm build-storybook` builds it
- `pnpm sync-fleets` — copy each stock blueprint into the stock fleets that embed a design of the same name
- `pnpm test:browser` — drive that bundle in Chromium, and run every story there with its `play`
  function and an accessibility check; needs `pnpm exec playwright install chromium` first

## Testing

**Don't run either suite whole locally: CI does** (the root [CLAUDE.md](../CLAUDE.md), "How changes land").
Run the test files that bear on the change, the typecheck and the format check, and push. `pnpm golden` is the
exception, run whole after a behaviour change for the outcomes and timings it reports against the baseline.

**Two suites, deliberately.** `pnpm test` must run from a cold checkout with nothing but `pnpm install`, so it
never needs a browser; the browser tests live in `tests/browser/` and run separately. They check what types
and unit tests cannot — that the page loads without throwing, that the renderer puts pixels on the canvas,
and that the controls do what they say — and deliberately *not* that the simulation is right, which the
golden checksums already cover through the same `scenarios/duel.ts` the viewer runs.

**Each suite is two Vitest projects.** `pnpm test` runs `unit`, the tests under `tests/`, and `components`,
React component tests (`*.test.tsx` beside the component) in `happy-dom`. `pnpm test:browser` runs `pages`,
the built pages driven from Node, and `storybook`, every story rendered in Chromium. A component gets a story
with a `play` function asserting what it should do; a unit test is for logic a story cannot reach. Scope a run
with `--project`, as `pnpm exec vitest run --project components`.

**Golden battle tests are load-bearing.** Fixed scenarios with bit-exact pinned outcomes are the only thing
that tells you the simulation is intact after time away. Add one whenever simulation behaviour changes
meaningfully, and never "fix" a failing golden test by re-recording it without understanding what moved.

## Working with the archived Unity project

`../SpaceCombatSimulation/` is a read-only reference. **Never modify it**; opening it in an installed editor
converts it irreversibly. Read it for design — DESIGN.md §10 has an index of the parts worth consulting
(genome encoding, competitor selection, species naming, the SQL schema) and the failures worth avoiding.
Targeting is not among them: `sim/targeting.ts` and `sim/doctrine.ts` replaced that design rather than
inherited it.

## Conventions

- **Every new part is open to evolution.** A new module kind gets a mutation weight above zero, and whatever
  it names or counts gets a knob or an operator, so a run can reach it. If it is no use, selection drops it;
  leaving it out means nobody ever finds out.
- **Never write about the *current* branch, anywhere — including DESIGN.md.** "X was implemented on branch Y"
  is fine: a historical fact that stays true. "The work is on branch Y" is wrong the moment it merges, and the
  Status block is the one place most likely to be believed. Describe *what exists*, not where it lives.
- **A comment must either be timeless, or expire with the code it describes.** Explain what a file is and
  why it exists *in general*, not why it was built at a particular point in the project. "Present in the
  foundation for two reasons…", "not needed yet", "at this stage" are stale the moment the next thing lands,
  and a comment that has quietly expired is worse than no comment. Stage and sequencing information belongs
  in DESIGN.md's Status block, ROADMAP.md and DECISIONS.md, which exist for exactly that purpose. Write as though the
  reader has no idea which parts were built first — because in six months, neither will you.

  **Temporary code is the exception, and saying so is the most useful thing a comment can do there.** "A
  stop-gap until the damage model lands: every round penetrates and is absorbed" earns its place, because it
  tells the next reader that the code is meant to be replaced and what by. The test is not whether a comment
  mentions time, but whether it can go out of date *while the code it describes stays put*: a note on a
  stop-gap dies when the stop-gap does, whereas "for now" on code nobody plans to revisit rots silently and
  invisibly. Name the thing that supersedes it, so the comment is a marker rather than a mood.
- British English in prose and comments, matching the existing project.
- Suggestions in DESIGN.md marked as suggestions are not decisions — flag them as open rather than
  implementing them silently.
- No elaborate tooling before the doctrine/orders slice (DESIGN.md §9). Editor infrastructure and clever
  abstractions feel like progress and are not.
