using Assets.Src.Evolution;
using Mono.Data.Sqlite;
using System;
using System.Collections.Generic;
using System.Data;
using UnityEngine;

namespace Assets.Src.Database
{
    public class EvolutionDatabaseHandler
    {
        private string CONFIG_TABLE { get; }
        private const string MAIN_CONFIG_TABLE = "MainConfig";
        private string INDIVIDUAL_TABLE { get; }

        public const string DEFAULT_CREATE_DB_COMMAND_PATH = "/CreateBlankDatabase.sql";
        private const string DEFAULT_DB_PATH = "/Database/SpaceCombatSimulationDB.s3db";

        private string RUN_TYPE_NAME { get; }

        private string _connectionString
        {
            get
            {
                var connection = "URI=file:" + Application.dataPath + _databasePath + "; foreign keys=true;";
                //Debug.Log("connection string: " + connection);
                return connection;
            }
        }
        private string _databasePath; //Path to database.
        private const string MUTATION_CONFIG_TABLE = "MutationConfig";
        private const string MATCH_CONFIG_TABLE = "MatchConfig";

        public EvolutionDatabaseHandler(string databasePath = DEFAULT_DB_PATH, string dbCreationCommandPath = DEFAULT_CREATE_DB_COMMAND_PATH)
        {
            _databasePath = databasePath;

            if (!string.IsNullOrEmpty(dbCreationCommandPath))
            {
                var initialiser = new DatabaseInitialiser
                {
                    DatabasePath = _databasePath
                };
                initialiser.EnsureDatabaseExists(dbCreationCommandPath);
            }
        }

        public Dictionary<int, string> ListConfigs()
        { 
            var configs = new Dictionary<int, string>();

            string sqlQuery = "SELECT " + CONFIG_TABLE + ".id, name" + " FROM " + CONFIG_TABLE + 
                " LEFT JOIN BaseEvolutionConfig on BaseEvolutionConfig.id = " + CONFIG_TABLE + ".id;";

            using (var sql_con = new SqliteConnection(_connectionString))
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
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                sql_con.Open();

                //Debug.Log("Updating generation to " + config.GenerationNumber);
                using (var command = new SqliteCommand("UPDATE BaseEvolutionConfig SET currentGeneration = ? WHERE id = ?;", sql_con))
                {
                    command.Parameters.Add(new SqliteParameter(DbType.Int32, (object)generationNumber));
                    command.Parameters.Add(new SqliteParameter(DbType.Int32, (object)databaseId));

                    command.ExecuteNonQuery();
                }
            }
        }

