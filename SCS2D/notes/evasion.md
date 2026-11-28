# Evasive manoeuvring: findings, November 2026

Measurements behind the evasion points (`approach.evasionRadii`, DECISIONS.md 2026-11-28), kept together for
when evasion needs looking at again. The scripts were throwaway; each measurement says enough to redo it.

[Atomic Rockets' page on space-war defence](https://www.projectrho.com/public_html/rocket/spacewardefense.php)
covers the same ground: a target's possible position at the moment a shot arrives spreads as ½·a·t², and a
shot is wasted once that spread is bigger than the target.

## Why the speed jink did little

`approach.evasion` alone asks for a sideways *speed*, redrawn every flight time or so. Two things undid it:

- **What a hull can push sideways is small.** Across the line of fire, with its bow on the enemy, a Gunship
  has 0.66 m/s², a Corvette 3.1, an X-Wing 1.6. Over a 2.2 s flight a Gunship moves 1.6 m off a lead, against
  a 39 m radius. Once it reaches the speed it asked for it coasts, and a coast is led exactly.
- **It turned the hull.** Asking for more sideways speed than the thrusters give set the helm turning its push
  that way: a jinking Gunship sat 22% broadside on average, against 1% flying straight, which spoiled its own aim
  and showed the enemy a longer hull.

Gun reach makes this worse by design: a gun fires only out to where a target dodging at `EVASION_ACCEL`
(10 m/s²) could not get clear, and no stock hull manages a third of that sideways. Inside reach, no evasion
moves a whole-hull lead by more than about a tenth of the hull's radius.

## Evasion points

A point round the enemy gun aimed at the ship, at its range, a random way and half to one and a half of
`evasionRadii` own radii along the arc; flown to on a braking law and redrawn on arrival. So it is always
speeding up or slowing down rather than coasting, and the side push stays within what the thrusters give, so
it stays bow-on (4% broadside rather than 22%).

**The braking is planned on twice the side push** (`EVADE_PLAN`). Lead error one flight time on, as a share
of the target's radius, and how often it would clear half a radius, for a Corvette and an X-Wing held 3 km
from the enemy:

| Plan on | Corvette miss | > ½ r | X-Wing miss | > ½ r | Bow off target |
| --- | --- | --- | --- | --- | --- |
| speed jink, 30 m/s | 0.60 r | 40% | 0.58 r | 41% | X-Wing 0.31 rad |
| ½ the push | 0.40 r | 32% | 0.34 r | 25% | none |
| 1× | 0.58 r | 42% | 0.34 r | 22% | none |
| **2×** | 0.71 r | 48% | 0.42 r | 33% | none |
| 4× | 0.81 r | 55% | 0.42 r | 35% | up to 0.4 rad at 2 radii |

Planned on half, it eases in and spends the end of each leg coasting. Planned on four times, it overshoots far
enough to turn the hull.

**Planned on the mains instead** (as though it would turn its push onto the point): a Corvette's lead error
rises to 2.2 radii, 73% clear, but its bow is 0.7 rad off target; a Gunship turns 1 rad off and gains nothing,
since it turns too slowly. Left out: the side push it has where it faces is what it plans on.

## In matches

Mirror duels, 1 km radius, 90 s, 16 seeds both ways round, against a plain Corvette:

| Corvette | Wins | Lost to it | Damage taken |
| --- | --- | --- | --- |
| speed jink, 30 m/s | 11 | 18 | 37% vs 34% |
| points, 30 m/s, 1 radius | 20 | 9 | 32% vs 39% |
| points, 30 m/s, ½ radius | 18 | 9 | 33% vs 40% |
| points, 140 m/s, 1.4 radii | 19 | 7 | 35% vs 42% |

The whole-hull lead error at these ranges is small, so most of the gain is likely in which part a round hits:
a gun aims at a part, a core or a mount, and a metre or two off puts it on something else.

Gunships gain nothing either way: a Gunship duel at 2 km is settled by a core hit in 7–9 s, and it cannot move
far enough sideways to spoil that.

## Doctrine-only evolution

Three Corvette founders, plain, speed jink (30 m/s) and points (30 m/s, 1 radius), in one population of 24;
only the avoidance fields mutating (`--doctrine targeting=0,approach=0,escort=0,gunnery=0,avoidance=1`, build
weights all 0, `--ships 1`), duels, 40 generations, two seeds; once as stock, and once with every gun's
`fireRange` at 3 so shots are taken where a dodge can spoil them.

- Every run lost the plain lineage by generation 5, and ended all or nearly all on evasion points.
- Each champion against a plain Corvette, then the same champion with `evasion` set to 0, which leaves it
  exactly the plain Corvette:

| Run | Champion | Wins as evolved | With evasion 0 |
| --- | --- | --- | --- |
| stock range, seed 1 | 141 m/s, 1.44 radii | 16–13 | 10–10 |
| stock range, seed 2 | 30 m/s, 0.45 radii | 21–6 | 10–10 |
| `fireRange` 3, seed 1 | 18 m/s, 0.94 radii | 22–9 | 16–16 |
| `fireRange` 3, seed 2 | 62 m/s, 0.83 radii | 24–5 | 16–16 |

At `fireRange` 3 the speed jink helps too, 19–12, and the points founder beats it, 23–8.
