using Assets.src.Evolution;
using Assets.Src.Evolution;
using Mono.Data.Sqlite;
using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Database
{
    public abstract class GeneralDatabaseHandler
    {
        public const string DEFAULT_COMMAND_PATH = "/Database/CreateBlankDatabase.sql";
        private const string DEFAULT_DB_PATH = "/tmp/SpaceCombatSimulationDB.s3db";

        protected abstract string RUN_TYPE_NAME { get; }

        protected string _connectionString
        {
            get
            {
                var connection = "URI=file:" + Application.dataPath + _databasePath;
                //Debug.Log("connection string: " + connection);
                return connection;
            }
        }
        protected string _databasePath; //Path to database.
        protected const string MUTATION_CONFIG_TABLE = "MutationConfig";
        protected const string MATCH_CONFIG_TABLE = "MatchConfig";

        public GeneralDatabaseHandler(string databasePath = DEFAULT_DB_PATH, string dbCreationCommandPath = DEFAULT_COMMAND_PATH)
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

        public abstract Dictionary<int, string> ListConfigs();

        protected Dictionary<int, string> ListConfigs(string table)
        {
            var configs = new Dictionary<int, string>();

            string sqlQuery = "SELECT id, name" + " FROM " + table + ";";

            using (var sql_con = new SqliteConnection(_connectionString))
            {
                IDbCommand dbcmd = null;
                IDataReader reader = null;
                try
                {
                    sql_con.Open(); //Open connection to the database.
                    dbcmd = sql_con.CreateCommand();
                    dbcmd.CommandText = sqlQuery;
                    reader = dbcmd.ExecuteReader();

                    while (reader.Read())
                    {
                        var id = reader.GetInt32(reader.GetOrdinal("id"));
                        var name = reader.GetString(reader.GetOrdinal("name"));
                        configs.Add(id, name);
                    }
                }
                catch (Exception e)
                {
                    Debug.LogWarning("Caught exception: " + e + ", message: " + e.Message);
                    throw e;
                }
                finally
                {
                    Disconnect(reader, null, dbcmd, sql_con);
                }
            }
            return configs;
        }

        protected string CreateReadConfigQuery(string table, int id)
        {
            string sqlQuery = "SELECT *" +
                        " FROM " + table +
                        " LEFT JOIN MatchConfig on MatchConfig.id = " + table + ".matchConfigId" +
                        " LEFT JOIN MutationConfig on MutationConfig.id = " + table + ".mutationConfigId" +
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

        protected IDataReader OpenReaderWithCommand(SqliteConnection connection, string command, out IDbCommand dbcmd)
        {
            connection.Open(); //Open connection to the database.
            dbcmd = connection.CreateCommand();
            dbcmd.CommandText = command;
            var reader = dbcmd.ExecuteReader();

            return reader;
        }

        protected MatchConfig ReadMatchConfig(IDataReader reader, int idIndex)
        {
            //Debug.Log("locationRandomisationRadiai ordinal: " + reader.GetOrdinal("locationRandomisationRadiai"));
            //Debug.Log("locationRandomisationRadiai value: " + reader.GetString(reader.GetOrdinal("locationRandomisationRadiai")));

            var config = new MatchConfig()
            {
                Id = reader.GetInt32(idIndex),
                MatchTimeout = reader.GetFloat(reader.GetOrdinal("matchTimeout")), //16
                WinnerPollPeriod = reader.GetFloat(reader.GetOrdinal("winnerPollPeriod")), //17
                InitialRange = reader.GetFloat(reader.GetOrdinal("initialRange")),
                InitialSpeed = reader.GetFloat(reader.GetOrdinal("initialSpeed")),
                RandomInitialSpeed = reader.GetFloat(reader.GetOrdinal("randomInitialSpeed")),
                CompetitorsPerTeam = reader.GetInt32(reader.GetOrdinal("competitorsPerTeam")),
                StepForwardProportion = reader.GetFloat(reader.GetOrdinal("stepForwardProportion")),
                RandomiseRotation = reader.GetBoolean(reader.GetOrdinal("randomiseRotation"))
            };

            if (!reader.IsDBNull(reader.GetOrdinal("locationRandomisationRadiai")))
            {
                config.LocationRandomisationRadiaiString = reader.GetString(reader.GetOrdinal("locationRandomisationRadiai"));
            }
            else
            {
                config.LocationRandomisationRadiaiString = null;
            }

            if (!reader.IsDBNull(reader.GetOrdinal("allowedModules")))
            {
                config.AllowedModulesString = reader.GetString(reader.GetOrdinal("allowedModules"));
            }

            if (!reader.IsDBNull(reader.GetOrdinal("budget")))
            {
                config.Budget = reader.GetInt32(reader.GetOrdinal("budget"));
            } else
            {
                config.Budget = null;
            }
            return config;
        }

        protected MutationConfig ReadMutationConfig(IDataReader reader, int idIndex)
        {
            //Debug.Log("matchConfigId ordinal: " + reader.GetOrdinal("MatchConfig.Id"));  //-1

            var config = new MutationConfig()
            {
                Id = reader.GetInt32(idIndex),
                Mutations = reader.GetInt32(reader.GetOrdinal("mutations")),
                MaxMutationLength = reader.GetInt32(reader.GetOrdinal("maxMutationLength")),
                GenomeLength = reader.GetInt32(reader.GetOrdinal("genomeLength")),
                GenerationSize = reader.GetInt32(reader.GetOrdinal("generationSize")),
                UseCompletelyRandomDefaultGenome = reader.GetBoolean(reader.GetOrdinal("randomDefault")),
                DefaultGenome = reader.GetString(reader.GetOrdinal("defaultGenome"))
            };
            return config;
        }

        protected int SaveMutationConfig(MutationConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            SqliteCommand insertSQL = new SqliteCommand(sql_con)
            {
                Transaction = transaction
            };

            insertSQL.CommandText = "INSERT INTO " + MUTATION_CONFIG_TABLE +
                        "(mutations, maxMutationLength, genomeLength, generationSize, randomDefault, defaultGenome)" +
                        " VALUES (?,?,?,?,?,?)";

            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.Mutations));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MaxMutationLength));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.GenomeLength));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.GenerationSize));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Boolean, (object)config.UseCompletelyRandomDefaultGenome));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.DefaultGenome));
            
            insertSQL.ExecuteNonQuery();

            SqliteCommand readIdCommand = new SqliteCommand(sql_con)
            {
                Transaction = transaction
            };

            //From http://www.sliqtools.co.uk/blog/technical/sqlite-how-to-get-the-id-when-inserting-a-row-into-a-table/
            readIdCommand.CommandText = "select last_insert_rowid()";

            // The row ID is a 64-bit value - cast the Command result to an Int64.
            //
            var LastRowID64 = (Int64)readIdCommand.ExecuteScalar();
            readIdCommand.Dispose();

            // Then grab the bottom 32-bits as the unique ID of the row.
            //
            int LastRowID = (int)LastRowID64;
            //end of copied code.

            config.Id = LastRowID;

            return config.Id;
        }

        protected int SaveMatchConfig(MatchConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            SqliteCommand insertSQL = new SqliteCommand(sql_con)
            {
                Transaction = transaction
            };

            insertSQL.CommandText = "INSERT INTO " + MATCH_CONFIG_TABLE +
                        "(matchTimeout, winnerPollPeriod, initialRange, initialSpeed, randomInitialSpeed, competitorsPerTeam, stepForwardProportion, locationRandomisationRadiai, randomiseRotation, allowedModules, budget)" +
                        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

            insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.MatchTimeout));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.WinnerPollPeriod));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.InitialRange));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.InitialSpeed));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.RandomInitialSpeed));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.CompetitorsPerTeam));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.StepForwardProportion));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.LocationRandomisationRadiaiString));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Boolean, (object)config.RandomiseRotation));

            if(!string.IsNullOrEmpty(config.AllowedModulesString))
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.AllowedModulesString));
            else
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, DBNull.Value));

            if (config.Budget.HasValue)
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.Budget.Value));
            else
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, DBNull.Value));


            insertSQL.ExecuteNonQuery();
            insertSQL.Dispose();

            SqliteCommand readIdCommand = new SqliteCommand(sql_con)
            {
                Transaction = transaction
            };

            //From http://www.sliqtools.co.uk/blog/technical/sqlite-how-to-get-the-id-when-inserting-a-row-into-a-table/
            readIdCommand.CommandText = "select last_insert_rowid()";

            // The row ID is a 64-bit value - cast the Command result to an Int64.
            //
            var LastRowID64 = (Int64)readIdCommand.ExecuteScalar();
            readIdCommand.Dispose();

            // Then grab the bottom 32-bits as the unique ID of the row.
            //
            int LastRowID = (int)LastRowID64;
            //end of copied code.

            config.Id = LastRowID;                

            return config.Id;
        }

        protected void UpdateExistingMutationConfig(MutationConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            SqliteCommand insertSQL = new SqliteCommand(sql_con)
            {
                Transaction = transaction
            };

            insertSQL.CommandText = "UPDATE " + MUTATION_CONFIG_TABLE +
                        " SET mutations = ?, maxMutationLength = ?, genomeLength = ?, generationSize = ?, randomDefault = ?, defaultGenome = ?" +
                        " WHERE id = ?";

            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.Mutations));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MaxMutationLength));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.GenomeLength));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.GenerationSize));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Boolean, (object)config.UseCompletelyRandomDefaultGenome));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.DefaultGenome));

            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.Id));

            insertSQL.ExecuteNonQuery();
            insertSQL.Dispose();

            return;
        }

        protected void UpdateExistingMatchConfig(MatchConfig config, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            SqliteCommand insertSQL = new SqliteCommand(sql_con)
            {
                Transaction = transaction
            };

            insertSQL.CommandText = "UPDATE " + MATCH_CONFIG_TABLE +
                        " SET matchTimeout = ?, winnerPollPeriod = ?, initialRange = ?, initialSpeed = ?, randomInitialSpeed = ?, competitorsPerTeam = ?," +
                        " stepForwardProportion = ?, locationRandomisationRadiai = ?, randomiseRotation = ?, allowedModules = ?, budget = ?" +
                        " WHERE id = ?";

            insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.MatchTimeout));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.WinnerPollPeriod));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.InitialRange));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.InitialSpeed));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.RandomInitialSpeed));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.CompetitorsPerTeam));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.StepForwardProportion));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.LocationRandomisationRadiaiString));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Boolean, (object)config.RandomiseRotation));

            if (!string.IsNullOrEmpty(config.AllowedModulesString))
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.AllowedModulesString));
            else
                insertSQL.Parameters.Add(new SqliteParameter(DbType.String, DBNull.Value));

            if (config.Budget.HasValue)
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.Budget.Value));
            else
                insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, DBNull.Value));

            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.Id));

            insertSQL.ExecuteNonQuery();
            insertSQL.Dispose();

            return;
        }

        protected int SaveMutationConfig(MutationConfig config)
        {
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                IDbCommand dbcmd = null;
                SqliteTransaction transaction = null;
                try
                {
                    sql_con.Open(); //Open connection to the database.

                    transaction = sql_con.BeginTransaction();
                    
                    config.Id = SaveMutationConfig(config, sql_con, transaction);

                    transaction.Commit();
                }
                catch (Exception e)
                {
                    Debug.LogWarning("Caught exception: " + e + ", message: " + e.Message);
                    throw e;
                }
                finally
                {
                    Disconnect(null, transaction, dbcmd, sql_con);
                }
            }

            return config.Id;
        }

        protected int SaveMatchConfig(MatchConfig config)
        {
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                IDbCommand dbcmd = null;
                SqliteTransaction transaction = null;
                try
                {
                    sql_con.Open(); //Open connection to the database.

                    transaction = sql_con.BeginTransaction();
                    
                    config.Id = SaveMatchConfig(config, sql_con, transaction);

                    transaction.Commit();
                }
                catch (Exception e)
                {
                    Debug.LogWarning("Caught exception: " + e + ", message: " + e.Message);
                    throw e;
                }
                finally
                {
                    Disconnect(null, transaction, dbcmd, sql_con);
                }
            }

            return config.Id;
        }

        protected void Disconnect(IDataReader reader, SqliteTransaction transaction , IDbCommand dbcmd, SqliteConnection sql_con)
        {
            //Debug.Log("Disconnecting");
            if (reader != null)
                reader.Close();
            reader = null;

            if (transaction != null)
            {
                try
                {
                    transaction.Dispose();
                }
                catch (SqliteException e)
                {
                    Debug.LogWarning("Failed to dispose of transaction. Carrying on reguardless.");
                    Debug.LogWarning(e.Message);
                    Debug.LogWarning(e.StackTrace);
                }
            }
            transaction = null;

            if (dbcmd != null)
                dbcmd.Dispose();
            dbcmd = null;

            if (sql_con != null)
                sql_con.Close();
        }

        protected void SetCurrentGenerationNumber(string table, int databaseId, int generationNumber)
        {
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                sql_con.Open();
                SqliteCommand command = null;

                try
                {
                    //Debug.Log("Updating generation to " + config.GenerationNumber);
                    command = new SqliteCommand("UPDATE " + table + " SET currentGeneration = ? WHERE id = ?;", sql_con);
                    
                    command.Parameters.Add(new SqliteParameter(DbType.Int32, (object)generationNumber));
                    command.Parameters.Add(new SqliteParameter(DbType.Int32, (object)databaseId));

                    command.ExecuteNonQuery();
                }
                finally
                {
                    Disconnect(null, null, command, sql_con);
                }
            }
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
                    GetNullableString(reader,"species"),
                    GetNullableString(reader,"speciesVerbose"),
                    GetNullableString(reader,"subspecies"),
                    GetNullableString(reader,"subspeciesVerbose")
                );
        }

        private int? GetNullableInt(IDataReader reader, string name)
        {
            var ordinal = reader.GetOrdinal(name);
            if (reader.IsDBNull(ordinal))
            {
                return null;
            }
            return reader.GetInt32(ordinal);
        }

        private float? GetNullableFloat(IDataReader reader, string name)
        {
            var ordinal = reader.GetOrdinal(name);
            if (reader.IsDBNull(ordinal))
            {
                return null;
            }
            return reader.GetFloat(ordinal);
        }

        private string GetNullableString(IDataReader reader, string name)
        {
            var ordinal = reader.GetOrdinal(name);
            if (reader.IsDBNull(ordinal))
            {
                return null;
            }
            return reader.GetString(ordinal);
        }

        protected void SaveBaseIndividual(string runtype, BaseIndividual individual, int runId, int generationNumber, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            SqliteCommand insertSQL = new SqliteCommand("INSERT INTO BaseIndividual " +
                            "(runType, runConfigId, generation, genome, score, cost, modules, r,g,b, species, speciesVerbose, subspecies, subspeciesVerbose)" +
                            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", sql_con, transaction);

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

        protected void UpdateBaseIndividual(BaseIndividual individual, int runId, int generationNumber, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            SqliteCommand insertSQL = new SqliteCommand("UPDATE  BaseIndividual" +
                           " SET score = ?, cost = ?, modules = ?, r = ?, g = ?, b = ?, species = ?, speciesVerbose = ?, subspecies = ?, subspeciesVerbose = ?" +
                           " WHERE runConfigId = ? AND generation = ? AND genome = ?", sql_con, transaction);
            
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
}
