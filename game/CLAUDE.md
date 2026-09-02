# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this directory.

## Read this first

**[DESIGN.md](DESIGN.md) is authoritative** for what this game is, how it works and why. This file covers
only how to *work* in the codebase. If the two disagree, DESIGN.md wins — and fix this file.

Before proposing a change that reverses a design decision, check **DESIGN.md §11 Rejected alternatives**.
Those were settled deliberately with reasons recorded. Reopen one only with new information, and if it is
reopened, update §11 and the Decision Log.

## Current state

**Pre-scaffold. No code yet.** The next step is Slice 0 (DESIGN.md §8): the pure simulation module, two
hard-coded blueprints, a Canvas2D debug viewer, and a bit-exact golden test.

Update the **Status** block at the top of DESIGN.md as work proceeds — it is the re-entry point after a gap.

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
render/     WebGL renderer; consumes snapshots, knows no game rules
ui/         React; UI state only
host/       worker and window lifecycle
scenarios/  data files
```

Planned commands, once scaffolded — keep them working, they are the cold-start re-entry path:

- `npm test` — unit tests plus the golden battle tests
- `npm run battle -- scenarios/<name>.json` — headless run, no browser
- `npm run dev` — browser dev server

## Testing

**Golden battle tests are load-bearing.** Fixed scenarios with bit-exact pinned outcomes are the only thing
that tells you the simulation is intact after time away. Add one whenever simulation behaviour changes
meaningfully, and never "fix" a failing golden test by re-recording it without understanding what moved.

## Working with the archived Unity project

`../SpaceCombatSimulation/` is a read-only reference. **Never modify it**; opening it in an installed editor
converts it irreversibly. Read it for design — DESIGN.md §10 has an index of the parts worth consulting
(genome encoding, competitor selection, species naming, the target-picker taxonomy, the SQL schema) and the
failures worth avoiding.

## Conventions

- British English in prose and comments, matching the existing project.
- Suggestions in DESIGN.md marked as suggestions are not decisions — flag them as open rather than
  implementing them silently.
- No elaborate tooling before the doctrine/orders slice (DESIGN.md §9). Editor infrastructure and clever
  abstractions feel like progress and are not.
