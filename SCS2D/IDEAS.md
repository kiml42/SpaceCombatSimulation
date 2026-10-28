# Bugs
Things that are obviously wrong.

- When a dinky gets welded to a gunship the other gunship will fire at the combined ship even though most of it is actually its ally.
- Fuel tanks should stop supplying fuel when they are too damaged.
- A miner anchored to an asteroid reads no robots in its bays (`ShipView.crews`), though its robots are out mining and loads come home.
- A hull gun's barrel collides as the rectangle its module would be, not where the barrel is drawn. Nothing welds to a barrel (`onWeldablePart`), as a stop-gap until it collides where it is.

-----------------------------------------------------------------------

# Balance

-----------------------------------------------------------------------

# Ideas
Ideas that aren't planned to be implemented yet, they may or may not be good ideas.

## General
- Only the dome of turrets should be in the turret layer, the box should be wholly in the hull layer.
- Control radius for cores: built (DESIGN.md §4); what is left is in ROADMAP.md §12, "A control radius for cores: what is left".
- Hysteresis on decision to use attack or thrust orientation, to avoid flip-flopping.
- Fighters should be able to dip into the hull layer (like they do for ramming) so they can fire beams and non-fragmenting projectiles at the hulls of ships. The balancing cost of this is that they can be hit by anything.
- Ships shouldn't fire engines that make them spin faster while trying to cancel out a spin. The pilot trying to hold orientation should generally win.
- Pads should hold the fighter that docks with them and move it to be centred and aligned (in any orthogonal direction in which it fits). This should be treated like each pad has a robot arm that can move the fighter into position (we might draw this arm later). This should let us realistically increase the speed at which a fighter can be captured, and it can be captured with very poor alignment because the (for now imaginary) arm will fix it.
  - Actually draw the robot arm in if it's not too hard, it would look cool, but that does require an actual IK chain for it, instead of just applying forces.
- Robot arms on Slipways to make them hold the ship they're creating (just cosmetic to explain how it's staying put)
- Range bands should be fuzzy (steer clear, escort and attack) with how much the ship wants to be in the band ramping up or down at the edges. This would stop sudden switching abruptly from getting closer to escort, and moving further to steer clear at the boundary (put 2 catamarans in a scene to see this behaviour). It would also let ships naturally settle into the range at which they burn their engines a bit continually when circling instead of pulsing when they get out of range.
- Robots don't need to spread out on a module they're just passing over, they should travel a somewhat efficient route, and only spread out a bit if they would get in each other's way.
- Ships often shoot at an asteroid that has one of their enemies crashed onto it.

## Editor
- (maybe) Allow dragging copies (when a module or assembly is set to be repeated) to set the offset (might get complicated with more than 2, so might need to restrict to the second one)
- Category input for ships - ships grouped by category when selecting them anywhere. (e.g. "Star Wars.Imperial", "Stock")
- Make it clearer how the range is controlled in the core's doctrine
- Add calibre multiplier to scale what the default maths gives (a turret's bore comes from its dome) (max. calibre should be about 1/3 of the available width, so the barrel fits on the hull/turret without looking silly (with multiple barrels, the sum of calibre can be a higher than this limit because there doesn't need to be as much space left to thickness reinforcement)).
- Thrust efficiency diagram overlaying the thrust diagram, to show which directions are efficient, as well as which are high thrust.
- Option to select an opponent.
  - All the doctrine readouts show what they'd calculate against that opponent at 0 relative velocity.
  - Can drag a ghost of the target ship around to see how it affects the behaviour of the ship.
  - Weapons and weapon engines animate as if it was in a battle at that position.
- When refitting a ship, add a button to animate the refit (not using robots, just show the old things being disassembled and the new parts being assembled)
  - Similar button for assembling from a pad or slipway.
- Allow mounting on the front of engines and hull weapons in the space beside the nozzle/barrel if there is any
- If a module is on the centreline, scale it symmetrically
- Doctrine needs a major overhaul
  - it's far too hidden for something you will often need. 
  - The sections aren't clear enough
- Easy way to mirror a ship.
  - Could add a "Mirror" button to a module off the centre line that creates a side group, puts that module in it, and duplicates the group mirrored. The group's origin should be 0,0 to make reflection easy, and all modules can be offset within it. Using the button when there is already a side group it should add it to that group.
  - Could make a "duplicate mirrored" button for an assembly that puts it in the right place and mirrors it in one action, instead of having to duplicate it, which offsets it, then needing to mirror it, and offset it to the negative position of where the original was.
- Default the refit mode to off except where it's useful


## Weapons
- Maybe: Turrets fire a volley of one shot per barrel, and then reload. Can specify delay between shots to allow for firing all at once or staggered
  - Beam turrets should allow for multiple beams to be on at the same time.
  - Might need to allow for reloading one while firing another to have continuous firing, could possibly just have each barrel reload independently, and just stagger the triggers by the set amount.
- Improved allowed turning for hull guns (they should have wider arcs)
- Bullet spread (inaccuracy. Could get worse as a gun gets damaged.)
- Shell fragments should be placed in a random layer when the shell detonates, instead of being considered to hit anything in either. Possibly there could be a bias towards keeping fragments in the turrets layer, to keep fragments good at hitting fighters. (probably dependent on the charge size)
- The default doctrine for a ship with a single hull beam put its attack band well within the range of its weapon, making it ineffective by default as long range is the main advantage of a beam.
- Multi-barrelled beams could fire at the same time, making duration les than half (double power, but more heating) with double the power. It could actually be useful to sniping.

