using Assets.Src.Evolution;
using Assets.Src.Evolution.BattleRoyale;
using Assets.Src.Evolution.Drone;
using Assets.Src.Evolution.Race;
using Mono.Data.Sqlite;
using System;
using System.Collections.Generic;
using System.Data;
using UnityEngine;

namespace Assets.Src.Database
{
    public class EvolutionDatabaseHandler
    {
        private const string CONFIG_TABLE_BR = "BrEvolutionConfig";

        private const string INDIVIDUAL_TABLE = "Individual";

        public const string DEFAULT_CREATE_DB_COMMAND_PATH = "/CreateBlankDatabase.sql";
        private const string DEFAULT_DB_PATH = "/Database/SpaceCombatSimulationDB.s3db";

        private string ConnectionString
        {
            get
            {
                var connection = "URI=file:" + Application.dataPath + _databasePath + "; foreign keys=true;";
                //Debug.Log("connection string: " + connection);
                return connection;
            }
        }
        private readonly string _databasePath; //Path to database.
        private const string MUTATION_CONFIG_TABLE = "MutationConfig";
        private const string MATCH_CONFIG_TABLE = "MatchConfig";

        private readonly DatabaseInitialiser _initialiser;
        private readonly string _dbCreationCommandPath;

        public EvolutionDatabaseHandler(string databasePath = DEFAULT_DB_PATH, string dbCreationCommandPath = DEFAULT_CREATE_DB_COMMAND_PATH)
        {
            _databasePath = databasePath;

            if (!string.IsNullOrEmpty(dbCreationCommandPath))
            {
                _initialiser = new DatabaseInitialiser
                {
                    DatabasePath = _databasePath
                };
                _initialiser.EnsureDatabaseExists();
                _dbCreationCommandPath = dbCreationCommandPath;
            }
            else
            {
                _dbCreationCommandPath = DEFAULT_CREATE_DB_COMMAND_PATH;
            }
        }

        public void InitialiseConnection()
        {
            _initialiser.EnsureDatabaseExists(_dbCreationCommandPath);
        }

        public Dictionary<int, string> ListConfigs()
        {
            var configs = new Dictionary<int, string>();

            string sqlQuery = "SELECT id, name FROM EvolutionConfig;";

            using (var sql_con = new SqliteConnection(ConnectionString))
            {
                sql_con.Open(); //Open connection to the database.
                using (var dbcmd = sql_con.CreateCommand())
                {
                    dbcmd.CommandText = sqlQuery;
                    using (var reader = dbcmd.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            var id = reader.GetInt32(reader.GetOrdinal("id"));
                            var name = reader.GetString(reader.GetOrdinal("name"));
                            configs.Add(id, name);
                        }
                    }
                }
            }
            return configs;
        }

        public void SetCurrentGenerationNumber(int databaseId, int generationNumber)
        {
            using (var sql_con = new SqliteConnection(ConnectionString))
            {
                sql_con.Open();

                //Debug.Log("Updating generation to " + config.GenerationNumber);
                using (var command = new SqliteCommand("UPDATE EvolutionConfig SET currentGeneration = ? WHERE id = ?;", sql_con))
                {
                    command.Parameters.Add(new SqliteParameter(DbType.Int32, (object)generationNumber));
                    command.Parameters.Add(new SqliteParameter(DbType.Int32, (object)databaseId));

                    command.ExecuteNonQuery();
                }
            }
        }

        #region Auto-load
        public void SetAutoloadId(int? autoloadId)
        {
            using (var sql_con = new SqliteConnection(ConnectionString))
            {
                sql_con.Open(); //Open connection to the database.
                using (var dbcmd = sql_con.CreateCommand())
                {
                    dbcmd.CommandText = "UPDATE MainConfig set autoloadId = ?;";

                    dbcmd.Parameters.Add(new SqliteParameter(DbType.Int32, (object)autoloadId));

                    dbcmd.ExecuteNonQuery();
                }
            }
        }

        public int? ReadAutoloadId()
        {
            string sqlQuery = "SELECT autoloadId FROM MainConfig;";
            int? idToLoad = null;
            using (var sql_con = new SqliteConnection(ConnectionString))
            {
                sql_con.Open(); //Open connection to the database.
                using (var dbcmd = sql_con.CreateCommand())
                {
                    dbcmd.CommandText = sqlQuery;
                    using (var reader = dbcmd.ExecuteReader())
                    {
                        if (reader.Read())
                        {
                            idToLoad = GetNullableInt(reader, "autoloadId");
                        }
                        else
                        {
                            Debug.Log("There are no rows in the main config table, there should be exactly 1");
                        }
                    }
                }
            }
            return idToLoad;
        }
        #endregion

