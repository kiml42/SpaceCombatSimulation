--
-- File generated with SQLiteStudio v3.1.1 on Mon Dec 11 12:56:38 2017
--
-- Text encoding used: System
--
PRAGMA foreign_keys = off;
BEGIN TRANSACTION;

-- Table: DroneEvolutionConfig
CREATE TABLE DroneEvolutionConfig (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name VARCHAR (50) NOT NULL ON CONFLICT REPLACE DEFAULT Unnamed, currentGeneration INTEGER DEFAULT '''0''' NOT NULL, minMatchesPerIndividual INTEGER DEFAULT '''1''' NOT NULL, winnersCount INTEGER DEFAULT '''5''' NOT NULL, minDrones INTEGER DEFAULT '''3''' NOT NULL, droneEscalation FLOAT DEFAULT (0.05) NOT NULL, maxDrones INTEGER DEFAULT '''50''' NOT NULL, killScoreMultiplier FLOAT DEFAULT '''1''' NOT NULL, flatKillBonus FLOAT DEFAULT '''100''' NOT NULL, completionBonus FLOAT DEFAULT '''1''' NOT NULL, deathPenalty FLOAT DEFAULT '''70''' NOT NULL, matchConfigId INTEGER REFERENCES MatchConfig (id) NOT NULL ON CONFLICT ROLLBACK, mutationConfigId INTEGER REFERENCES MutationConfig (id) NOT NULL, droneList VARCHAR (3000));
INSERT INTO DroneEvolutionConfig (id, name, currentGeneration, minMatchesPerIndividual, winnersCount, minDrones, droneEscalation, maxDrones, killScoreMultiplier, flatKillBonus, completionBonus, deathPenalty, matchConfigId, mutationConfigId, droneList) VALUES (0, 'Run0', 1, 5, 14, 10, 3, 15, -4, -6, -8, -20, 5, 6, '0;2;1;3;1;1;3;1;5;1;1;1;6;1;1');
INSERT INTO DroneEvolutionConfig (id, name, currentGeneration, minMatchesPerIndividual, winnersCount, minDrones, droneEscalation, maxDrones, killScoreMultiplier, flatKillBonus, completionBonus, deathPenalty, matchConfigId, mutationConfigId, droneList) VALUES (1, 'Run1', 7, 1, 5, 3, 8, 100, 50, 100, 388, 70, 1, 1, '0;2;1;3;1;1;3;1;5;1;1;1;6;1;1');

-- Table: DroneShootingIndividual
CREATE TABLE DroneShootingIndividual (runConfigId INTEGER NOT NULL REFERENCES DroneEvolutionConfig (id), generation INTEGER NOT NULL, genome VARCHAR (1000) NOT NULL, score FLOAT, matchesPlayed INTEGER, matchesSurvived INTEGER, completeKills INTEGER, totalKills INTEGER, matchScores VARCHAR (500), PRIMARY KEY (runConfigId, generation, genome));
INSERT INTO DroneShootingIndividual (runConfigId, generation, genome, score, matchesPlayed, matchesSurvived, completeKills, totalKills, matchScores) VALUES (0, 0, '123', 42, 3, 1, 0, 5, '123,321');
INSERT INTO DroneShootingIndividual (runConfigId, generation, genome, score, matchesPlayed, matchesSurvived, completeKills, totalKills, matchScores) VALUES (0, 0, '148', 65, 2, 0, 1, 1, '3');

-- Table: EvolutionConfig1v1
CREATE TABLE EvolutionConfig1v1 (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name VARCHAR (50) NOT NULL ON CONFLICT REPLACE DEFAULT Unnamed, currentGeneration INTEGER DEFAULT '''0''' NOT NULL, minMatchesPerIndividual INTEGER DEFAULT '''1''' NOT NULL, winnersCount INTEGER DEFAULT '''5''' NOT NULL, suddenDeathDamage FLOAT DEFAULT '''1''' NOT NULL, suddenDeathReloadTime FLOAT DEFAULT '''100''' NOT NULL, matchConfigId INTEGER REFERENCES MatchConfig (id) NOT NULL ON CONFLICT ROLLBACK, mutationConfigId INTEGER REFERENCES MutationConfig (id) NOT NULL);
INSERT INTO EvolutionConfig1v1 (id, name, currentGeneration, minMatchesPerIndividual, winnersCount, suddenDeathDamage, suddenDeathReloadTime, matchConfigId, mutationConfigId) VALUES (0, 'Default1v1', 2, 3, 5, 1, 5, 2, 2);
INSERT INTO EvolutionConfig1v1 (id, name, currentGeneration, minMatchesPerIndividual, winnersCount, suddenDeathDamage, suddenDeathReloadTime, matchConfigId, mutationConfigId) VALUES (1, 'Default1v1b', 1, 4, 6, 2, 6, 3, 3);

