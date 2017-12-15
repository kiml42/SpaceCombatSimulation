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
    public class EvolutionTargetShootingDatabaseHandler : GeneralDatabaseHandler
    {
        private const string CONFIG_TABLE = "DroneEvolutionConfig";
        private const string INDIVIDUAL_TABLE = "DroneShootingIndividual";

        public EvolutionTargetShootingDatabaseHandler(string databasePath, string dbCreationCommandPath):base(databasePath, dbCreationCommandPath)
        {
        }

        public EvolutionTargetShootingDatabaseHandler(string databasePath) : base(databasePath)
        {
        }

        public EvolutionTargetShootingDatabaseHandler() : base()
        {
        }

        public EvolutionTargetShootingConfig ReadConfig(int id)
        {
            var config = new EvolutionTargetShootingConfig();

            //Debug.Log("Reading config from DB. Id: " + id);
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                IDbCommand dbcmd = null;
                IDataReader reader = null;
                try
                {
                    reader = OpenReaderWithCommant(sql_con, CreateReadConfigQuery(CONFIG_TABLE, id), out dbcmd);

                    reader.Read();

                    //Debug.Log("DroneEvolutionConfig.id ordinal: " + reader.GetOrdinal("id"));
                    config.DatabaseId = reader.GetInt32(reader.GetOrdinal("id"));

                    //Debug.Log("name ordinal: " + reader.GetOrdinal("name"));
                    config.RunName = reader.GetString(reader.GetOrdinal("name")); //1
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
                    config.DeathPenalty = reader.GetFloat(reader.GetOrdinal("deathPenalty"));  //11
                    config.DronesString = reader.GetString(reader.GetOrdinal("droneList"));   //14


                    config.MatchConfig = ReadMatchConfig(reader, 12);//TODO check index
                    config.MutationConfig = ReadMutationConfig(reader, 13);//TODO check index
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
            return config;
        }

        public GenerationTargetShooting ReadGeneration(int runId, int generationNumber)
        {
            //Debug.Log("Reading generation from DB. runId: " + runId + ", generation Number: " + generationNumber);
            var generation = new GenerationTargetShooting();
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                IDbCommand dbcmd = null;
                IDataReader reader = null;
                try
                {
                    reader = OpenReaderWithCommant(sql_con, CreateReadIndividualsQuery(INDIVIDUAL_TABLE, runId, generationNumber), out dbcmd);

                    while (reader.Read())
                    {
                        //Debug.Log("genome ordinal: " + reader.GetOrdinal("genome"));  //-1
                        var genome = reader.GetString(reader.GetOrdinal("genome"));
                        var individual = new IndividualTargetShooting(genome)
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

            return generation;
        }

        public void SaveNewGeneration(GenerationTargetShooting generation, int runId, int generationNumber)
        {
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                IDbCommand dbcmd = null;
                SqliteTransaction transaction = null;
                try
                {
                    sql_con.Open(); //Open connection to the database.

                    transaction = sql_con.BeginTransaction();
                    
                    foreach (var individual in generation.Individuals)
                    {
                        SqliteCommand insertSQL = new SqliteCommand("INSERT INTO DroneShootingIndividual " +
                            "(runConfigId, generation, genome, score, matchesPlayed, matchesSurvived, completeKills, totalKills, matchScores)" +
                            " VALUES (?,?,?,?,?,?,?,?,?)", sql_con, transaction);

                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)runId));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)generationNumber));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Genome));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)individual.Score));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.MatchesPlayed));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.MatchesSurvived));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.CompleteKills));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.TotalKills));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.MatchScoresString));

                        //todo check if this is nessersary/how to use transactions correctly.
                        insertSQL.Transaction = transaction;

                        insertSQL.ExecuteNonQuery();
                    }

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
        }

        public void UpdateGeneration(GenerationTargetShooting generation, int runId, int generationNumber)
        {
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                IDbCommand dbcmd = null;
                SqliteTransaction transaction = null;
                try
                {
                    sql_con.Open(); //Open connection to the database.

                    transaction = sql_con.BeginTransaction();

                    foreach (var individual in generation.Individuals)
                    {
                        UpdateIndividual(individual, runId, generationNumber, sql_con, transaction);
                    }

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
        }
        
        private void UpdateIndividual(IndividualTargetShooting individual, int runId, int generationNumber, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            SqliteCommand insertSQL = new SqliteCommand("UPDATE  DroneShootingIndividual " +
                            "SET score = ?, matchesPlayed = ?, matchesSurvived = ?, completeKills = ?, totalKills = ?, matchScores = ?" +
                            " WHERE runConfigId = ? AND generation = ? AND genome = ?", sql_con, transaction);

            insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)individual.Score));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.MatchesPlayed));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.MatchesSurvived));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.CompleteKills));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.TotalKills));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.MatchScoresString));

            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)runId));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)generationNumber));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Genome));

            //todo check if this is nessersary/how to use transactions correctly.
            insertSQL.Transaction = transaction;

            insertSQL.ExecuteNonQuery();
        }

        public void SetCurrentGenerationNumber(int databaseId, int generationNumber)
        {
            SetCurrentGenerationNumber(CONFIG_TABLE, databaseId, generationNumber);
        }
    }
}
