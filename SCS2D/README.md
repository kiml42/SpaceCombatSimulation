# Space Combat Simulation — SCS2D

A planar, physics-driven fleet-tactics game with deep ship design, built in TypeScript.

**What it is and why it is that way lives in [DESIGN.md](DESIGN.md).** What is not built or not settled is
in [ROADMAP.md](ROADMAP.md), and why things ended up as they are is in [DECISIONS.md](DECISIONS.md). This
file is only about getting it running.

The Unity project in `../SpaceCombatSimulation/` is a 2017–2021 prototype, archived and not developed.

## Running it

Needs Node 20 or newer; CI's typecheck row runs 24.

```
cd SCS2D
npm ci
npm run build
```

Then open `dist/index.html` in a browser. It is one self-contained file, so there is no server to run and
nothing external to fetch — double-clicking it works.

Space pauses, full stop single-steps, F re-fits the camera. Scroll to zoom, drag to pan.

## Tinkering

```
npm run dev
```

Rebuilds on every save. Refresh the page to see the change; there is no live reload.

Almost everything worth changing is in one of these:

| To change | Edit |
| --- | --- |
| The ships' layouts | `scenarios/blueprints.ts` |
| The engagement — positions, velocities, orders, the gravity well | `scenarios/duel.ts` |
| Scaling laws and the constants behind them | `sim/modules.ts` |
| How the pilot flies and fights | `sim/ships.ts` |
| Colours, plumes, firing arcs | `render/canvas2d.ts` |
| How the camera follows | `render/camera.ts` |
| Controls and the clock | `host/main.ts` |

**Expect the golden tests to fail the moment you change anything in `sim/` or `scenarios/`.** That is them
working: they pin the simulation's behaviour bit-for-bit, and a change in what a battle does is exactly what
they exist to report. Run `npm run golden` to print the new checksums and paste them into
`tests/golden.test.ts` — but only once you know what moved and why. Copying a value out of a failure without
understanding it turns a regression into the new expected behaviour, permanently.

## Commands

| Command | Does |
| --- | --- |
| `npm test` | Unit tests, determinism tests and the golden checksums. Runs from a cold checkout. |
| `npm run typecheck` | All three TS projects — `sim/` has no ambient types, `render/` and `host/` have the DOM |
| `npm run build` | Bundle to `dist/index.html` |
| `npm run dev` | The same build, on every save |
| `npm run golden` | Re-derive the golden checksums after a *deliberate* change |
| `npm run test:browser` | Drive the built page in Chromium — `npx playwright install chromium` once first |

## One thing that will change

Opening `dist/index.html` straight off disk works because the page is a single file with no worker. When the
simulation moves into a web worker (DESIGN.md §5), browsers will refuse to start it from `file://` and this
will need serving over HTTP — `npx serve dist`, or anything equivalent. Not yet, but that is the day the
instructions above stop being enough.
