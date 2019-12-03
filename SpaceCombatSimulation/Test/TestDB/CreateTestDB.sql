--
-- File generated with SQLiteStudio v3.1.1 on Mon Dec 11 12:56:38 2017
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

INSERT INTO EvolutionConfig (id, name, currentGeneration, minMatchesPerIndividual, winnersCount) 
VALUES (0, 'Run0', 1, 5, 14);
INSERT INTO EvolutionConfig (id, name, currentGeneration, minMatchesPerIndividual, winnersCount) 
VALUES (1, 'Run1', 7, 3, 4);
INSERT INTO EvolutionConfig (id, name, currentGeneration, minMatchesPerIndividual, winnersCount) 
VALUES (2, '1v1' , 2, 3, 5);
INSERT INTO EvolutionConfig (id, name, currentGeneration, minMatchesPerIndividual, winnersCount) 
VALUES (3, '4Way', 1, 4, 6);

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
INSERT INTO DroneEvolutionConfig (id, minDrones, droneEscalation, maxDrones, killScoreMultiplier, flatKillBonus, completionBonus, droneList, dronesInSphereRandomRadius, dronesOnSphereRandomRadius)
VALUES (0, 10, 3, 15, -4, -6, -8, '0,2,1,3,1,1,3,1,5,1,1,1,6,1,1', 102, 103);
INSERT INTO DroneEvolutionConfig (id, minDrones, droneEscalation, maxDrones, killScoreMultiplier, flatKillBonus, completionBonus, droneList, dronesInSphereRandomRadius, dronesOnSphereRandomRadius)
VALUES (1, 3, 8, 100, 50, 100, 388, '0,2,1,3,1,1,3,1,5,1,1,1,6,1,1', 200, 201);

-- Table: RaceEvolutionConfig
CREATE TABLE RaceEvolutionConfig (
	id INTEGER PRIMARY KEY REFERENCES EvolutionConfig (id) ON DELETE CASCADE NOT NULL,
	raceMaxDistance FLOAT NOT NULL DEFAULT (2000),
	raceScoreMultiplier FLOAT NOT NULL DEFAULT (1000),
	raceGoalObject INTEGER
);
INSERT INTO RaceEvolutionConfig (id, raceMaxDistance, raceScoreMultiplier, raceGoalObject)
VALUES (2, 2010, 1003, 4);
INSERT INTO RaceEvolutionConfig (id, raceMaxDistance, raceScoreMultiplier, raceGoalObject)
VALUES (3, 2011, 1013, NULL);

-- Table: BrEvolutionConfig
CREATE TABLE BrEvolutionConfig (
	id INTEGER PRIMARY KEY REFERENCES EvolutionConfig (id) ON DELETE CASCADE NOT NULL,
	combatants INTEGER NOT NULL DEFAULT (2),
	survivalBonus FLOAT NOT NULL DEFAULT (400),
	deathScoreMultiplier FLOAT NOT NULL DEFAULT (1)
);
INSERT INTO BrEvolutionConfig (id, combatants, survivalBonus, deathScoreMultiplier)
VALUES (2, 2, 42, 1.5);
INSERT INTO BrEvolutionConfig (id, combatants, survivalBonus, deathScoreMultiplier)
VALUES (3, 4, 421, 11.5);

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
INSERT INTO MatchConfig (id, matchTimeout, winnerPollPeriod, inSphereRandomisationRadius, onSphereRandomisationRadius, initialRange, initialSpeed, randomInitialSpeed, competitorsPerTeam, stepForwardProportion, randomiseRotation, allowedModules, budget) 
VALUES (0, 25, 2, 102, 103, 6005, 5, 5,6,0.5, 1, '1,2,4,5', 12345);
INSERT INTO MatchConfig (id, matchTimeout, winnerPollPeriod, inSphereRandomisationRadius, onSphereRandomisationRadius, initialRange, initialSpeed, randomInitialSpeed, competitorsPerTeam, stepForwardProportion, randomiseRotation, allowedModules, budget) 
VALUES (1, 2, 1, 2002, 203, 6001, 1,1,2, 0.1, 1, '1,2,4,5', null);
INSERT INTO MatchConfig (id, matchTimeout, winnerPollPeriod, inSphereRandomisationRadius, onSphereRandomisationRadius, initialRange, initialSpeed, randomInitialSpeed, competitorsPerTeam, stepForwardProportion, randomiseRotation, allowedModules, budget) 
VALUES (2, 26, 3, 106, 107, 6002,2,2,3, 0.2, 0, '1,2,4,5', 12345);
INSERT INTO MatchConfig (id, matchTimeout, winnerPollPeriod, inSphereRandomisationRadius, onSphereRandomisationRadius, initialRange, initialSpeed, randomInitialSpeed, competitorsPerTeam, stepForwardProportion, randomiseRotation, allowedModules, budget) 
VALUES (3, 27, 4, 207, 208, 6003,3,3,4, 0.3, 0, '1,2,4,5', 12345);

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
INSERT INTO MutationConfig (id, mutations, maxMutationLength, genomeLength, generationSize, randomDefault, defaultGenome) VALUES (0, 7, 4, 91, 27, 1, 'abc');
INSERT INTO MutationConfig (id, mutations, maxMutationLength, genomeLength, generationSize, randomDefault, defaultGenome) VALUES (1, 3, 5, 100, 17, 0, '');
INSERT INTO MutationConfig (id, mutations, maxMutationLength, genomeLength, generationSize, randomDefault, defaultGenome) VALUES (2, 17, 14, 191, 127, 11, 'abc1');
INSERT INTO MutationConfig (id, mutations, maxMutationLength, genomeLength, generationSize, randomDefault, defaultGenome) VALUES (3, 27, 24, 291, 227, 21, '2abc');

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

