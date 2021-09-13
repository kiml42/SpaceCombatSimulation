using Mono.Data.Sqlite;
using System;
using System.IO;
using UnityEngine;

namespace Assets.Src.Database
{
    public class DatabaseInitialiser
    {
        private string ConnectionString
        {
            get
            {
                var connection = "URI=file:" + DatabaseFullPath + "; foreign keys=true;";
                //Debug.Log("connection string: " + connection);
                return connection;
            }
        }
        public string DatabasePath = "/Database/SpaceCombatSimulationDB.s3db"; //Path to database.
        private string DatabaseFullPath { get { return Application.dataPath + DatabasePath; } }
        
        /// <summary>
        /// Creates the database if it doesn't exist, if it does exist, this does nothing.
        /// </summary>
        /// <param name="creationCommandFilePath"></param>
        public void EnsureDatabaseExists(string creationCommandFilePath = EvolutionDatabaseHandler.DEFAULT_CREATE_DB_COMMAND_PATH)
        {
            if(!File.Exists(DatabaseFullPath))
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
            if (File.Exists(DatabaseFullPath))
            {
                //Debug.Log("Dropping database " + _databaseFullPath);
                File.Delete(DatabaseFullPath);
                //Debug.Log("database deleted");
                return;
            }
            Debug.Log("cannot drop database because it does not exist: " + DatabaseFullPath);
        }

        private void CreateDatabase(string creationCommandFilePath)
        {
            var folder = Path.GetDirectoryName(DatabaseFullPath);
            if (!Directory.Exists(folder))
            {
                Debug.Log("Creating dir: " + folder);
                Directory.CreateDirectory(folder);
            }

            Debug.Log("Creating database '" + DatabaseFullPath + "' using command file '" + creationCommandFilePath + "'");
            SqliteConnection.CreateFile(DatabaseFullPath);
            
            using (var sql_con = new SqliteConnection(ConnectionString))
            {
                try
                {
                    sql_con.Open();

                    var sql = File.ReadAllText(Application.streamingAssetsPath + creationCommandFilePath);

                    //Debug.Log("create sql: " + sql);

                    using (var dbcmd = new SqliteCommand(sql, sql_con))
                    {
                        dbcmd.ExecuteNonQuery();
                    }
                }
                catch (Exception e)
                {
                    Debug.LogWarning("Caught exception: " + e + ", message: " + e.Message);
                    throw;
                }
            }
        }
    }
}