        #region read
        private string CreateReadConfigQuery(int id)
        {
            string sqlQuery = "SELECT *" +
                        " FROM EvolutionConfig" +

                        " LEFT JOIN DroneEvolutionConfig on DroneEvolutionConfig.id = EvolutionConfig.id" +
                        " LEFT JOIN RaceEvolutionConfig on RaceEvolutionConfig.id = EvolutionConfig.id" +
                        " LEFT JOIN BrEvolutionConfig on BrEvolutionConfig.id = EvolutionConfig.id" +

                        " LEFT JOIN MatchConfig on MatchConfig.id = EvolutionConfig.id" +
                        " LEFT JOIN MutationConfig on MutationConfig.id = EvolutionConfig.id" +
                        " WHERE EvolutionConfig.id = " + id + ";";
            return sqlQuery;
        }

        private string CreateReadIndividualsQuery(int runId, int generationNumber)
        {
            string sqlQuery = "SELECT *" +
                        " FROM Individual" +
                        " WHERE Individual.runConfigId = " + runId + " AND Individual.generation = " + generationNumber +
                        ";";
            return sqlQuery;
        }

        private IDataReader OpenReaderWithCommand(SqliteConnection connection, string command)
        {
            connection.Open(); //Open connection to the database.
            using (var dbcmd = connection.CreateCommand())
            {
                dbcmd.CommandText = command;
                var reader = dbcmd.ExecuteReader();
                return reader;
            }
        }

        private MatchConfig ReadMatchConfig(IDataReader reader)
        {
            //Debug.Log("EvolutionConfig.id ordinal: " + reader.GetOrdinal("id"));
            //Debug.Log("EvolutionConfig.id value: " + reader.GetInt32(reader.GetOrdinal("id")));

            var config = new MatchConfig()
            {
                MatchTimeout = reader.GetFloat(reader.GetOrdinal("matchTimeout")), //16
                WinnerPollPeriod = reader.GetFloat(reader.GetOrdinal("winnerPollPeriod")), //17
                InitialRange = reader.GetFloat(reader.GetOrdinal("initialRange")),
                InitialSpeed = reader.GetFloat(reader.GetOrdinal("initialSpeed")),
                MinimumLocationRandomisation = reader.GetFloat(reader.GetOrdinal("inSphereRandomisationRadius")),
                MaximumLocationRandomisation = reader.GetFloat(reader.GetOrdinal("onSphereRandomisationRadius")),
                RandomInitialSpeed = reader.GetFloat(reader.GetOrdinal("randomInitialSpeed")),
                CompetitorsPerTeam = reader.GetInt32(reader.GetOrdinal("competitorsPerTeam")),
                StepForwardProportion = reader.GetFloat(reader.GetOrdinal("stepForwardProportion")),
                RandomiseRotation = reader.GetBoolean(reader.GetOrdinal("randomiseRotation"))
            };

            if (!reader.IsDBNull(reader.GetOrdinal("allowedModules")))
            {
                config.AllowedModulesString = reader.GetString(reader.GetOrdinal("allowedModules"));
            }

            if (!reader.IsDBNull(reader.GetOrdinal("budget")))
            {
                config.Budget = reader.GetInt32(reader.GetOrdinal("budget"));
            }
            else
            {
                config.Budget = null;
            }
            return config;
        }

        private MutationConfig ReadMutationConfig(IDataReader reader)
        {
            //Debug.Log("id ordinal: " + reader.GetOrdinal("id"));

            var config = new MutationConfig()
            {
                Mutations = reader.GetInt32(reader.GetOrdinal("mutations")),
                MaxMutationLength = reader.GetInt32(reader.GetOrdinal("maxMutationLength")),
                GenomeLength = reader.GetInt32(reader.GetOrdinal("genomeLength")),
                GenerationSize = reader.GetInt32(reader.GetOrdinal("generationSize")),
                UseCompletelyRandomDefaultGenome = reader.GetBoolean(reader.GetOrdinal("randomDefault")),
                DefaultGenome = reader.GetString(reader.GetOrdinal("defaultGenome"))
            };
            return config;
        }

