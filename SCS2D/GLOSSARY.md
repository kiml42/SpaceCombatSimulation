# Glossary

What the game calls things, wherever a player reads them: labels, buttons, tooltips, help and errors. Use these
words, and not their alternatives, in anything a player sees, and in the docs when they describe what a player
sees. Code may keep its own names (`BattlePage`, `Blueprint`, `battleRoute`); this is about the words on screen.

## Places

| Term | What it is | Not |
| --- | --- | --- |
| **Main menu** | The landing page | home, start page |
| **Skirmish** | The main mode: rounds against an enemy that evolves to beat you, including the fleet editing between them | |
| **Simulator** | The sandbox for scenarios and custom battles, and for testing designs and fleets (`#/simulator`) | Battle, viewer, battle page |
| **Ship editor** | Where designs are made (`#/ship`) | Ship designer, blueprint editor |
| **Fleet editor** | Where fleets are laid out (`#/fleet`) | Fleet designer |
| **Library** | The designs and fleets you have saved | |
| **Evolution** | Breeding designs and fleets in runs of generations | |
| **Effects** | How hits, beams, flames and leaks are drawn | |

## Things

| Term | What it is | Not |
| --- | --- | --- |
| **design** | What the ship editor makes, and what a fleet places copies of | blueprint |
| **ship** | One built from a design, in a fleet or a battle | |
| **fleet** | Ships laid out together, each from a design | |
| **category** | What a design is grouped under; with its name, what it is known by. **Stock** is the game's alone, and **My ships** is where a player's goes with none of its own | folder, group |
| **ship design file** | A design saved to a file (`.ship.json`) | blueprint file |
| **fleet file**, **skirmish file** | A fleet or a skirmish saved to a file | |
| **round** | One stage of a skirmish, fought again until won | |
| **upgrade card** | A change to a side's limits, picked from a hand | |
| **main** guns, **secondary** guns | A ship's weapons it fights with, and the rest (point defence and the like): a weapon's *main* tick | main battery, primaries; secondaries is fine |
| **priority** | How soon a part gets its ship's fuel, metal and charge when there is not enough, and how soon it is mended: higher first | claim, tier |
| **turning gear** | The share of a turret given to the ring and drive that swing it, which reloading gives up | traverse gear, training gear |

## How to write them

- **A place's name is a proper noun:** "Test in Simulator", "Back to Skirmish", "Open the Library". A skirmish as
  one game of the mode is an ordinary noun: "New skirmish", "Start a skirmish".
- **The editors are described, not named,** so they stay lower case in a sentence ("in the fleet editor") and
  take sentence case only where a label starts with them ("Fleet editor" in the main menu).
- **Ships are automated, with nobody aboard,** unless something says otherwise (DESIGN.md §2). A ship is flown by
  its core and worked on by its robots, so never write crew, crewed, manned or anyone aboard, on screen or in the
  docs, and don't name code after them either. "Pilot" means the core's flying logic, not a person.
- **A button that goes somewhere says where:** "Test in Simulator", "Back to fleet", "Back to Skirmish".

A new place or thing gets a row here before it gets a label, so the next screen calls it the same.
