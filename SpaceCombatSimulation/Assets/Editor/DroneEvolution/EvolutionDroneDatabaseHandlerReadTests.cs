using Assets.Src.Database;
using NUnit.Framework;
using System;
using UnityEngine;

public class EvolutionDroneDatabaseHandlerReadTests
{
    private const string _dbPathStart = "/../tmp/TestDB/";
    private const string _dbPathExtension = ".s3db";
    private string _dbPath;
    private const string _createCommandPath = "/../../Test/TestDB/CreateTestDB.sql";
    EvolutionDatabaseHandler _handler;
    DatabaseInitialiser _initialiser;

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
    public void ListConfigs_listsConfigs()
    {
        var configs = _handler.ListConfigs();

        Assert.IsNotNull(configs);
        Assert.IsNotEmpty(configs);
        Assert.IsTrue(configs.ContainsKey(0));
        Assert.AreEqual("Run0", configs[0]);
        Assert.IsTrue(configs.ContainsKey(1));
        Assert.AreEqual("Run1", configs[1]);
    }

    [Test]
    public void ReadDroneConfig_ReadsID()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(0, config.DatabaseId);
    }

    [Test]
    public void ReadDroneConfig_ReadsDifferentID()
    {
        var config = _handler.ReadConfig(1);
        Assert.AreEqual(1, config.DatabaseId);
    }

    [Test]
    public void ReadDroneConfig_ReadsName()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual("Run0", config.RunName);
    }

    [Test]
    public void ReadDroneConfig_ReadsDifferentName()
    {
        var config = _handler.ReadConfig(1);
        Assert.AreEqual("Run1", config.RunName);
    }

    [Test]
    public void ReadDroneConfig_GenerationNumber()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(1, config.GenerationNumber);
    }

    [Test]
    public void ReadDroneConfig_MinMatchesPerIndividual()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(5, config.MinMatchesPerIndividual);
    }

    [Test]
    public void ReadDroneConfig_WinnersFromEachGeneration()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(14, config.WinnersFromEachGeneration);
    }

    [Test]
    public void ReadDroneConfig_MinDronesToSpawn()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(10, config.EvolutionDroneConfig.MinDronesToSpawn);
    }

    [Test]
    public void ReadDroneConfig_ExtraDromnesPerGeneration()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(3, config.EvolutionDroneConfig.ExtraDromnesPerGeneration);
    }

    [Test]
    public void ReadDroneConfig_MaxDronesToSpawn()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(15, config.EvolutionDroneConfig.MaxDronesToSpawn);
    }

    [Test]
    public void ReadDroneConfig_KillScoreMultiplier()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(-4, config.EvolutionDroneConfig.KillScoreMultiplier);
    }

    [Test]
    public void ReadDroneConfig_FlatKillBonus()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(-6, config.EvolutionDroneConfig.FlatKillBonus);
    }

    [Test]
    public void ReadDroneConfig_CompletionBonus()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(-8, config.EvolutionDroneConfig.CompletionBonus);
    }

    [Test]
    public void ReadDroneConfig_Drones()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual("0,2,1,3,1,1,3,1,5,1,1,1,6,1,1", config.EvolutionDroneConfig.DronesString);
    }

    [Test]
    public void CountCompleteKillersTest()
    {
        var result = _handler.CountCompleteKillers(0, 1);

        Assert.AreEqual(3, result);
    }
    #endregion

    #region MatchControl
    [Test]
    public void ReadDroneConfig_MatchControl_MatchTimeout()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(25, config.MatchConfig.MatchTimeout);
    }

    [Test]
    public void ReadDroneConfig_MatchControl_WinnerPollPeriod()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(2, config.MatchConfig.WinnerPollPeriod);
    }

    [Test]
    public void ReadConfig_MatchControl_InitialRange()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(6005, config.MatchConfig.InitialRange);
    }

    [Test]
    public void ReadConfig_MatchControl_InitialSpeed()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(5, config.MatchConfig.InitialSpeed);
    }

    [Test]
    public void ReadConfig_MatchControl_RandomInitialSpeed()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(5, config.MatchConfig.RandomInitialSpeed);
    }

    [Test]
    public void ReadConfig_MatchControl_CompetitorsPerTeam()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(6, config.MatchConfig.CompetitorsPerTeam);
    }

    [Test]
    public void ReadConfig_MatchControl_StepForwardProportion()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(0.5f, config.MatchConfig.StepForwardProportion);
    }

    [Test]
    public void ReadConfig_MatchControl_AllowedModulesString()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual("1,2,4,5", config.MatchConfig.AllowedModulesString);
        Assert.AreEqual(1, config.MatchConfig.AllowedModuleIndicies[0]);
        Assert.AreEqual(2, config.MatchConfig.AllowedModuleIndicies[1]);
        Assert.AreEqual(4, config.MatchConfig.AllowedModuleIndicies[2]);
    }

    [Test]
    public void ReadConfig_MatchControl_RandomiseRotation()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(true, config.MatchConfig.RandomiseRotation);
    }

    [Test]
    public void ReadConfig_MatchControl_ShipInSphereRandomRadius()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(100, config.MatchConfig.InSphereRandomisationRadius);
    }

    [Test]
    public void ReadConfig_MatchControl_ShipOnSphereRandomRadius()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(101, config.MatchConfig.OnSphereRandomisationRadius);
    }

    [Test]
    public void ReadConfig_MatchControl_DronesInSphereRandomRadius()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(102, config.EvolutionDroneConfig.DronesInSphereRandomRadius);
    }

    [Test]
    public void ReadConfig_MatchControl_DronesOnSphereRandomRadius()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(103, config.EvolutionDroneConfig.DronesOnSphereRandomRadius);
    }

    [Test]
    public void ReadConfig_MatchControl_Budget()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(12345, config.MatchConfig.Budget);
    }

    [Test]
    public void ReadConfig_MatchControl_Budget_null()
    {
        var config = _handler.ReadConfig(1);
        Assert.IsNull(config.MatchConfig.Budget);
    }
    #endregion

    #region MutationControl
    [Test]
    public void ReadDroneConfig_MutationControl_Mutations()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(7, config.MutationConfig.Mutations);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_MaxMutationLength()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(4, config.MutationConfig.MaxMutationLength);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_GenomeLength()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(91, config.MutationConfig.GenomeLength);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_GenerationSize()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(27, config.MutationConfig.GenerationSize);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_UseCompletelyRandomDefaultGenome()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(true, config.MutationConfig.UseCompletelyRandomDefaultGenome);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_DefaultGenome()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual("abc", config.MutationConfig.DefaultGenome);
    }
    #endregion
}
