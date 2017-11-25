using System.Collections;
using System.Collections.Generic;
using UnityEngine;

using Mono.Data.Sqlite;
using System.Data;
using System;

public class DatabaseConnection : MonoBehaviour {

	// Use this for initialization
	void Start () {
        var id = 0;
        string conn = "URI=file:" + Application.dataPath + "/SpaceCombatSimulationDB.s3db"; //Path to database.
        IDbConnection dbconn;
        dbconn = (IDbConnection)new SqliteConnection(conn);
        dbconn.Open(); //Open connection to the database.
        IDbCommand dbcmd = dbconn.CreateCommand();
        string sqlQuery = "SELECT id, currentGeneration" + " FROM DroneEvolutionConfig" + " WHERE id =" + id;
        dbcmd.CommandText = sqlQuery;
        IDataReader reader = dbcmd.ExecuteReader();
        while (reader.Read())
        {
            int readId = reader.GetInt32(0);
            int currentGeneration = reader.GetInt32(1);

            Debug.Log("readId= " + readId);
            Debug.Log("currentGeneration= " + currentGeneration);
        }
        reader.Close();
        reader = null;
        dbcmd.Dispose();
        dbcmd = null;
        dbconn.Close();
        dbconn = null;
    }

    // Update is called once per frame
    void Update () {
		
	}
}
