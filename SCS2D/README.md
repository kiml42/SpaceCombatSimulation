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

Then open `dist/index.html` in a browser: the React app, with the battle viewer and the fleet editor. The
pages not yet moved into it — the ship editor, the evolution page and the skirmish — sit beside it. Each is one
self-contained file, so there is no server to run and nothing external to fetch: double-clicking it works.

Space pauses, full stop single-steps, F re-fits the camera. Scroll to zoom, drag to pan.

## Tinkering

```
pnpm dev
```

Starts Vite's dev server and opens the React app, which reloads itself on save. The other pages are rebuilt on
every save and served beside it; refresh one to see a change. Served from one address, they share storage —
saved ships and fleets — which pages opened as files on Firefox do not.

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
| `pnpm lint` | ESLint and Stylelint over the React app |
| `pnpm build` | Bundle each page to `dist/`, one file each |
| `pnpm dev` | Vite's dev server, with the other pages rebuilt on save beside it; also keeps the stock fleets' designs in step with `scenarios/blueprints/` |
| `pnpm storybook` | The React app's components on their own |
| `pnpm sync-fleets` | Copy each stock blueprint into the stock fleets that embed it |
| `pnpm golden` | Re-derive the golden checksums after a *deliberate* change |
| `pnpm evolve` | Fight a headless evolution run and write it to `runs/`, to open on the evolution page with Open run; its flags are in CLAUDE.md |
| `pnpm yardstick` | Measure a finished run against a ship that does not evolve |
| `pnpm test:browser` | Drive the built pages, and every story, in Chromium — `pnpm exec playwright install chromium` once first |

## One thing that will change

Opening `dist/index.html` straight off disk works because the page is a single file with no worker. When the
simulation moves into a web worker (DESIGN.md §5), browsers will refuse to start it from `file://` and this
will need serving over HTTP — `pnpm dlx serve dist`, or anything equivalent. Not yet, but that is the day the
instructions above stop being enough.
