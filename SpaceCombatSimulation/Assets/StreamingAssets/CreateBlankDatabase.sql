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

-- Table: BaseEvolutionConfig
CREATE TABLE BaseEvolutionConfig (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name VARCHAR (50) NOT NULL ON CONFLICT REPLACE DEFAULT Unnamed, currentGeneration INTEGER DEFAULT '''0''' NOT NULL, minMatchesPerIndividual INTEGER DEFAULT '''3''' NOT NULL, winnersCount INTEGER DEFAULT '''5''' NOT NULL);

-- Table: DroneEvolutionConfig
CREATE TABLE DroneEvolutionConfig (id INTEGER PRIMARY KEY REFERENCES BaseEvolutionConfig (id) ON DELETE CASCADE NOT NULL, minDrones INTEGER DEFAULT '''3''' NOT NULL, droneEscalation FLOAT DEFAULT (0.05) NOT NULL, maxDrones INTEGER DEFAULT '''50''' NOT NULL, killScoreMultiplier FLOAT DEFAULT '''1''' NOT NULL, flatKillBonus FLOAT DEFAULT '''100''' NOT NULL, completionBonus FLOAT DEFAULT '''1''' NOT NULL, deathPenalty FLOAT DEFAULT '''70''' NOT NULL, droneList VARCHAR (3000), shipInSphereRandomRadius INTEGER DEFAULT '''0''' NOT NULL, shipOnSphereRandomRadius INTEGER DEFAULT '''0''' NOT NULL, dronesInSphereRandomRadius INTEGER DEFAULT '''0''' NOT NULL, dronesOnSphereRandomRadius INTEGER DEFAULT '''0''' NOT NULL);

-- Table: BrEvolutionConfig
CREATE TABLE BrEvolutionConfig (id INTEGER PRIMARY KEY REFERENCES BaseEvolutionConfig (id) ON DELETE CASCADE NOT NULL, combatants INTEGER NOT NULL DEFAULT (2), inSphereRandomisationRadius FLOAT NOT NULL DEFAULT (0), onSphereRandomisationRadius FLOAT NOT NULL DEFAULT (0), raceMaxDistance FLOAT NOT NULL DEFAULT (2000), raceScoreMultiplier FLOAT NOT NULL DEFAULT (1000), survivalBonus FLOAT NOT NULL DEFAULT (400), deathScoreMultiplier FLOAT NOT NULL DEFAULT (1));

-- Table: MatchConfig
CREATE TABLE MatchConfig (id INTEGER PRIMARY KEY REFERENCES BaseEvolutionConfig (id) ON DELETE CASCADE NOT NULL, matchTimeout FLOAT DEFAULT '300' NOT NULL, winnerPollPeriod FLOAT DEFAULT '2' NOT NULL, initialRange FLOAT DEFAULT '''6000''' NOT NULL, initialSpeed FLOAT DEFAULT '''0''' NOT NULL, randomInitialSpeed FLOAT DEFAULT '''0''' NOT NULL, competitorsPerTeam INTEGER DEFAULT '''1''' NOT NULL, stepForwardProportion FLOAT DEFAULT '''0.5''' NOT NULL, randomiseRotation BOOLEAN DEFAULT 'TRUE' NOT NULL, allowedModules STRING DEFAULT null, budget INTEGER DEFAULT 1000);

-- Table: MutationConfig
CREATE TABLE MutationConfig (id INTEGER PRIMARY KEY REFERENCES BaseEvolutionConfig (id) ON DELETE CASCADE NOT NULL, mutations BIGINT NOT NULL, maxMutationLength INTEGER DEFAULT '5' NOT NULL, genomeLength INTEGER DEFAULT '100' NOT NULL, generationSize INTEGER DEFAULT '20' NOT NULL, randomDefault BOOLEAN DEFAULT 'FALSE' NOT NULL, defaultGenome VARCHAR (1000));

-- Table: BaseIndividual
CREATE TABLE BaseIndividual (runType VARCHAR (1000) NOT NULL, runConfigId INTEGER REFERENCES BaseEvolutionConfig (id) ON DELETE CASCADE NOT NULL, generation INTEGER NOT NULL, genome VARCHAR (1000) NOT NULL, score FLOAT NOT NULL, cost FLOAT, modules INTEGER, r FLOAT NOT NULL, g FLOAT NOT NULL, b FLOAT NOT NULL, species VARCHAR (1000), speciesVerbose VARCHAR (1000), subspecies VARCHAR (1000), subspeciesVerbose VARCHAR (1000), PRIMARY KEY (runConfigId, generation, genome));

-- Table: DroneIndividual
CREATE TABLE DroneIndividual (runConfigId INTEGER REFERENCES BaseIndividual (runConfigId) ON DELETE CASCADE NOT NULL, generation INTEGER REFERENCES BaseIndividual (generation) ON DELETE CASCADE NOT NULL, genome VARCHAR (1000) REFERENCES BaseIndividual (genome) ON DELETE CASCADE NOT NULL, matchesPlayed INTEGER, matchesSurvived INTEGER, completeKills INTEGER, totalKills INTEGER, matchScores VARCHAR (500), PRIMARY KEY (runConfigId, generation, genome));

-- Table: BrIndividual
CREATE TABLE BrIndividual (runConfigId INTEGER REFERENCES BaseIndividual (runConfigId) ON DELETE CASCADE NOT NULL, generation INTEGER REFERENCES BaseIndividual (generation) ON DELETE CASCADE NOT NULL, genome VARCHAR (1000) REFERENCES BaseIndividual (genome) ON DELETE CASCADE NOT NULL, wins INTEGER NOT NULL, draws INTEGER NOT NULL, loses INTEGER NOT NULL, previousCombatants VARCHAR (500), PRIMARY KEY (runConfigId, generation, genome));

COMMIT TRANSACTION;
PRAGMA foreign_keys = on;
