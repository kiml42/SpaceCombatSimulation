# CLAUDE.md

## Status: the Unity project is archived

**Active development is in `SCS2D/`, a TypeScript rewrite. Start at [SCS2D/DESIGN.md](SCS2D/DESIGN.md) and
[SCS2D/CLAUDE.md](SCS2D/CLAUDE.md).** The design is split three ways: `DESIGN.md` (what the game is),
`ROADMAP.md` (what is not built or not settled) and `DECISIONS.md` (why things are as they are).

The Unity project in `SpaceCombatSimulation/` is a 2017–2021 prototype, kept for reference and occasional
tinkering. Do not modify it, do not upgrade it, and do not attempt to port it incrementally — the rewrite changes
language, dimensionality and physics ownership, so nothing carries over as code. `SCS2D/DESIGN.md` §10 lists the
files worth *reading* for their design, plus three specific failures recorded so they aren't repeated.

**Opening it with an installed editor (6000.3.2f1 or 6000.3.9f1) converts the project in place, irreversibly** —
it is pinned to 2022.3.15f1. To run it, install the pinned editor via Unity Hub, or convert on a branch and never
merge.

## How changes land

**Open a pull request against `master`. That is the default for any piece of work, in either tree.** It applies
to code, and to documentation that carries a decision — a ROADMAP.md open question, a DECISIONS.md entry, a
changed convention — because those are the things worth reading before they land, not after.

Pushing straight to `master` is the exception, not a shortcut to reach for when a change feels small. It is for
non-code changes with nothing to review: a typo, a broken link, a note the author has just dictated and asked to
be recorded. A change being documentation-only does not by itself qualify it; a change being *uncontentious*
does. When unsure, open the PR — an unnecessary PR costs a click, and an unwanted push to `master` costs a
revert.

Ask before pushing directly, unless the author has already said to for that particular change.

Don't make comments too verbose, make sure they're short enough that people will actually read them, 
or leave them out entirely if the name is sufficient, or the code easy to read.

## Archived Unity Project

A Unity 3D simulation of space combat with Newtonian-ish physics ("space ships are not aeroplanes"), plus a
genetic-algorithm harness that evolves ship designs. A ship is not authored by hand: it is *grown* from a genome
string, fought in a match, scored, and its genome mutated for the next generation. Results persist in SQLite.

What follows documents only the parts still worth consulting — the genome encoding, the evolution loop and the
SQLite layer, none of which the rewrite has yet. **Targeting is no longer among them**: `SCS2D/sim/targeting.ts`
and `sim/doctrine.ts` replaced it with per-mount picking from doctrine weights, and the archive's static
`TargetRepository` and priority-ordered `ITargetPicker` stack are of no further use. The tree goes when
`SCS2D/DESIGN.md` §10's deletion trigger is met — the new sim running an evolution generation headlessly.

### Repository layout

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

`*.sln` and `*.csproj` are Unity-generated and gitignored. Don't hand-edit or commit them.

### Genome → ship

`GenomeWrapper` ([GenomeWrapper.cs](SpaceCombatSimulation/Assets/Src/Evolution/GenomeWrapper.cs)) is a cursor over
the genome string. It hands out fixed-width "genes" (`GetGene`, `GetGeneAsInt`, `GetScaledNumber`) and wraps around
the end of the string, so a genome is effectively circular. `Jump()`/`JumpBack()` let a module's configuration live
at an arbitrary offset in the genome — this is what makes the encoding tree-shaped rather than a flat array.

Construction is a mutual recursion: `ModuleHub.SubConfigure` runs a `ShipBuilder`, which walks the hub's
`SpawnPoints`, reads a gene to pick a module out of the shared `ModuleList`, instantiates it, and calls
`GenomeWrapper.ConfigureAddedModule` — which accumulates cost/type counts, jumps, configures the new module (which
may itself be a hub, recursing), and jumps back.

Two hard limits shape the result: a **cost budget** (`GenomeWrapper.Budget`, from `MatchConfig`) and **spatial
collision** — `ShipBuilder` refuses a spawn point within `THRESHOLD_DISTANCE` of an already-used one.

The tree of instantiated modules is recorded as nested `ModuleRecord`s, and their string forms *are* the taxonomy:
`Species` / `Subspecies` / `Name` on `GenomeWrapper` are all renderings of that tree. Species strings are used as
grouping keys in the DB and graphs, so changing `ModuleRecord.ToString*` changes data compatibility.

### Evolution loop

`EvolutionController` ([EvolutionController.cs](SpaceCombatSimulation/Assets/Src/Evolution/EvolutionController.cs))
drives all three run flavours (battle-royale, drone, race) in one class, reading `EvolutionConfig` from SQLite and
loading or creating the current `Generation`.

- `Generation` ([Generation.cs](SpaceCombatSimulation/Assets/Src/Evolution/Generation.cs)) owns competitor selection
  (`PickCompetitors` prefers individuals with fewest matches and avoids repeat pairings), `RecordMatch`, and
  `PickWinners`.
- A match ends by polling at `MatchConfig.WinnerPollPeriod`, accruing `Score` by `ScoreType`, then writing the
  generation back and **reloading the current scene**. Scene reload is the iteration mechanism — there is no
  in-place reset.
- A generation rolls over when every individual has played `MinMatchesPerIndividual` matches;
  `EvolutionMutationWrapper`/`StringMutator` then produce the next genomes.

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
