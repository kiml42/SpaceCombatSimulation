using UnityEngine;
using UnityEditor;
using UnityEngine.TestTools;
using NUnit.Framework;
using System.Collections;
using Assets.src.Evolution;
using Assets.Src.Database;
using System;

public class EvolutionTargetShootingDatabaseHandlerSaveTests
{
    private string _dbPath = "/../tmp/TestDB/SpaceCombatSimulationDB3.s3db";
    private string _createCommandPath = "/../Test/TestDB/CreateTestDB.sql";
    EvolutionTargetShootingDatabaseHandler _handler;

    public EvolutionTargetShootingDatabaseHandlerSaveTests()
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

        _handler = new EvolutionTargetShootingDatabaseHandler(_dbPath);
    }

    #region top level
    [Test]
    public void SetCurrentGeneration_UpdatesCurrentGeneration()
    {

        var config =  _handler.ReadConfig(1);
        Assert.AreEqual(1, config.DatabaseId);

        _handler.SetCurrentGenerationNumber(1, 5);

        config.GenerationNumber = 2;  //set it werong
        var config1 = _handler.ReadConfig(1);
        Assert.AreEqual(5, config1.GenerationNumber);  //has been read back out

        //repeat with a different number, to be sure it wasn't just 5 to begin with.
        _handler.SetCurrentGenerationNumber(1, 7);

        config.GenerationNumber = 3;  //set it werong
        var config2 = _handler.ReadConfig(1);
        Assert.AreEqual(7, config2.GenerationNumber);  //has been read back out
    }
    #endregion
}