        public EvolutionConfig ReadConfig(int id)
        {
            var config = new EvolutionConfig();

            //Debug.Log("Reading config from DB. Id: " + id);
            using (var sql_con = new SqliteConnection(ConnectionString))
            {
                using (var reader = OpenReaderWithCommand(sql_con, CreateReadConfigQuery(id)))
                {
                    if (reader.Read())
                    {
                        config.DatabaseId = reader.GetInt32(reader.GetOrdinal("id"));

                        config.RunName = reader.GetString(reader.GetOrdinal("name")); //1
                        config.GenerationNumber = reader.GetInt32(reader.GetOrdinal("currentGeneration"));
                        config.MinMatchesPerIndividual = reader.GetInt32(reader.GetOrdinal("minMatchesPerIndividual"));
                        config.WinnersFromEachGeneration = reader.GetInt32(reader.GetOrdinal("winnersCount"));

                        config.MatchConfig = ReadMatchConfig(reader);
                        config.MutationConfig = ReadMutationConfig(reader);

                        config.BrConfig = ReadConfigBr(reader);
                        config.EvolutionDroneConfig = ReadConfigDrone(reader);
                        config.RaceConfig = ReadConfigRace(reader);
                    }
                    else
                    {
                        throw new Exception("Config not found for ID " + id);
                    }
                }
                SetAutoloadId(id);
            }
            return config;
        }
        private EvolutionBrConfig ReadConfigBr(IDataReader reader)
        {
            var config = new EvolutionBrConfig
            {
                NumberOfCombatants = GetNullableInt(reader,"combatants") ?? 1,
                SurvivalBonus = GetNullableFloat(reader, "survivalBonus") ?? 0,
                DeathScoreMultiplier = GetNullableFloat(reader, "deathScoreMultiplier") ?? 0
            };
            return config;
        }

        private EvolutionDroneConfig ReadConfigDrone(IDataReader reader)
        {
            var config = new EvolutionDroneConfig
            {
                MinDronesToSpawn = GetNullableInt(reader, "minDrones") ?? 0,
                ExtraDromnesPerGeneration = GetNullableFloat(reader, "droneEscalation") ?? 0,
                MaxDronesToSpawn = GetNullableInt(reader, "maxDrones") ?? 0,
                KillScoreMultiplier = GetNullableFloat(reader, "killScoreMultiplier") ?? 0,
                FlatKillBonus = GetNullableFloat(reader, "flatKillBonus") ?? 0,
                CompletionBonus = GetNullableFloat(reader, "completionBonus") ?? 0,
                DronesString = GetNullableString(reader, "droneList"),

                DronesInSphereRandomRadius = GetNullableFloat(reader, "dronesInSphereRandomRadius") ?? 0,
                DronesOnSphereRandomRadius = GetNullableFloat(reader, "dronesOnSphereRandomRadius") ?? 0
            };

            return config;
        }
        private EvolutionRaceConfig ReadConfigRace(IDataReader reader)
        {
            var config = new EvolutionRaceConfig
            {
                RaceMaxDistance = GetNullableFloat(reader, "raceMaxDistance") ?? 0,
                RaceScoreMultiplier = GetNullableFloat(reader, "raceScoreMultiplier") ?? 0,
                RaceGoalObject = GetNullableInt(reader, "raceGoalObject")
            };
            return config;
        }

        private SpeciesSummary ReadSpeciesSummary(IDataReader reader)
        {
            //Debug.Log("modules ordinal: " + reader.GetOrdinal("modules"));
            //Debug.Log("modules isNull: " + reader.IsDBNull(reader.GetOrdinal("modules")));

            return new SpeciesSummary(
                    reader.GetString(reader.GetOrdinal("genome")),
                    GetNullableFloat(reader, "cost"),
                    GetNullableInt(reader, "modules"),
                    reader.GetFloat(reader.GetOrdinal("r")),
                    reader.GetFloat(reader.GetOrdinal("g")),
                    reader.GetFloat(reader.GetOrdinal("b")),
                    GetNullableString(reader, "species"),
                    GetNullableString(reader, "speciesVerbose"),
                    GetNullableString(reader, "subspecies"),
                    GetNullableString(reader, "subspeciesVerbose")
                );
        }

