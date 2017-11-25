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
            string sqlQuery = "SELECT id,currentGeneration,minMatchesPerIndividual" + "FROM DroneEvolutionConfig" + " WHERE id ="+id;
            dbcmd.CommandText = sqlQuery;
            IDataReader reader = dbcmd.ExecuteReader();
            while (reader.Read())
            {
                int readId = reader.GetInt32(0);

                Debug.Log("id= " + readId);
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
