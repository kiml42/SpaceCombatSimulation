using UnityEngine;
using UnityEditor;
using UnityEngine.TestTools;
using NUnit.Framework;
using System.Collections;
using Assets.src.Evolution;
using Assets.Src.Database;
using System.Linq;
using Assets.Src.Evolution;
using System.Collections.Generic;
using System;
using System.IO;

public class EvolutionTargetShootingDatabaseHandlerIndividualsTests
{
    private string _dbPathStart = "/../tmp/TestDB/";
    private string _dbPathExtension = ".s3db";
    private string _dbPath;
    private string _createCommandPath = "/../Test/TestDB/CreateTestDB.sql";
    EvolutionTargetShootingControler _toConfigure;
    EvolutionTargetShootingDatabaseHandler _handler;
    DatabaseInitialiser initialiser;
    
    [SetUp]
    public void Setup()
    {
        _dbPath = _dbPathStart + Guid.NewGuid().ToString() + _dbPathExtension;

        if (!Directory.Exists(Application.dataPath + _dbPathStart))
        {
            Debug.Log("Creating dir: " + Application.dataPath + _dbPathStart);
            Directory.CreateDirectory(Application.dataPath + _dbPathStart);
        }

        initialiser = new DatabaseInitialiser
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
    public void SetCurrentGeneration_ReadsCurrentGeneration()
    {
        GenerationTargetShooting generation = _handler.ReadGeneration(0, 0);

        Assert.NotNull(generation);
        Assert.AreEqual(2, generation.Individuals.Count);

        var i1 = generation.Individuals.First();

        Assert.AreEqual("123", i1.Genome);
        Assert.AreEqual(42, i1.Score);
        Assert.AreEqual(3, i1.MatchesPlayed);
        Assert.AreEqual(1, i1.MatchesSurvived);
        Assert.AreEqual(0, i1.CompleteKills);
        Assert.AreEqual(5, i1.TotalKills);
        Assert.AreEqual("123,321", i1.MatchScoresString);
        Assert.AreEqual(2, i1.MatchScores.Count);
        Assert.AreEqual(123, i1.MatchScores.First());
        Assert.AreEqual(321, i1.MatchScores[1]);
    }

    [Test]
    public void SetCurrentGeneration_SavesCurrentGeneration()
    {
        //TODO make sure the rows don't exist before running this test
        GenerationTargetShooting gen = new GenerationTargetShooting();
        gen.Individuals.Add(new IndividualTargetShooting("abc"));
        gen.Individuals.Add(new IndividualTargetShooting("def"));

        _handler.SaveNewGeneration(gen, 3, 4);

        GenerationTargetShooting RetrievedGen1 = _handler.ReadGeneration(3, 4);

        Assert.NotNull(RetrievedGen1);
        Assert.AreEqual(2, RetrievedGen1.Individuals.Count);

        var i1 = RetrievedGen1.Individuals.First();

        Assert.AreEqual("abc", i1.Genome);
        Assert.AreEqual(0, i1.Score);
        Assert.AreEqual(0, i1.MatchesPlayed);
        Assert.AreEqual(0, i1.MatchesSurvived);
        Assert.AreEqual(0, i1.CompleteKills);
        Assert.AreEqual(0, i1.TotalKills);
        Assert.AreEqual("", i1.MatchScoresString);
        Assert.AreEqual(0, i1.MatchScores.Count);

        var i2 = RetrievedGen1.Individuals[1];

        Assert.AreEqual("def", i2.Genome);
        Assert.AreEqual(0, i2.Score);
        Assert.AreEqual(0, i2.MatchesPlayed);
        Assert.AreEqual(0, i2.MatchesSurvived);
        Assert.AreEqual(0, i2.CompleteKills);
        Assert.AreEqual(0, i2.TotalKills);
        Assert.AreEqual("", i2.MatchScoresString);
        Assert.AreEqual(0, i2.MatchScores.Count);

        gen.RecordMatch("abc", 42, true, true, 15);

        _handler.UpdateGeneration(gen, 3, 4);

        GenerationTargetShooting RetrievedGen2 = _handler.ReadGeneration(3, 4);

        Assert.NotNull(RetrievedGen2);
        Assert.AreEqual(2, RetrievedGen2.Individuals.Count);

        var i1b = RetrievedGen2.Individuals.First();

        Assert.AreEqual("abc", i1b.Genome);
        Assert.AreEqual(42, i1b.Score);
        Assert.AreEqual(1, i1b.MatchesPlayed);
        Assert.AreEqual(1, i1b.MatchesSurvived);
        Assert.AreEqual(1, i1b.CompleteKills);
        Assert.AreEqual(15, i1b.TotalKills);
        Assert.AreEqual("42", i1b.MatchScoresString);
        Assert.AreEqual(1, i1b.MatchScores.Count);
        Assert.AreEqual(42, i1b.MatchScores.First());

        var i2b = RetrievedGen1.Individuals[1];

        Assert.AreEqual("def", i2b.Genome);
        Assert.AreEqual(0, i2b.Score);
        Assert.AreEqual(0, i2b.MatchesPlayed);
        Assert.AreEqual(0, i2b.MatchesSurvived);
        Assert.AreEqual(0, i2b.CompleteKills);
        Assert.AreEqual(0, i2b.TotalKills);
        Assert.AreEqual("", i2b.MatchScoresString);
        Assert.AreEqual(0, i2b.MatchScores.Count);
    }

    [Test]
    public void SetCurrentGeneration_SavesNewGeneration()
    {
        //TODO make sure the rows don't exist before running this test
        GenerationTargetShooting gen = new GenerationTargetShooting();
        gen.Individuals.Add(new IndividualTargetShooting("abc")
        {
            CompleteKills = 2,
            MatchesPlayed = 4,
            MatchesSurvived = 1,
            MatchScores = new List<float>
            {
                6,10
            },
            Score = 35,
            TotalKills = 7
        });
        gen.Individuals.Add(new IndividualTargetShooting("def"));

        _handler.SaveNewGeneration(gen, 3, 4);

        GenerationTargetShooting generation = _handler.ReadGeneration(3, 4);

        Assert.NotNull(generation);
        Assert.AreEqual(2, generation.Individuals.Count);

        var i1 = generation.Individuals.First();

        Assert.AreEqual("abc", i1.Genome);
        Assert.AreEqual(35, i1.Score);
        Assert.AreEqual(4, i1.MatchesPlayed);
        Assert.AreEqual(1, i1.MatchesSurvived);
        Assert.AreEqual(2, i1.CompleteKills);
        Assert.AreEqual(7, i1.TotalKills);
        Assert.AreEqual("6,10", i1.MatchScoresString);
        Assert.AreEqual(2, i1.MatchScores.Count);
        Assert.AreEqual(6, i1.MatchScores.First());
        Assert.AreEqual(10, i1.MatchScores[1]);
    }

    #endregion

    [TearDown]
    public void TearDown()
    {
        try
        {
            initialiser.DropDatabase();
        } catch (Exception e)
        {
            Debug.LogWarning("Failed to tear down database: " + e.Message);
        }
    }

}