        public Generation ReadGeneration(int runId, int generationNumber)
        {
            //Debug.Log("Reading generation from DB. runId: " + runId + ", generation Number: " + generationNumber);
            var individuals = new List<Individual>();
            using (var sql_con = new SqliteConnection(ConnectionString))
            {
                using (var reader = OpenReaderWithCommand(sql_con, CreateReadIndividualsQuery(runId, generationNumber)))
                {
                    while (reader.Read())
                    {
                        //Debug.Log("wins ordinal: " + reader.GetOrdinal("wins"));
                        var individual = new Individual(ReadSpeciesSummary(reader))
                        {
                            Score = reader.GetFloat(reader.GetOrdinal("score")),
                            PreviousCombatantsString = GetNullableString(reader, "previousCombatants"),

                            MatchesPlayed = reader.GetInt32(reader.GetOrdinal("matchesPlayed")),
                            MatchesSurvived = reader.GetInt32(reader.GetOrdinal("matchesSurvived")),
                            KilledAllDrones = reader.GetInt32(reader.GetOrdinal("killedAllDrones")),
                            TotalDroneKills = reader.GetInt32(reader.GetOrdinal("totalDroneKills")),
                            MatchScoresString = reader.GetString(reader.GetOrdinal("matchScores")),
                            MatchesAsLastSurvivor = reader.GetInt32(reader.GetOrdinal("matchesAsLastSurvivor")),
                        };
                        individuals.Add(individual);
                    }
                }
            }

            return new Generation(individuals);
        }
        #endregion

