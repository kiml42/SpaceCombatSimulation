using Assets.Src.Database;
using Assets.Src.Evolution;
using Assets.Src.Evolution.BattleRoyale;
using Assets.Src.Evolution.Drone;
using Assets.Src.Evolution.Race;
using NUnit.Framework;
using System;
using System.Collections.Generic;
using UnityEngine;

public class EvolutionDroneDatabaseHandlerSaveTests
{
    private const string _dbPathStart = "/../tmp/TestDB/";
    private const string _dbPathExtension = ".s3db";
    private string _dbPath;
    private const string _createCommandPath = "/../../Test/TestDB/CreateTestDB.sql";
    EvolutionDatabaseHandler _handler;
    DatabaseInitialiser _initialiser;
    private EvolutionConfig DefaultEvolutionConfig
    {
        get
        {
            var config = new EvolutionConfig
            {
                RunName = "SaveConfigTest",
                GenerationNumber = 42,
                MinMatchesPerIndividual = 6,
                WinnersFromEachGeneration = 7,
                MatchConfig = new MatchConfig
                {
                    InSphereRandomisationRadius = 43,
                    OnSphereRandomisationRadius = 44,
                },
                MutationConfig = new MutationConfig
                {
                    DefaultGenome = "SaveConfigTest_DefaultGenome"
                }
            };

            config.BrConfig = new EvolutionBrConfig
            {
                NumberOfCombatants = 3,
                DeathScoreMultiplier = 123,
                SurvivalBonus = 432,
            };

            config.RaceConfig = new EvolutionRaceConfig
            {
                RaceMaxDistance = 2342,
                RaceScoreMultiplier = 1234,
                RaceGoalObject = 4
            };

            return config;
        }
    }


    [SetUp]
    public void Setup()
    {
        _dbPath = _dbPathStart + Guid.NewGuid().ToString() + _dbPathExtension;

        _initialiser = new DatabaseInitialiser
        {
            DatabasePath = _dbPath
        };

        _handler = new EvolutionDatabaseHandler(_dbPath, _createCommandPath);
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
        var config = DefaultEvolutionConfig;

        config.DatabaseId = -13; //set id to something really obvious to show if it hasn't been set correctly.

        int result = _handler.SaveNewEvolutionConfig(config);

        var expectedId = 4;

        Assert.AreEqual(expectedId, result);

        var retrieved = _handler.ReadConfig(expectedId);

        Assert.AreEqual(expectedId, retrieved.DatabaseId);
        Assert.AreEqual("SaveConfigTest", retrieved.RunName);
        Assert.AreEqual(91, retrieved.MatchConfig.InSphereRandomisationRadius);
        Assert.AreEqual(92, retrieved.MatchConfig.OnSphereRandomisationRadius);
        Assert.AreEqual(93, retrieved.EvolutionDroneConfig.DronesInSphereRandomRadius);
        Assert.AreEqual(94, retrieved.EvolutionDroneConfig.DronesOnSphereRandomRadius);

        Assert.AreEqual(config.MatchConfig.Budget, retrieved.MatchConfig.Budget);
    }

    [Test]
    public void SaveConfig_savesNullBudget()
    {
        var config = new EvolutionConfig
        {
            EvolutionDroneConfig = new EvolutionDroneConfig
            {
                Drones = new List<int>
                {
                    0,1,3,4,4
                }
            }
        };

        int result = _handler.SaveNewEvolutionConfig(config);

        var retrieved = _handler.ReadConfig(result);

        Assert.IsNull(retrieved.MatchConfig.Budget);
    }

    [Test]
    public void UpdateTest()
    {
        var config = _handler.ReadConfig(0);

        config.RunName = "Altered";
        config.MatchConfig.AllowedModulesString = "1,3,5";
        config.MatchConfig.InitialRange++;
        config.MatchConfig.Budget++;
        config.MutationConfig.GenomeLength++;
        config.MatchConfig.InSphereRandomisationRadius++;
        config.MatchConfig.OnSphereRandomisationRadius++;
        config.EvolutionDroneConfig.DronesInSphereRandomRadius++;
        config.EvolutionDroneConfig.DronesOnSphereRandomRadius++;

        _handler.UpdateExistingEvolutionConfig(config);

        var updated = _handler.ReadConfig(0);

        Assert.AreEqual(config.RunName, updated.RunName);
        Assert.AreEqual("Altered", updated.RunName);
        Assert.AreEqual(config.MatchConfig.InSphereRandomisationRadius, updated.MatchConfig.InSphereRandomisationRadius);
        Assert.AreEqual(config.MatchConfig.OnSphereRandomisationRadius, updated.MatchConfig.OnSphereRandomisationRadius);
        Assert.AreEqual(config.EvolutionDroneConfig.DronesInSphereRandomRadius, updated.EvolutionDroneConfig.DronesInSphereRandomRadius);
        Assert.AreEqual(config.EvolutionDroneConfig.DronesOnSphereRandomRadius, updated.EvolutionDroneConfig.DronesOnSphereRandomRadius);

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

        _handler.UpdateExistingEvolutionConfig(config);

        var updated = _handler.ReadConfig(0);
        
        Assert.IsNull(updated.MatchConfig.Budget);
    }
    #endregion
}