-- Table: Individual1v1
CREATE TABLE Individual1v1 (runConfigId INTEGER NOT NULL REFERENCES DroneEvolutionConfig (id), generation INTEGER NOT NULL, genome VARCHAR (1000) NOT NULL, score FLOAT, wins INTEGER, draws INTEGER, loses INTEGER, previousCombatants VARCHAR (500), PRIMARY KEY (runConfigId, generation, genome));
INSERT INTO Individual1v1 (runConfigId, generation, genome, score, wins, draws, loses, previousCombatants) VALUES (0, 0, '123', 42, 3, 1, 0, '123,321');
INSERT INTO Individual1v1 (runConfigId, generation, genome, score, wins, draws, loses, previousCombatants) VALUES (0, 0, '148', 65, 2, 0, 1, '3');

-- Table: MatchConfig
CREATE TABLE MatchConfig (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, matchTimeout FLOAT DEFAULT '300' NOT NULL, winnerPollPeriod FLOAT DEFAULT '2' NOT NULL, initialRange FLOAT DEFAULT '''6000''' NOT NULL, initialSpeed FLOAT DEFAULT '''0''' NOT NULL, randomInitialSpeed FLOAT DEFAULT '''0''' NOT NULL, competitorsPerTeam INTEGER DEFAULT '''1''' NOT NULL, stepForwardProportion FLOAT DEFAULT '''0.5''' NOT NULL, locationRandomisationRadiai STRING DEFAULT '''0''' NOT NULL, randomiseRotation BOOLEAN DEFAULT 'TRUE' NOT NULL);
INSERT INTO MatchConfig (id, matchTimeout, winnerPollPeriod, initialRange, initialSpeed, randomInitialSpeed, competitorsPerTeam, stepForwardProportion, locationRandomisationRadiai, randomiseRotation) 
VALUES (0, 0, 0, 6000, 0, 0,1,0, '0,1', 0);
INSERT INTO MatchConfig (id, matchTimeout, winnerPollPeriod, initialRange, initialSpeed, randomInitialSpeed, competitorsPerTeam, stepForwardProportion, locationRandomisationRadiai, randomiseRotation) 
VALUES (1, 2, 1, 6001, 1,1,2, 0.1, '2,3', 1);
INSERT INTO MatchConfig (id, matchTimeout, winnerPollPeriod, initialRange, initialSpeed, randomInitialSpeed, competitorsPerTeam, stepForwardProportion, locationRandomisationRadiai, randomiseRotation) 
VALUES (5, 25, 2, 6005,5,5,6, 0.5, '3,6', 1);
INSERT INTO MatchConfig (id, matchTimeout, winnerPollPeriod, initialRange, initialSpeed, randomInitialSpeed, competitorsPerTeam, stepForwardProportion, locationRandomisationRadiai, randomiseRotation) 
VALUES (2, 26, 3, 6002,2,2,3, 0.2, '7,342', 0);
INSERT INTO MatchConfig (id, matchTimeout, winnerPollPeriod, initialRange, initialSpeed, randomInitialSpeed, competitorsPerTeam, stepForwardProportion, locationRandomisationRadiai, randomiseRotation) 
VALUES (3, 27, 4, 6003,3,3,4, 0.3, '1,34', 0);

-- Table: MutationConfig
CREATE TABLE MutationConfig (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, mutations BIGINT NOT NULL, allowedCharacters VARCHAR (30) DEFAULT '0123456789012' NOT NULL, maxMutationLength INTEGER DEFAULT '5' NOT NULL, genomeLength INTEGER DEFAULT '100' NOT NULL, generationSize INTEGER DEFAULT '20' NOT NULL, randomDefault BOOLEAN DEFAULT 'FALSE' NOT NULL, defaultGenome VARCHAR (1000));
INSERT INTO MutationConfig (id, mutations, allowedCharacters, maxMutationLength, genomeLength, generationSize, randomDefault, defaultGenome) VALUES (0, 4, 'abc', 6, 2, 5, 0, '123');
INSERT INTO MutationConfig (id, mutations, allowedCharacters, maxMutationLength, genomeLength, generationSize, randomDefault, defaultGenome) VALUES (1, 3, ' 0123456789012  ', 5, 100, 17, 0, '');
INSERT INTO MutationConfig (id, mutations, allowedCharacters, maxMutationLength, genomeLength, generationSize, randomDefault, defaultGenome) VALUES (6, 7, ' xyz ', 4, 91, 27, 1, 'abc');
INSERT INTO MutationConfig (id, mutations, allowedCharacters, maxMutationLength, genomeLength, generationSize, randomDefault, defaultGenome) VALUES (2, 17, ' xyzq ', 14, 191, 127, 11, 'abc1');
INSERT INTO MutationConfig (id, mutations, allowedCharacters, maxMutationLength, genomeLength, generationSize, randomDefault, defaultGenome) VALUES (3, 27, ' xyzt ', 24, 291, 227, 21, '2abc');

COMMIT TRANSACTION;
PRAGMA foreign_keys = on;
