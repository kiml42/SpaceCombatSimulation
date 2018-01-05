using UnityEngine;
using UnityEditor;
using UnityEngine.TestTools;
using NUnit.Framework;
using System.Collections;
using Assets.src.Evolution;
using Assets.Src.Database;
using System;
using Assets.Src.Evolution;

public class Evolution1v1DatabaseHandlerSaveTests
{
    private string _dbPathStart = "/../tmp/TestDB/";
    private string _dbPathExtension = ".s3db";
    private string _dbPath;
    private string _createCommandPath = "/../Test/TestDB/CreateTestDB.sql";
    Evolution1v1DatabaseHandler _handler;
    DatabaseInitialiser initialiser;

    [SetUp]
    public void Setup()
    {
        _dbPath = _dbPathStart + Guid.NewGuid().ToString() + _dbPathExtension;

        initialiser = new DatabaseInitialiser
        {
            DatabasePath = _dbPath
        };

        _handler = new Evolution1v1DatabaseHandler(_dbPath, _createCommandPath);
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

    [Test]
    public void SaveConfig_savesWholeThingAndReturnsId()
    {
        var config = new Evolution1v1Config
        {
            RunName = "SaveConfigTest",
            GenerationNumber = 42,
            MinMatchesPerIndividual = 6,
            SuddenDeathDamage = 20,
            SuddenDeathReloadTime = 5,
            WinnersFromEachGeneration = 7,
            MatchConfig = new MatchConfig
            {
                LocationRandomisationRadiai = new float[]
                {
                    100,50
                }
            },
            MutationConfig = new MutationConfig
            {
                DefaultGenome = "SaveConfigTest_DefaultGenome"
            }
        };

        config.DatabaseId = -13; //set id to something really obvious to show if it hasn't been set correctly.

        int result = _handler.SaveConfig(config);

        var expectedId = 2;

        Assert.AreEqual(expectedId, result);

        var retrieved = _handler.ReadConfig(expectedId);

        Assert.AreEqual(expectedId, retrieved.DatabaseId);
        Assert.AreEqual("SaveConfigTest", retrieved.RunName);

        var match = retrieved.MatchConfig;
        var mut = retrieved.MutationConfig;

        Assert.AreEqual(6, match.Id);
        Assert.AreEqual(7, mut.Id);
        Assert.AreEqual(config.MatchConfig.LocationRandomisationRadiai, match.LocationRandomisationRadiai);
    }

    [Test]
    public void UpdateTest()
    {
        var config = _handler.ReadConfig(0);

        config.RunName = "Altered";
        config.MatchConfig.InitialRange++;
        config.MutationConfig.GenomeLength++;

        _handler.UpdateExistingConfig(config);

        var updated = _handler.ReadConfig(0);

        Assert.AreEqual(config.RunName, updated.RunName);
        Assert.AreEqual("Altered", updated.RunName);
        Assert.AreEqual(config.MatchConfig.InitialRange, updated.MatchConfig.InitialRange);
        Assert.AreEqual(config.MutationConfig.GenomeLength, updated.MutationConfig.GenomeLength);
    }
    #endregion
}
