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

        public Evolution1v1DatabaseHandler(string databasePath, string dbCreationCommandPath):base(databasePath, dbCreationCommandPath)
        {
        }

        public Evolution1v1DatabaseHandler(string databasePath) : base(databasePath)
        {
        }

        public Evolution1v1DatabaseHandler() : base()
        {
        }

        public Evolution1v1Config ReadConfig(int id)
        {
            var config = new Evolution1v1Config();

            //Debug.Log("Reading config from DB. Id: " + id);
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                IDbCommand dbcmd = null;
                IDataReader reader = null;
                try
                {
                    reader = OpenReaderWithCommant(sql_con, CreateReadConfigQuery(CONFIG_TABLE, id), out dbcmd);
                    
                    reader.Read();
                    
                    //Debug.Log("EvolutionConfig1v1.id ordinal: " + reader.GetOrdinal("id"));
                    config.DatabaseId = reader.GetInt32(reader.GetOrdinal("id"));

                    //Debug.Log("name ordinal: " + reader.GetOrdinal("name"));
                    config.RunName = reader.GetString(reader.GetOrdinal("name")); //1
                    config.GenerationNumber = reader.GetInt32(reader.GetOrdinal("currentGeneration"));
                    config.MinMatchesPerIndividual = reader.GetInt32(reader.GetOrdinal("minMatchesPerIndividual"));
                    config.WinnersFromEachGeneration = reader.GetInt32(reader.GetOrdinal("winnersCount"));
                    config.SuddenDeathDamage = reader.GetFloat(reader.GetOrdinal("suddenDeathDamage"));
                    config.SuddenDeathReloadTime = reader.GetFloat(reader.GetOrdinal("suddenDeathReloadTime"));

                    config.MatchConfig = ReadMatchConfig(reader, 7);//TODO check index
                    config.MutationConfig = ReadMutationConfig(reader, 8);//TODO check index
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
                return config;
            }
        }

        public Generation1v1 ReadGeneration(int runId, int generationNumber)
        {
            //Debug.Log("Reading generation from DB. runId: " + runId + ", generation Number: " + generationNumber);
            var generation = new Generation1v1();
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

                        //Debug.Log("wins ordinal: " + reader.GetOrdinal("wins"));  //-1

                        var individual = new Individual1v1(genome)
                        {
                            Score = reader.GetFloat(reader.GetOrdinal("score")),
                            Wins = reader.GetInt32(reader.GetOrdinal("wins")),
                            Loses = reader.GetInt32(reader.GetOrdinal("loses")),
                            Draws = reader.GetInt32(reader.GetOrdinal("draws")),
                            PreviousCombatantsString = reader.GetString(reader.GetOrdinal("previousCombatants")),
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

        public void SaveNewGeneration(Generation1v1 generation, int runId, int generationNumber)
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
                        SqliteCommand insertSQL = new SqliteCommand("INSERT INTO Individual1v1 " +
                            "(runConfigId, generation, genome, score, wins, draws, loses, previousCombatants)" +
                            " VALUES (?,?,?,?,?,?,?,?)", sql_con, transaction);

                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)runId));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)generationNumber));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.Genome));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)individual.Score));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.Wins));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.Draws));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.Loses));
                        insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.PreviousCombatantsString));

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

        public void UpdateGeneration(Generation1v1 generation, int runId, int generationNumber)
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
        
        private void UpdateIndividual(Individual1v1 individual, int runId, int generationNumber, SqliteConnection sql_con, SqliteTransaction transaction)
        {
            SqliteCommand insertSQL = new SqliteCommand("UPDATE  Individual1v1 " +
                            "SET score = ?, wins = ?, draws = ?, loses = ?, previousCombatants = ?" +
                            " WHERE runConfigId = ? AND generation = ? AND genome = ?", sql_con, transaction);

            insertSQL.Parameters.Add(new SqliteParameter(DbType.Decimal, (object)individual.Score));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.Wins));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.Draws));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.Int32, (object)individual.Loses));
            insertSQL.Parameters.Add(new SqliteParameter(DbType.String, (object)individual.PreviousCombatantsString));

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
