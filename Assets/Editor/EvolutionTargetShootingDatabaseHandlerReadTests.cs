using UnityEngine;
using UnityEditor;
using UnityEngine.TestTools;
using NUnit.Framework;
using System.Collections;
using Assets.src.Evolution;
using Assets.Src.Database;
using System;

public class EvolutionTargetShootingDatabaseHandlerReadTests
{
    private string _dbPath = "/../Test/TestDB/SpaceCombatSimulationDB2.s3db";
    private string _createCommandPath = "/../Test/TestDB/CreateTestDB.sql";
    EvolutionTargetShootingControler _toConfigure;
    EvolutionTargetShootingDatabaseHandler _handler;

    public EvolutionTargetShootingDatabaseHandlerReadTests()
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
        _toConfigure.FileManager = go.AddComponent<EvolutionFileManager>();
        _toConfigure.MutationControl = go.AddComponent<EvolutionMutationController>();
        _toConfigure.MatchControl = go.AddComponent<EvolutionMatchController>();

        _handler = new EvolutionTargetShootingDatabaseHandler(_toConfigure)
        {
            DatabasePath = _dbPath
        };
    }

    #region top level
    [Test]
    public void ReadDroneConfig_ReadsID()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(0, _toConfigure.DatabaseId);
    }

    [Test]
    public void ReadDroneConfig_ReadsDifferentID()
    {
        _handler.ReadDroneConfig(1);
        Assert.AreEqual(1, _toConfigure.DatabaseId);
    }

    [Test]
    public void ReadDroneConfig_ReadsName()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual("Run0", _toConfigure.RunName);
    }

    [Test]
    public void ReadDroneConfig_ReadsDifferentName()
    {
        _handler.ReadDroneConfig(1);
        Assert.AreEqual("Run1", _toConfigure.RunName);
    }

    [Test]
    public void ReadDroneConfig_GenerationNumber()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(1, _toConfigure.GenerationNumber);
    }

    [Test]
    public void ReadDroneConfig_MinMatchesPerIndividual()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(5, _toConfigure.MinMatchesPerIndividual);
    }

    [Test]
    public void ReadDroneConfig_WinnersFromEachGeneration()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(14, _toConfigure.WinnersFromEachGeneration);
    }

    [Test]
    public void ReadDroneConfig_MinDronesToSpawn()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(10, _toConfigure.MinDronesToSpawn);
    }

    [Test]
    public void ReadDroneConfig_ExtraDromnesPerGeneration()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(3, _toConfigure.ExtraDromnesPerGeneration);
    }

    [Test]
    public void ReadDroneConfig_MaxDronesToSpawn()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(15, _toConfigure.MaxDronesToSpawn);
    }

    [Test]
    public void ReadDroneConfig_KillScoreMultiplier()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(-4, _toConfigure.KillScoreMultiplier);
    }

    [Test]
    public void ReadDroneConfig_FlatKillBonus()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(-6, _toConfigure.FlatKillBonus);
    }

    [Test]
    public void ReadDroneConfig_CompletionBonus()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(-8, _toConfigure.CompletionBonus);
    }

    [Test]
    public void ReadDroneConfig_DeathPenalty()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(-20, _toConfigure.DeathPenalty);
    }

    [Test]
    public void ReadDroneConfig_Drones()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual("Assets/Prefabs/ModularShip/Drones/SelfBuildingModularShip.prefab;Assets/Prefabs/ModularShip/Drones/EngineDrone.prefab;Assets/Prefabs/ModularShip/Drones/MiniLaserDrone.prefab;Assets/Prefabs/ModularShip/Drones/SelfBuildingModularShip.prefab;Assets/Prefabs/ModularShip/Drones/MiniLaserDrone.prefab;Assets/Prefabs/ModularShip/Drones/SelfBuildingModularShip.prefab;Assets/Prefabs/ModularShip/Drones/SelfBuildingModularShip.prefab;Assets/Prefabs/ModularShip/Drones/MiniLaserDrone.prefab;Assets/Prefabs/ModularShip/Drones/SelfBuildingModularShip.prefab;Assets/Prefabs/ModularShip/Drones/TorpedoDrone.prefab;Assets/Prefabs/ModularShip/Drones/SelfBuildingModularShip.prefab;Assets/Prefabs/ModularShip/Drones/SelfBuildingModularShip.prefab;Assets/Prefabs/ModularShip/Drones/SelfBuildingModularShip.prefab;Assets/Prefabs/ModularShip/Drones/TwinCannonDrone.prefab", _toConfigure.DronesString);
    }
    #endregion

    #region MatchControl
    [Test]
    public void ReadDroneConfig_MatchControl_Id()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(5, _toConfigure.MatchControl.Id);
    }

    [Test]
    public void ReadDroneConfig_MatchControl_MatchTimeout()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(25, _toConfigure.MatchControl.MatchTimeout);
    }

    [Test]
    public void ReadDroneConfig_MatchControl_WinnerPollPeriod()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(2, _toConfigure.MatchControl.WinnerPollPeriod);
    }
    #endregion

    #region MutationControl
    [Test]
    public void ReadDroneConfig_MutationControl_Id()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(6, _toConfigure.MutationControl.Id);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_Mutations()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(7, _toConfigure.MutationControl.Mutations);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_AllowedCharacters()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(" xyz ", _toConfigure.MutationControl.AllowedCharacters);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_MaxMutationLength()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(4, _toConfigure.MutationControl.MaxMutationLength);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_GenomeLength()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(91, _toConfigure.MutationControl.GenomeLength);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_GenerationSize()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(27, _toConfigure.MutationControl.GenerationSize);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_UseCompletelyRandomDefaultGenome()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual(true, _toConfigure.MutationControl.UseCompletelyRandomDefaultGenome);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_DefaultGenome()
    {
        _handler.ReadDroneConfig(0);
        Assert.AreEqual("abc", _toConfigure.MutationControl.DefaultGenome);
    }
    #endregion
}
