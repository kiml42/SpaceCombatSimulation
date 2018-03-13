﻿using UnityEngine;
using UnityEditor;
using UnityEngine.TestTools;
using NUnit.Framework;
using System.Collections;
using Assets.src.Evolution;
using Assets.Src.Database;
using System;
using System.Linq;

public class EvolutionDroneDatabaseHandlerDeleteTests
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
            Debug.LogError("Failed to tear down database: " + e.Message);
        }
    }

    [Test]
    public void DeleteConfig_DeletesConfigWithGivenID()
    {
        var id = 0;
        var configs = _handler.ListConfigs();
        Assert.IsTrue(configs.Any(c => c.Key == id));

        var generationBefore = _handler.ReadGeneration(id, 0);
        Assert.AreEqual(2, generationBefore.Individuals.Count);

        _handler.DeleteConfig(id);

        var configsAfter = _handler.ListConfigs();
        Assert.IsFalse(configsAfter.Any(c => c.Key == 0));

        var generationAfter = _handler.ReadGeneration(id, 0);
        Assert.AreEqual(0, generationAfter.Individuals.Count);
    }
    
    [Test]
    public void DeleteConfig_DeletesDeletesIndividualsForConfigWithGivenID()
    {
        var id = 0;
        var configs = _handler.ListConfigs();
        Assert.IsTrue(configs.Any(c => c.Key == id));

        var generationBefore = _handler.ReadGeneration(id, 0);
        Assert.AreEqual(2, generationBefore.Individuals.Count);

        _handler.DeleteIndividuals(id);

        var configsAfter = _handler.ListConfigs();
        Assert.IsTrue(configsAfter.Any(c => c.Key == 0));

        var generationAfter = _handler.ReadGeneration(id, 0);
        Assert.AreEqual(0, generationAfter.Individuals.Count);
    }
}
