# Scenes: what each is good for

The battles the Battle route lists (`SCENES` in `scenes.ts`), in its order: what is in each, and which to open
to see or test a given part of the game. Counts are from the blueprints in `blueprints/` and `fleets/`. Keep this
in step when a scene is added or changes what it shows. A scene with variants (Swarm, Crippled Landing) offers
them in a second list beside the first, and the address names the one picked (`?scene=Swarm&variant=300 fighters`).

## Which scene for what

| To look at | Open |
| --- | --- |
| Robots: bays, berths, robots out on a hull | **Rival Mines** (two bays a ship, big on screen), Mending, Refitting |
| Mining and ore into holds | Mining (no fighting), Rival Mines |
| Building: pads, slipways, refits | Factory (pad), Shipyard (slipway), Refitting, Catamaran Refits, Pad Rebuild |
| Fighters launching, landing, rearming | Beam Carrier, Rearm, Pad Rebuild, Crippled Landing (damaged) |
| Docking, claws, ports, fuel and metal moving | Tanker (ports), Scavenge, Salvage Run (claws), Hooked (welded) |
| Beams on their own | Beam Duel |
| Rail guns: charged from power, solid shot | Rail Duel |
| Plasma lances: pulses of fuel, kept charged or charged on target | Lance Duel |
| A big capital ship with many modules | **Star Wars** (Star Destroyer, about 174 modules) |
| Many small ships | **Swarm: 300 fighters** (302 ships), Swarm: 20 fighters (22) |
| Gravity wells | Duel, Beam Duel, Rail Duel, Lance Duel, Binary (moving wells), Kernels, Asteroid Field, Mining, Rival Mines |
| Asteroids | Asteroid Field, Kernels, Mining, Rival Mines |
| A ship breaking in two | Split |
| Engines as weapons | Torch Run |
| Ramming | Torpedoes, Split, Crash |
| Modules shattered, lingering debris | Crash |
| Shooting past friends | Line Ahead |
| Fighter flight that never ends | Passes, Circling (nothing can die) |

## Benchmarking (`pnpm bench:render`)

- **Swarm: 300 fighters**: the most ships and modules, mostly a few pixels across, so it measures small ships.
- **Star Wars**: one huge ship and about 31 others, guns, beams and fighters: the heaviest mixed scene.
- **Rival Mines**: two mid-sized ships covered in robot bays, on asteroids, under gravity. Its ships grow in
  number over time, so measure it at a fixed `--at`.
- **Duel**: small and cheap, the baseline.
- Factory and Rival Mines build ships as they run, so later frames are heavier. Torpedoes is over quickly.
  Mending, Refitting, Catamaran Refits, Salvage Run, Scavenge and Tanker have one to five ships and no fighting:
  too light to measure anything.

## Scene by scene

`CROSSING` (`battle.ts`) starts the sides 1800 m either side, moving across the line between them;
`SIDE_WELL` is a gravity well 1500 m to one side.

