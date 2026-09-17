# Parked work

Drafts that are worth keeping and are **not part of the build**. Nothing here is compiled by
`npm run typecheck`, bundled by `npm run build` or run by either test suite — `tsconfig.json` includes
`scenarios`, `scripts` and `tests`, and `sim/tsconfig.json` includes `sim`, so this folder is outside both
on purpose.

That is what makes it safe to park something unfinished, and it is also the risk: **a file here may not
compile, and may be wrong.** Each one says at the top what state it is in and what it is waiting on. Move a
file into the tree it belongs to when it is ready, rather than importing it from here.

An empty folder is the goal. If something in here has gone stale, delete it — the reasoning worth keeping
lives in [DECISIONS.md](../DECISIONS.md) and [ROADMAP.md](../ROADMAP.md), which are read, and a draft nobody
is waiting for is just a second place to look.

| File | What it is |
| --- | --- |
| `compare-designs.mts` | Compiles every authored ship on two checkouts and compares each figure bit for bit. |