## Manoeuvring
- Ships need to have a max allowed rotational speed, or some other mechanism to stop them spinning up faster and faster when they have damaged engines.
- Ships need to be able to know when they're already turning towards the target, so not push themselves to turn faster.
- Evasive manoeuvres
  - Consider the time a projectile will take to arrive and change lateral velocity enough to not be where the enemy expects.
  - Would need counter-strategies, e.g. deliberately aiming randomly based on the target's ability to accelerate (already somewhat accounted for with the trigger range limit)
- Ramming needs to work harder to cancel lateral velocity, this is more important than getting to the desired forwards velocity.

## Evolution
- Make damage and function taken start at 0 and go negative, so the graph scales nicely at the beginning when they're all useless, highlighting even minor improvements.
- We need a mechanism to let ships know what the goal is. This could be something like a "go close to that" order being given to all ships when the race goal is present. (At the moment we lean on the escort doctrine, but that just makes evolving a second ship mean they bunch up with each other instead of going for the goal)
- Duplicated parts or assemblies can be placed anywhere on the surface of the ship, not just close to the module they're a duplicate of (possibly with a higher chance of appearing nearby)
- Ships often lose manoeuvrability, even starting with a good configuration of engines, they will often lose some.
- Evolution finds it very hard to make ships bigger
  - e.g. a corvette can make its outer modules bigger, and even stretch some of its inner modules, but there's no mechanism to add a module somewhere in the middle to extend it, or make it wider.


## Fleet Editor
- Make duplicate consistent with the ship editor (which creates a one module subassembly)
- Allow stepping into a single ship to edit it in place, without needing to switch to the ship editor - this would combine both editors into a single page with two modes.

## Battle UI
- Fleet status tiles could turn with their ship, so it always points the same way in its tile.
- Cap projectile rendering at the point they hit, so a streak does not overlap the target it struck. (The muzzle end is capped.)
- A selected ship's framing takes in and rings what it is escorting; it could do the same for what it is keeping clear of, possibly with a symbol to show what sort of attention the selected ship is paying to each

## Harvesting
- Scavenging wrecks and mining asteroids. Two of the causes of wrecked Salvagers are being fixed as ROADMAP.md
step 15, item 5: arriving with its jaws held on all the way, braking astern, rather than turning round late; and
flying round asteroids in its way rather than relying on keeping clear, which looks only seconds ahead.
 

### Getting hold safely
- Two-stage approach: stop and match motion a few lengths off the surface, then creep in at the claw's lowest
  speed. Slower to grip, but the fast part of the trip never ends at a rock.
- Abort and go round again: if the approach is out of tolerance close in (too fast, too far across, still turning),
  back off along the stand-off path and try again, rather than pressing on into a bad contact.
- Aim at a point on the surface, not the centre: the wedge facing it, or the richest wedge of the vein in reach.
  An asteroid's middle is not where the claw meets it, and a spinning one's surface is moving.
- Rubble that gives: rock is loosely bound, so a slow knock could crumble the wedge it hits (damage spent on the
  rock) rather than crush the ship's engine. Makes grabbing forgiving without making ships tougher.
- A claw approach speed of its own in doctrine, separate from the combat `approachSpeed`, so it can evolve: the
  Salvager closes on rock at the speed it would close on an enemy.

### Sharing rocks
- Claims: a ship scavenging an asteroid or hulk is a claim friends respect, unless the rock is big enough for
  several. Two friends on one minor crash into each other's anchored hulls.
- Keep clear of a rock an enemy miner is anchored to, or treat it as a target: the rival-outposts demo has one
  side's Salvager fly to the other's major and crash into the miner there.
- Recall robots before letting go, or let robots left on a rock keep working and come home when the ship grips it
  again. A miner torn off a rock now loses every robot out on it, and pays metal to build them again.

### Throughput
- Deliver to a base: miners carry their hold to a friend with a port (a refinery or outpost ship) and go back,
  rather than stopping when the hold is full. What the rival-outposts demo needs to be a contest of income.
- A drill on the claw: like heating ice, a claw grinds ore slowly on its own, so a miner with no robots still earns.
- Miner robots: a robot bay setting for the kind of robot it builds. Set to miners, its berths are twice as long
  and twice as wide, and each miner carries eight times a robot's load (its volume) and mines four times as fast
  (its area), with eight times the charge to dig a full load, but cannot mend its ship. Walking is most of a
  trip, so a bigger load spreads it over more ore: on Rival Mines' Replicator, a trip is about 115 s of walking
  and 23 s of work for about 700 kg. A miner, in four berths' deck, would bring about 5.6 t in about 160 s (the
  walk, and twice the digging), some 35 kg/s against four robots' 20. Rather than "heavy" robots that are better at everything, which would leave
  ordinary ones worth building only in bays too small for a heavy one.
- Shorter walks: robots spend about four fifths of their time walking on the rock (Rival Mines' Replicator:
  40% going out, 41% coming home, 16% working, 3% in the bay), and their walks lengthen as the rock nearest the
  claw is mined out. A moored ship could let go and grip again nearer what is left, or robots could run faster
  over rock than `ROBOT_TOP_SPEED`.
- Tailings: what mining leaves (the waste share) drifts off as loose rubble, a hazard round a worked rock.
- An outpost built on an asteroid: robots raise a slipway or pad on an anchored major, so a mine becomes a place.

### Choosing what to mine
- Weigh the trip's fuel and danger against the rock's worth, and prefer rocks near friends and away from enemies.
- Show each side's mining as income in the fleet tiles, and a picked asteroid's time to mine out at the rate
  being taken from it.

## Skirmish
- The game should be able to track multiple saved skirmishes internally, by name.
- When the enemy are evolving, make the history fill the battle area.
  - In this mode the player's fleet should be put on the left, and the enemy on the right.
