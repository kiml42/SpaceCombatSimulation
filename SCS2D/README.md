# Space Combat Simulation — SCS2D

A planar, physics-driven fleet-tactics game with deep ship design, built in TypeScript.

**What it is and why it is that way lives in [DESIGN.md](DESIGN.md).** What is not built or not settled is
in [ROADMAP.md](ROADMAP.md), and why things ended up as they are is in [DECISIONS.md](DECISIONS.md). This
file is only about getting it running.

The Unity project in `../SpaceCombatSimulation/` is a 2017–2021 prototype, archived and not developed.

## Playing it without a checkout

Every green build of `master` publishes the viewer to GitHub Pages, so the current battle is one link away —
no clone, no toolchain, and it works on a phone. The URL is on the repository's Pages settings, and under the
`Publish to Pages` job of any CI run on master. [QUICKSTART.md](QUICKSTART.md) is a player's guide to the
skirmish, for handing to anyone trying it.

## Running it

Needs Node 22.12 or newer, as vitest does; CI tests on 22, 24 and 26.

And pnpm, at the version `packageManager` in `package.json` names: `corepack enable` sets it up where Node
still ships corepack, and `npm install -g pnpm` anywhere.

```
cd SCS2D
pnpm install
pnpm build
```

Then open `dist/index.html` in a browser: the React app, with the battle viewer, the ship and fleet
editors, the skirmish and evolution. It is one self-contained file, so there is no server to run and nothing
external to fetch: double-clicking it works.

Space pauses, full stop single-steps, F re-fits the camera. Scroll to zoom, drag to pan.

## Tinkering

```
pnpm dev
```

Starts Vite's dev server for the React app at http://localhost:5173/, which reloads itself on save. It does not
open a tab, and always uses that port: if it is taken, it stops rather than moving to another.

```
pnpm storybook
```

Every component of the React app on its own, at `localhost:6006`.

Almost everything worth changing is in one of these:

| To change | Edit |
| --- | --- |
| The ships' layouts | `scenarios/blueprints/*.json`, listed in `scenarios/blueprints.ts` |
| The engagement — positions, velocities, orders, the gravity well | `scenarios/duel.ts` |
| How every scenario is assembled and stepped | `scenarios/battle.ts` |
| Scaling laws and the constants behind them | `sim/modules.ts` |
| How the pilot flies and fights | `sim/ships.ts` |
| Colours, plumes, firing arcs | `render/canvas2d.ts` |
| How the camera follows | `render/camera.ts` |
| The clock, the camera and the keys | `host/battleView.ts` |
| The viewer's controls | `app/routes/battle/` |

**Expect the golden tests to fail the moment you change anything in `sim/` or `scenarios/`.** That is them
working: they pin the simulation's behaviour bit-for-bit, and a change in what a battle does is exactly what
they exist to report. Run `pnpm golden` to print the new checksums and paste them into
`tests/golden.test.ts` — but only once you know what moved and why. Copying a value out of a failure without
understanding it turns a regression into the new expected behaviour, permanently.

## Commands

| Command | Does |
| --- | --- |
| `pnpm test` | Unit tests, determinism tests and the golden checksums. Runs from a cold checkout. |
| `pnpm typecheck` | All four TS projects — `sim/` has no ambient types, `render/`, `editor/` and `host/` have the DOM, and the React app |
| `pnpm lint` | ESLint over everything, and Stylelint over the React app's CSS |
| `pnpm build` | Bundle the app to `dist/index.html`, one file |
| `pnpm dev` | Vite's dev server; also keeps the stock fleets' designs in step with `scenarios/blueprints/` |
| `pnpm storybook` | The React app's components on their own |
| `pnpm sync-fleets` | Copy each stock blueprint into the stock fleets that embed it |
| `pnpm golden` | Re-derive the golden checksums after a *deliberate* change |
| `pnpm evolve` | Fight a headless evolution run and write it to `runs/`, to open on the Evolution route with Open run; its flags are in CLAUDE.md |
| `pnpm yardstick` | Measure a finished run against a ship that does not evolve |
| `pnpm test:browser` | Drive the built app, and every story, in Chromium — `pnpm exec playwright install chromium` once first |

## Opening it from disk

`dist/index.html` opens straight off disk because it is a single file: the workers it starts — the skirmish's
search and the evolution run — are inlined into it (`?worker&inline`) rather than loaded from beside it, which
`file://` would refuse. Firefox has not been checked. Anything that moves to a worker should be inlined the
same way, or the page will need serving over HTTP (`pnpm dlx serve dist`).
