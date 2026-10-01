# Bugs
Things that are obviously wrong.

- When stating evolution in "A battle" setting, it doesn't start showing a battle, you need to switch to "the combatants" and back again.

## Simulation

-----------------------------------------------------------------------

# Ideas
Ideas that aren't planned to be implemented yet, they may or may not be good ideas.


## Editor
- Hover on the thrust diagram shows engine plumes on the main display for how it would achieve that thrust
- Test button - switches to the game view, with the ship loaded into a default scene with one other stock ship, each given basic orders to attack each other.
- Allow dragging copies (when a module or assembly is set to be repeated) to set the offset (might get complicated with more than 2, so might need to restrict to the second one)
- Allow scaling an assembly - this could get messy, as it would create a duplicate that behaves differently due to different scaling laws.
- Snap to hulls

## Turrets
- Turrets fire a volley of one shot per barrel, and then reload. Can specify delay between shots to alow for firing all at once or staggered
  - Beam turrets should allow for multiple beams to be on at the same time.
  - Might need to allow for reloading one while firing another to have continuous firing, could possibly just have each barrel reload independently, and just stagger the triggers by the set amount.
- Improve barrel spacing on hull guns
- Bullet spread

## Maneuvering
- Command ships with a max tangential velocity, also for doctrines
- Ships need to have a max allowed rotational speed.
- Ships need to be able to know when they're already turning towards the target, so not push themselves to turn faster.
- Attack orientation
  - Set manually, or define some weapons as main guns and use their overlapping angles to find the best orientation. (make sure engines used as weapons can be included.)
- Thrust orientation - same as attack orientation, but considering engines.

## Evolution
- Mutate to change the whole scale of the ship
- When mutation between gun and engine, the module should be rotates 180, to maintain the correct outward face.
- Consider scoring for ramming
  - Currently just loses score by everything taking damage
  - Might want to attribute the damage to both ships to the other, this would be asymmetrical is one manages to ram its armour into an active component on the other.
- Random variation to arena size, and initial velocities. can be shown as `setting [X] +- [dx]` in one row each so it's not making the section longer, and clearly shows their link.
- Allow naming of evolution runs -> file name when exported.
- Graphs take up too much space. Could probably merge mass and ship count using left and right axes. Could use two different colours and have means solid, and bests dashed.
- In-battle scores should be an overlay on the battle, not making it be a tiny bar at the bottom.

## Fleet Editor
- Allow grouping ships.
- Make duplicate consistent with the ship editor (which creates a one module subassembly)

## Battle UI
- Fleet status display - show thumbnails of all ships in each fleet, one on the left, one on the right.
  - Thumbnails indicate the exact current state, possibly even a live view with its own camera tracking the ship (possibly rotated to match)
  - Click a ship to focus the main camera on it
- Randomisation settings for all parameters of a custom battle
- team coloured beams and projectiles - as a UI option, so you can still see the more realistic mode by default.