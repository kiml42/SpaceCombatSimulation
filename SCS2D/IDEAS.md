# Bugs
Things that are obviously wrong.

- Fuel tanks should stop supplying fuel when they are too damaged.
- When setting up a co-evolution run between two very large fleets, the UI hangs for about 30 s (the Imperial Fleet against the Rebel Fleet) after each change to a setting the opening match reads, and on loading the page with such a setup saved: the preview breeds a whole first generation to draw it. A burst of changes now builds it once, and a setting it does not read (generations, matches, winners) does not rebuild it. Fixing it needs the build off the main thread, or a preview that does not breed, at the cost of its seed no longer being the run's.
- In evolution, things end up connected to engine bells, which shouldn't be allowed as connection surfaces.
- A hull gun's barrel collides as the rectangle its module would be, not where the barrel is drawn. Nothing welds to a barrel (`onWeldablePart`), as a stop-gap until it collides where it is.

-----------------------------------------------------------------------

# Balance

-----------------------------------------------------------------------

# Ideas
Ideas that aren't planned to be implemented yet, they may or may not be good ideas.

## General
- Engines should be able to do damage past destroyed modules like beams can
- Consider width and length as interchangeable for calculating turret stats. They should be based on the size of the turret on top (based on the smaller dimension) and the area within the volume of the box underneath.
- Only the dome of turrets should be in the turret layer, the box should be wholly in the hull layer.
- Beams from thick hull beams could be treated as a separate beam in each layer. Damage against a thick module stays the same, but is halved against a hull layer module or fighter, with the other half continuing, able to hit something else.
- Hysteresis on decision to use attack or thrust orientation, to avoid flip-flopping.
- Fighters should be able to dip into the hull layer (like they do for ramming) so they can fire beams and non-fragmenting projectiles at the hulls of ships. The balancing cost of this is that they can be hit by anything.
- Ships shouldn't fire engines that make them spin faster while trying to cancel out a spin. The pilot trying to hold orientation should generally win.
- docking fighters struggle to keep up with an accelerating carrier, even when they have plenty of spare thrust they could be using. They should probably account for the carrier's current acceleration and aim to match it's changing speed (and assume it will maintain its acceleration)
- Shell fragments should be placed in a random layer when the shell detonates, instead of being considered to hit anything in either. Possibly there could be a bias towards keeping fragments in the turrets layer, to keep fragments good at hitting fighters. (probably dependent on the charge size)
- Pads should hold the fighter that docks with them and move it to be centred and aligned (in any orthogonal direction in which it fits). This should be treated like each pad has a robot arm that can move the fighter into position (we might draw this arm later). This should let us realistically increase the speed at which a fighter can be captured, and it can be captured with very poor alignment because the (for now imaginary) arm will fix it.

## Editor
- Test button - switches to the game view, with the ship loaded into a default scene with one other stock ship, their doctrines will make them fight.
- Allow dragging copies (when a module or assembly is set to be repeated) to set the offset (might get complicated with more than 2, so might need to restrict to the second one)
- Category input for ships - ships grouped by category when selecting them anywhere. (e.g. "Star Wars.Imperial", "Stock")
- Make it clearer how the range is controlled in the core's doctrine
- Add calibre multiplier to scale what the default maths gives.
- For engines and hull weapons, make the module size specify the size of the machinery block with the barrel/nozzle extending out from there. The barrel/nozzle will still need ot be considered for overlapping. This should make it easier to adjust things in the editor, as you won't have the option to set a module length that doesn't work with a given barrel length.
- Thrust efficiency diagram overlaying the thrust diagram, to show which directions are efficient, as well as which are high thrust.

## Weapons
- Maybe: Turrets fire a volley of one shot per barrel, and then reload. Can specify delay between shots to allow for firing all at once or staggered
  - Beam turrets should allow for multiple beams to be on at the same time.
  - Might need to allow for reloading one while firing another to have continuous firing, could possibly just have each barrel reload independently, and just stagger the triggers by the set amount.
- Improve barrel spacing on hull guns
- Bullet spread (inaccuracy. Could get worse as a gun gets damaged.)

## Manoeuvring
- Ships need to have a max allowed rotational speed, or some other mechanism to stop them spinning up faster and faster when they have damaged engines.
- Ships need to be able to know when they're already turning towards the target, so not push themselves to turn faster.
- Ships should consider if their rotation will result in a collision. e.g. one side of the catamaran in split gets its front broken off because it turns in a way that moves it towards the other half while trying to get an engine lined up to move away.

## Evolution
- Make damage and function taken start at 0 and go negative, so the graph scales nicely at the beginning when they're all useless, highlighting even minor improvements.
- We need a mechanism to let ships know what the goal is. This could be something like a "go close to that" order being given to all ships when the race goal is present. (At the moment we lean on the escort doctrine, but that just makes evolving a second ship mean they bunch up with each other instead of going for the goal)
- Dropdown to choose what to graph: the chart under the score offers mass and ships, or weapons and engines. Still to add: anything from doctrines, to see how those are evolving
  - Might want to show the total change over the run in the dropdown, so it's easy to see what is generally changing and will likely have an interesting graph.
- Whole ship scale mutation
- Assembly scale mutation - scales everything in all copies of the assembly up or down.
- Make mutation settings for numbers define the maximum range and make all numbers always mutate a little (still rejecting invalid values) (could include positions and scales as well)
- Duplicated parts or assemblies can be placed anywhere on the surface of the ship, not just close to the module they're a duplicate of (possibly with a higher chance of appearing nearby)

## Fleet Editor
- Make duplicate consistent with the ship editor (which creates a one module subassembly)
- Allow stepping into a single ship to edit it in place, without needing to switch to the ship editor - this would combine both editors into a single page with two modes.

## Battle UI
- Fleet status display - show thumbnails of all ships in each fleet, one on the left, one on the right.
  - Thumbnails indicate the exact current state, possibly even a live view with its own camera tracking the ship (possibly rotated to match)
  - Click a ship to focus the main camera on it
- Cap projectile rendering at the point they hit, so a streak does not overlap the target it struck. (The muzzle end is capped.)
- Add a ship to a running battle, for quick testing. Dropdown in the corner to choose a ship to add to the battle. click and drag to chose position and velocity (position from first click, drag to N seconds worth of distance for the initial velocity.) Ship is instantly spawned when you let go.
- A selected ship's framing takes in and rings what it is escorting; it could do the same for what it is keeping clear of, possibly with a symbol to show what sort of attention the selected ship is paying to each
