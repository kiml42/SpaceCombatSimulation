# Ideas
Ideas that aren't planned to be implemented yet, they may or may not be good ideas.

## Editor
- Hover on the thrust diagram shows engine plumes on the main display for how it would achieve that thrust
- Test button - switches to the game view, with the ship loaded into a default scene with one other stock ship, each given basic orders to attack each other.
- Allow dragging copies (when a module or assembly is set to be repeated) to set the offset (might get complicated with more than 2, so might need to restrict to the second one)
- Handle for rotating an assembly
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

## Evolution
- Fleet evolution - one JSON file to define a formation of multiple ships.
- Boss Battle - All evolving ships are on the same side competing to do the most damage (and take the least) from the "Boss" ship or fleet (defined in the config).
- Mutate to change the whole scale of the ship

## Fleet Editor
- Allow grouping ships.
- Make duplicate consistent with the ship editor (which creates a one module subassembly)

## Battle UI
- Fleet status display - show thumbnails of all ships in each fleet, one on the left, one on the right.
  - Thumbnails indicate the exact current state, possibly even a live view with its own camera tracking the ship (possibly rotated to match)
  - Click a ship to focus the main camera on it
- If there are no live ships in the current view, track the dead ones - prevents sudden loss of tracking when the ship dies.