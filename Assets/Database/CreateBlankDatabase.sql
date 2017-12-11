--
-- File generated with SQLiteStudio v3.1.1 on Mon Dec 11 12:58:21 2017
--
-- Text encoding used: System
--
PRAGMA foreign_keys = off;
BEGIN TRANSACTION;

-- Table: DroneEvolutionConfig
CREATE TABLE DroneEvolutionConfig (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name VARCHAR (50) NOT NULL ON CONFLICT REPLACE DEFAULT Unnamed, currentGeneration INTEGER DEFAULT '''0''' NOT NULL, minMatchesPerIndividual INTEGER DEFAULT '''1''' NOT NULL, winnersCount INTEGER DEFAULT '''5''' NOT NULL, minDrones INTEGER DEFAULT '''3''' NOT NULL, droneEscalation FLOAT DEFAULT (0.05) NOT NULL, maxDrones INTEGER DEFAULT '''50''' NOT NULL, killScoreMultiplier FLOAT DEFAULT '''1''' NOT NULL, flatKillBonus FLOAT DEFAULT '''100''' NOT NULL, completionBonus FLOAT DEFAULT '''1''' NOT NULL, deathPenalty FLOAT DEFAULT '''70''' NOT NULL, matchConfigId INTEGER REFERENCES MatchConfig (id) NOT NULL ON CONFLICT ROLLBACK, mutationConfigId INTEGER REFERENCES MutationConfig (id) NOT NULL, droneList VARCHAR (3000));

-- Table: DroneShootingIndividual
CREATE TABLE DroneShootingIndividual (runConfigId INTEGER NOT NULL REFERENCES DroneEvolutionConfig (id), generation INTEGER NOT NULL, genome VARCHAR (1000) NOT NULL, score FLOAT, matchesPlayed INTEGER, matchesSurvived INTEGER, completeKills INTEGER, totalKills INTEGER, matchScores VARCHAR (500), PRIMARY KEY (runConfigId, generation, genome));

-- Table: MatchConfig
CREATE TABLE MatchConfig (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, matchTimeout FLOAT DEFAULT '300' NOT NULL, winnerPollPeriod FLOAT DEFAULT '2' NOT NULL);

-- Table: MutationConfig
CREATE TABLE MutationConfig (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, mutations BIGINT NOT NULL, allowedCharacters VARCHAR (30) DEFAULT '0123456789012' NOT NULL, maxMutationLength INTEGER DEFAULT '5' NOT NULL, genomeLength INTEGER DEFAULT '100' NOT NULL, generationSize INTEGER DEFAULT '20' NOT NULL, randomDefault BOOLEAN DEFAULT 'FALSE' NOT NULL, defaultGenome VARCHAR (1000));

-- Table: Test
CREATE TABLE [Test] (
[F1] INTEGER DEFAULT '0' NULL
);

COMMIT TRANSACTION;
PRAGMA foreign_keys = on;
