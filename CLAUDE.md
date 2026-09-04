# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: the Unity project is archived

**Active development is in `SCS2D/`, a TypeScript rewrite. Start at [SCS2D/DESIGN.md](SCS2D/DESIGN.md) and
[SCS2D/CLAUDE.md](SCS2D/CLAUDE.md).**

The Unity project in `SpaceCombatSimulation/` is a 2017–2021 prototype, kept for reference and occasional
tinkering. Do not modify it, do not upgrade it, and do not attempt to port it incrementally — the rewrite changes
language, dimensionality and physics ownership, so nothing carries over as code. `SCS2D/DESIGN.md` §10 lists the
files worth *reading* for their design, plus three specific failures recorded so they aren't repeated.

**Opening it with an installed editor (6000.3.2f1 or 6000.3.9f1) converts the project in place, irreversibly** —
it is pinned to 2022.3.15f1. To run it, install the pinned editor via Unity Hub, or convert on a branch and never
merge.

The rest of this file documents that archived project.

## What it is

A Unity 3D simulation of space combat with Newtonian-ish physics ("space ships are not aeroplanes"), plus a
genetic-algorithm harness that evolves ship designs. A ship is not authored by hand: it is *grown* from a genome
string, fought in a match, scored, and its genome mutated for the next generation. Results persist in SQLite.

## Repository layout

The Unity project is **not** at the repo root — it lives in the `SpaceCombatSimulation/` subfolder.

| Path | Contents |
| --- | --- |
| `SpaceCombatSimulation/Assets/Src/` | All runtime C# (namespaces `Assets.Src.*`) |
| `SpaceCombatSimulation/Assets/Editor/` | EditMode (NUnit) tests |
| `SpaceCombatSimulation/Assets/Scenes/` | `MainMenu`, `Evolution/Evolution`, `Evolution/EditEvolution` are the live ones |
| `SpaceCombatSimulation/Assets/StreamingAssets/CreateBlankDatabase.sql` | Production DB schema |
| `SpaceCombatSimulation/Test/TestDB/CreateTestDB.sql` | Test DB schema + seed data |
| `SpaceCombatSimulation/Test/` (other dirs) | Dead legacy MSTest/xUnit projects — ignore, they reference source trees that no longer exist |
| `Builds/<version>/` | Committed player builds |
| `ToDo.txt` | The project's live bug list and roadmap — check it before "fixing" odd behaviour |

`*.sln` and `*.csproj` are Unity-generated and gitignored. Don't hand-edit or commit them. There are no `.asmdef`
files, so everything compiles into `Assembly-CSharp` / `Assembly-CSharp-Editor`.

`ProjectVersion.txt` pins Unity `2022.3.15f1`, but the editors installed on this machine are `6000.3.2f1` and
`6000.3.9f1` (`C:\Program Files\Unity\Hub\Editor\<version>\Editor\Unity.exe`). Opening with an installed editor
will trigger a project upgrade.

## Commands

Run the EditMode test suite headlessly:

```bash
"C:\Program Files\Unity\Hub\Editor\6000.3.9f1\Editor\Unity.exe" -runTests -batchmode -projectPath C:\Projects\SpaceCombatSimulation\SpaceCombatSimulation -testPlatform EditMode -testResults C:\Projects\SpaceCombatSimulation\SpaceCombatSimulation\tmp\results.xml
```

Run a single test or fixture by adding a filter:

```bash
"C:\Program Files\Unity\Hub\Editor\6000.3.9f1\Editor\Unity.exe" -runTests -batchmode -projectPath C:\Projects\SpaceCombatSimulation\SpaceCombatSimulation -testPlatform EditMode -testFilter "GenerationTests.GetCompetitors_SelectsThoseWithNoMatchesFirst" -testResults C:\Projects\SpaceCombatSimulation\SpaceCombatSimulation\tmp\results.xml
```

Only one Unity process may hold the project at a time; close the editor first or pass a different `-projectPath`
copy. Interactively, tests run from **Window > General > Test Runner**.

Run a committed build without a GUI (per the README):