        #region save new
        private void SaveIndividual(Individual individual, int runId, int generationNumber, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var insertSQL = new SqliteCommand("INSERT INTO Individual " +
                            "(runConfigId, generation, genome, score, matchScores, cost, modules, r,g,b, species, speciesVerbose, subspecies, subspeciesVerbose," +
                            " matchesPlayed, matchesSurvived, matchesAsLastSurvivor, killedAllDrones, totalDroneKills, previousCombatants)" +
                            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", sql_con, transaction))
            {
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)runId));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)generationNumber));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Genome));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)individual.Score));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.MatchScoresString));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)individual.Summary.Cost));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.Summary.ModulesAdded));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)individual.Summary.Color.r));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)individual.Summary.Color.g));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)individual.Summary.Color.b));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Summary.Species));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Summary.VerboseSpecies));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Summary.Subspecies));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Summary.VerboseSubspecies));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.MatchesPlayed));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.MatchesSurvived));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.MatchesAsLastSurvivor));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.KilledAllDrones));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.TotalDroneKills));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.PreviousCombatantsString));

                insertSQL.ExecuteNonQuery();
            }
        }

        public int SaveNewEvolutionConfig(EvolutionConfig config)
        {
            using (var sql_con = new SqliteConnection(ConnectionString))
            {
                sql_con.Open(); //Open connection to the database.

                using (var transaction = sql_con.BeginTransaction())
                {
                    var id = SaveNewEvolutionConfig(config, sql_con, transaction);

                    transaction.Commit();

                    return id;
                }
            }
        }

        private int SaveNewEvolutionConfig(EvolutionConfig config, SqliteConnection connection, SqliteTransaction transaction)
        {
            var sql = "INSERT INTO EvolutionConfig" +
                " (name, currentGeneration, minMatchesPerIndividual, winnersCount) " +
                " VALUES (?,?,?,?);";
            using (var insertSQL = new SqliteCommand(sql, connection, transaction))
            {
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.RunName));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.GenerationNumber));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MinMatchesPerIndividual));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.WinnersFromEachGeneration));

                insertSQL.ExecuteNonQuery();
            }
            config.DatabaseId = GetLastUpdatedId(connection, transaction);

            SaveNewMatchConfig(config.DatabaseId, config.MatchConfig, connection, transaction);
            SaveNewMutationConfig(config.DatabaseId, config.MutationConfig, connection, transaction);

            SaveNewConfigBr(config.DatabaseId, config.BrConfig, connection, transaction);
            SaveNewConfigDrone(config.DatabaseId, config.EvolutionDroneConfig, connection, transaction);
            SaveNewConfigRace(config.DatabaseId, config.RaceConfig, connection, transaction);


            return config.DatabaseId;
        }
        
        private void SaveNewMatchConfig(int id, MatchConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var insertSQL = new SqliteCommand(sql_con)
            {
                Transaction = transaction
            })
            {
                insertSQL.CommandText = "INSERT INTO " + MATCH_CONFIG_TABLE +
                            "(id, matchTimeout, winnerPollPeriod, initialRange, initialSpeed, randomInitialSpeed," +
                            " inSphereRandomisationRadius, onSphereRandomisationRadius," +
                            " competitorsPerTeam, stepForwardProportion, randomiseRotation, allowedModules, budget)" +
                            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)id));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.MatchTimeout));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.WinnerPollPeriod));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.InitialRange));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.InitialSpeed));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.RandomInitialSpeed));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.MinimumLocationRandomisation));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.MaximumLocationRandomisation));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.CompetitorsPerTeam));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.StepForwardProportion));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Boolean, (object)config.RandomiseRotation));

                if (!string.IsNullOrEmpty(config.AllowedModulesString))
                    insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.AllowedModulesString));
                else
                    insertSQL.Parameters.Add(new SqliteParameter(DbType.String, DBNull.Value));

                if (config.Budget.HasValue)
                    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.Budget.Value));
                else
                    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, DBNull.Value));

                insertSQL.ExecuteNonQuery();
            }
        }

        private void SaveNewMutationConfig(int id, MutationConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var insertSQL = new SqliteCommand(sql_con)
            {
                Transaction = transaction
            })
            {
                insertSQL.CommandText = "INSERT INTO " + MUTATION_CONFIG_TABLE +
                            "(id, mutations, maxMutationLength, genomeLength, generationSize, randomDefault, defaultGenome)" +
                            " VALUES (?,?,?,?,?,?,?)";

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)id));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.Mutations));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MaxMutationLength));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.GenomeLength));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.GenerationSize));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Boolean, (object)config.UseCompletelyRandomDefaultGenome));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.DefaultGenome));

                insertSQL.ExecuteNonQuery();
            }
        }

        private void SaveNewConfigBr(int databaseId, EvolutionBrConfig config, SqliteConnection connection, SqliteTransaction transaction)
        {
            using (var insertSQL = new SqliteCommand(connection)
            {
                Transaction = transaction
            })
            {
                insertSQL.CommandText = "INSERT INTO " + CONFIG_TABLE_BR +
                    "(id, combatants, survivalBonus, deathScoreMultiplier)" +
                    " VALUES (?,?,?,?)";

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)databaseId));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.NumberOfCombatants));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.SurvivalBonus));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.DeathScoreMultiplier));

                insertSQL.ExecuteNonQuery();
            }
        }

        public void SaveNewConfigDrone(int databaseId, EvolutionDroneConfig config, SqliteConnection connection, SqliteTransaction transaction)
        {
           using (var insertSQL = new SqliteCommand(connection){Transaction = transaction})
            {
                insertSQL.CommandText = "INSERT INTO DroneEvolutionConfig" +
                    "(id, minDrones, droneEscalation, maxDrones, killScoreMultiplier, flatKillBonus, completionBonus, droneList," +
                    " dronesInSphereRandomRadius, dronesOnSphereRandomRadius)" +
                    " VALUES (?,?,?,?,?,?,?,?,?,?)";

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)databaseId));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MinDronesToSpawn));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.ExtraDromnesPerGeneration));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MaxDronesToSpawn));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.KillScoreMultiplier));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.FlatKillBonus));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.CompletionBonus));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.DronesString));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.DronesInSphereRandomRadius));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.DronesOnSphereRandomRadius));

                insertSQL.ExecuteNonQuery();
            }
        }

        private void SaveNewConfigRace(int databaseId, EvolutionRaceConfig config, SqliteConnection connection, SqliteTransaction transaction)
        {
            using (var insertSQL = new SqliteCommand(connection)
            {
                Transaction = transaction
            })
            {
                insertSQL.CommandText = "INSERT INTO RaceEvolutionConfig (id, raceMaxDistance, raceScoreMultiplier, raceGoalObject)" +
                    " VALUES (?,?,?,?)";

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)databaseId));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.RaceMaxDistance));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.RaceScoreMultiplier));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.RaceGoalObject));

                insertSQL.ExecuteNonQuery();
            }
        }

        public void SaveNewGeneration(Generation generation, int runId, int generationNumber)
        {
            using (var sql_con = new SqliteConnection(ConnectionString))
            {
                sql_con.Open(); //Open connection to the database.

                using (var transaction = sql_con.BeginTransaction())
                {
                    foreach (var individual in generation.Individuals)
                    {
                        SaveIndividual(individual, runId, generationNumber, sql_con, transaction);
                    }

                    transaction.Commit();
                }
            }
        }
        #endregion

        #region update existing
        private void UpdateIndividual(Individual individual, int runId, int generationNumber, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var insertSQL = new SqliteCommand("UPDATE  Individual" +

                           " SET score = ?, cost = ?, modules = ?, r = ?, g = ?, b = ?, species = ?, speciesVerbose = ?, subspecies = ?, subspeciesVerbose = ?," +
                           " previousCombatants = ?, matchesAsLastSurvivor = ?," +
                           " matchesPlayed = ?, matchesSurvived = ?, killedAllDrones = ?, totalDroneKills = ?, matchScores = ?" +
                           " WHERE runConfigId = ? AND generation = ? AND genome = ?", sql_con, transaction))
            {
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)individual.Score));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)individual.Summary.Cost));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.Summary.ModulesAdded));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)individual.Summary.Color.r));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)individual.Summary.Color.g));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)individual.Summary.Color.b));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Summary.Species));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Summary.VerboseSpecies));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Summary.Subspecies));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Summary.VerboseSubspecies));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.PreviousCombatantsString));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.MatchesAsLastSurvivor));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.MatchesPlayed));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.MatchesSurvived));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.KilledAllDrones));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.TotalDroneKills));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.MatchScoresString));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)runId));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)generationNumber));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Genome));

                insertSQL.ExecuteNonQuery();
            }
        }

        public int UpdateExistingEvolutionConfig(EvolutionConfig config)
        {
            using (var sql_con = new SqliteConnection(ConnectionString))
            {
                sql_con.Open(); //Open connection to the database.

                using (var transaction = sql_con.BeginTransaction())
                {
                    var id = UpdateExistingEvolutionConfig(config, sql_con, transaction);

                    transaction.Commit();

                    return id;
                }
            }
        }

        private int UpdateExistingEvolutionConfig(EvolutionConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            UpdateExistingMatchConfig(config.DatabaseId, config.MatchConfig, sql_con, transaction);
            UpdateExistingMutationConfig(config.DatabaseId, config.MutationConfig, sql_con, transaction);
            UpdateExistingConfigBr(config.DatabaseId, config.BrConfig, sql_con, transaction);
            UpdateExistingConfigDrone(config.DatabaseId, config.EvolutionDroneConfig, sql_con, transaction);
            UpdateExistingConfigRace(config.DatabaseId, config.RaceConfig, sql_con, transaction);

            using (var insertSQL = new SqliteCommand("UPDATE EvolutionConfig" +
                             " SET name = ?, minMatchesPerIndividual = ?, winnersCount = ?" +
                             " WHERE id = ?", sql_con, transaction))
            {
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.RunName));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MinMatchesPerIndividual));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.WinnersFromEachGeneration));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.DatabaseId));

                insertSQL.ExecuteNonQuery();

                return config.DatabaseId;
            }
        }

        private void UpdateExistingMutationConfig(int id, MutationConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var insertSQL = new SqliteCommand(sql_con)
            {
                Transaction = transaction
            })
            {
                insertSQL.CommandText = "UPDATE " + MUTATION_CONFIG_TABLE +
                            " SET mutations = ?, maxMutationLength = ?, genomeLength = ?, generationSize = ?, randomDefault = ?, defaultGenome = ?" +
                            " WHERE id = ?";

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.Mutations));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MaxMutationLength));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.GenomeLength));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.GenerationSize));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Boolean, (object)config.UseCompletelyRandomDefaultGenome));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.DefaultGenome));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)id));

                insertSQL.ExecuteNonQuery();
            }
        }

        private void UpdateExistingMatchConfig(int id, MatchConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var insertSQL = new SqliteCommand(sql_con)
            {
                Transaction = transaction
            })
            {
                insertSQL.CommandText = "UPDATE " + MATCH_CONFIG_TABLE +
                            " SET matchTimeout = ?, winnerPollPeriod = ?, initialRange = ?, initialSpeed = ?, randomInitialSpeed = ?, competitorsPerTeam = ?," +
                            " inSphereRandomisationRadius = ?, onSphereRandomisationRadius = ?," +
                            " stepForwardProportion = ?, randomiseRotation = ?, allowedModules = ?, budget = ?" +
                            " WHERE id = ?";

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.MatchTimeout));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.WinnerPollPeriod));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.InitialRange));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.InitialSpeed));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.RandomInitialSpeed));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.CompetitorsPerTeam));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.MinimumLocationRandomisation));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.MaximumLocationRandomisation));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.StepForwardProportion));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Boolean, (object)config.RandomiseRotation));

                if (!string.IsNullOrEmpty(config.AllowedModulesString))
                    insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.AllowedModulesString));
                else
                    insertSQL.Parameters.Add(new SqliteParameter(DbType.String, DBNull.Value));

                if (config.Budget.HasValue)
                    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.Budget.Value));
                else
                    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, DBNull.Value));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)id));

                insertSQL.ExecuteNonQuery();
            }
        }

        private void UpdateExistingConfigBr(int id, EvolutionBrConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var insertSQL = new SqliteCommand(sql_con)
            {
                Transaction = transaction
            })
            {
                insertSQL.CommandText = "UPDATE " + CONFIG_TABLE_BR +
                    " SET  combatants = ?, survivalBonus = ?, deathScoreMultiplier = ?" +
                    " WHERE id = ?";

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.NumberOfCombatants));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.SurvivalBonus));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.DeathScoreMultiplier));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)id));

                insertSQL.ExecuteNonQuery();
            }
        }

        private void UpdateExistingConfigRace(int id, EvolutionRaceConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var insertSQL = new SqliteCommand(sql_con)
            {
                Transaction = transaction
            })
            {
                insertSQL.CommandText = "UPDATE RaceEvolutionConfig" +
                    " SET " +
                    " raceMaxDistance = ?, raceScoreMultiplier = ?, raceGoalObject = ?" +
                    " WHERE id = ?";

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.RaceMaxDistance));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.RaceScoreMultiplier));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.RaceGoalObject));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)id));

                insertSQL.ExecuteNonQuery();
            }
        }

        private void UpdateExistingConfigDrone(int id, EvolutionDroneConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
        {
           using (var insertSQL = new SqliteCommand(sql_con)
            {
                Transaction = transaction
            })
            {
                insertSQL.CommandText = "UPDATE DroneEvolutionConfig" +
                    " SET  minDrones = ?," +
                    " droneEscalation = ?, maxDrones = ?, killScoreMultiplier = ?, flatKillBonus = ?, completionBonus = ?, droneList = ?," +
                    " dronesInSphereRandomRadius = ?, dronesOnSphereRandomRadius = ?" +
                    " WHERE id = ?";

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MinDronesToSpawn));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.ExtraDromnesPerGeneration));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MaxDronesToSpawn));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.KillScoreMultiplier));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.FlatKillBonus));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.CompletionBonus));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.DronesString));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.DronesInSphereRandomRadius));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.DronesOnSphereRandomRadius));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)id));

                insertSQL.ExecuteNonQuery();
            }
        }

        public void UpdateGeneration(Generation generation, int runId, int generationNumber)
        {
            using (var sql_con = new SqliteConnection(ConnectionString))
            {
                sql_con.Open(); //Open connection to the database.

                using (var transaction = sql_con.BeginTransaction())
                {
                    foreach (var individual in generation.Individuals)
                    {
                        UpdateIndividual(individual, runId, generationNumber, sql_con, transaction);
                    }

                    transaction.Commit();
                }
            }
        }
        #endregion

        #region delete
        public void DeleteConfig(int id)
        {
            using (var sql_con = new SqliteConnection(ConnectionString))
            {
                sql_con.Open(); //Open connection to the database.
                using (var transaction = sql_con.BeginTransaction())
                {
                    DeleteIndividuals(id, sql_con, transaction);
                    DeleteMatchConfig(id, sql_con, transaction);
                    DeleteMutationConfig(id, sql_con, transaction);
                    DeleteBrConfig(id, sql_con, transaction);
                    DeleteDroneConfig(id, sql_con, transaction);
                    DeleteRaceConfig(id, sql_con, transaction);

                    using (var insertSQL = new SqliteCommand("DELETE FROM EvolutionConfig WHERE id = ?;", sql_con, transaction))
                    {
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)id));

                        insertSQL.ExecuteNonQuery();
                    }
                    transaction.Commit();
                }
            }
        }

        public void DeleteIndividuals(int runConfigId)
        {
            using (var sql_con = new SqliteConnection(ConnectionString))
            {
                sql_con.Open(); //Open connection to the database.
                using (var transaction = sql_con.BeginTransaction())
                {
                    DeleteIndividuals(runConfigId, sql_con, transaction);
                    transaction.Commit();
                }
            }
        }

        private void DeleteMatchConfig(int databaseId, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var deleteSQL = new SqliteCommand("DELETE FROM MatchConfig WHERE id = ?;", sql_con, transaction))
            {
                deleteSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)databaseId));
                deleteSQL.ExecuteNonQuery();
            }
        }

        private void DeleteMutationConfig(int databaseId, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var deleteSQL = new SqliteCommand("DELETE FROM MutationConfig WHERE id = ?;", sql_con, transaction))
            {
                deleteSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)databaseId));
                deleteSQL.ExecuteNonQuery();
            }
        }

        private void DeleteBrConfig(int databaseId, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var deleteSQL = new SqliteCommand("DELETE FROM BrEvolutionConfig WHERE id = ?;", sql_con, transaction))
            {
                deleteSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)databaseId));
                deleteSQL.ExecuteNonQuery();
            }
        }

        private void DeleteRaceConfig(int databaseId, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var deleteSQL = new SqliteCommand("DELETE FROM RaceEvolutionConfig WHERE id = ?;", sql_con, transaction))
            {
                deleteSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)databaseId));
                deleteSQL.ExecuteNonQuery();
            }
        }

        private void DeleteDroneConfig(int databaseId, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var deleteSQL = new SqliteCommand("DELETE FROM DroneEvolutionConfig WHERE id = ?;", sql_con, transaction))
            {
                deleteSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)databaseId));
                deleteSQL.ExecuteNonQuery();
            }
        }

        private void DeleteIndividuals(int runConfigId, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var deleteSQL = new SqliteCommand("DELETE FROM Individual WHERE runConfigId = ?;", sql_con, transaction))
            {
                deleteSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)runConfigId));
                deleteSQL.ExecuteNonQuery();
            }
        }
        #endregion

        #region null handlers
        private static int? GetNullableInt(IDataReader reader, string name)
        {
            var ordinal = reader.GetOrdinal(name);
            if (reader.IsDBNull(ordinal))
            {
                return null;
            }
            return reader.GetInt32(ordinal);
        }

        private static float? GetNullableFloat(IDataReader reader, string name)
        {
            var ordinal = reader.GetOrdinal(name);
            if (reader.IsDBNull(ordinal))
            {
                return null;
            }
            return reader.GetFloat(ordinal);
        }

        private static string GetNullableString(IDataReader reader, string name)
        {
            var ordinal = reader.GetOrdinal(name);
            if (reader.IsDBNull(ordinal))
            {
                return null;
            }
            return reader.GetString(ordinal);
        }
        #endregion

        private int GetLastUpdatedId(SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var readIdCommand = new SqliteCommand(sql_con)
            {
                Transaction = transaction
            })
            {
                //From http://www.sliqtools.co.uk/blog/technical/sqlite-how-to-get-the-id-when-inserting-a-row-into-a-table/
                readIdCommand.CommandText = "select last_insert_rowid()";

                // The row ID is a 64-bit value - cast the Command result to an Int64.
                //
                var LastRowID64 = (Int64)readIdCommand.ExecuteScalar();

                // Then grab the bottom 32-bits as the unique ID of the row.
                //
                int lastRowID = (int)LastRowID64;
                //end of copied code.
                return lastRowID;
            }
        }
        
        /// <summary>
        /// Returns the sum of all individuals that were still alive at the time all the drones were killed timesd by the number of matches in which they did so.
        /// </summary>
        /// <param name="id"></param>
        /// <param name="currentGeneration"></param>
        /// <returns></returns>
        public int CountCompleteKillers(int id, int currentGeneration)
        {
            int count = 0;
            //Debug.Log("Reading generation from DB. runId: " + runId + ", generation Number: " + generationNumber);
            using (var sql_con = new SqliteConnection(ConnectionString))
            {
                string sqlQuery = "SELECT killedAllDrones" +
                        " FROM " + INDIVIDUAL_TABLE +
                        " WHERE runConfigId = " + id +
                        " AND generation < " + currentGeneration +
                        " AND killedAllDrones > 0 ;";
                using (var reader = OpenReaderWithCommand(sql_con, sqlQuery))
                {
                    while (reader.Read())
                    {
                        //Debug.Log("genome ordinal: " + reader.GetOrdinal("genome"));  //-1
                        var completeKills = reader.GetInt32(reader.GetOrdinal("killedAllDrones"));
                        count += completeKills;
                    }
                }
            }
            return count;
        }
    }
}
