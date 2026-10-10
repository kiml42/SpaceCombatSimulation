# Bugs
Things that are obviously wrong.

- Fuel tanks should stop supplying fuel when they are too damaged.
- Fighter engines in the turret layer immediately hit an overflown hull layer module. Should probably just make engine plumes follow the same rules as beams about staying in their own layers.
- When setting up a co-evolution run between two very large fleets, the UI hangs on every input. Setting up runs with fleets this big is probably a bad idea anyway, but the UI shouldn't hang making it difficult to change your mind.
- If you add a ship to a fleet from a file that shares a name with an existing ship in the fleet, you get a copy of that ship, instead of the new ship. Should either rename the new ship, or replace the old ship. either way, it should alert you.
- In evolution, things end up connected to engine bells, which shouldn't be allowed as connection surfaces.
- Welding in battles sometimes happens to the bounding box around the barrels for hull guns, which looks silly, so shouldn't be possible (they should be considered non-connectable surfaces).

-----------------------------------------------------------------------

# Balance
- Beams are overpowered at the moment, outperforming guns most of the time. Adding power systems should help balance them. Check how well they perform once power is implemented.

-----------------------------------------------------------------------

# Ideas
Ideas that aren't planned to be implemented yet, they may or may not be good ideas.

## General
- Doctrine to specify an allowed range of tangential velocities, to allow for fighters to do fast passes.
- Engines should be able to do damage past destroyed modules like beams can
- Engines and beams could reduce the mass of the part they hit/pass through after a certain amount of damage as if sublimating it
- Ships should be able to target specific modules, and, once we have the "main gun" setting in place, offset their aim for their main guns' projectile speed.
- Ships should be able to point in the direction they want to accelerate, instead of just facing the target (there should be a doctrine weighting to balance between aiming the attack orientation at the enemy, and turning to make use of the main engines to accelerate)
- Consider width and length as interchangeable for calculating turret stats. They should be based on teh size of the turret on top (based on the smaller dimension) and the area within the volume of the box underneath.
- Only the dome of turrets should be in the turret layer, the box should be wholly in the hull layer.
- Beams from thick hull beams could be treated as a separate beam in each layer. Damage against a thick module stays the same, but is halved against a hull layer module or fighter, with the other half continuing, able to hit something else.
- Hysteresis on decision to use attack or thrust orientation, to avoid flip-flopping.
- Ability for fighters to stay docked until ordered to leave, or an enemy comes within a specified range
- Fighters should be able to dip into the hull layer (like they do for ramming) so they can fire beams and non-fragmenting projectiles at the hulls of ships. The balancing cost of this is that they can be hit by anything.
- Ships shouldn't fire engines that make them spin faster while trying to cancel out a spin. The pilot trying to hold orientation should generally win.
- docking fighters struggle to keep up with an accelerating carrier, even when they have plenty of spare thrust they could be using. They should probably account for the carrier's current acceleration and aim to match it's changing speed (and assume it will maintain its acceleration)

## Editor
- Test button - switches to the game view, with the ship loaded into a default scene with one other stock ship, each given basic orders to attack each other.
- Allow dragging copies (when a module or assembly is set to be repeated) to set the offset (might get complicated with more than 2, so might need to restrict to the second one)
- Allow scaling an assembly - this could get messy, as it would create a duplicate that behaves differently due to different scaling laws.
- Snap to hulls
- Category input for ships - ships grouped by category when selecting them anywhere. (e.g. "Star Wars.Imperial", "Stock")
- Make it clearer how the range is controlled in the core's doctrine
- Add calibre multiplier to scale what the default maths gives.
- For engines and hull weapons, make the module size specify the size of the machinery block witht eh barrel/nozzle extending out from there. The barrel/nozzle will still need ot be considered for overlapping. This should make it easier to adjust things in the editor, as you won't have the option to set a module length that doesn't work with a given barrel length.
- Thrust efficiency diagram overlaying the thrust diagram, to show which directions are efficient, as well as which are high thrust.
- Expand the thrust diagram on mouseover or click.

## Weapons
- Turrets fire a volley of one shot per barrel, and then reload. Can specify delay between shots to allow for firing all at once or staggered
  - Beam turrets should allow for multiple beams to be on at the same time.
  - Might need to allow for reloading one while firing another to have continuous firing, could possibly just have each barrel reload independently, and just stagger the triggers by the set amount.
- Improve barrel spacing on hull guns
- Bullet spread

## Manoeuvring
- Command ships with a max tangential velocity, also for doctrines
- Ships need to have a max allowed rotational speed.
- Ships need to be able to know when they're already turning towards the target, so not push themselves to turn faster.
- Attack orientation
  - Set manually, or define some weapons as main guns and use their overlapping angles to find the best orientation. (make sure engines used as weapons can be included.)
- Thrust orientation - same as attack orientation, but considering engines.

## Evolution
- Consider scoring for ramming
  - Currently just loses score by everything taking damage
  - Might want to attribute the damage to both ships to the other, this would be asymmetrical is one manages to ram its armour into an active component on the other.
- Make damage and function taken start at 0 and go negative, so the graph scales nicely at the beginning when they're all useless, highlighting even minor improvements.
- We need a mechanism to let ships know what the goal is. This could be something like a "go close to that" order being given to all ships when the race goal is present. (At the moment we lean on the escort doctrine, but that just makes evolving a second ship mean they bunch up with each other instead of going for the goal)
- Dropdown to choose what to graph (score, mass, ship count, weapon count, engine count, possibly even select anything from doctrines to see how those are evolving)
  - Might want to show the total change over the run in the dropdown, so it's easy to see what is generally changing and will likely have an interesting graph.
- Add an export button to every fleet in the "the combatants" view, should fit under the score neatly.
- Co-evolution mode fills up scores for all the As and then all the Bs, it would be better if the battles order was randomised, so they fill up together.
  - Also, we could show partial scores if we added a battle count section (probably beneath the score value) showing "X/Y", so you can see how many of its battles the ship has completed.

## Fleet Editor
- Make duplicate consistent with the ship editor (which creates a one module subassembly)

## Battle UI
- Fleet status display - show thumbnails of all ships in each fleet, one on the left, one on the right.
  - Thumbnails indicate the exact current state, possibly even a live view with its own camera tracking the ship (possibly rotated to match)
  - Click a ship to focus the main camera on it
- Randomisation settings for all parameters of a custom battle
- Cap projectile rendering at the point they hit, so a streak does not overlap the target it struck. (The muzzle end is capped.)
- Add a ship to a running battle, for quick testing. Dropdown in the corner to choose a ship to add to the battle. click and drag to chose position and velocity (position from first click, drag to N seconds worth of distance for the initial velocity.) Ship is instantly spawned when you let go.
- A selected ship's framing could take in what it is escorting or keeping clear of, as well as its target.
- Fuel tanks should still show their fuel level when damaged
- The ship name on cores should rotate and scale with the ship, as if it is literally written on the hull.
- Use time scale buttons instead of a slider (0.25, 0.5, 1, 2, 4, 8, 16)
- Show the range the selected ship is trying to get into with the target as a ring around the target (or possibly the selected ship, to be consistent with the editor)
