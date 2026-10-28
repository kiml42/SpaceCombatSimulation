# How fast the skirmish enemy adapts: findings, October 2026

Notes from one piece of work on the skirmish enemy's answer search (`evolution/answer.ts`), started because
the enemy took a long time to adapt when the player stepped up in capability. Linked from ROADMAP.md §12. The
decisions themselves are in DECISIONS.md (2026-10-27 and 2026-10-28); this keeps the measurements and the
reasoning together, for when it needs looking at again.

## The case it started from

The author's exported skirmish, round 4. The player had stepped up from 21 t (two Bees) to 1,227 t (two Bees
and a Hive), against an enemy of 51 t of ships bred from bare cores. In play the enemy took **76 generations**
to answer, and its answer was still only 126 t.

## How it was measured

Every number below replays that round's enemy search headlessly from the exported file, under the skirmish's
own settings: the player's fleet as it was at round 4, the enemy it beat, and the round's seed. It uses four
job workers, the same pool the page uses. Each run is one seed of the search (1, 2 or 3), capped at 15
generations, and records per generation the best enemy's wins, its fleet's mass, and whether an answer was
found.

Three seeds is a small sample. Read a difference between two columns as real only where it shows on more than
one seed. The tool is [`benchmarks/answerSearch.ts`](../benchmarks/README.md), committed afterwards from the
scratch scripts these runs used. Variants were compared as separate checkouts, or with its `--settings`.

## What was wrong, and what changed

### The search fought by different rules from the round

This was the largest single problem. The search cut each match at its length (180 s) and took an enemy that
was ahead then to have won. The round is fought on to its decision. Under the quiet rule, enemies that led
at 180 s then went quiet and lost the round: one did so at 590 s holding 97% of its mass against the player's
47%. Selection could not see it, so the search kept breeding the same enemy, with "3 of 3 wins" every
generation and every one failing the check. The author's file showed the same plateaus: 8–10 generations at
a time on round 4, and all 15 on round 6.

