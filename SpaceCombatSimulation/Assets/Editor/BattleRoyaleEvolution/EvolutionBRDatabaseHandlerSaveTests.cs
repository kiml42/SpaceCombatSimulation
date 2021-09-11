using Assets.Src.Database;
using Assets.Src.Evolution;
using Assets.Src.Evolution.BattleRoyale;
using Assets.Src.Evolution.Race;
using NUnit.Framework;
using System;
using UnityEngine;

public class EvolutionBRDatabaseHandlerSaveTests
{
    private const string _dbPathStart = "/../tmp/TestDB/";
    private const string _dbPathExtension = ".s3db";
    private string _dbPath;
    private const string _createCommandPath = "/../../Test/TestDB/CreateTestDB.sql";
    EvolutionDatabaseHandler _handler;
    DatabaseInitialiser _initialiser;

    private EvolutionConfig DefaultEvolutionConfig {
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
                    MinimumLocationRandomisation = 43,
                    MaximumLocationRandomisation = 44,
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

        _initialiser.EnsureDatabaseExists();

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
            Debug.LogError("Failed to tear down database: " + e.Message);
        }
    }

    #region top level
    [Test]
    public void SetCurrentGeneration_UpdatesCurrentGeneration()
    {
        var config = _handler.ReadConfig(3);
        Assert.AreEqual(3, config.DatabaseId);

        _handler.SetCurrentGenerationNumber(3, 5);
        
        var config2 = _handler.ReadConfig(3);
        Assert.AreEqual(5, config2.GenerationNumber);  //has been read back out

        //repeat with a different number, to be sure it wasn't just 5 to begin with.
        _handler.SetCurrentGenerationNumber(3, 7);
        
        var config3 = _handler.ReadConfig(3);
        Assert.AreEqual(7, config3.GenerationNumber);  //has been read back out
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
        Assert.AreEqual(3, retrieved.BrConfig.NumberOfCombatants);
        Assert.AreEqual(43, retrieved.MatchConfig.MinimumLocationRandomisation);
        Assert.AreEqual(44, retrieved.MatchConfig.MaximumLocationRandomisation);
        Assert.AreEqual(123, retrieved.BrConfig.DeathScoreMultiplier);
        Assert.AreEqual(2342, retrieved.RaceConfig.RaceMaxDistance);
        Assert.AreEqual(1234, retrieved.RaceConfig.RaceScoreMultiplier);
        Assert.AreEqual(432, retrieved.BrConfig.SurvivalBonus);
        Assert.AreEqual(4, retrieved.RaceConfig.RaceGoalObject);
    }

    [Test]
    public void SaveConfig_savesNullGoal()
    {
        var config = DefaultEvolutionConfig;

        config.RaceConfig.RaceGoalObject = null;

        int result = _handler.SaveNewEvolutionConfig(config);

        var expectedId = 4;

        Assert.AreEqual(expectedId, result);

        var retrieved = _handler.ReadConfig(expectedId);
        
        Assert.IsNull(retrieved.RaceConfig.RaceGoalObject);
    }

    [Test]
    public void UpdateTest()
    {
        var config = _handler.ReadConfig(2);

        config.RunName = "Altered";
        config.MatchConfig.InitialRange++;
        config.MutationConfig.GenomeLength++;
        config.BrConfig.NumberOfCombatants++;
        config.MatchConfig.MinimumLocationRandomisation++;
        config.MatchConfig.MaximumLocationRandomisation++;
        config.BrConfig.SurvivalBonus++;
        config.RaceConfig.RaceMaxDistance++;
        config.RaceConfig.RaceScoreMultiplier++;
        config.BrConfig.DeathScoreMultiplier++;
        config.RaceConfig.RaceGoalObject++;

        _handler.UpdateExistingEvolutionConfig(config);

        var updated = _handler.ReadConfig(2);

        Assert.AreEqual(config.RunName, updated.RunName);
        Assert.AreEqual("Altered", updated.RunName);
        Assert.AreEqual(config.MatchConfig.InitialRange, updated.MatchConfig.InitialRange);
        Assert.AreEqual(config.MutationConfig.GenomeLength, updated.MutationConfig.GenomeLength);
        Assert.AreEqual(config.BrConfig.NumberOfCombatants, updated.BrConfig.NumberOfCombatants);
        Assert.AreEqual(config.MatchConfig.MinimumLocationRandomisation, updated.MatchConfig.MinimumLocationRandomisation);
        Assert.AreEqual(config.MatchConfig.MaximumLocationRandomisation, updated.MatchConfig.MaximumLocationRandomisation);
        Assert.AreEqual(config.BrConfig.SurvivalBonus, updated.BrConfig.SurvivalBonus);
        Assert.AreEqual(config.RaceConfig.RaceMaxDistance, updated.RaceConfig.RaceMaxDistance);
        Assert.AreEqual(config.RaceConfig.RaceScoreMultiplier, updated.RaceConfig.RaceScoreMultiplier);
        Assert.AreEqual(config.BrConfig.DeathScoreMultiplier, updated.BrConfig.DeathScoreMultiplier);
        Assert.AreEqual(config.RaceConfig.RaceGoalObject, updated.RaceConfig.RaceGoalObject);
    }

    [Test]
    public void UpdateTest_setGoalToNull()
    {
        var config = _handler.ReadConfig(2);
        
        config.RaceConfig.RaceGoalObject = null;

        _handler.UpdateExistingEvolutionConfig(config);

        var updated = _handler.ReadConfig(2);
        
        Assert.IsNull(updated.RaceConfig.RaceGoalObject);
    }
    #endregion
}
