--
-- File generated with SQLiteStudio v3.1.1 on Thu Dec 14 12:05:27 2017
--
-- Text encoding used: System
--
PRAGMA foreign_keys = off;
BEGIN TRANSACTION;

-- Table: MainConfig
CREATE TABLE MainConfig (
    autoloadId INTEGER
);
INSERT INTO MainConfig (autoloadId)
VALUES (null);


-- Table: EvolutionConfig
CREATE TABLE EvolutionConfig (
	id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
	name VARCHAR (50) NOT NULL ON CONFLICT REPLACE DEFAULT Unnamed,
	currentGeneration INTEGER DEFAULT '''0''' NOT NULL,
	minMatchesPerIndividual INTEGER DEFAULT '''3''' NOT NULL,
	winnersCount INTEGER DEFAULT '''5''' NOT NULL
);

-- Table: DroneEvolutionConfig
CREATE TABLE DroneEvolutionConfig (
	id INTEGER PRIMARY KEY REFERENCES EvolutionConfig (id) ON DELETE CASCADE NOT NULL,
	minDrones INTEGER DEFAULT '''3''' NOT NULL,
	droneEscalation FLOAT DEFAULT (0.05) NOT NULL,
	maxDrones INTEGER DEFAULT '''50''' NOT NULL,
	killScoreMultiplier FLOAT DEFAULT '''1''' NOT NULL,
	flatKillBonus FLOAT DEFAULT '''100''' NOT NULL,
	completionBonus FLOAT DEFAULT '''1''' NOT NULL,
	droneList VARCHAR (3000),
	dronesInSphereRandomRadius INTEGER DEFAULT '''0''' NOT NULL,
	dronesOnSphereRandomRadius INTEGER DEFAULT '''0''' NOT NULL
);

-- Table: RaceEvolutionConfig
CREATE TABLE RaceEvolutionConfig (
	id INTEGER PRIMARY KEY REFERENCES EvolutionConfig (id) ON DELETE CASCADE NOT NULL,
	raceMaxDistance FLOAT NOT NULL DEFAULT (2000),
	raceScoreMultiplier FLOAT NOT NULL DEFAULT (1000),
	raceGoalObject INTEGER
);

-- Table: BrEvolutionConfig
CREATE TABLE BrEvolutionConfig (
	id INTEGER PRIMARY KEY REFERENCES EvolutionConfig (id) ON DELETE CASCADE NOT NULL,
	combatants INTEGER NOT NULL DEFAULT (2),
	survivalBonus FLOAT NOT NULL DEFAULT (400),
	deathScoreMultiplier FLOAT NOT NULL DEFAULT (1)
);

-- Table: MatchConfig
CREATE TABLE MatchConfig (
	id INTEGER PRIMARY KEY REFERENCES EvolutionConfig (id) ON DELETE CASCADE NOT NULL,
	matchTimeout FLOAT DEFAULT '300' NOT NULL,
	winnerPollPeriod FLOAT DEFAULT '2' NOT NULL,
	inSphereRandomisationRadius FLOAT NOT NULL DEFAULT (0),
	onSphereRandomisationRadius FLOAT NOT NULL DEFAULT (0),
	initialRange FLOAT DEFAULT '''6000''' NOT NULL,
	initialSpeed FLOAT DEFAULT '''0''' NOT NULL,
	randomInitialSpeed FLOAT DEFAULT '''0''' NOT NULL,
	competitorsPerTeam INTEGER DEFAULT '''1''' NOT NULL,
	stepForwardProportion FLOAT DEFAULT '''0.5''' NOT NULL,
	randomiseRotation BOOLEAN DEFAULT 'TRUE' NOT NULL,
	allowedModules STRING DEFAULT null,
	budget INTEGER DEFAULT 1000
);

-- Table: MutationConfig
CREATE TABLE MutationConfig (
	id INTEGER PRIMARY KEY REFERENCES EvolutionConfig (id) ON DELETE CASCADE NOT NULL,
	mutations BIGINT NOT NULL,
	maxMutationLength INTEGER DEFAULT '5' NOT NULL,
	genomeLength INTEGER DEFAULT '100' NOT NULL,
	generationSize INTEGER DEFAULT '20' NOT NULL,
	randomDefault BOOLEAN DEFAULT 'FALSE' NOT NULL,
	defaultGenome VARCHAR (1000)
);


-- Table: Individual
CREATE TABLE Individual (
	runConfigId INTEGER REFERENCES EvolutionConfig (id) ON DELETE CASCADE NOT NULL,
	generation INTEGER NOT NULL,
    genome VARCHAR (1000) NOT NULL,

	score FLOAT NOT NULL,
	matchScores VARCHAR (500),
    cost FLOAT,

	modules INTEGER,
	r FLOAT NOT NULL, g FLOAT NOT NULL, b FLOAT NOT NULL,
	species VARCHAR (1000),
	speciesVerbose VARCHAR (1000),
	subspecies VARCHAR (1000),
	subspeciesVerbose VARCHAR (1000),

	matchesPlayed INTEGER,
	matchesSurvived INTEGER,
	matchesAsLastSurvivor INTEGER,
	killedAllDrones INTEGER,
	totalDroneKills INTEGER,

	previousCombatants VARCHAR (500),

	PRIMARY KEY (runConfigId, generation, genome)
);

COMMIT TRANSACTION;
PRAGMA foreign_keys = on;
