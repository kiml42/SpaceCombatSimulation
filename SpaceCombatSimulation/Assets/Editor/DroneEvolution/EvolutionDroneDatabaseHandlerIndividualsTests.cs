using Assets.Src.Database;
using Assets.Src.Evolution;
using NUnit.Framework;
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class EvolutionDroneDatabaseHandlerIndividualsTests
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
    public void SetCurrentGeneration_ReadsCurrentGeneration()
    {
        var generation = _handler.ReadGeneration(0, 0);

        Assert.IsNotNull(generation);
        Assert.AreEqual(2, generation.Individuals.Count);

        var i1 = generation.Individuals.First();

        Assert.AreEqual("123", i1.Genome);
        Assert.AreEqual(42, i1.Score);
        Assert.AreEqual(3, i1.MatchesPlayed);
        Assert.AreEqual(1, i1.MatchesSurvived);
        Assert.AreEqual(2, i1.KilledAllDrones);
        Assert.AreEqual(5, i1.TotalDroneKills);
        Assert.AreEqual("123,321", i1.MatchScoresString);
        Assert.AreEqual(2, i1.MatchScores.Count);
        Assert.AreEqual(123, i1.MatchScores.First());
        Assert.AreEqual(321, i1.MatchScores[1]);
    }

    [Test]
    public void UpdateGeneration_savesAlteredGeneration()
    {
        var gen = new Generation();
        gen.Individuals.Add(new Individual("abc"));
        gen.Individuals.Add(new Individual("def"));

        _handler.SaveNewGeneration(gen, 3, 4);

        var RetrievedGen1 = _handler.ReadGeneration(3, 4);

        Assert.IsNotNull(RetrievedGen1);
        Assert.AreEqual(2, RetrievedGen1.Individuals.Count);

        var i1 = RetrievedGen1.Individuals.First();

        Assert.AreEqual("abc", i1.Genome);
        Assert.AreEqual(0, i1.Score);
        Assert.AreEqual(0, i1.MatchesPlayed);
        Assert.AreEqual(0, i1.MatchesSurvived);
        Assert.AreEqual(0, i1.KilledAllDrones);
        Assert.AreEqual(0, i1.TotalDroneKills);
        Assert.AreEqual("", i1.MatchScoresString);
        Assert.AreEqual(0, i1.MatchScores.Count);

        var i2 = RetrievedGen1.Individuals[1];

        Assert.AreEqual("def", i2.Genome);
        Assert.AreEqual(0, i2.Score);
        Assert.AreEqual(0, i2.MatchesPlayed);
        Assert.AreEqual(0, i2.MatchesSurvived);
        Assert.AreEqual(0, i2.KilledAllDrones);
        Assert.AreEqual(0, i2.TotalDroneKills);
        Assert.AreEqual("", i2.MatchScoresString);
        Assert.AreEqual(0, i2.MatchScores.Count);

        gen.RecordMatch(new GenomeWrapper("abc"), 42, true, true, 15, new List<string> { "abc" }, false);

        _handler.UpdateGeneration(gen, 3, 4);

        var RetrievedGen2 = _handler.ReadGeneration(3, 4);

        Assert.IsNotNull(RetrievedGen2);
        Assert.AreEqual(2, RetrievedGen2.Individuals.Count);

        var i1b = RetrievedGen2.Individuals.First();

        Assert.AreEqual("abc", i1b.Genome);
        Assert.AreEqual(42, i1b.Score);
        Assert.AreEqual(1, i1b.MatchesPlayed);
        Assert.AreEqual(1, i1b.MatchesSurvived);
        Assert.AreEqual(1, i1b.KilledAllDrones);
        Assert.AreEqual(15, i1b.TotalDroneKills);
        Assert.AreEqual("42", i1b.MatchScoresString);
        Assert.AreEqual(1, i1b.MatchScores.Count);
        Assert.AreEqual(42, i1b.MatchScores.First());

        var i2b = RetrievedGen2.Individuals[1];

        Assert.AreEqual("def", i2b.Genome);
        Assert.AreEqual(0, i2b.Score);
        Assert.AreEqual(0, i2b.MatchesPlayed);
        Assert.AreEqual(0, i2b.MatchesSurvived);
        Assert.AreEqual(0, i2b.KilledAllDrones);
        Assert.AreEqual(0, i2b.TotalDroneKills);
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

        RetrievedGen1.RecordMatch(new GenomeWrapper("123"), 42, true, true, 15, new List<string> { "123" }, false);

        _handler.UpdateGeneration(RetrievedGen1, 3, 4);

        var RetrievedGen2 = _handler.ReadGeneration(0, 0);

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
        var gen = new Generation();
        gen.Individuals.Add(new Individual("abc")
        {
            KilledAllDrones = 2,
            MatchesPlayed = 4,
            MatchesSurvived = 1,
            MatchScores = new List<float>
            {
                6,10
            },
            Score = 35,
            TotalDroneKills = 7
        });
        gen.Individuals.Add(new Individual("def"));

        _handler.SaveNewGeneration(gen, 3, 4);

        var generation = _handler.ReadGeneration(3, 4);

        Assert.IsNotNull(generation);
        Assert.AreEqual(2, generation.Individuals.Count);

        var i1 = generation.Individuals.First();

        Assert.AreEqual("abc", i1.Genome);
        Assert.AreEqual(35, i1.Score);
        Assert.AreEqual(4, i1.MatchesPlayed);
        Assert.AreEqual(1, i1.MatchesSurvived);
        Assert.AreEqual(2, i1.KilledAllDrones);
        Assert.AreEqual(7, i1.TotalDroneKills);
        Assert.AreEqual("6,10", i1.MatchScoresString);
        Assert.AreEqual(2, i1.MatchScores.Count);
        Assert.AreEqual(6, i1.MatchScores.First());
        Assert.AreEqual(10, i1.MatchScores[1]);
    }

    #endregion
}
