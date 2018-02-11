using Mono.Data.Sqlite;
using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Database
{
    public class DatabaseInitialiser
    {
        private string _connectionString
        {
            get
            {
                var connection = "URI=file:" + _databaseFullPath;
                //Debug.Log("connection string: " + connection);
                return connection;
            }
        }
        public string DatabasePath = "/SpaceCombatSimulationDB.s3db"; //Path to database.
        private string _databaseFullPath { get { return Application.dataPath + DatabasePath; } }
        
        /// <summary>
        /// Creates teh database if it doesn't exist, if it does exist, this does nothing.
        /// </summary>
        /// <param name="creationCommandFilePath"></param>
        public void EnsureDatabaseExists(string creationCommandFilePath)
        {
            if(!File.Exists(_databaseFullPath))
                CreateDatabase(creationCommandFilePath);
        }

        /// <summary>
        /// Deletes the database and all data 
        /// Then recreates the database using the script provided.
        /// Should only be used for testing.
        /// </summary>
        /// <param name="filePath">Path to the sql file for recreating the database</param>
        public void ReCreateDatabase(string creationCommandFilePath)
        {
            DropDatabase();
            CreateDatabase(creationCommandFilePath);
        }

        /// <summary>
        /// Deletes the database and all data - should only be used for testing.
        /// </summary>
        public void DropDatabase()
        {
            if (File.Exists(_databaseFullPath))
            {
                //Debug.Log("Dropping database " + _databaseFullPath);
                File.Delete(_databaseFullPath);
                //Debug.Log("database deleted");
                return;
            }
            Debug.Log("cannot drop database because it does not exist: " + _databaseFullPath);
        }

        private void CreateDatabase(string creationCommandFilePath)
        {
            var folder = Path.GetDirectoryName(_databaseFullPath);
            if (!Directory.Exists(folder))
            {
                Debug.Log("Creating dir: " + folder);
                Directory.CreateDirectory(folder);
            }

            Debug.Log("Creating database '" + _databaseFullPath + "' using command file '" + creationCommandFilePath + "'");
            SqliteConnection.CreateFile(_databaseFullPath);
            
            using (var sql_con = new SqliteConnection(_connectionString))
            {
                try
                {
                    sql_con.Open();

                    var sql = File.ReadAllText(Application.dataPath + creationCommandFilePath);

                    //Debug.Log("create sql: " + sql);

                    using (var dbcmd = new SqliteCommand(sql, sql_con))
                    {
                        dbcmd.ExecuteNonQuery();
                    }
                }
                catch (Exception e)
                {
                    Debug.LogWarning("Caught exception: " + e + ", message: " + e.Message);
                    throw e;
                }
            }
        }
    }
}
