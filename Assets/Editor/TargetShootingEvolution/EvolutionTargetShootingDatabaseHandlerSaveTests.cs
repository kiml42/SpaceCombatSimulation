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
    EvolutionTargetShootingControler _toConfigure;
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

        var go = new GameObject();

        _toConfigure = go.AddComponent<EvolutionTargetShootingControler>();

        _toConfigure.ShipConfig = go.AddComponent<EvolutionShipConfig>();
        _toConfigure.MutationControl = go.AddComponent<EvolutionMutationController>();
        _toConfigure.MatchControl = go.AddComponent<EvolutionMatchController>();

        _handler = new EvolutionTargetShootingDatabaseHandler(_toConfigure, _dbPath);
    }

    #region top level
    [Test]
    public void SetCurrentGeneration_UpdatesCurrentGeneration()
    {
        _handler.ReadDroneConfig(1);
        Assert.AreEqual(1, _toConfigure.DatabaseId);

        _handler.SetCurrentGeneration(5);
        Assert.AreEqual(5, _toConfigure.GenerationNumber);  //has been set

        _toConfigure.GenerationNumber = 2;  //set it werong
        _handler.ReadDroneConfig(1);
        Assert.AreEqual(5, _toConfigure.GenerationNumber);  //has been read back out

        //repeat with a different number, to be sure it wasn't just 5 to begin with.
        _handler.SetCurrentGeneration(7);
        Assert.AreEqual(7, _toConfigure.GenerationNumber);  //has been set

        _toConfigure.GenerationNumber = 3;  //set it werong
        _handler.ReadDroneConfig(1);
        Assert.AreEqual(7, _toConfigure.GenerationNumber);  //has been read back out
    }
    #endregion
}
