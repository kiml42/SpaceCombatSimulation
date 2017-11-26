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

        public EvolutionTargetShootingDatabaseHandler(EvolutionTargetShootingControler toConfigure)
        {
            _toConfigure = toConfigure;
        }


        public void ReadDroneConfig(int id)
        {
            string conn = "URI=file:" + Application.dataPath + "/SpaceCombatSimulationDB.s3db"; //Path to database.
            IDbConnection dbconn;
            dbconn = (IDbConnection)new SqliteConnection(conn);
            dbconn.Open(); //Open connection to the database.
            IDbCommand dbcmd = dbconn.CreateCommand();
            string sqlQuery = "SELECT DroneEvolutionConfig.id,name,currentGeneration,minMatchesPerIndividual,winnersCount,minDrones,droneEscalation,maxDrones," +
                "killScoreMultiplier,flatKillBonus,completionBonus,deathPenalty,droneList," +
                "MatchConfig.id,matchTimeout,winnerPollPeriod" +
                " FROM DroneEvolutionConfig" +
                " INNER JOIN MatchConfig on MatchConfig.id = DroneEvolutionConfig.matchConfigId;" +
                " WHERE DroneEvolutionConfig.id =" + id;
            dbcmd.CommandText = sqlQuery;
            IDataReader reader = dbcmd.ExecuteReader();
            while (reader.Read())
            {
                var readId = reader.GetInt32(0);
                var name = reader.GetString(1);
                var currentGeneration = reader.GetInt32(2);
                var minMatchesPerIndividual = reader.GetInt32(3);
                var winnersCount = reader.GetInt32(4);
                var minDrones = reader.GetInt32(5);
                var droneEscalation = reader.GetFloat(6);
                var maxDrones = reader.GetInt32(7);
                var killScoreMultiplier = reader.GetFloat(8);
                var flatKillBonus = reader.GetFloat(9);
                var completionBonus = reader.GetFloat(10);
                var deathPenalty = reader.GetFloat(11);
                var droneList = reader.GetString(12);

                var matchTimeout = reader.GetFloat(13);
                var winnerPollPeriod = reader.GetFloat(14);

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
                    ", matchTimeout " + matchTimeout +
                    ", winnerPollPeriod " + winnerPollPeriod
                    );
            }
            reader.Close();
            reader = null;
            dbcmd.Dispose();
            dbcmd = null;
            dbconn.Close();
            dbconn = null;
        }

        private void Disconect()
        {

        }
    }
}
