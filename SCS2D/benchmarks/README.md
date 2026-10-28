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
