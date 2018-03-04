using UnityEngine;
using UnityEditor;
using UnityEngine.TestTools;
using NUnit.Framework;
using System.Collections;
using Assets.src.Evolution;
using Assets.Src.Database;
using System;
using Assets.Src.Evolution;
using System.Collections.Generic;

public class EvolutionDroneDatabaseHandlerSaveTests
{
    private string _dbPathStart = "/../tmp/TestDB/";
    private string _dbPathExtension = ".s3db";
    private string _dbPath;
    private string _createCommandPath = "/../Test/TestDB/CreateTestDB.sql";
    EvolutionDroneDatabaseHandler _handler;
    DatabaseInitialiser _initialiser;

    [SetUp]
    public void Setup()
    {
        _dbPath = _dbPathStart + Guid.NewGuid().ToString() + _dbPathExtension;

        _initialiser = new DatabaseInitialiser
        {
            DatabasePath = _dbPath
        };

        _handler = new EvolutionDroneDatabaseHandler(_dbPath, _createCommandPath);
    }

    [TearDown]
    public void TearDown()
    {
        try
        {
            _initialiser.DropDatabase();
        }
        catch (Exception e)
        {
            Debug.LogWarning("Failed to tear down database: " + e.Message);
        }
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

    [Test]
    public void SaveConfig_savesWholeThingAndReturnsId()
    {
        var config = new EvolutionDroneConfig
        {
            RunName = "SaveConfigTest",
            GenerationNumber = 42,
            MinMatchesPerIndividual = 6,
            CompletionBonus = 5,
            DeathPenalty = 4,
            Drones = new List<int>
            {
                1,2
            },
            ExtraDromnesPerGeneration = 0.03f,
            FlatKillBonus = 56,
            KillScoreMultiplier = 32,
            MaxDronesToSpawn = 123,
            MinDronesToSpawn = 7,
            WinnersFromEachGeneration = 7,
            MatchConfig = new MatchConfig
            {
                LocationRandomisationRadiai = new float[]
                {
                    100,50
                },
                Budget = 1235
            },
            MutationConfig = new MutationConfig
            {
                DefaultGenome = "SaveConfigTest_DefaultGenome"
            }
        };

        config.DatabaseId = -13; //set id to something really obvious to show if it hasn't been set correctly.

        int result = _handler.SaveNewConfig(config);

        var expectedId = 4;

        Assert.AreEqual(expectedId, result);

        var retrieved = _handler.ReadConfig(expectedId);

        Assert.AreEqual(expectedId, retrieved.DatabaseId);
        Assert.AreEqual("SaveConfigTest", retrieved.RunName);

        var match = retrieved.MatchConfig;
        var mut = retrieved.MutationConfig;

        Assert.AreEqual(6, match.Id);
        Assert.AreEqual(7, mut.Id);
        Assert.AreEqual(config.MatchConfig.LocationRandomisationRadiai, match.LocationRandomisationRadiai);
        Assert.AreEqual(config.MatchConfig.Budget, match.Budget);
    }

    [Test]
    public void SaveConfig_savesNullBudget()
    {
        var config = new EvolutionDroneConfig
        {
            MatchConfig = new MatchConfig
            {
                LocationRandomisationRadiai = new float[]
                {
                    0,1
                },
                Budget = null
            },
            Drones = new List<int>
            {
                0,1,3,4,4
            }
        };

        int result = _handler.SaveNewConfig(config);

        var retrieved = _handler.ReadConfig(result);

        Assert.IsNull(retrieved.MatchConfig.Budget);
    }

    [Test]
    public void UpdateTest()
    {
        var config = _handler.ReadConfig(0);

        config.RunName = "Altered";
        config.MatchConfig.LocationRandomisationRadiaiString = "1,2,3,4";
        config.MatchConfig.AllowedModulesString = "1,3,5";
        config.MatchConfig.InitialRange++;
        config.MatchConfig.Budget++;
        config.MutationConfig.GenomeLength++;

        _handler.UpdateExistingConfig(config);

        var updated = _handler.ReadConfig(0);

        Assert.AreEqual(config.RunName, updated.RunName);
        Assert.AreEqual("Altered", updated.RunName);
        Assert.AreEqual("1,2,3,4", updated.MatchConfig.LocationRandomisationRadiaiString);
        Assert.AreEqual("1,3,5", updated.MatchConfig.AllowedModulesString);
        Assert.AreEqual(config.MatchConfig.Budget, updated.MatchConfig.Budget);
        Assert.AreEqual(config.MatchConfig.InitialRange, updated.MatchConfig.InitialRange);
        Assert.AreEqual(config.MutationConfig.GenomeLength, updated.MutationConfig.GenomeLength);
    }

    [Test]
    public void UpdateTest_setBudgetToNull()
    {
        var config = _handler.ReadConfig(0);

        config.MatchConfig.Budget = null;

        _handler.UpdateExistingConfig(config);

        var updated = _handler.ReadConfig(0);
        
        Assert.IsNull(updated.MatchConfig.Budget);
    }
    #endregion
}