| Scene | Light | What is in it | What it exercises |
| --- | --- | --- | --- |
| Duel | daylight | 2 Corvettes against 1 Gunship, crossing, `SIDE_WELL` | Guns, turrets, a hull gun; rounds bent by a well. The golden test's battle |
| Beam Duel | eclipse | 2 Beam Corvettes against 1 Beam Gunship, as Duel | Beams alone |
| Rail Duel | blue giant | 2 Rail Corvettes against 1 Rail Gunship, as Duel | Rail guns charging from generators and batteries: the Corvettes' generators keep theirs going, the Gunship's generator and outrigger batteries keep its heavy one going |
| Lance Duel | red dwarf | 2 Lance Corvettes against 1 Lance Gunship, head on and at rest 1.2 km apart, `SIDE_WELL` | Plasma lances closing to knife range: the Corvettes' charged only on target, the Gunship's kept charged and leaking; their pulses' falloff and kick |
| Star Wars | noon | Star Destroyer (18 TIE pads, 2 robot bays) and 10 TIEs against the Ghost, the Quasar (4 X-Wing pads) and 20 X-, Y- and A-Wings, 5 km apart | A capital ship of about 174 modules; guns, beams, fighters; about 32 ships |
| Swarm: 20 fighters | dusk | 20 Dinkies against 2 Gunships | Small ships, guns |
| Swarm: 300 fighters | red dwarf | 300 Dinkies against 2 Gunships | Ship and module count (about 3,300 Dinky modules) |
| Torpedoes | violet | 12 Torpedoes rammed at a Beam Gunship from 1500 m | Ramming, beam turrets shooting down craft. Short |
| Standoff | ice | Two lines of Gunship, Corvette, Beam Corvette and 2 Dinkies, 1 km apart | Fighting from the first frame; doctrine without orders |
| Line Ahead | gold | Two columns of 4, nose to tail | Shooting past friendly ships |
| Split | nebula | A Catamaran rammed by a Bare Core at 30 m/s; a Corvette arrives later | A ship breaking into two working ships |
| Crash | daylight | A Star Destroyer, no pilot, drifting bow first into a major asteroid at 20 m/s | Shattering: its bow broken into debris at the first contact, then layer after layer until it stops |
| Torch Run | eclipse | 4 Torches round a Laser Frigate | Engine flames as weapons; beams |
| Binary | blue giant | Corvette against Gunship between two wells on an eccentric orbit | Moving wells |
| Kernels | violet | Corvette against Gunship between two spinning asteroid kernels on the binary wells | Collisions with asteroids |
| Asteroid Field | dusk | Corvette against Gunship among 2 major and 8 minor asteroids | Asteroid drawing and collisions, wells |
| Mining | gold | 2 empty Salvagers, 1 major and 4 minor asteroids rich in metal and ice | Claws on rock, robots mining, ore into holds. No fighting |
| Rival Mines | ice | A Replicator a side (2 claws, 2 robot bays, 2 turrets, 2 pads, a slipway), each on its own major, the two on a binary orbit | Robots, mining, building on pads and slipways, wells, fighting. Grows over time |
| Hooked | nebula | 2 Corvettes welded stern to stern, a Gunship either side | Hooked ships flying as one body |
| Broadside | eclipse | Broadside against a Corvette, 3 km apart | Guns firing over the side; turning side-on |
| Salvage Run | red dwarf | A Salvager and 2 wrecks | Claw docking, robots breaking wrecks for metal. No fighting |
| Mending | noon | A damaged Mender, alone, no pilot | Robots repairing |
| Refitting | daylight | A Rebuilder being refitted, no pilot | Building, removing and converting modules in place |
| Catamaran Refits | ice | A Catamaran and a Beam Catamaran each refitting to the other, no pilots | Turrets swapped in place |
| Scavenge | dusk | 2 Scavengers and 3 Corvette wrecks | Claws, fuel drunk from wrecks. No fighting |
| Pad Rebuild | noon | A Workshop (2 pads) and 2 damaged, half-empty Dinkies | Landing, refuelling, pads rebuilding lost modules |
| Factory | daylight | A Factory building 3 Dinkies on a pad, and a hulk | Building on a pad, launching. Grows over time |
| Shipyard | gold | A Shipyard building a Scavenger on its slipway, and a hulk | Slipway building |
| Rearm | violet | A Tender (2 pads), 3 Dinkies with 6 rounds each, and a hulk | Running dry, landing to rearm, relaunching |
| Tanker | blue giant | A Tanker and 2 Pickets low on fuel | Port docking, fuel transfer. No fighting |
| Beam Carrier | nebula | A Beam Carrier (8 pads of Dinky Beams, a tender), 2 wrecks, 8 Dinkies attacking | Fighters launching, fighting and landing to recharge; batteries; about 20 ships |
| Passes | dusk | An invulnerable Dinky strafing a crippled, protected Corvette | Fighter flight and guns, forever |
| Circling | ice | The same, with a Y-Wing circling | As Passes |
| Crippled Landing | gold | 8 carriers, each with a fighter low on fuel and damaged as the variant says, coming in from its own eighth of the way round | Landing with thrusters or a main shot away; `tests/crippledLanding.test.ts` runs every variant |
