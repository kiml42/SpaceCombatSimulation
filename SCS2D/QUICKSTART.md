# Quick start: Skirmish

Space Combat Simulation is a game about designing warships and fleets, then watching them fight under
real physics. Ships in space are not aeroplanes: they keep going until something pushes them, they turn by
thrusting, and a gun fires along the ship's motion as well as its aim.

Play it in your browser at **https://kiml42.github.io/SpaceCombatSimulation/**. It works on a phone too.

**You don't fly your ships in a skirmish.** You design them, choose their doctrine, arrange the fleet and
press Fight. If you lose, the fix is mostly in the shipyard and not in your reflexes.

## The loop

1. Pick an enemy and a budget.
2. Build a fleet within that budget.
3. Fight. Win, and the enemy **evolves an answer**: a mutated version of itself that beats the fleet you just
   won with.
4. Change your fleet to beat the answer, and repeat.

A skirmish has no end. It is about how long you can stay ahead of an enemy that learns from every win you
get. Each time the enemy struggles to find an answer, its budget grows, so the header tells you how big an
enemy you are holding off (2×, for example, means it may spend twice what you can).

## Starting a skirmish

Open **Skirmish** from the links in the header. The setup screen has these:

- **Enemy**: any stock or saved fleet, or a single ship. The table under it shows what it costs.
- **Your budget**: three resources to make use of. **Metal** (tonnes of hull and fittings),
  **fuel** (tonnes in the tanks) and **build** (hours to build). Leave them alone or press
  **Match the enemy** for an even fight. Lower them for a challenge, or raise them to let the game escalate
  further.
- **Your fleet**: a fleet to start from, or *An empty fleet, to build*. An empty fleet takes you straight
  to the fleet editor.
- **Start**.

The other cards (*The round*, *The enemy's answer*, the mutation odds) are optional. Hover over a field to
see what it does, and use **Reset to defaults** to undo your changes. To begin with, the defaults are fine.

## A round

The panel on the right shows the round, the enemy you face and your fleet's spend against the budget.

- **Fight** starts the battle. Use **speed** in the header to run it faster, up to 16×.
- **Edit fleet** opens the fleet editor. **Restart** fights the round again from the start.
- You are **blue**.

### How a battle is decided

- A side **wins** when the other side is out. A side is out when it has nothing left armed, or when it stops
  fighting: after both sides have opened fire, a side that goes the *quiet time* (30 s by default) without
  firing, hitting or ramming, while the other side keeps fighting, is out.
- **A draw is a loss**, whether both sides go quiet or the time cap runs out. Ships that circle forever
  don't win.
- Lose, and you try the same round again on the same opening, as often as you like. Change something before
  each try.

### After a win

The enemy starts breeding. You can watch each generation's best mutant fight your fleet, or press
**Stop watching** to skip that. When a mutant beats your fleet on the next round's setup, that mutant is
your next enemy, and **Next round** takes you to it. The answer is chosen because it beats *your* fleet, so
you'll need to adapt and upgrade it.

## The fleet editor

- **Add ship ▾** adds a design from the fleet or the ship library. Drag a ship to move it, and drag its knob
  to turn it.
- Selecting a ship lets you set **copies** and a **step** to lay out a line or a wedge. **Make group** keeps
  a formation together.
- The **Skirmish** box shows your spend against the budget. **Problems** lists anything that stops the fleet
  from flying.
- **Edit** next to a ship's design opens it in the ship editor. **Fork** first if you only want to change
  that one ship.
- **Back to battle** returns you to the round.

## The ship editor

A ship is a deck plan of modules, viewed from above. Click a button under **Add a module** to place one.
Drag a module to move it, drag its edges to resize it, and drag its knob to turn it.

| Group | Modules | What they do |
| --- | --- | --- |
| Structural | Core, Structure, Tank, Hold | The core is the ship's brain. Tanks hold fuel, and holds hold the metal that guns load their rounds from. |
| Power | Generator, Battery, Robot bay | Generators charge batteries. Beams draw on the batteries. Robots crawl the hull mending damage. |
| Propulsion | Engine | Thrust. Turning comes from engines too, so place them with that in mind. |
| Weapons | Turret, Beam turret, Hull gun, Hull beam | Turrets traverse. Hull weapons point wherever the ship points. Press **A** to see the firing arcs. |
| Docking | Claw, Pad, Port, Slipway | Drain wrecks, refuel fighters, share fuel and build ships in battle. |

**What it works out to** shows mass, thrust, acceleration and firepower. **Problems** tells you what is wrong.
Select a weapon to set **what it shoots at**. Select the core to set **what the ship does**, such as how
close it fights and when it runs. That is its doctrine, and it tells the ship what to do without explicit
orders.

**Back to fleet** returns you with the design changed in every ship that uses it, unless you forked it.

## Things worth knowing

- **Guns disable ships; they rarely destroy them.** They strip engines, weapons and other modules and
  leave a drifting hulk. A side with nothing left armed is out.
- **Ammunition and fuel run out.** A ship that empties its tanks closing in at full burn has nothing left for
  the fight.
- **Firing arcs come from the layout.** A gun won't fire on bearings where other parts of the ship are in
  the way. Press **A** in the editor to see where each one can point and where it can fire.
- **Small changes show.** Battles are deterministic, so a retry with the same fleet plays out exactly the
  same way. Change one thing and you see what that one thing did.

## Battle controls

| Key or mouse | Does |
| --- | --- |
| Space | Pause or play |
| . (full stop) | Step once while paused |
| F | Frame everything, or the picked ship and its target |
| Click a ship | Pick it: shows its target, the range and its arcs |
| Escape | Let the picked ship go |
| Ctrl+A | Cycle the arcs drawn |
| C | Colour shots by side, or draw them as light |
| T | Hide or show each side's ships down the edges |
| Drag / scroll or pinch | Pan / zoom |

Press **?** or **Keys** in the footer on any page for the full list.

## History and saving

The **History** list shows every match, newest first. You can watch any match again, or save or export
either fleet from it. Saving an enemy is a good way to collect hard opponents.

Your skirmish, settings and history are kept in the browser. Close the tab and you continue where you left
off when you come back. They are lost if you clear the site's data or switch browsers, so use **Export** in the header to save
everything to a `.skirmish.json` file and **Import** to load it back. The same file is useful when reporting a
strange battle.

**New skirmish** in the round panel abandons the current skirmish and starts another.
