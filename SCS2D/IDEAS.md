# Bugs
Things that are obviously wrong.

- Turrets sometimes track through thick modules which should physically block them.
- Fighter engines in the turret layer immediately hit an overflown hull layer module. Should probably just make engine plumes follow the same rules as beams about staying in their own layers.

-----------------------------------------------------------------------

# Balance
- Beams are overpowered at the moment, outperforming guns most of the time. Adding power systems should help balance them. Check how well they perform once power is implemented.

-----------------------------------------------------------------------

# Ideas
Ideas that aren't planned to be implemented yet, they may or may not be good ideas.

## General
- Engines should be able to do damage past destroyed modules like beams can
- Engines and beams could reduce the mass of the part they hit/pass through after a certain amount of damage as if sublimating it
- Ships should be able to target specific modules, and, once we have the "main gun" setting in place, offset their aim for their main guns' projectile speed.
- Ships should be able to point in the direction they want to accelerate, instead of just facing the target (there should be a doctrine weighting to balance between aiming the attack orientation at the enemy, and turning to make use of the main engines to accelerate)
- Consider width and length as interchangeable for calculating turret stats. They should be based on teh size of the turret on top (based on the smaller dimension) and the area within the volume of the box underneath.
- Only the dome of turrets should be in the turret layer, the box should be wholly in the hull layer.

## Editor
- Test button - switches to the game view, with the ship loaded into a default scene with one other stock ship, each given basic orders to attack each other.
- Allow dragging copies (when a module or assembly is set to be repeated) to set the offset (might get complicated with more than 2, so might need to restrict to the second one)
- Allow scaling an assembly - this could get messy, as it would create a duplicate that behaves differently due to different scaling laws.
- Snap to hulls
- Category input for ships - ships grouped by category when selecting them anywhere. (e.g. "Star Wars.Imperial", "Stock")
- Make it clearer how the range is controlled in the core's doctrine
- Add calibre multiplier to scale what the default maths gives.

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
- Random variation to arena size, and initial velocities. can be shown as `setting [X] +- [dx]` in one row each so it's not making the section longer, and clearly shows their link.
- Graphs take up too much space. Could probably merge mass and ship count using left and right axes. Could use two different colours and have means solid, and bests dashed.
- Make damage and function taken start at 0 and go negative, so the graph scales nicely at the beginning when they're all useless, highlighting even minor improvements.
- We need a mechanism to let ships know what the goal is. This could be something like a "go close to that" order being given to all ships when the race goal is present. (At the moment we lean on the escort doctrine, but that just makes evolving a second ship mean they bunch up with each other instead of going for the goal)
- Allow ship names to mutate (can just add and remove and change random letters (or spaces), unpronounceable is probably better than just the name of the starting ship with a number)

## Fleet Editor
- Allow grouping ships.
- Make duplicate consistent with the ship editor (which creates a one module subassembly)

## Battle UI
- Fleet status display - show thumbnails of all ships in each fleet, one on the left, one on the right.
  - Thumbnails indicate the exact current state, possibly even a live view with its own camera tracking the ship (possibly rotated to match)
  - Click a ship to focus the main camera on it
- Randomisation settings for all parameters of a custom battle
- Cap projectile rendering at their start and end positions so they don't overlap the barrel that launched them, or the target they hit.
- Add a ship to a running battle, for quick testing. Dropdown in the corner to choose a ship to add to the battle. click and drag to chose position and velocity (position from first click, drag to N seconds worth of distance for the initial velocity.) Ship is instantly spawned when you let go.
- Write names on ships' cores. Names should be their team colour and a sequential number e.g. "Red 5" for the fifth ship instantiated on the red team.
- A selected ship's framing could take in what it is escorting or keeping clear of, as well as its target.