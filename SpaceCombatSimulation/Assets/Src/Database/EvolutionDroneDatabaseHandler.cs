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
    public class EvolutionDroneDatabaseHandler : GeneralDatabaseHandler
    {
        protected override string CONFIG_TABLE { get { return "DroneEvolutionConfig"; } }
        protected override string INDIVIDUAL_TABLE { get { return "DroneIndividual";} }

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
                    
                    config.MatchConfig = ReadMatchConfig(reader);
                    config.MutationConfig = ReadMutationConfig(reader);

                    return config;
                }
            }
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
                            " droneEscalation = ?, maxDrones = ?, killScoreMultiplier = ?, flatKillBonus = ?, completionBonus = ?, deathPenalty = ?, droneList = ?" +
                            " WHERE id = ?";

                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MinDronesToSpawn));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.ExtraDromnesPerGeneration));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MaxDronesToSpawn));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.KillScoreMultiplier));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.FlatKillBonus));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.CompletionBonus));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.DeathPenalty));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.DronesString));

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
                            "(id, minDrones, droneEscalation, maxDrones, killScoreMultiplier, flatKillBonus, completionBonus, deathPenalty, droneList)" +
                            " VALUES (?,?,?,?,?,?,?,?,?)";

                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.DatabaseId));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MinDronesToSpawn));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.ExtraDromnesPerGeneration));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MaxDronesToSpawn));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.KillScoreMultiplier));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.FlatKillBonus));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.CompletionBonus));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.DeathPenalty));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.DronesString));

                        insertSQL.ExecuteNonQuery();
                        insertSQL.Dispose();
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
    }
}