- [#512](https://github.com/kiml42/SpaceCombatSimulation/pull/512): search matches end when the round's own
  quiet rule decides them.
- [#516](https://github.com/kiml42/SpaceCombatSimulation/pull/516): the round's own seed is fought to the
  round's decision, and counts as won only by the answer margin. It replaces the separate check stage, and
  the round won ranks first among a generation's enemies.

### Builders' scores were inflated

A side's share of its own starting mass counted mined metal and built ships, so a fleet that mined or built
finished "more than whole". One enemy scored a margin of 67 where an outright win is worth about 3.
[#510](https://github.com/kiml42/SpaceCombatSimulation/pull/510) caps the share at 1.

### Generations were slow

A generation took about 132 s fought serially on four cores.
[#509](https://github.com/kiml42/SpaceCombatSimulation/pull/509) deals each generation's matches out to a
job worker per spare core, giving the same results in any order, and took it to about 44 s.

Dealing the long round matches out first was tried as well. It was about 5% faster, but no enemy finishes a
generation until near the end that way, which empties the page's "leading enemy" for most of it, so it was
dropped. The branch `claude/answer-rounds-first` holds it.

### The enemy could not grow fast enough

The enemy's fleets stayed at a few small ships. Its budget was not the limit: about 100 t used of some
7,200 t allowed.

- **Adding ships was not the problem.** 87–100% of `add` attempts fit, so placing new ships further out was
  not needed to make adds succeed.
- **Stealing the player's designs works, but is off by default.**
  [#511](https://github.com/kiml42/SpaceCombatSimulation/pull/511) added the `steal` operator, named `copy`
  until review. [#515](https://github.com/kiml42/SpaceCombatSimulation/pull/515) made it take heavier
  designs more often: drawn evenly, the Hive came up only half the time. The author turned it off by default,
  as it could feel like cheating; letting the player allow it in play is a §12 open question.
- [#517](https://github.com/kiml42/SpaceCombatSimulation/pull/517): `add` duplicates heavier designs more
  often, taking mass as a stand-in for strength, since a match does not credit what each design did.
- [#518](https://github.com/kiml42/SpaceCombatSimulation/pull/518): fleets were bunched, ships 1.1–2.5 times
  their two radii apart and a whole fleet 20–30 m across where 500 m is allowed. Added ships now stand
  further off, and `spread` opens a fleet out or draws it in.
- [#519](https://github.com/kiml42/SpaceCombatSimulation/pull/519): `scale` makes one design bigger or
  smaller, whole. The ship's own `rescale` was one knob among every module's, in steps of a few percent.
- [#520](https://github.com/kiml42/SpaceCombatSimulation/pull/520): `chimera` joins two designs' halves, cut
  only at faces that look away from each design's centre of mass.
- [#535](https://github.com/kiml42/SpaceCombatSimulation/pull/535): scale's and spread's sizes are settings
  (`fleetScaleSize`, 0.2; `fleetSpreadSize`, 0.25), and both are drawn from `drift`.

### Found along the way

- [#513](https://github.com/kiml42/SpaceCombatSimulation/pull/513): a crash when a moored ship's hull was
  renumbered, as the claw it was moored by went stale.
- [#514](https://github.com/kiml42/SpaceCombatSimulation/pull/514): a timing-dependent assertion in the
  evolution worker's test, which failed on fast CI runners.

## Results

### With stealing on (weight 0.5): the generation an answer was found

| | seed 1 | seed 2 | seed 3 |
| --- | --- | --- | --- |
| In play, before any of this | 76 generations | | |
| #511, under the old match rules | none: 3 of 3 wins from gen 5, every check failed | | |
| + #512, the quiet rule | 11 | none, 0 wins | none, 0 wins |
| + #515, heavier designs stolen | 9 | none: wins, every check failed | 15 |
| + #516, the round fought to its decision | **9** | **7** | **10** |

Not every combination was run, so some cells are blank. Each row includes the rows above it.

### With stealing off (the default): the best enemy at generation 15

| | seed 1 | seed 2 | seed 3 |
| --- | --- | --- | --- |
| #516 | 2 wins, 67 t | 0 wins, 60 t | 0 wins, 43 t |
| + #517, heavier adds | 0 wins, 88 t | 0 wins, 35 t | 0 wins, 75 t |
| + #518, spread | 0 wins, 86 t | 0 wins, 44 t | 0 wins, 76 t |
| + #519, scale at a fixed ×1.1 | 0 wins, **215 t** | **answer at gen 11**, 82 t | 0 wins, 75 t |
| #519 without spread | 0 wins, 90 t | 1 win, 168 t | 0 wins, 76 t |
| + #520 chimera, any face cut | 0 wins, 34 t | 0 wins, 32 t | 0 wins, 27 t (gen 7) |
| scale drawn by drift, width 0.1, + spread | 0 wins, 48 t | 0–1 wins, 11 t | 0 wins, 86 t |
| the same + #520 chimera, as merged | 0 wins, 53 t | 2 wins, 51 t | 0 wins, 27 t |
| #535: drift width 0.2, + spread, chimera off | 0 wins, 78 t | 0 wins, 52 t | 1–2 wins, 68–100 t |

What this says, as far as three seeds can:

- **Stealing is the strongest lever.** With it on, every seed was answered within 10 generations. With it
  off, only one seed of one configuration was answered within 15.
- **Scale is the next.** At a fixed ×1.1 it grew one enemy to nearly three times anything else and answered
  another seed. Spread seems to help it, or at least not to hinder it.
- **Drawing scale from `drift` cost most of that**, at width 0.1 and still at 0.2. A drift with no dead zone
  moves under a twentieth on two draws in five, which is hardly a change. Its tail, one draw in ten at five
  times the width, now and then asks for half or more, and those draws are mostly refused. A fixed tenth is a
  real step every time.
- **The chimera, as first written, shrank the enemy**, since a cut could keep little more than a core. With
  the centre-of-mass rule it weighs 1.1–1.9 times the ship it replaces, as a median, and comes out level or
  better on two seeds and worse on one. The author kept it on.

## A note on `drift` and its dead zone

Widening a drift (`magnitude`, or a size like `fleetScaleSize`) does not make its dead zone less likely. The
dead zone is measured on the bell value before the width scales it: with the default `deadZone` of 0.5,
about 38% of draws are zero at any width. Widening scales every other step, the tail's included. `scale`,
`spread` and the ship's own `rescale` use no dead zone, since a factor of one is no change.

## If adapting is still too slow

These are the things not yet tried, most promising first:

1. **Draw scale's step from a band**, say 5–15% either way, every time. That keeps it random without the
   near-zero steps or the huge tail. Benchmark it against the fixed ×1.1 rows above.
2. **More seeds, and other rounds**, before trusting any of the smaller differences above.
3. **Bias towards growth when outweighed:** grow designs more often, or in bigger steps, when the enemy
   weighs a fraction of the player.
4. **Credit each design for what it did in a match**, so `add` (and `steal`) can prefer what worked rather
   than what is heavy.
5. **Score using the budget:** a small reward for an enemy that spends more of what it is allowed.
6. **Offer stealing in play**, as in §12: "the enemy is trying to steal your designs".
