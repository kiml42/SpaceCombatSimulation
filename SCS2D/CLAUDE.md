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
render/     WebGL renderer; consumes snapshots, knows no game rules
ui/         React; UI state only
host/       worker and window lifecycle
scenarios/  data files
```

Keep these working — they are the cold-start re-entry path:

- `npm test` — unit tests, determinism tests and the golden scenario checksums
- `npm run typecheck` — both TS projects (`sim/` is checked with no ambient types)
- `npm run golden` — re-derive golden checksums after a *deliberate* behaviour change

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