INSERT INTO Individual (runConfigId, generation, genome, score, matchScores, cost, modules, r,g,b, species, speciesVerbose, subspecies, subspeciesVerbose,
matchesPlayed, matchesSurvived, matchesAsLastSurvivor,
killedAllDrones, totalDroneKills,
previousCombatants)
VALUES (0, 0, '123', 42, '123,321', 5646, 6, 1,2,3, 'species42', 'speciesV42', 'subspecies42', 'subspeciesV42',
3, 1, 1,
2, 5,
'');

INSERT INTO Individual (runConfigId, generation, genome, score, matchScores, cost, modules, r,g,b, species, speciesVerbose, subspecies, subspeciesVerbose,
matchesPlayed, matchesSurvived, matchesAsLastSurvivor,
killedAllDrones, totalDroneKills,
previousCombatants)
VALUES (0, 0, '148', 65, '3', 466, 8, 0.5,0.5,0.5, 'species', 'speciesVerbose', 'subspecies', 'subspeciesVerbose',
2, 0, 0,
1, 1,
'');

INSERT INTO Individual (runConfigId, generation, genome, score, matchScores, cost, modules, r,g,b, species, speciesVerbose, subspecies, subspeciesVerbose,
matchesPlayed, matchesSurvived, matchesAsLastSurvivor,
killedAllDrones, totalDroneKills,
previousCombatants)
VALUES (0, 1, '1232', 42, '123,321', 5646, 6, 1,2,3, 'species42', 'speciesV42', 'subspecies42', 'subspeciesV42',
3, 1, 1,
2, 5,
'');

INSERT INTO Individual (runConfigId, generation, genome, score, matchScores, cost, modules, r,g,b, species, speciesVerbose, subspecies, subspeciesVerbose,
matchesPlayed, matchesSurvived, matchesAsLastSurvivor,
killedAllDrones, totalDroneKills,
previousCombatants)
VALUES (0, 1, '1482', 65, '3', 466, 8, 0.5,0.5,0.5, 'species', 'speciesVerbose', 'subspecies', 'subspeciesVerbose',
2, 0, 0,
1, 1,
'');

INSERT INTO Individual (runConfigId, generation, genome, score, matchScores, cost, modules, r,g,b, species, speciesVerbose, subspecies, subspeciesVerbose,
matchesPlayed, matchesSurvived, matchesAsLastSurvivor,
killedAllDrones, totalDroneKills,
previousCombatants)
VALUES (2, 0, '123', 42, '42', 123, 6, 1,2,3, 'species42', 'speciesV42', 'subspecies42', 'subspeciesV42',
4, 4, 3,
0, 0,
'123,321');

INSERT INTO Individual (runConfigId, generation, genome, score, matchScores, cost, modules, r,g,b, species, speciesVerbose, subspecies, subspeciesVerbose,
matchesPlayed, matchesSurvived, matchesAsLastSurvivor,
killedAllDrones, totalDroneKills,
previousCombatants)
VALUES (2, 0, '148', 65, '65', 466, 8, 0.5,0.5,0.5, 'species', 'speciesVerbose', 'subspecies', 'subspeciesVerbose',
3, 2, 2,
0, 0,
'3');

COMMIT TRANSACTION;
PRAGMA foreign_keys = on;