```bash
Builds/0.0.5/SpaceCombatSimulation.exe -batchmode -nographics
```

In-game keys: `Z` cycles the ship-cam's followed object, `R` cycles reticle state, `O` cycles camera mode,
`Esc` returns to the main menu.

Useful SQL for inspecting a run is kept in `DebuggingScripts.sql`; e.g. filter individuals with
`runConfigId = 2 ORDER BY generation DESC, score DESC LIMIT 200;`.

## Architecture

### Genome → ship

`GenomeWrapper` ([GenomeWrapper.cs](SpaceCombatSimulation/Assets/Src/Evolution/GenomeWrapper.cs)) is a cursor over
the genome string. It hands out fixed-width "genes" (`GetGene`, `GetGeneAsInt`, `GetScaledNumber`) and wraps around
the end of the string, so a genome is effectively circular. `Jump()`/`JumpBack()` let a module's configuration live
at an arbitrary offset in the genome — this is what makes the encoding tree-shaped rather than a flat array.

Construction is a mutual recursion:

1. `EvolutionShipConfig.SpawnShip` instantiates the root prefab and calls `Configure(genomeWrapper)` on it.
2. Every configurable component derives from
   `GeneticConfigurableMonobehaviour` ([here](SpaceCombatSimulation/Assets/Src/ModuleSystem/GeneticConfigurableMonobehaviour.cs)),
   which records `ConfigIndex`, guards against double-configuration, and delegates to `SubConfigure`.
3. `ModuleHub.SubConfigure` runs a `ShipBuilder`, which walks the hub's `SpawnPoints`, reads a gene to pick a module
   out of the shared `ModuleList` (constrained by `AllowedModuleIndicies`), instantiates it, and calls
   `GenomeWrapper.ConfigureAddedModule`.
4. `ConfigureAddedModule` accumulates cost/type counts, then jumps, configures the new module (which may itself be a
   hub, recursing), and jumps back.

Two hard limits shape the result: a **cost budget** (`GenomeWrapper.Budget`, from `MatchConfig`) and **spatial
collision** — `ShipBuilder` spawns a throwaway `TestCubeChecker` at each candidate point and refuses locations within
`THRESHOLD_DISTANCE` of an already-used one.

The tree of instantiated modules is recorded as nested `ModuleRecord`s, and their string forms *are* the taxonomy:
`Species` / `Subspecies` / `Name` on `GenomeWrapper` are all renderings of that tree. Species strings are used as
grouping keys in the DB and graphs, so changing `ModuleRecord.ToString*` changes data compatibility.

### Evolution loop

`EvolutionController` ([EvolutionController.cs](SpaceCombatSimulation/Assets/Src/Evolution/EvolutionController.cs))
drives everything and handles all three run flavours (battle-royale, drone, race) in one class, with `#region`
blocks per flavour and a config object per flavour hanging off `EvolutionConfig`.

- `Start()`: takes `DatabaseId` from `ArgumentStore.IdToLoad` (set by the menu scene, otherwise the inspector value),
  reads `EvolutionConfig` from SQLite, loads or creates the current `Generation`, then spawns race goal, ships, drones.
- `Generation` ([Generation.cs](SpaceCombatSimulation/Assets/Src/Evolution/Generation.cs)) owns competitor selection
  (`PickCompetitors` prefers individuals with fewest matches and avoids repeat pairings), `RecordMatch`, and
  `PickWinners`.
- `FixedUpdate()`: polls at `MatchConfig.WinnerPollPeriod` via `EvolutionMatchController`, accrues `Score` by
  `ScoreType`, and when the match ends writes the generation back and **reloads the current scene**. Scene reload is
  the iteration mechanism — there is no in-place reset. A generation rolls over when every individual has played
  `MinMatchesPerIndividual` matches; `EvolutionMutationWrapper`/`StringMutator` then produce the next genomes.

The `Edit*ConfigController` classes in `Assets/Src/Evolution/` back the `EditEvolution` scene, which is the UI for
the same DB rows.

### Targeting

Targeting is deliberately data-driven so it can be tuned by the genome:

