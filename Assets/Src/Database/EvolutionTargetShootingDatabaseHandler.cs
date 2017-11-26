using Mono.Data.Sqlite;
using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Database
{
    public class EvolutionTargetShootingDatabaseHandler
    {
        private EvolutionTargetShootingControler _toConfigure;
        private string _connectionString = "URI=file:" + Application.dataPath + "/SpaceCombatSimulationDB.s3db"; //Path to database.

        public EvolutionTargetShootingDatabaseHandler(EvolutionTargetShootingControler toConfigure)
        {
            _toConfigure = toConfigure;
        }


        public void ReadDroneConfig(int id)
        {
            IDbConnection dbconn = null;
            IDbCommand dbcmd = null;
            IDataReader reader = null;
            try
            {
                dbconn = (IDbConnection)new SqliteConnection(_connectionString);
                dbconn.Open(); //Open connection to the database.
                dbcmd = dbconn.CreateCommand();
                //string sqlQuery = "SELECT DroneEvolutionConfig.id,name,currentGeneration,minMatchesPerIndividual,winnersCount,minDrones,droneEscalation,maxDrones," +
                //    "killScoreMultiplier,flatKillBonus,completionBonus,deathPenalty,droneList," +
                //    "MatchConfig.id,matchTimeout,winnerPollPeriod," +
                //    "MutationConfig.id,mutations,allowedCharacters,maxMuatationLength,genomeLength,generationSize,randomDefault,defaultGenome" +
                //    " FROM DroneEvolutionConfig" +
                //    " LEFT JOIN MatchConfig on MatchConfig.id = DroneEvolutionConfig.matchConfigId;" +
                //    " LEFT JOIN MutationConfig on MutationConfig.id = DroneEvolutionConfig.mutationConfigId;" +
                //    " WHERE DroneEvolutionConfig.id =" + id;
                string sqlQuery = "SELECT *" +
                    " FROM DroneEvolutionConfig" +
                    " LEFT JOIN MatchConfig on MatchConfig.id = DroneEvolutionConfig.matchConfigId" +
                    " LEFT JOIN MutationConfig on MutationConfig.id = DroneEvolutionConfig.mutationConfigId;" +
                    " WHERE DroneEvolutionConfig.id =" + id;
                dbcmd.CommandText = sqlQuery;
                reader = dbcmd.ExecuteReader();
                reader.Read();

                //Debug.Log("DroneEvolutionConfig.id ordinal: " + reader.GetOrdinal("id"));
                var readId = reader.GetInt32(0);
                var name = reader.GetString(reader.GetOrdinal("name")); //1
                var currentGeneration = reader.GetInt32(reader.GetOrdinal("currentGeneration"));
                var minMatchesPerIndividual = reader.GetInt32(reader.GetOrdinal("minMatchesPerIndividual"));
                var winnersCount = reader.GetInt32(reader.GetOrdinal("winnersCount"));
                var minDrones = reader.GetInt32(reader.GetOrdinal("minDrones"));
                var droneEscalation = reader.GetFloat(reader.GetOrdinal("droneEscalation"));
                var maxDrones = reader.GetInt32(reader.GetOrdinal("maxDrones"));
                var killScoreMultiplier = reader.GetFloat(reader.GetOrdinal("killScoreMultiplier"));
                var flatKillBonus = reader.GetFloat(reader.GetOrdinal("flatKillBonus"));
                var completionBonus = reader.GetFloat(reader.GetOrdinal("completionBonus"));
                var deathPenalty = reader.GetFloat(reader.GetOrdinal("deathPenalty"));  //11
                var droneList = reader.GetString(reader.GetOrdinal("droneList"));   //14


                //Debug.Log("matchConfigId ordinal: " + reader.GetOrdinal("MatchConfig.Id"));  //-1
                var matchConfigId = reader.GetInt32(12);
                var matchTimeout = reader.GetFloat(reader.GetOrdinal("matchTimeout")); //16
                var winnerPollPeriod = reader.GetFloat(reader.GetOrdinal("winnerPollPeriod")); //17

                var mutationConfigId = reader.GetInt32(13);
                var mutations = reader.GetInt32(reader.GetOrdinal("mutations"));    //19
                var allowedCharacters = reader.GetString(reader.GetOrdinal("allowedCharacters"));   //20
                var maxMuatationLength = reader.GetInt32(reader.GetOrdinal("maxMuatationLength"));   //21
                var genomeLength = reader.GetInt32(reader.GetOrdinal("genomeLength")); //22
                var generationSize = reader.GetInt32(reader.GetOrdinal("generationSize"));   //23
                var randomDefault = reader.GetBoolean(reader.GetOrdinal("randomDefault"));  //24
                var defaultGenome = reader.GetString(reader.GetOrdinal("defaultGenome"));   //25


                Debug.Log(
                    "id= " + readId +
                    ", name= " + name +
                    ", currentGeneration= " + currentGeneration +
                    ", minMatchesPerIndividual= " + minMatchesPerIndividual +
                    ", winnersCount= " + winnersCount +
                    ", minDrones= " + minDrones +
                    ", droneEscalation= " + droneEscalation +
                    ", maxDrones= " + maxDrones +
                    ", killScoreMultiplier= " + killScoreMultiplier +
                    ", flatKillBonus= " + flatKillBonus +
                    ", completionBonus " + completionBonus +
                    ", deathPenalty " + deathPenalty +
                    ", droneList " + droneList +

                    ", mutationConfigId " + mutationConfigId +
                    ", matchTimeout " + matchTimeout +
                    ", winnerPollPeriod " + winnerPollPeriod +

                    ", mutationConfigId " + mutationConfigId +
                    ", mutations " + mutations +
                    ", maxMuatationLength " + maxMuatationLength +
                    ", genomeLength " + genomeLength +
                    ", generationSize " + generationSize +
                    ", randomDefault " + randomDefault +
                    ", defaultGenome " + defaultGenome
                    );
            }
            finally
            {
                Debug.Log("Disconnecting");
                if (reader != null)
                    reader.Close();
                reader = null;
                if (dbcmd != null)
                    dbcmd.Dispose();
                dbcmd = null;
                if (dbconn != null)
                    dbconn.Close();
                dbconn = null;
            }
        }

        public void SaveConfig()
        {
            SaveMatchConfig(_toConfigure.MatchControl);
            SaveMutationConfig(_toConfigure.MutationControl);

            SaveEvolutionControlerConfig();
        }

        private void SaveMatchConfig(EvolutionMatchController matchConfig)
        {
            if (matchConfig.Id.HasValue)
            {
                Debug.LogError("Updating existing not implemented");
            }
            else
            {
                SqliteConnection sql_con = null;
                try
                {
                    sql_con = new SqliteConnection(_connectionString);
                    sql_con.Open();
                    SqliteCommand insertSQL = new SqliteCommand("INSERT INTO MatchConfig (matchTimeout, winnerPollPeriod) VALUES (12,2)", sql_con);

                    //TODO remove cast to int when the database is fixed.
                    //insertSQL.Parameters.Add((int)matchConfig.MatchTimeout);
                    //insertSQL.Parameters.Add(matchConfig.WinnerPollPeriod);

                    insertSQL.ExecuteNonQuery();
                }
                finally
                {
                    if (sql_con != null)
                        sql_con.Close();
                    sql_con = null;
                }

            }
        }

        private void SaveMutationConfig(EvolutionMutationController mutationConfig)
        {
            if (mutationConfig.Id.HasValue)
            {
                Debug.LogError("Updating existing not implemented");
            }
            else
            {
                SqliteConnection sql_con = null;
                try
                {
                    sql_con = new SqliteConnection(_connectionString);
                    SqliteCommand insertSQL = new SqliteCommand("INSERT INTO MutationConfig (mutations, maxMuatationLength" +
                        ", genomeLength, generationSize, randomDefault, defaultGenome) VALUES (?,?,?,?,?,?)", sql_con);

                    insertSQL.Parameters.Add(mutationConfig.Mutations);
                    insertSQL.Parameters.Add(mutationConfig.MaxMutationLength);
                    insertSQL.Parameters.Add(mutationConfig.GenomeLength);
                    insertSQL.Parameters.Add(mutationConfig.GenerationSize);
                    insertSQL.Parameters.Add(mutationConfig.UseCompletelyRandomDefaultGenome);
                    insertSQL.Parameters.Add(mutationConfig.DefaultGenome);

                    insertSQL.ExecuteNonQuery();
                }
                finally
                {
                    if (sql_con != null)
                        sql_con.Close();
                    sql_con = null;
                }
            }
        }

        private void SaveEvolutionControlerConfig()
        {
            if (_toConfigure.Id.HasValue)
            {
                Debug.LogError("Updating existing not implemented");
            }
            else
            {
                SqliteConnection sql_con = null;
                try
                {
                    sql_con = new SqliteConnection(_connectionString);
                    SqliteCommand insertSQL = new SqliteCommand("INSERT INTO DroneEvolutionConfig (name , currentGeneration , minMatchesPerIndividual" +
                        ", winnersCount , minDrones , droneEscalation , maxDrones , killScoreMultiplier, flatKillBonus, completionBonus " +
                        ", deathPenalty, droneList, matchConfigId, mutationConfigId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", sql_con);

                    insertSQL.Parameters.Add(_toConfigure.Name);
                    insertSQL.Parameters.Add(_toConfigure.GenerationNumber);
                    insertSQL.Parameters.Add(_toConfigure.MinMatchesPerIndividual);
                    insertSQL.Parameters.Add(_toConfigure.WinnersFromEachGeneration);
                    insertSQL.Parameters.Add(_toConfigure.MinDronesToSpawn);
                    insertSQL.Parameters.Add(_toConfigure.ExtraDroneEveryXGenerations);
                    insertSQL.Parameters.Add(_toConfigure.MaxDronesToSpawn);
                    insertSQL.Parameters.Add(_toConfigure.KillScoreMultiplier);
                    insertSQL.Parameters.Add(_toConfigure.FlatKillBonus);
                    insertSQL.Parameters.Add(_toConfigure.CompletionBonus);
                    insertSQL.Parameters.Add(_toConfigure.DeathPenalty);
                    insertSQL.Parameters.Add(_toConfigure.DronesString);

                    insertSQL.Parameters.Add(_toConfigure.MatchControl.Id);
                    insertSQL.Parameters.Add(_toConfigure.MutationControl.Id);

                    insertSQL.ExecuteNonQuery();
                }
                finally
                {
                    if (sql_con != null)
                        sql_con.Close();
                    sql_con = null;
                }
            }
        }
    }
}
