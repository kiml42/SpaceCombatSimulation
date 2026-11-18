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
get. When the enemy struggles to find an answer it draws **upgrade cards** that raise its limits, and when
you keep losing a round you get to pick one too.

## Starting a skirmish

Press **Start a skirmish** on the main menu. The setup screen has these:

- **Enemy**: who you fight, from a list of presets. Its hint says what it is and how many ships a side may field.
- **Battlefield**: where, from a list of presets: whether there are asteroids, and how the rounds are drawn.
- **Start: build your fleet** takes you to the fleet editor with an empty fleet and the enemy's cost as
  your budget.

**Customise** picks any fleet or ship from your library as the enemy, and sets your budget: **metal**
(tonnes of hull and fittings), **fuel** (tonnes in the tanks) and **build** (hours to build). **Match the
enemy** sets it to what the enemy costs. **Advanced settings** holds the rest, such as the time cap and the
mutation odds. Hover over a field to see what it does. To begin with, the presets are fine.

**Load a saved skirmish…** picks up a skirmish exported earlier.

## A round

The panel on the right shows the round, the enemy you face and your fleet's spend against the budget.

- **Fight** starts the battle. Use **speed** in the bar along the top to run it faster, up to 16×.
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

### Upgrade cards

Each *different* fleet that loses a round counts towards an upgrade card (three by default). Then **Pick
your upgrade card** offers a hand: each moves your limits, such as more metal, fuel or build time, another
ship, or room to deploy wider, and some trade one for another. What you pick lasts for the rest of the
skirmish. The enemy draws cards of its own when its evolving stalls.

### After a win

You may first **pick where to fight next**: each choice changes the battlefield of the next round. Then the
enemy starts breeding, and the History shows its progress. **Watch the best so far** shows each generation's
best mutant fighting your fleet. When a mutant beats your fleet on the next round's setup, that mutant is
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
- **Back to Skirmish** returns you to the round.

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

Open the menu (**◀ Menu**, or Escape) for the full list, and press **?** there.

## History and saving

The **History** list shows every match, newest first. You can watch any match again, or save or export
either fleet from it. Saving an enemy is a good way to collect hard opponents.

Your skirmish, settings and history are kept in the browser. Close the tab and you continue where you left
off when you come back. They are lost if you clear the site's data or switch browsers, so use **Export skirmish** in the menu to save
everything to a `.skirmish.json` file, and **Load a saved skirmish…** on the setup screen to load it back. The
same file is useful when reporting a strange battle.

**New skirmish**, in the menu or on the main menu, abandons the current skirmish and starts another.
