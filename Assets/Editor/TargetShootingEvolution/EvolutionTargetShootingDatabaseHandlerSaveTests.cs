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
    private string _dbPathStart = "/../tmp/TestDB/";
    private string _dbPathExtension = ".s3db";
    private string _dbPath;
    private string _createCommandPath = "/../Test/TestDB/CreateTestDB.sql";
    EvolutionTargetShootingDatabaseHandler _handler;
    DatabaseInitialiser initialiser;

    [SetUp]
    public void Setup()
    {
        _dbPath = _dbPathStart + Guid.NewGuid().ToString() + _dbPathExtension;

        initialiser = new DatabaseInitialiser
        {
            DatabasePath = _dbPath
        };

        _handler = new EvolutionTargetShootingDatabaseHandler(_dbPath, _createCommandPath);
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