        #region Autoload
        public void SetAutoloadId(int? autoloadId)
        {
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                sql_con.Open(); //Open connection to the database.
                using (var dbcmd = sql_con.CreateCommand())
                {
                    dbcmd.CommandText = "UPDATE " + MAIN_CONFIG_TABLE + " set autoloadId = ?;";

                    dbcmd.Parameters.Add(new SqliteParameter(DbType.Int32, (object)autoloadId));

                    dbcmd.ExecuteNonQuery();
                }
            }
        }

        public int? ReadAutoloadId()
        {
            string sqlQuery = "SELECT autoloadId FROM " + MAIN_CONFIG_TABLE + ";";
            int? idToLoad = null;
            using (var sql_con = new SqliteConnection(_connectionString))
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
                        } else
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
        protected string CreateReadConfigQuery(string table, int id)
        {
            string sqlQuery = "SELECT *" +
                        " FROM " + table +
                        " LEFT JOIN BaseEvolutionConfig on BaseEvolutionConfig.id = " + table + ".id" +
                        " LEFT JOIN MatchConfig on MatchConfig.id = BaseEvolutionConfig.id" +
                        " LEFT JOIN MutationConfig on MutationConfig.id = BaseEvolutionConfig.id" +
                        " WHERE " + table + ".id = " + id + ";";
            return sqlQuery;
        }

        protected string CreateReadIndividualsQuery(string table, int runId, int generationNumber)
        {
            string sqlQuery = "SELECT *" +
                        " FROM " + table +
                        " LEFT JOIN BaseIndividual on BaseIndividual.runConfigId = " + table + ".runConfigId AND" +
                        " BaseIndividual.generation = " + table + ".generation AND" +
                        " BaseIndividual.genome = " + table + ".genome" +
                        " WHERE BaseIndividual.runConfigId = " + runId + " AND BaseIndividual.generation = " + generationNumber +
                        ";";
            return sqlQuery;
        }

        protected IDataReader OpenReaderWithCommand(SqliteConnection connection, string command)
        {
            connection.Open(); //Open connection to the database.
            using (var dbcmd = connection.CreateCommand())
            {
                dbcmd.CommandText = command;
                var reader = dbcmd.ExecuteReader();

                return reader;
            }
        }

        protected MatchConfig ReadMatchConfig(IDataReader reader)
        {
            //Debug.Log("BaseEvolutionConfig.id ordinal: " + reader.GetOrdinal("id"));
            //Debug.Log("BaseEvolutionConfig.id value: " + reader.GetInt32(reader.GetOrdinal("id")));

            var config = new MatchConfig()
            {
                MatchTimeout = reader.GetFloat(reader.GetOrdinal("matchTimeout")), //16
                WinnerPollPeriod = reader.GetFloat(reader.GetOrdinal("winnerPollPeriod")), //17
                InitialRange = reader.GetFloat(reader.GetOrdinal("initialRange")),
                InitialSpeed = reader.GetFloat(reader.GetOrdinal("initialSpeed")),
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

        protected MutationConfig ReadMutationConfig(IDataReader reader)
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

        protected SpeciesSummary ReadSpeciesSummary(IDataReader reader)
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
                    GetValueForNullableStringField(reader, "species"),
                    GetValueForNullableStringField(reader, "speciesVerbose"),
                    GetValueForNullableStringField(reader, "subspecies"),
                    GetValueForNullableStringField(reader, "subspeciesVerbose")
                );
        }
        #endregion

        #region save new
        protected void SaveMutationConfig(int id, MutationConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
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

        protected void SaveMatchConfig(int id, MatchConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var insertSQL = new SqliteCommand(sql_con)
            {
                Transaction = transaction
            })
            {
                insertSQL.CommandText = "INSERT INTO " + MATCH_CONFIG_TABLE +
                            "(id, matchTimeout, winnerPollPeriod, initialRange, initialSpeed, randomInitialSpeed, competitorsPerTeam, stepForwardProportion, randomiseRotation, allowedModules, budget)" +
                            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)id));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.MatchTimeout));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.WinnerPollPeriod));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.InitialRange));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.InitialSpeed));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.RandomInitialSpeed));
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

        protected void SaveBaseIndividual(string runtype, BaseIndividual individual, int runId, int generationNumber, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var insertSQL = new SqliteCommand("INSERT INTO BaseIndividual " +
                            "(runType, runConfigId, generation, genome, score, cost, modules, r,g,b, species, speciesVerbose, subspecies, subspeciesVerbose)" +
                            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", sql_con, transaction))
            {
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)runtype));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)runId));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)generationNumber));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Genome));
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

                insertSQL.ExecuteNonQuery();
            }
        }

        protected int SaveBaseEvolutionConfig(BaseEvolutionConfig config, SqliteConnection connection, SqliteTransaction transaction)
        {
            var sql = "INSERT INTO BaseEvolutionConfig" +
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

            SaveMatchConfig(config.DatabaseId, config.MatchConfig, connection, transaction);
            SaveMutationConfig(config.DatabaseId, config.MutationConfig, connection, transaction);

            return config.DatabaseId;
        }
        #endregion

        #region update existing
        protected void UpdateExistingMutationConfig(int id, MutationConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
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

        protected void UpdateExistingMatchConfig(int id, MatchConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var insertSQL = new SqliteCommand(sql_con)
            {
                Transaction = transaction
            })
            {
                insertSQL.CommandText = "UPDATE " + MATCH_CONFIG_TABLE +
                            " SET matchTimeout = ?, winnerPollPeriod = ?, initialRange = ?, initialSpeed = ?, randomInitialSpeed = ?, competitorsPerTeam = ?," +
                            " stepForwardProportion = ?, randomiseRotation = ?, allowedModules = ?, budget = ?" +
                            " WHERE id = ?";

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.MatchTimeout));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.WinnerPollPeriod));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.InitialRange));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.InitialSpeed));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.RandomInitialSpeed));
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

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)id));

                insertSQL.ExecuteNonQuery();
            }
        }

        protected void UpdateBaseIndividual(BaseIndividual individual, int runId, int generationNumber, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var insertSQL = new SqliteCommand("UPDATE  BaseIndividual" +
                           " SET score = ?, cost = ?, modules = ?, r = ?, g = ?, b = ?, species = ?, speciesVerbose = ?, subspecies = ?, subspeciesVerbose = ?" +
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

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)runId));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)generationNumber));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Genome));

                insertSQL.ExecuteNonQuery();
            }
        }

        protected void UpdateBaseEvolutionConfig(BaseEvolutionConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            UpdateExistingMatchConfig(config.DatabaseId, config.MatchConfig, sql_con, transaction);
            UpdateExistingMutationConfig(config.DatabaseId, config.MutationConfig, sql_con, transaction);

            using (var insertSQL = new SqliteCommand("UPDATE BaseEvolutionConfig" +
                             " SET name = ?, minMatchesPerIndividual = ?, winnersCount = ?" +
                             " WHERE id = ?", sql_con, transaction))
            {
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.RunName));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MinMatchesPerIndividual));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.WinnersFromEachGeneration));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.DatabaseId));

                insertSQL.ExecuteNonQuery();
            }
        }
        #endregion

        #region delete
        public void DeleteConfig(int id)
        {
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                sql_con.Open(); //Open connection to the database.
                using (var transaction = sql_con.BeginTransaction())
                {
                    DeleteIndividuals(id, sql_con, transaction);
                    DeleteMatchConfig(id, sql_con, transaction);
                    DeleteMutationConfig(id, sql_con, transaction);
                    DeleteBrConfig(id, sql_con, transaction);
                    DeleteDroneConfig(id, sql_con, transaction);
                    using (var insertSQL = new SqliteCommand("DELETE FROM BaseEvolutionConfig WHERE id = ?;", sql_con, transaction))
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
            using (var sql_con = new SqliteConnection(_connectionString))
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
            DeleteBrIndividuals(runConfigId, sql_con, transaction);
            DeleteDroneIndividuals(runConfigId, sql_con, transaction);
            using (var deleteSQL = new SqliteCommand("DELETE FROM BaseIndividual WHERE runConfigId = ?;", sql_con, transaction))
            {
                deleteSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)runConfigId));
                deleteSQL.ExecuteNonQuery();
            }
        }

        private void DeleteBrIndividuals(int runConfigId, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var deleteSQL = new SqliteCommand("DELETE FROM BrIndividual WHERE runConfigId = ?;", sql_con, transaction))
            {
                deleteSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)runConfigId));
                deleteSQL.ExecuteNonQuery();
            }
        }

        private void DeleteDroneIndividuals(int runConfigId, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            using (var deleteSQL = new SqliteCommand("DELETE FROM DroneIndividual WHERE runConfigId = ?;", sql_con, transaction))
            {
                deleteSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)runConfigId));
                deleteSQL.ExecuteNonQuery();
            }
        }
        #endregion
        
        #region null handlers
        protected static int? GetNullableInt(IDataReader reader, string name)
        {
            var ordinal = reader.GetOrdinal(name);
            if (reader.IsDBNull(ordinal))
            {
                return null;
            }
            return reader.GetInt32(ordinal);
        }

        protected static float? GetNullableFloat(IDataReader reader, string name)
        {
            var ordinal = reader.GetOrdinal(name);
            if (reader.IsDBNull(ordinal))
            {
                return null;
            }
            return reader.GetFloat(ordinal);
        }

        protected static string GetValueForNullableStringField(IDataReader reader, string name)
        {
            var ordinal = reader.GetOrdinal(name);
            if (reader.IsDBNull(ordinal))
            {
                return null;
            }
            return reader.GetString(ordinal);
        }
        #endregion

        protected int GetLastUpdatedId(SqliteConnection sql_con, SqliteTransaction transaction)
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

        public abstract BaseGeneration ReadBaseGeneration(int runId, int generationNumber);

        #region Br
        protected string CONFIG_TABLE_BR { get { return "BrEvolutionConfig"; } }
        protected string INDIVIDUAL_TABLE_BR { get { return "BrIndividual"; } }
        protected string RUN_TYPE_NAME_BR { get { return "Battle Royale"; } }
        
        public EvolutionBrConfig ReadConfig(int id)
        {
            var config = new EvolutionBrConfig();

            //Debug.Log("Reading config from DB. Id: " + id);
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                using (var reader = OpenReaderWithCommand(sql_con, CreateReadConfigQuery(CONFIG_TABLE_BR, id)))
                {
                    if (reader.Read())
                    {
                        //Debug.Log("EvolutionConfig1v1.id ordinal: " + reader.GetOrdinal("id"));
                        config.DatabaseId = reader.GetInt32(reader.GetOrdinal("id"));

                        //Debug.Log("id ordinal: " + reader.GetOrdinal("id"));
                        //Debug.Log("id value: " + reader.GetDecimal(reader.GetOrdinal("id")));

                        config.RunName = reader.GetString(reader.GetOrdinal("name")); //1
                        config.GenerationNumber = reader.GetInt32(reader.GetOrdinal("currentGeneration"));
                        config.MinMatchesPerIndividual = reader.GetInt32(reader.GetOrdinal("minMatchesPerIndividual"));
                        config.WinnersFromEachGeneration = reader.GetInt32(reader.GetOrdinal("winnersCount"));
                        config.NumberOfCombatants = reader.GetInt32(reader.GetOrdinal("combatants"));
                        config.InSphereRandomisationRadius = reader.GetFloat(reader.GetOrdinal("inSphereRandomisationRadius"));
                        config.OnSphereRandomisationRadius = reader.GetFloat(reader.GetOrdinal("onSphereRandomisationRadius"));
                        config.RaceMaxDistance = reader.GetFloat(reader.GetOrdinal("raceMaxDistance"));
                        config.RaceScoreMultiplier = reader.GetFloat(reader.GetOrdinal("raceScoreMultiplier"));
                        config.SurvivalBonus = reader.GetFloat(reader.GetOrdinal("survivalBonus"));
                        config.DeathScoreMultiplier = reader.GetFloat(reader.GetOrdinal("deathScoreMultiplier"));
                        config.RaceGoalObject = GetNullableInt(reader, "raceGoalObject");

                        config.MatchConfig = ReadMatchConfig(reader);
                        config.MutationConfig = ReadMutationConfig(reader);
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

        public int UpdateExistingConfig(EvolutionBrConfig config)
        {
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                sql_con.Open(); //Open connection to the database.

                using (var transaction = sql_con.BeginTransaction())
                {
                    UpdateBaseEvolutionConfig(config, sql_con, transaction);

                    using (var insertSQL = new SqliteCommand(sql_con)
                    {
                        Transaction = transaction
                    })
                    {
                        insertSQL.CommandText = "UPDATE " + CONFIG_TABLE_BR +
                            " SET  combatants = ?, inSphereRandomisationRadius = ?, onSphereRandomisationRadius = ?," +
                            " raceMaxDistance = ?, raceScoreMultiplier = ?, raceGoalObject = ?, survivalBonus = ?, deathScoreMultiplier = ?" +
                            " WHERE id = ?";

                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.NumberOfCombatants));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.InSphereRandomisationRadius));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.OnSphereRandomisationRadius));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.RaceMaxDistance));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.RaceScoreMultiplier));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.RaceGoalObject));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.SurvivalBonus));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.DeathScoreMultiplier));

                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.DatabaseId));

                        insertSQL.ExecuteNonQuery();
                    }
                    transaction.Commit();
                }
            }
            return config.DatabaseId;
        }

        public int SaveNewConfig(EvolutionBrConfig config)
        {
            using (var connection = new SqliteConnection(_connectionString))
            {
                connection.Open(); //Open connection to the database.

                using (var transaction = connection.BeginTransaction())
                {
                    SaveBaseEvolutionConfig(config, connection, transaction);

                    using (var insertSQL = new SqliteCommand(connection)
                    {
                        Transaction = transaction
                    })
                    {
                        insertSQL.CommandText = "INSERT INTO " + CONFIG_TABLE_BR +
                            "(id, combatants, inSphereRandomisationRadius, onSphereRandomisationRadius, raceMaxDistance, raceScoreMultiplier, raceGoalObject, survivalBonus, deathScoreMultiplier)" +
                            " VALUES (?,?,?,?,?,?,?,?,?)";

                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.DatabaseId));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.NumberOfCombatants));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.InSphereRandomisationRadius));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.OnSphereRandomisationRadius));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.RaceMaxDistance));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.RaceScoreMultiplier));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.RaceGoalObject));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.SurvivalBonus));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.DeathScoreMultiplier));

                        insertSQL.ExecuteNonQuery();
                    }

                    transaction.Commit();
                }
            }

            return config.DatabaseId;
        }

        public Generation ReadGeneration(int runId, int generationNumber)
        {
            //Debug.Log("Reading generation from DB. runId: " + runId + ", generation Number: " + generationNumber);
            var lines = new List<string>();
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                using (var reader = OpenReaderWithCommand(sql_con, CreateReadIndividualsQuery(INDIVIDUAL_TABLE_BR, runId, generationNumber)))
                {
                    while (reader.Read())
                    {
                        //Debug.Log("wins ordinal: " + reader.GetOrdinal("wins"));
                        var individual = new IndividualBr(ReadSpeciesSummary(reader))
                        {
                            Score = reader.GetFloat(reader.GetOrdinal("score")),
                            Wins = reader.GetInt32(reader.GetOrdinal("wins")),
                            Loses = reader.GetInt32(reader.GetOrdinal("loses")),
                            Draws = reader.GetInt32(reader.GetOrdinal("draws")),
                            PreviousCombatantsString = GetValueForNullableStringField(reader, "previousCombatants")
                        };
                        lines.Add(individual.Genome);
                    }
                }
            }

            return new Generation(lines);
        }

        public void SaveNewGeneration(Generation generation, int runId, int generationNumber)
        {
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                sql_con.Open(); //Open connection to the database.

                using (var transaction = sql_con.BeginTransaction())
                {
                    foreach (var individual in generation.Individuals)
                    {
                        SaveBaseIndividual(RUN_TYPE_NAME_BR, individual, runId, generationNumber, sql_con, transaction);

                        using (var insertSQL = new SqliteCommand("INSERT INTO " + INDIVIDUAL_TABLE +
                            " (runConfigId, generation, genome, wins, draws, loses, previousCombatants)" +
                            " VALUES (?,?,?,?,?,?,?)", sql_con, transaction))
                        {
                            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)runId));
                            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)generationNumber));
                            insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Genome));
                            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.Wins));
                            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.Draws));
                            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.Loses));
                            insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.PreviousCombatantsString));

                            insertSQL.ExecuteNonQuery();
                        }
                    }

                    transaction.Commit();
                }
            }
        }

        public void UpdateGeneration(GenerationBr generation, int runId, int generationNumber)
        {
            using (var sql_con = new SqliteConnection(_connectionString))
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

        private void UpdateIndividual(IndividualBr individual, int runId, int generationNumber, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            UpdateBaseIndividual(individual, runId, generationNumber, sql_con, transaction);

            using (var insertSQL = new SqliteCommand("UPDATE " + INDIVIDUAL_TABLE +
                            " SET wins = ?, draws = ?, loses = ?, previousCombatants = ?" +
                            " WHERE runConfigId = ? AND generation = ? AND genome = ?", sql_con, transaction))
            {
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.Wins));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.Draws));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.Loses));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.PreviousCombatantsString));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)runId));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)generationNumber));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Genome));

                insertSQL.ExecuteNonQuery();
            }
        }

        public override BaseGeneration ReadBaseGeneration(int runId, int generationNumber)
        {
            return ReadGeneration(runId, generationNumber);
        }
        #endregion

        #region Drone

        protected override string CONFIG_TABLE { get { return "DroneEvolutionConfig"; } }
        protected override string INDIVIDUAL_TABLE { get { return "DroneIndividual"; } }

        protected override string RUN_TYPE_NAME { get { return "drone"; } }

        public EvolutionDroneDatabaseHandler(string databasePath, string dbCreationCommandPath) : base(databasePath, dbCreationCommandPath)
        {
        }

        public EvolutionDroneDatabaseHandler(string databasePath) : base(databasePath)
        {
        }

        public EvolutionDroneDatabaseHandler() : base()
        {
        }

        public EvolutionDroneConfig ReadConfig(int id)
        {
            var config = new EvolutionDroneConfig();

            //Debug.Log("Reading config from DB. Id: " + id);
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                using (var reader = OpenReaderWithCommand(sql_con, CreateReadConfigQuery(CONFIG_TABLE, id)))
                {
                    reader.Read();

                    //Debug.Log("DroneEvolutionConfig.id ordinal: " + reader.GetOrdinal("id"));
                    config.DatabaseId = reader.GetInt32(reader.GetOrdinal("id"));

                    //Debug.Log("name ordinal: " + reader.GetOrdinal("name"));
                    config.RunName = reader.GetString(reader.GetOrdinal("name"));
                    config.GenerationNumber = reader.GetInt32(reader.GetOrdinal("currentGeneration"));
                    config.MinMatchesPerIndividual = reader.GetInt32(reader.GetOrdinal("minMatchesPerIndividual"));
                    config.WinnersFromEachGeneration = reader.GetInt32(reader.GetOrdinal("winnersCount"));
                    config.MinDronesToSpawn = reader.GetInt32(reader.GetOrdinal("minDrones"));
                    //Debug.Log("droneEscalation ordinal: " + reader.GetOrdinal("droneEscalation"));
                    config.ExtraDromnesPerGeneration = reader.GetFloat(reader.GetOrdinal("droneEscalation"));
                    config.MaxDronesToSpawn = reader.GetInt32(reader.GetOrdinal("maxDrones"));
                    config.KillScoreMultiplier = reader.GetFloat(reader.GetOrdinal("killScoreMultiplier"));
                    config.FlatKillBonus = reader.GetFloat(reader.GetOrdinal("flatKillBonus"));
                    config.CompletionBonus = reader.GetFloat(reader.GetOrdinal("completionBonus"));
                    config.DeathPenalty = reader.GetFloat(reader.GetOrdinal("deathPenalty"));
                    config.DronesString = reader.GetString(reader.GetOrdinal("droneList"));

                    config.ShipInSphereRandomRadius = reader.GetFloat(reader.GetOrdinal("shipInSphereRandomRadius"));
                    config.ShipOnSphereRandomRadius = reader.GetFloat(reader.GetOrdinal("shipOnSphereRandomRadius"));
                    config.DronesInSphereRandomRadius = reader.GetFloat(reader.GetOrdinal("dronesInSphereRandomRadius"));
                    config.DronesOnSphereRandomRadius = reader.GetFloat(reader.GetOrdinal("dronesOnSphereRandomRadius"));

                    config.MatchConfig = ReadMatchConfig(reader);
                    config.MutationConfig = ReadMutationConfig(reader);
                }
            }
            return config;
        }

        /// <summary>
        /// Returns the number of matches that ended in complete kills in all previous generations.
        /// </summary>
        /// <param name="id"></param>
        /// <param name="currentGeneration"></param>
        /// <returns></returns>
        public int CountCompleteKillers(int id, int currentGeneration)
        {
            int count = 0;
            //Debug.Log("Reading generation from DB. runId: " + runId + ", generation Number: " + generationNumber);
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                string sqlQuery = "SELECT completeKills" +
                        " FROM " + INDIVIDUAL_TABLE +
                        " WHERE runConfigId = " + id +
                        " AND generation < " + currentGeneration +
                        " AND completeKills > 0 ;";
                using (var reader = OpenReaderWithCommand(sql_con, sqlQuery))
                {
                    while (reader.Read())
                    {
                        //Debug.Log("genome ordinal: " + reader.GetOrdinal("genome"));  //-1
                        var completeKills = reader.GetInt32(reader.GetOrdinal("completeKills"));
                        count += completeKills;
                    }
                }
            }
            return count;
        }

        public int UpdateExistingConfig(EvolutionDroneConfig config)
        {
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                sql_con.Open(); //Open connection to the database.

                using (var transaction = sql_con.BeginTransaction())
                {
                    UpdateBaseEvolutionConfig(config, sql_con, transaction);

                    using (var insertSQL = new SqliteCommand(sql_con)
                    {
                        Transaction = transaction
                    })
                    {
                        insertSQL.CommandText = "UPDATE " + CONFIG_TABLE +
                            " SET  minDrones = ?," +
                            " droneEscalation = ?, maxDrones = ?, killScoreMultiplier = ?, flatKillBonus = ?, completionBonus = ?, deathPenalty = ?, droneList = ?," +
                            " shipInSphereRandomRadius = ?, shipOnSphereRandomRadius = ?, dronesInSphereRandomRadius = ?, dronesOnSphereRandomRadius = ?" +
                            " WHERE id = ?";

                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MinDronesToSpawn));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.ExtraDromnesPerGeneration));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MaxDronesToSpawn));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.KillScoreMultiplier));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.FlatKillBonus));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.CompletionBonus));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.DeathPenalty));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.DronesString));

                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.ShipInSphereRandomRadius));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.ShipOnSphereRandomRadius));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.DronesInSphereRandomRadius));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.DronesOnSphereRandomRadius));

                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.DatabaseId));

                        insertSQL.ExecuteNonQuery();
                    }

                    transaction.Commit();
                }
            }

            return config.DatabaseId;
        }

        public int SaveNewConfig(EvolutionDroneConfig config)
        {
            using (var connection = new SqliteConnection(_connectionString))
            {
                connection.Open(); //Open connection to the database.

                using (var transaction = connection.BeginTransaction())
                {
                    SaveBaseEvolutionConfig(config, connection, transaction);

                    using (var insertSQL = new SqliteCommand(connection)
                    {
                        Transaction = transaction
                    })
                    {
                        insertSQL.CommandText = "INSERT INTO " + CONFIG_TABLE +
                            "(id, minDrones, droneEscalation, maxDrones, killScoreMultiplier, flatKillBonus, completionBonus, deathPenalty, droneList," +
                            " shipInSphereRandomRadius, shipOnSphereRandomRadius, dronesInSphereRandomRadius, dronesOnSphereRandomRadius)" +
                            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)";

                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.DatabaseId));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MinDronesToSpawn));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.ExtraDromnesPerGeneration));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MaxDronesToSpawn));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.KillScoreMultiplier));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.FlatKillBonus));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.CompletionBonus));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.DeathPenalty));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.DronesString));

                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.ShipInSphereRandomRadius));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.ShipOnSphereRandomRadius));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.DronesInSphereRandomRadius));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Double, (object)config.DronesOnSphereRandomRadius));

                        insertSQL.ExecuteNonQuery();
                    }
                    transaction.Commit();
                }
            }

            return config.DatabaseId;
        }

        public GenerationDrone ReadGeneration(int runId, int generationNumber)
        {
            //Debug.Log("Reading generation from DB. runId: " + runId + ", generation Number: " + generationNumber);
            var generation = new GenerationDrone();
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                using (var reader = OpenReaderWithCommand(sql_con, CreateReadIndividualsQuery(INDIVIDUAL_TABLE, runId, generationNumber)))
                {
                    while (reader.Read())
                    {
                        //Debug.Log("genome ordinal: " + reader.GetOrdinal("genome"));  //-1
                        var individual = new IndividualDrone(ReadSpeciesSummary(reader))
                        {
                            Score = reader.GetFloat(reader.GetOrdinal("score")),
                            MatchesPlayed = reader.GetInt32(reader.GetOrdinal("matchesPlayed")),
                            MatchesSurvived = reader.GetInt32(reader.GetOrdinal("matchesSurvived")),
                            CompleteKills = reader.GetInt32(reader.GetOrdinal("completeKills")),
                            TotalKills = reader.GetInt32(reader.GetOrdinal("totalKills")),
                            MatchScoresString = reader.GetString(reader.GetOrdinal("matchScores"))
                        };

                        generation.Individuals.Add(individual);
                    }
                }
            }

            return generation;
        }

        public void SaveNewGeneration(GenerationDrone generation, int runId, int generationNumber)
        {
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                sql_con.Open(); //Open connection to the database.

                using (var transaction = sql_con.BeginTransaction())
                {
                    foreach (var individual in generation.Individuals)
                    {
                        SaveBaseIndividual(RUN_TYPE_NAME, individual, runId, generationNumber, sql_con, transaction);

                        using (var insertSQL = new SqliteCommand("INSERT INTO " + INDIVIDUAL_TABLE +
                            " (runConfigId, generation, genome, matchesPlayed, matchesSurvived, completeKills, totalKills, matchScores)" +
                            " VALUES (?,?,?,?,?,?,?,?)", sql_con, transaction))
                        {
                            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)runId));
                            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)generationNumber));
                            insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Genome));
                            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.MatchesPlayed));
                            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.MatchesSurvived));
                            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.CompleteKills));
                            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.TotalKills));
                            insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.MatchScoresString));

                            insertSQL.ExecuteNonQuery();
                        }
                    }
                    transaction.Commit();
                }
            }
        }

        public void UpdateGeneration(GenerationDrone generation, int runId, int generationNumber)
        {
            using (var sql_con = new SqliteConnection(_connectionString))
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

        private void UpdateIndividual(IndividualDrone individual, int runId, int generationNumber, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            UpdateBaseIndividual(individual, runId, generationNumber, sql_con, transaction);

            using (var insertSQL = new SqliteCommand("UPDATE " + INDIVIDUAL_TABLE +
                            " SET matchesPlayed = ?, matchesSurvived = ?, completeKills = ?, totalKills = ?, matchScores = ?" +
                            " WHERE runConfigId = ? AND generation = ? AND genome = ?", sql_con, transaction))
            {
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.MatchesPlayed));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.MatchesSurvived));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.CompleteKills));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.TotalKills));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.MatchScoresString));

                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)runId));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)generationNumber));
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Genome));

                insertSQL.ExecuteNonQuery();
            }
        }

        public override BaseGeneration ReadBaseGeneration(int runId, int generationNumber)
        {
            return ReadGeneration(runId, generationNumber);
        }
        #endregion
    }
}
