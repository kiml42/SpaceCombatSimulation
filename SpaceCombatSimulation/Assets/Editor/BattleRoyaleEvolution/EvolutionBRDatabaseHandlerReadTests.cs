using UnityEngine;
using UnityEditor;
using UnityEngine.TestTools;
using NUnit.Framework;
using System.Collections;
using Assets.src.Evolution;
using Assets.Src.Database;
using System;

public class EvolutionBRDatabaseHandlerReadTests
{
    private string _dbPathStart = "/../tmp/TestDB/";
    private string _dbPathExtension = ".s3db";
    private string _dbPath;
    private string _createCommandPath = "/../../Test/TestDB/CreateTestDB.sql";
    EvolutionBrDatabaseHandler _handler;
    DatabaseInitialiser _initialiser;

    [SetUp]
    public void Setup()
    {
        _dbPath = _dbPathStart + Guid.NewGuid().ToString() + _dbPathExtension;

        _initialiser = new DatabaseInitialiser
        {
            DatabasePath = _dbPath
        };

        _handler = new EvolutionBrDatabaseHandler(_dbPath, _createCommandPath);
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
            Debug.LogError("Failed to tear down database: " + e.Message);
        }
    }

    #region top level
    [Test]
    public void ListConfigs_listsConfigs()
    {
        var configs = _handler.ListConfigs();

        Assert.IsNotNull(configs);
        Assert.IsNotEmpty(configs);
        Assert.IsTrue(configs.ContainsKey(2));
        Assert.AreEqual("1v1", configs[2]);
        Assert.IsTrue(configs.ContainsKey(3));
        Assert.AreEqual("4Way", configs[3]);
    }

    [Test]
    public void ReadConfig_ReadsID()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(2, config.DatabaseId);
    }

    [Test]
    public void ReadConfig_ReadsDifferentID()
    {
        var config = _handler.ReadConfig(3);
        Assert.AreEqual(3, config.DatabaseId);
    }

    [Test]
    public void ReadConfig_ReadsName()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual("1v1", config.RunName);
    }

    [Test]
    public void ReadConfig_ReadsDifferentName()
    {
        var config = _handler.ReadConfig(3);
        Assert.AreEqual("4Way", config.RunName);
    }

    [Test]
    public void ReadConfig_ReadsNumberOfCombatants()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(2, config.NumberOfCombatants);
    }

    [Test]
    public void ReadConfig_ReadsDifferentNumberOfCombatants()
    {
        var config = _handler.ReadConfig(3);
        Assert.AreEqual(4, config.NumberOfCombatants);
    }

    [Test]
    public void ReadConfig_GenerationNumber()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(2, config.GenerationNumber);
    }

    [Test]
    public void ReadConfig_MinMatchesPerIndividual()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(3, config.MinMatchesPerIndividual);
    }

    [Test]
    public void ReadConfig_WinnersFromEachGeneration()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(5, config.WinnersFromEachGeneration);
    }

    [Test]
    public void ReadConfig_InSphereRandomisationRadius()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(106, config.InSphereRandomisationRadius);
    }

    [Test]
    public void ReadConfig_OnSphereRandomisationRadius()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(107, config.OnSphereRandomisationRadius);
    }

    [Test]
    public void ReadConfig_RaceMaxDistance()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(2010, config.RaceMaxDistance);
    }

    [Test]
    public void ReadConfig_RaceScoreMultiplier()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(1003, config.RaceScoreMultiplier);
    }

    [Test]
    public void ReadConfig_SurvivalBonus()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(42, config.SurvivalBonus);
    }

    [Test]
    public void ReadConfig_DeathScoreMultiplier()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(1.5f, config.DeathScoreMultiplier);
    }

    [Test]
    public void ReadConfig_RaceGoalObject()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(4, config.RaceGoalObject);
    }

    [Test]
    public void ReadConfig_RaceGoalObject_null()
    {
        var config = _handler.ReadConfig(3);
        Assert.IsNull(config.RaceGoalObject);
    }
    #endregion

    #region MatchControl
    [Test]
    public void ReadConfig_MatchControl_MatchTimeout()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(26, config.MatchConfig.MatchTimeout);
    }

    [Test]
    public void ReadConfig_MatchControl_WinnerPollPeriod()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(3, config.MatchConfig.WinnerPollPeriod);
    }

    [Test]
    public void ReadConfig_MatchControl_InitialRange()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(6002, config.MatchConfig.InitialRange);
    }

    [Test]
    public void ReadConfig_MatchControl_InitialSpeed()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(2, config.MatchConfig.InitialSpeed);
    }

    [Test]
    public void ReadConfig_MatchControl_RandomInitialSpeed()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(2, config.MatchConfig.RandomInitialSpeed);
    }

    [Test]
    public void ReadConfig_MatchControl_CompetitorsPerTeam()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(3, config.MatchConfig.CompetitorsPerTeam);
    }

    [Test]
    public void ReadConfig_MatchControl_StepForwardProportion()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(0.2f, config.MatchConfig.StepForwardProportion);
    }

    [Test]
    public void ReadConfig_MatchControl_AllowedModulesString()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual("1,2,4,5", config.MatchConfig.AllowedModulesString);
        Assert.AreEqual(1, config.MatchConfig.AllowedModuleIndicies[0]);
        Assert.AreEqual(2, config.MatchConfig.AllowedModuleIndicies[1]);
    }

    [Test]
    public void ReadConfig_MatchControl_RandomiseRotation()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(false, config.MatchConfig.RandomiseRotation);
    }
    #endregion

    #region MutationControl
    [Test]
    public void ReadConfig_MutationControl_Mutations()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(17, config.MutationConfig.Mutations);
    }

    [Test]
    public void ReadConfig_MutationControl_MaxMutationLength()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(14, config.MutationConfig.MaxMutationLength);
    }

    [Test]
    public void ReadConfig_MutationControl_GenomeLength()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(191, config.MutationConfig.GenomeLength);
    }

    [Test]
    public void ReadConfig_MutationControl_GenerationSize()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(127, config.MutationConfig.GenerationSize);
    }

    [Test]
    public void ReadConfig_MutationControl_UseCompletelyRandomDefaultGenome()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual(true, config.MutationConfig.UseCompletelyRandomDefaultGenome);
    }

    [Test]
    public void ReadConfig_MutationControl_DefaultGenome()
    {
        var config = _handler.ReadConfig(2);
        Assert.AreEqual("abc1", config.MutationConfig.DefaultGenome);
    }
    #endregion
}
