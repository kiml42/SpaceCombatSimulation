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
    public class EvolutionTargetShootingDatabaseHandler
    {
        private const string DEFAULT_COMMAND_PATH = "/Database/CreateBlankDatabase.sql";
        private const string DEFAULT_DB_PATH = "/tmp/SpaceCombatSimulationDB.s3db";
        private string _connectionString
        {
            get
            {
                var connection = "URI=file:" + Application.dataPath + _databasePath;
                //Debug.Log("connection string: " + connection);
                return connection;
            }
        }
        private  string _databasePath; //Path to database.

        public EvolutionTargetShootingDatabaseHandler(string databasePath = DEFAULT_DB_PATH, string dbCreationCommandPath = DEFAULT_COMMAND_PATH)
        {
            //Debug.Log("EvolutionTargetShootingDatabaseHandler constructor");

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
                    sql_con.Open(); //Open connection to the database.
                    dbcmd = sql_con.CreateCommand();
                    string sqlQuery = "SELECT *" +
                        " FROM DroneEvolutionConfig" +
                        " LEFT JOIN MatchConfig on MatchConfig.id = DroneEvolutionConfig.matchConfigId" +
                        " LEFT JOIN MutationConfig on MutationConfig.id = DroneEvolutionConfig.mutationConfigId" +
                        " WHERE DroneEvolutionConfig.id = " + id + ";";
                    //Debug.Log(sqlQuery);
                    dbcmd.CommandText = sqlQuery;
                    reader = dbcmd.ExecuteReader();
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

                    //Debug.Log("matchConfigId ordinal: " + reader.GetOrdinal("MatchConfig.Id"));  //-1
                    config.MatchConfig.Id = reader.GetInt32(12);
                    config.MatchConfig.MatchTimeout = reader.GetFloat(reader.GetOrdinal("matchTimeout")); //16
                    config.MatchConfig.WinnerPollPeriod = reader.GetFloat(reader.GetOrdinal("winnerPollPeriod")); //17

                    config.MutationConfig.Id = reader.GetInt32(13);
                    config.MutationConfig.Mutations = reader.GetInt32(reader.GetOrdinal("mutations"));    //19
                    config.MutationConfig.AllowedCharacters = reader.GetString(reader.GetOrdinal("allowedCharacters"));   //20
                    config.MutationConfig.MaxMutationLength = reader.GetInt32(reader.GetOrdinal("maxMutationLength"));   //21
                    config.MutationConfig.GenomeLength = reader.GetInt32(reader.GetOrdinal("genomeLength")); //22
                    config.MutationConfig.GenerationSize = reader.GetInt32(reader.GetOrdinal("generationSize"));   //23
                    config.MutationConfig.UseCompletelyRandomDefaultGenome = reader.GetBoolean(reader.GetOrdinal("randomDefault"));  //24
                    config.MutationConfig.DefaultGenome = reader.GetString(reader.GetOrdinal("defaultGenome"));   //25
                }
                catch (Exception e)
                {
                    Debug.LogWarning("Caught exception: " + e + ", message: " + e.Message);
                    throw e;
                }
                finally
                {
                    //Debug.Log("Disconnecting");
                    if (reader != null)
                        reader.Close();
                    reader = null;
                    if (dbcmd != null)
                        dbcmd.Dispose();
                    dbcmd = null;
                    if (sql_con != null)
                        sql_con.Close();
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
                    sql_con.Open(); //Open connection to the database.
                    dbcmd = sql_con.CreateCommand();
                    string sqlQuery = "SELECT *" +
                        " FROM DroneShootingIndividual" +
                        " WHERE runConfigId = " + runId + " AND generation = " + generationNumber +
                        ";";
                    //Debug.Log(sqlQuery);
                    dbcmd.CommandText = sqlQuery;
                    reader = dbcmd.ExecuteReader();
                    
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
                    //Debug.Log("Disconnecting");
                    if (reader != null)
                        reader.Close();
                    reader = null;
                    if (dbcmd != null)
                        dbcmd.Dispose();
                    dbcmd = null;
                    if (sql_con != null)
                        sql_con.Close();
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
                    //Debug.Log("Disconnecting");
                    if (transaction != null)
                        transaction.Dispose();
                    transaction = null;
                    if (dbcmd != null)
                        dbcmd.Dispose();
                    dbcmd = null;
                    if (sql_con != null)
                        sql_con.Close();
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
                    //Debug.Log("Disconnecting");
                    if (transaction != null)
                        transaction.Dispose();
                    transaction = null;
                    if (dbcmd != null)
                        dbcmd.Dispose();
                    dbcmd = null;
                    if (sql_con != null)
                        sql_con.Close();
                }
            }
        }

        //YAGNI: might be useful in future
        //public void UpdateIndividual(IndividualTargetShooting individual, int runId, int generationNumber)
        //{
        //    using (var sql_con = new SqliteConnection(_connectionString))
        //    {
        //        IDbCommand dbcmd = null;
        //        try
        //        {
        //            sql_con.Open(); //Open connection to the database.
                                        
        //            UpdateIndividual(individual, runId, generationNumber, sql_con, null);
        //        }
        //        catch (Exception e)
        //        {
        //            Debug.LogWarning("Caught exception: " + e + ", message: " + e.Message);
        //            throw e;
        //        }
        //        finally
        //        {
        //            //Debug.Log("Disconnecting");
        //            if (dbcmd != null)
        //                dbcmd.Dispose();
        //            dbcmd = null;
        //            if (sql_con != null)
        //                sql_con.Close();
        //        }
        //    }
        //}

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
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                sql_con.Open();
                SqliteCommand command = null;

                try
                {
                    //Debug.Log("Updating generation to " + config.GenerationNumber);
                    command = new SqliteCommand("UPDATE DroneEvolutionConfig SET currentGeneration = ? WHERE id = ?;", sql_con);

                    command.Parameters.Add(new SqliteParameter(DbType.Int32, (object)generationNumber));
                    command.Parameters.Add(new SqliteParameter(DbType.Int32, (object)databaseId));

                    command.ExecuteNonQuery();
                }
                finally
                {
                    if (command != null)
                        command.Dispose();
                    if (sql_con != null)
                        sql_con.Close();

                }
            }
        }

        public void SaveConfig()
        {
            throw new NotImplementedException();
            //using (var sql_con = new SqliteConnection(_connectionString))
            //{
            //    sql_con.Open();
            //    try
            //    {
            //        SaveMatchConfig(config.MatchControl, sql_con);
            //        SaveMutationConfig(config.MutationControl, sql_con);

            //        SaveEvolutionControlerConfig(sql_con);
            //    }
            //    finally
            //    {
            //        if (sql_con != null)
            //            sql_con.Close();
            //    }
            //}
        }

        private int? SaveMatchConfig(EvolutionMatchController matchConfig, SqliteConnection sql_con)
        {
            throw new NotImplementedException();
            //if (matchConfig.Id.HasValue)
            //{
            //    Debug.LogWarning("Updating existing MatchConfig not implemented, Id: " + matchConfig.Id.Value);
            //}
            //else
            //{
            //    string sqlQuery = "SELECT id" +
            //    " FROM MatchConfig;";

            //    var dbcmd = sql_con.CreateCommand();
            //    dbcmd.CommandText = sqlQuery;
            //    var reader = dbcmd.ExecuteReader();

            //    var ids = new List<int>();
            //    while (reader.Read())
            //    {
            //        ids.Add(reader.GetInt32(0));
            //    }
            //    var maxId = ids.Max();
            //    var newId = maxId + 1;

            //    matchConfig.Id = newId;

            //    SqliteCommand insertSQL = new SqliteCommand("INSERT INTO MatchConfig (id, matchTimeout, winnerPollPeriod) VALUES (?,?,?)", sql_con);

            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)matchConfig.Id));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)matchConfig.MatchTimeout));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)matchConfig.WinnerPollPeriod));

            //    insertSQL.ExecuteNonQuery();
            //}
            //return matchConfig.Id;
        }

        private int? SaveMutationConfig(EvolutionMutationController mutationConfig, SqliteConnection sql_con)
        {
            throw new NotImplementedException();
            //if (mutationConfig.Id.HasValue)
            //{
            //    Debug.LogWarning("Updating existing MutationConfig not implemented, Id: " + mutationConfig.Id.Value);
            //}
            //else
            //{
            //    sql_con = new SqliteConnection(_connectionString);
            //    sql_con.Open(); //Open connection to the database.

            //    string sqlQuery = "SELECT id" +
            //    " FROM MutationConfig;";

            //    var dbcmd = sql_con.CreateCommand();
            //    dbcmd.CommandText = sqlQuery;
            //    var reader = dbcmd.ExecuteReader();

            //    var ids = new List<int>();
            //    while (reader.Read())
            //    {
            //        ids.Add(reader.GetInt32(0));
            //    }
            //    var maxId = ids.Max();
            //    var newId = maxId + 1;
            //    mutationConfig.Id = newId;

            //    SqliteCommand insertSQL = new SqliteCommand("INSERT INTO MutationConfig (" +
            //        "id, mutations, allowedCharacters, maxMutationLength" +
            //        ", genomeLength, generationSize, randomDefault, defaultGenome) VALUES (?,?,?,?,?,?,?,?)", sql_con);

            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)mutationConfig.Id.Value));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)mutationConfig.Mutations));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)mutationConfig.AllowedCharacters));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)mutationConfig.MaxMutationLength));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)mutationConfig.GenomeLength));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)mutationConfig.GenerationSize));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Boolean, (object)mutationConfig.UseCompletelyRandomDefaultGenome));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)mutationConfig.DefaultGenome));

            //    insertSQL.ExecuteNonQuery();

            //}
            //return mutationConfig.Id;
        }

        private void SaveEvolutionControlerConfig(SqliteConnection sql_con)
        {
            throw new NotImplementedException();
            //if (config.ReadFromDatabase)
            //{
            //    //If it's set to be read from the database, it must already exist in the database, so update the existing one.
            //    Debug.LogWarning("Updating existing DroneEvolutionConfig not implemented, Id: " + config.DatabaseId);
            //}
            //else
            //{
            //    SqliteCommand insertSQL = new SqliteCommand("INSERT INTO DroneEvolutionConfig (name , currentGeneration , minMatchesPerIndividual" +
            //        ", winnersCount , minDrones , droneEscalation , maxDrones , killScoreMultiplier, flatKillBonus, completionBonus " +
            //        ", deathPenalty, droneList, matchConfigId, mutationConfigId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", sql_con);

            //    //insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.Id.Value));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.RunName));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.GenerationNumber));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MinMatchesPerIndividual));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.WinnersFromEachGeneration));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MinDronesToSpawn));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.ExtraDroneEveryXGenerations));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MaxDronesToSpawn));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.KillScoreMultiplier));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.FlatKillBonus));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.CompletionBonus));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)config.DeathPenalty));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)config.DronesString));

            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MatchControl.Id));
            //    insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)config.MutationControl.Id));

            //    insertSQL.ExecuteNonQuery();
            //}
        }
    }
}
