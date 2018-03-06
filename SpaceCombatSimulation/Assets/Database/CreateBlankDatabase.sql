--
-- File generated with SQLiteStudio v3.1.1 on Thu Dec 14 12:05:27 2017
--
-- Text encoding used: System
--
PRAGMA foreign_keys = off;
BEGIN TRANSACTION;

-- Table: BaseEvolutionConfig
CREATE TABLE BaseEvolutionConfig (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name VARCHAR (50) NOT NULL ON CONFLICT REPLACE DEFAULT Unnamed, currentGeneration INTEGER DEFAULT '''0''' NOT NULL, minMatchesPerIndividual INTEGER DEFAULT '''3''' NOT NULL, winnersCount INTEGER DEFAULT '''5''' NOT NULL, matchConfigId INTEGER REFERENCES MatchConfig (id) NOT NULL ON CONFLICT ROLLBACK, mutationConfigId INTEGER REFERENCES MutationConfig (id) NOT NULL);

-- Table: DroneEvolutionConfig
CREATE TABLE DroneEvolutionConfig (id INTEGER PRIMARY KEY REFERENCES BaseEvolutionConfig (id) NOT NULL, minDrones INTEGER DEFAULT '''3''' NOT NULL, droneEscalation FLOAT DEFAULT (0.05) NOT NULL, maxDrones INTEGER DEFAULT '''50''' NOT NULL, killScoreMultiplier FLOAT DEFAULT '''1''' NOT NULL, flatKillBonus FLOAT DEFAULT '''100''' NOT NULL, completionBonus FLOAT DEFAULT '''1''' NOT NULL, deathPenalty FLOAT DEFAULT '''70''' NOT NULL, droneList VARCHAR (3000));

-- Table: BrEvolutionConfig
CREATE TABLE BrEvolutionConfig (id INTEGER PRIMARY KEY REFERENCES BaseEvolutionConfig (id) NOT NULL, combatants INTEGER DEFAULT '''2''' NOT NULL, inSphereRandomisationRadius FLOAT DEFAULT '0' NOT NULL, onSphereRandomisationRadius FLOAT DEFAULT '0' NOT NULL);

-- Table: MatchConfig
CREATE TABLE MatchConfig (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, matchTimeout FLOAT DEFAULT '300' NOT NULL, winnerPollPeriod FLOAT DEFAULT '2' NOT NULL, initialRange FLOAT DEFAULT '''6000''' NOT NULL, initialSpeed FLOAT DEFAULT '''0''' NOT NULL, randomInitialSpeed FLOAT DEFAULT '''0''' NOT NULL, competitorsPerTeam INTEGER DEFAULT '''1''' NOT NULL, stepForwardProportion FLOAT DEFAULT '''0.5''' NOT NULL, randomiseRotation BOOLEAN DEFAULT 'TRUE' NOT NULL, allowedModules STRING DEFAULT null, budget INTEGER DEFAULT 1000);

-- Table: MutationConfig
CREATE TABLE MutationConfig (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, mutations BIGINT NOT NULL, maxMutationLength INTEGER DEFAULT '5' NOT NULL, genomeLength INTEGER DEFAULT '100' NOT NULL, generationSize INTEGER DEFAULT '20' NOT NULL, randomDefault BOOLEAN DEFAULT 'FALSE' NOT NULL, defaultGenome VARCHAR (1000));

-- Table: BaseIndividual
CREATE TABLE BaseIndividual (runType VARCHAR (1000) NOT NULL, runConfigId INTEGER NOT NULL REFERENCES BaseEvolutionConfig (id), generation INTEGER NOT NULL, genome VARCHAR (1000) NOT NULL, score FLOAT NOT NULL, cost FLOAT, modules INTEGER, r FLOAT NOT NULL, g FLOAT NOT NULL, b FLOAT NOT NULL, species VARCHAR (1000), speciesVerbose VARCHAR (1000), subspecies VARCHAR (1000), subspeciesVerbose VARCHAR (1000), PRIMARY KEY (runConfigId, generation, genome));

-- Table: DroneIndividual
CREATE TABLE DroneIndividual (runConfigId INTEGER NOT NULL REFERENCES BaseIndividual (runConfigId), generation INTEGER REFERENCES BaseIndividual (generation) NOT NULL, genome VARCHAR (1000) REFERENCES BaseIndividual (genome) NOT NULL, matchesPlayed INTEGER, matchesSurvived INTEGER, completeKills INTEGER, totalKills INTEGER, matchScores VARCHAR (500), PRIMARY KEY (runConfigId, generation, genome));

-- Table: BrIndividual
CREATE TABLE BrIndividual (runConfigId INTEGER NOT NULL REFERENCES BaseIndividual (runConfigId), generation INTEGER REFERENCES BaseIndividual (generation) NOT NULL, genome VARCHAR (1000) REFERENCES BaseIndividual (genome) NOT NULL, wins INTEGER NOT NULL, draws INTEGER NOT NULL, loses INTEGER NOT NULL, previousCombatants VARCHAR (500), PRIMARY KEY (runConfigId, generation, genome));

COMMIT TRANSACTION;
PRAGMA foreign_keys = on;
