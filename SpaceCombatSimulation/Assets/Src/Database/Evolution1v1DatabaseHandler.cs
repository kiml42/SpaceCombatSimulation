using Mono.Data.Sqlite;
using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Text;
using UnityEngine;
using Assets.src.Evolution;
using Assets.Src.Evolution;

namespace Assets.Src.Database
{
    public class Evolution1v1DatabaseHandler : GeneralDatabaseHandler
    {
        private const string CONFIG_TABLE = "EvolutionConfig1v1";
        private const string INDIVIDUAL_TABLE = "Individual1v1";
        protected override string RUN_TYPE_NAME { get { return "1v1"; } }

        public Evolution1v1DatabaseHandler(string databasePath, string dbCreationCommandPath):base(databasePath, dbCreationCommandPath)
        {
        }

        public Evolution1v1DatabaseHandler(string databasePath) : base(databasePath)
        {
        }

        public Evolution1v1DatabaseHandler() : base()
        {
        }

        public override Dictionary<int, string> ListConfigs()
        {
            return ListConfigs(CONFIG_TABLE);
        }

        public Evolution1v1Config ReadConfig(int id)
        {
            var config = new Evolution1v1Config();

            //Debug.Log("Reading config from DB. Id: " + id);
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                using (var reader = OpenReaderWithCommand(sql_con, CreateReadConfigQuery(CONFIG_TABLE, id)))
                {
                    if (reader.Read())
                    {
                        //Debug.Log("EvolutionConfig1v1.id ordinal: " + reader.GetOrdinal("id"));
                        config.DatabaseId = reader.GetInt32(reader.GetOrdinal("id"));

                        //Debug.Log("suddenDeathReloadTime ordinal: " + reader.GetOrdinal("suddenDeathReloadTime"));
                        //Debug.Log("suddenDeathReloadTime value: " + reader.GetDecimal(reader.GetOrdinal("suddenDeathReloadTime")));

                        //Debug.Log("matchConfigId ordinal: " + reader.GetOrdinal("matchConfigId"));
                        //Debug.Log("matchConfigId value: " + reader.GetDecimal(reader.GetOrdinal("matchConfigId")));

                        config.RunName = reader.GetString(reader.GetOrdinal("name")); //1
                        config.GenerationNumber = reader.GetInt32(reader.GetOrdinal("currentGeneration"));
                        config.MinMatchesPerIndividual = reader.GetInt32(reader.GetOrdinal("minMatchesPerIndividual"));
                        config.WinnersFromEachGeneration = reader.GetInt32(reader.GetOrdinal("winnersCount"));
                        config.SuddenDeathDamage = reader.GetFloat(reader.GetOrdinal("suddenDeathDamage"));
                        config.SuddenDeathReloadTime = reader.GetFloat(reader.GetOrdinal("suddenDeathReloadTime"));

                        config.MatchConfig = ReadMatchConfig(reader);
                        config.MutationConfig = ReadMutationConfig(reader);
                    }
                    else
                    {
                        throw new Exception("Config not found for ID " + id);
                    }
                }
                return config;
            }
        }

        public int UpdateExistingConfig(Evolution1v1Config config)
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
                            " SET suddenDeathDamage = ?, suddenDeathReloadTime = ?" +
                            " WHERE id = ?";

                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.SuddenDeathDamage));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.SuddenDeathReloadTime));

                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.DatabaseId));

                        insertSQL.ExecuteNonQuery();
                    }
                    transaction.Commit();
                }
            }
            return config.DatabaseId;
        }

        public int SaveNewConfig(Evolution1v1Config config)
        {
            using (var connection = new SqliteConnection(_connectionString))
            {
                connection.Open(); //Open connection to the database.

                using (var transaction = connection.BeginTransaction())
                {
                    SaveBaseEvolutionConfig(config, connection, transaction);

                    using(var insertSQL = new SqliteCommand(connection)
                    {
                        Transaction = transaction
                    })
                    {
                        insertSQL.CommandText = "INSERT INTO " + CONFIG_TABLE +
                            "(id, suddenDeathDamage, suddenDeathReloadTime)" +
                            " VALUES (?,?,?)";

                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.DatabaseId));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.SuddenDeathDamage));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.SuddenDeathReloadTime));

                        insertSQL.ExecuteNonQuery();
                    }
                    
                    transaction.Commit();
                }
            }

            return config.DatabaseId;
        }

        public Generation1v1 ReadGeneration(int runId, int generationNumber)
        {
            //Debug.Log("Reading generation from DB. runId: " + runId + ", generation Number: " + generationNumber);
            var generation = new Generation1v1();
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                using (var reader = OpenReaderWithCommand(sql_con, CreateReadIndividualsQuery(INDIVIDUAL_TABLE, runId, generationNumber)))
                {
                    while (reader.Read())
                    {
                        //Debug.Log("wins ordinal: " + reader.GetOrdinal("wins"));

                        var individual = new Individual1v1(ReadSpeciesSummary(reader))
                        {
                            Score = reader.GetFloat(reader.GetOrdinal("score")),
                            Wins = reader.GetInt32(reader.GetOrdinal("wins")),
                            Loses = reader.GetInt32(reader.GetOrdinal("loses")),
                            Draws = reader.GetInt32(reader.GetOrdinal("draws")),
                            PreviousCombatantsString = reader.GetString(reader.GetOrdinal("previousCombatants"))
                        };

                        generation.Individuals.Add(individual);
                    }
                }
            }

            return generation;
        }
        
        public void SaveNewGeneration(Generation1v1 generation, int runId, int generationNumber)
        {
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                sql_con.Open(); //Open connection to the database.

                using (var transaction = sql_con.BeginTransaction())
                {
                    foreach (var individual in generation.Individuals)
                    {
                        SaveBaseIndividual(RUN_TYPE_NAME, individual, runId, generationNumber, sql_con, transaction);

                        using (var insertSQL = new SqliteCommand("INSERT INTO Individual1v1 " +
                            "(runConfigId, generation, genome, wins, draws, loses, previousCombatants)" +
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

        public void UpdateGeneration(Generation1v1 generation, int runId, int generationNumber)
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
        
        private void UpdateIndividual(Individual1v1 individual, int runId, int generationNumber, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            UpdateBaseIndividual(individual, runId, generationNumber, sql_con, transaction);

            using (var insertSQL = new SqliteCommand("UPDATE  Individual1v1" +
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
    }
}
