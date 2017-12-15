using UnityEngine;
using UnityEditor;
using UnityEngine.TestTools;
using NUnit.Framework;
using System.Collections;
using Assets.src.Evolution;
using Assets.Src.Database;
using System;

public class Evolution1v1DatabaseHandlerSaveTests
{
    private string _dbPath = "/../tmp/TestDB/SpaceCombatSimulationDB3.s3db";
    private string _createCommandPath = "/../Test/TestDB/CreateTestDB.sql";
    Evolution1v1DatabaseHandler _handler;

    public Evolution1v1DatabaseHandlerSaveTests()
    {
        var initialiser = new DatabaseInitialiser
        {
            DatabasePath = _dbPath
        };

        try
        {
            initialiser.ReCreateDatabase(_createCommandPath);
        }
        catch (Exception e)
        {
            Debug.LogError("Caught exception: " + e.Message + ". when recreating the database, carrying on regardless, the data may not be correct.");
        }

        _handler = new Evolution1v1DatabaseHandler(_dbPath);
    }

    #region top level
    [Test]
    public void SetCurrentGeneration_UpdatesCurrentGeneration()
    {
        var config = _handler.ReadConfig(1);
        Assert.AreEqual(1, config.DatabaseId);

        _handler.SetCurrentGenerationNumber(1, 5);
        
        var config2 = _handler.ReadConfig(1);
        Assert.AreEqual(5, config2.GenerationNumber);  //has been read back out

        //repeat with a different number, to be sure it wasn't just 5 to begin with.
        _handler.SetCurrentGenerationNumber(1, 7);
        
        var config3 = _handler.ReadConfig(1);
        Assert.AreEqual(7, config3.GenerationNumber);  //has been read back out
    }
    #endregion
}
