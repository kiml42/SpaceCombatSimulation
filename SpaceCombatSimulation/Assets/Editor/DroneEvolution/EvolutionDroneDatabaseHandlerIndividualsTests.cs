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

public class EvolutionDroneDatabaseHandlerIndividualsTests
{
    private string _dbPathStart = "/../tmp/TestDB/";
    private string _dbPathExtension = ".s3db";
    private string _dbPath;
    private string _createCommandPath = "/../../Test/TestDB/CreateTestDB.sql";
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

    #region top level
    [Test]
    public void SetCurrentGeneration_ReadsCurrentGeneration()
    {
        GenerationDrone generation = _handler.ReadGeneration(0, 0);

        Assert.IsNotNull(generation);
        Assert.AreEqual(2, generation.Individuals.Count);

        var i1 = generation.Individuals.First();

        Assert.AreEqual("123", i1.Genome);
        Assert.AreEqual(42, i1.Score);
        Assert.AreEqual(3, i1.MatchesPlayed);
        Assert.AreEqual(1, i1.MatchesSurvived);
        Assert.AreEqual(2, i1.CompleteKills);
        Assert.AreEqual(5, i1.TotalKills);
        Assert.AreEqual("123,321", i1.MatchScoresString);
        Assert.AreEqual(2, i1.MatchScores.Count);
        Assert.AreEqual(123, i1.MatchScores.First());
        Assert.AreEqual(321, i1.MatchScores[1]);
    }

    [Test]
    public void UpdateGeneration_savesAlteredGeneration()
    {
        GenerationDrone gen = new GenerationDrone();
        gen.Individuals.Add(new IndividualDrone("abc"));
        gen.Individuals.Add(new IndividualDrone("def"));

        _handler.SaveNewGeneration(gen, 3, 4);

        GenerationDrone RetrievedGen1 = _handler.ReadGeneration(3, 4);

        Assert.IsNotNull(RetrievedGen1);
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

        gen.RecordMatch(new GenomeWrapper("abc"), 42, true, true, 15);

        _handler.UpdateGeneration(gen, 3, 4);

        GenerationDrone RetrievedGen2 = _handler.ReadGeneration(3, 4);

        Assert.IsNotNull(RetrievedGen2);
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

        var i2b = RetrievedGen2.Individuals[1];

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
    public void UpdateGeneration_PreservesUnalteredSpecies()
    {
        var RetrievedGen1 = _handler.ReadGeneration(0, 0);

        Assert.IsNotNull(RetrievedGen1);
        Assert.AreEqual(2, RetrievedGen1.Individuals.Count);

        var i1 = RetrievedGen1.Individuals.First(i => i.Genome == "123");
        
        Assert.AreEqual("species42", i1.Summary.Species);
        Assert.AreEqual("subspecies42", i1.Summary.Subspecies);
        Assert.AreEqual("speciesV42", i1.Summary.VerboseSpecies);
        Assert.AreEqual("subspeciesV42", i1.Summary.VerboseSubspecies);

        var i2 = RetrievedGen1.Individuals.First(i => i.Genome == "148");
        
        Assert.AreEqual("species", i2.Summary.Species);
        Assert.AreEqual("subspecies", i2.Summary.Subspecies);
        Assert.AreEqual("speciesVerbose", i2.Summary.VerboseSpecies);
        Assert.AreEqual("subspeciesVerbose", i2.Summary.VerboseSubspecies);

        RetrievedGen1.RecordMatch(new GenomeWrapper("123"), 42, true, true, 15);

        _handler.UpdateGeneration(RetrievedGen1, 3, 4);

        GenerationDrone RetrievedGen2 = _handler.ReadGeneration(0, 0);

        Assert.IsNotNull(RetrievedGen2);
        Assert.AreEqual(2, RetrievedGen2.Individuals.Count);
        
        var i1b = RetrievedGen2.Individuals.First(i => i.Genome == "123");
        
        Assert.AreEqual("species42", i1b.Summary.Species);
        Assert.AreEqual("subspecies42", i1b.Summary.Subspecies);
        Assert.AreEqual("speciesV42", i1b.Summary.VerboseSpecies);
        Assert.AreEqual("subspeciesV42", i1b.Summary.VerboseSubspecies);

        var i2b = RetrievedGen2.Individuals.First(i => i.Genome == "148");
        
        Assert.AreEqual("species", i2b.Summary.Species);
        Assert.AreEqual("subspecies", i2b.Summary.Subspecies);
        Assert.AreEqual("speciesVerbose", i2b.Summary.VerboseSpecies);
        Assert.AreEqual("subspeciesVerbose", i2b.Summary.VerboseSubspecies);
    }

    [Test]
    public void SetCurrentGeneration_SavesNewGeneration()
    {
        //TODO make sure the rows don't exist before running this test
        GenerationDrone gen = new GenerationDrone();
        gen.Individuals.Add(new IndividualDrone("abc")
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
        gen.Individuals.Add(new IndividualDrone("def"));

        _handler.SaveNewGeneration(gen, 3, 4);

        GenerationDrone generation = _handler.ReadGeneration(3, 4);

        Assert.IsNotNull(generation);
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
}
