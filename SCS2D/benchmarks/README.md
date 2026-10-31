# Benchmarks

Tools for measuring the game, **not part of it**: nothing in the game, its tests or its build imports from here.
They exist to answer "did this change help?" with numbers before it is played.

## `answerSearch.ts`: how fast the skirmish enemy answers a round

Replays one round's enemy search from an exported skirmish (*Export* on the skirmish page), headlessly, as
the page fights it: `searchPool` from `host/answer.ts`, with a job worker a core (`answerJobWorker.mjs`). For
each seed of the search it prints, and writes, a line a generation: the best enemy's wins, its fleet's mass
in tonnes, and whether it has answered.

```sh
pnpm exec tsx benchmarks/answerSearch.ts my.skirmish.json --round 4 --seeds 1,2,3 --generations 15 --label before
```

| Option | Default | What it does |
| --- | --- | --- |
| `--round` | (required) | The round to replay: one the file's history shows won and then searched. |
| `--seeds` | `1,2,3` | The search's own seeds, one run each, run in turn. |
| `--generations` | `15` | Where a run stops if nothing answers first. |
| `--workers` | cores less one, at most 4 | Job workers. The results are the same for any number; only the time changes. |
| `--label` | `run` | Names the output files, so runs side by side can be told apart. |
| `--settings` | `{}` | JSON merged over the skirmish's settings, e.g. `'{"breeding":{"opSteal":0.5}}'`. |
| `--file-breeding` | off | Breed with the odds saved in the file. Without it, breeding uses the code's defaults, so a changed default is what gets measured. |
| `--fresh` | off | Run again a seed that has already finished. Without it, finished seeds are skipped, so an interrupted batch can be started again as it was. |

Output goes to `benchmarks/results/` (git-ignored): `<label>-r<round>-s<seed>.jsonl`, plus the best fleet as
`-best.json`, which opens in the fleet editor. If a job throws, its message is written to `-crash.json` and
the run stops.

**It is slow.** A generation takes about 40–140 s on four cores, so three seeds of 15 generations is roughly
an hour. Run one batch at a time: two at once share the cores, and the timings mean nothing.

### Comparing two versions of the code

The tool measures the checkout it runs in. To compare a change with `master`, run the same command in two git
worktrees, one on each branch, with different labels. To compare settings rather than code, use `--settings`
in one checkout.

Read a difference as real only where it shows on more than one seed: three seeds is a small sample.
[`notes/skirmish-adaptation.md`](../notes/skirmish-adaptation.md) shows what earlier runs found.

## `render.ts`: how fast the battle view draws

Runs scenes on the Battle route in a browser **window**, so it draws on this machine's own graphics, in WebGL
and in Canvas2D, and times every frame: the gap between frames, and the main thread's time in the frame's
callbacks (stepping the battle and drawing; WebGL's own GPU work is not in it).

```sh
pnpm bench:render
pnpm bench:render --scenes "Star Wars,Super Swarm" --renderers webgl --paused --label laptop
```

It needs Playwright's Chromium (`pnpm exec playwright install chromium`), or `--browser chrome` for an
installed Chrome, or `--browser firefox` for an installed Firefox. It builds the app first if `dist/` has none; `--build` builds it again, so a change is
measured. Leave the window alone while it runs: covering or minimising it slows or stops its frames.

| Option | Default | What it does |
| --- | --- | --- |
| `--scenes` | `Duel,Star Wars,Super Swarm,Asteroid Field,Factory` | Scenes by their names in the Battle route's list. |
| `--renderers` | `webgl,canvas2d` | Which to measure, each in a fresh page. |
| `--seconds` | `8` | How long each scene is measured. |
| `--at` | `5` | Battle seconds each scene is played to first, so every run measures the same moment of it. |
| `--warmup` | `3` | Seconds each scene runs first, unmeasured, after reaching `--at`. |
| `--size` | `1600x900` | The page's size, CSS pixels. |
| `--dpr` | `1` | Device pixel ratio: `2` draws four times the pixels, as a high-DPI screen does. |
| `--paused` | off | Hold the battle at `--at`, so the time is drawing alone. |
| `--strips` | `shown` | `hidden` hides the fleet strips down the edges, to see what they cost. |
| `--screenshots` | off | Save each scene as measured, beside the results, to check what was drawn. |
| `--profile` | off | After measuring each scene, take a CPU profile of it for `--seconds` and print the 15 functions with the most self time; the `.cpuprofile` opens in DevTools' Performance panel. Build with `pnpm exec vite build --minify false` first for readable names. |
| `--vsync` | off | Hold the frame rate to the display's. Without it the rate is uncapped, so a fast machine shows how far over 60 it could go. |
| `--browser` | `chromium` | Playwright's Chromium, or a `chrome`, `msedge` or `firefox` installed on the machine. |
| `--executable` | | A browser by its path, in place of `--browser`. |
| `--headless` | off | No window. Headless Chromium usually draws WebGL in software, so this measures little; it is for trying the tool. |
| `--label` | `run` | Names the output file. |

It prints a line a scene as it goes, then a table, and writes `benchmarks/results/render-<label>.json`. The
first line of the summary names the GPU the browser used: if it says SwiftShader or llvmpipe, WebGL was drawn
in software and its figures say nothing about the machine.

Firefox is driven over WebDriver BiDi, in a fresh profile of its own with full-precision timers. It has no
`--profile` (that is Chromium's DevTools protocol), and the GPU it names is a near match, not the exact model.

Reading the table: **fps** and **frame** p50/p95/worst (ms between frames) are what is felt; **js** p50/p95
(ms of main-thread work a frame) is where the time goes. Frames far longer than their js time are waiting on
the GPU or the display; js close to the frame time means the CPU is the limit, in stepping the battle unless
`--paused` says otherwise. **from** is the battle time measuring began, and **sim** the battle seconds a
second while measured: under 1 means the battle fell behind.

Running, a slow frame steps the battle further to catch up, which makes the next frame slower still, so a
scene near the edge swings widely from run to run. To compare drawing, use `--paused`.

From PowerShell, quote a comma list (`--renderers "webgl,canvas2d"`), or it arrives split on the commas.