- `TargetRepository` ([TargetRepository.cs](SpaceCombatSimulation/Assets/Src/ObjectManagement/TargetRepository.cs)) is
  a **static** dictionary of `ITarget` keyed by team string. `SelfRegisteringTarget` adds/removes entries. Because it
  is static it survives scene reloads — treat stale entries as a real failure mode.
- Who counts as an enemy comes from `IKnowsEnemyTags`; `EnemyTagSource.DeferToParent` means a module normally
  inherits its ship's enemy list rather than declaring its own.
- `TargetChoosingMechanism` (global namespace) asks an `ITargetDetector` for candidates, then filters through
  `CombinedTargetPicker`, which runs every sibling `ITargetPicker` in **ascending `TargetPickerPriority`**. A
  low-priority picker that discards a target removes it before higher-priority pickers ever see it — ordering is
  semantically load-bearing, not cosmetic.
- Pickers under `Targeting/TargetPickers/` either filter or adjust `PotentialTarget.Score`. Those deriving from
  `GeneticallyConfigurableTargetPicker` have their `Threshold`/`FlatBoost`/`Multiplier` read out of the genome, so
  each evolved ship has its own target preferences.

### Ship control

`SpaceShipControler` / `RocketController` are thin MonoBehaviours; the logic lives in `BasePilot` subclasses
(`SpaceshipPilot`, `RocketPilot`, `ManualSpaceshipPilot`) which decide an orientation and acceleration, then push
that onto `EngineControler`s and a `TorquerManager`. Turrets follow the same split: `TurretRunner` +
`ITurretTurner` implementations (`UnityTurretTurner` for hinge-joint turrets, `EyeballTurretTurner` for free-aiming
ones). Ships are physical assemblies of jointed rigidbodies — `JointBreakHandler` and `HealthControler` handle
modules being severed, and severed parts remain in the world.

Camera work uses `ShipCam` plus a set of `ICameraOrientator`s; `WeightedCameraOrientator`/`PriorityCameraOrientator`
blend or select among them.

### Persistence

SQLite via the committed `Assets/Plugins/Mono.Data.Sqlite.dll` + `sqlite3.dll` (the `packages.config` entries for
`Microsoft.Data.Sqlite` are vestigial). `EvolutionDatabaseHandler` writes raw SQL — no ORM.

Path conventions matter and are easy to get wrong:

- DB paths are relative to `Application.dataPath` (i.e. the `Assets` folder). Default:
  `/Database/SpaceCombatSimulationDB.s3db`.
- Schema-creation script paths are relative to `Application.streamingAssetsPath`.
- The live DB file is gitignored and created on demand by `DatabaseInitialiser.EnsureDatabaseExists()`.
- DB tests give each test a GUID-named database under `SpaceCombatSimulation/tmp/TestDB/` (gitignored) and build it
  from `CreateTestDB.sql`, then drop it in `TearDown`. Follow that pattern rather than touching the real DB.

Any new persisted config field needs to be added in four places: the config class, `CreateBlankDatabase.sql`,
`CreateTestDB.sql`, and the read/write SQL in `EvolutionDatabaseHandler`.

## Conventions and gotchas

- Namespaces are mostly `Assets.Src.<Folder>`, but not uniformly: `ShipBuilder` is in `Assets.src.Evolution`
  (lowercase `src`), and several MonoBehaviours (`TargetChoosingMechanism`, `MainMenuController`,
  `EvolutionBRDatabaseHandler*Tests`) sit in the global namespace. Match the file you're editing.
- Dependency wiring is via public fields assigned in prefabs/scenes, with `GetComponent`/`GetComponentInParent`
  fallbacks in `Start()`. Renaming or retyping a public field silently breaks serialized scene references.
- Every asset has a `.meta` sibling; add, move and delete them together with their asset.
- Many components carry a `public bool Log` for targeted `Debug.Log` tracing instead of a logging framework.
- Physics logic belongs in `FixedUpdate`; input and UI in `Update`/`OnGUI`.
- The author prefers changes to arrive as a pull request against `master` rather than direct pushes.
