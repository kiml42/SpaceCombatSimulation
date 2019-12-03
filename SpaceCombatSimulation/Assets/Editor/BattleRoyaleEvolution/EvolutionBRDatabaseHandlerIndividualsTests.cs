using Assets.Src.Database;
using Assets.Src.Evolution;
using NUnit.Framework;
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class EvolutionBRDatabaseHandlerIndividualsTests
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
            Debug.LogError("Failed to tear down database: " + e.Message);
        }
    }

    #region top level
    [Test]
    public void SetCurrentGeneration_ReadsCurrentGeneration()
    {
        Generation generation = _handler.ReadGeneration(2, 0);

        Assert.IsNotNull(generation);
        Assert.AreEqual(2, generation.Individuals.Count);

        var i1 = generation.Individuals.First();

        Assert.AreEqual("123", i1.Genome);
        Assert.AreEqual(3, i1.MatchesAsLastSurvivor);
        Assert.AreEqual(4, i1.MatchesSurvived);
        Assert.AreEqual(4, i1.MatchesPlayed);
        
        Assert.AreEqual("123,321", i1.PreviousCombatantsString);
        Assert.AreEqual(2, i1.PreviousCombatants.Count);
        Assert.AreEqual("123", i1.PreviousCombatants.First());
        Assert.AreEqual("321", i1.PreviousCombatants[1]);

        //BaseMembers
        Assert.AreEqual(42, i1.Score);
        Assert.AreEqual(123, i1.Summary.Cost);
        Assert.AreEqual(6, i1.Summary.ModulesAdded);
        Assert.AreEqual(new Color(1,2,3), i1.Summary.Color);
        Assert.AreEqual("species42", i1.Summary.Species);
        Assert.AreEqual("speciesV42", i1.Summary.VerboseSpecies);
        Assert.AreEqual("subspecies42", i1.Summary.Subspecies);
        Assert.AreEqual("subspeciesV42", i1.Summary.VerboseSubspecies);
    }

    [Test]
    public void UpdateGeneration_SavesCurrentGeneration()
    {
        Generation gen = new Generation();
        gen.Individuals.Add(new Individual("abc"));
        gen.Individuals.Add(new Individual("def"));

        _handler.SaveNewGeneration(gen, 3, 4);

        Generation RetrievedGen1 = _handler.ReadGeneration(3, 4);

        Assert.IsNotNull(RetrievedGen1);
        Assert.AreEqual(2, RetrievedGen1.Individuals.Count);

        var i1 = RetrievedGen1.Individuals.First();

        Assert.AreEqual("abc", i1.Genome);
        Assert.AreEqual(0, i1.Score);
        Assert.AreEqual(0, i1.MatchesAsLastSurvivor);
        Assert.AreEqual("", i1.PreviousCombatantsString);
        Assert.AreEqual(0, i1.PreviousCombatants.Count);

        var i2 = RetrievedGen1.Individuals[1];

        Assert.AreEqual("def", i2.Genome);
        Assert.AreEqual(0, i2.Score);
        Assert.AreEqual(0, i2.MatchesAsLastSurvivor);
        Assert.AreEqual("", i2.PreviousCombatantsString);
        Assert.AreEqual(0, i2.PreviousCombatants.Count);

        var gwA = new GenomeWrapper("abc")
        {
            Budget = 59
        };
        
        gen.RecordMatch(gwA, 5, true, false, 0, new List<string> { "abc", "def" }, true);
        gen.RecordMatch(new GenomeWrapper("def"), 15, false, false, 0, new List<string> { "abc", "def" }, false);

        _handler.UpdateGeneration(gen, 3, 4);

        Generation RetrievedGen2 = _handler.ReadGeneration(3, 4);

        Assert.IsNotNull(RetrievedGen2);
        Assert.AreEqual(2, RetrievedGen2.Individuals.Count);

        var i1b = RetrievedGen2.Individuals.First(i => i.Genome == "abc");
        
        Assert.AreEqual(5, i1b.Score);
        Assert.AreEqual(1, i1b.MatchesAsLastSurvivor);
        Assert.AreEqual(1, i1b.MatchesPlayed);
        Assert.AreEqual(1, i1b.MatchesSurvived);
        Assert.AreEqual("def", i1b.PreviousCombatantsString);
        Assert.AreEqual(1, i1b.PreviousCombatants.Count);
        Assert.AreEqual("def", i1b.PreviousCombatants.First());

        var i2b = RetrievedGen2.Individuals.First(i => i.Genome == "def");
        
        Assert.AreEqual(15, i2b.Score);
        Assert.AreEqual(0, i2b.MatchesAsLastSurvivor);
        Assert.AreEqual(0, i2b.MatchesSurvived);
        Assert.AreEqual(1, i2b.MatchesPlayed);
        Assert.AreEqual("abc", i2b.PreviousCombatantsString);
        Assert.AreEqual(1, i2b.PreviousCombatants.Count);
        Assert.AreEqual("abc", i2b.PreviousCombatants.First());
    }

    [Test]
    public void UpdateGeneration_SavesADraw()
    {
        Generation gen = new Generation();
        gen.Individuals.Add(new Individual("abc"));
        gen.Individuals.Add(new Individual("def"));

        _handler.SaveNewGeneration(gen, 3, 4);

        Generation RetrievedGen1 = _handler.ReadGeneration(3, 4);

        Assert.IsNotNull(RetrievedGen1);
        Assert.AreEqual(2, RetrievedGen1.Individuals.Count);

        var i1 = RetrievedGen1.Individuals.First();

        Assert.AreEqual("abc", i1.Genome);
        Assert.AreEqual(0, i1.Score);
        Assert.AreEqual(0, i1.MatchesAsLastSurvivor);
        Assert.AreEqual(0, i1.MatchesPlayed);
        Assert.AreEqual(0, i1.MatchesSurvived);
        Assert.AreEqual("", i1.PreviousCombatantsString);
        Assert.AreEqual(0, i1.PreviousCombatants.Count);

        var i2 = RetrievedGen1.Individuals[1];

        Assert.AreEqual("def", i2.Genome);
        Assert.AreEqual(0, i2.Score);
        Assert.AreEqual(0, i2.MatchesAsLastSurvivor);
        Assert.AreEqual(0, i2.MatchesPlayed);
        Assert.AreEqual(0, i2.MatchesSurvived);
        Assert.AreEqual("", i2.PreviousCombatantsString);
        Assert.AreEqual(0, i2.PreviousCombatants.Count);

        gen.RecordMatch(new GenomeWrapper("abc"), 7, true, false, 0, new List<string> { "abc" , "def" }, false);
        gen.RecordMatch(new GenomeWrapper("def"), 7, true, false, 0, new List<string> { "abc" , "def" }, false);

        _handler.UpdateGeneration(gen, 3, 4);

        Generation RetrievedGen2 = _handler.ReadGeneration(3, 4);

        Assert.IsNotNull(RetrievedGen2);
        Assert.AreEqual(2, RetrievedGen2.Individuals.Count);

        var i1b = RetrievedGen2.Individuals.First();

        Assert.AreEqual("abc", i1b.Genome);
        Assert.AreEqual(7, i1b.Score);
        Assert.AreEqual(0, i1b.MatchesAsLastSurvivor);
        Assert.AreEqual(1, i1b.MatchesPlayed);
        Assert.AreEqual(1, i1b.MatchesSurvived);
        Assert.AreEqual("def", i1b.PreviousCombatantsString);
        Assert.AreEqual(1, i1b.PreviousCombatants.Count);
        Assert.AreEqual("def", i1b.PreviousCombatants.First());

        var i2b = RetrievedGen2.Individuals[1];

        Assert.AreEqual("def", i2b.Genome);
        Assert.AreEqual(7, i2b.Score);
        Assert.AreEqual(0, i2b.MatchesAsLastSurvivor);
        Assert.AreEqual(1, i2b.MatchesPlayed);
        Assert.AreEqual(1, i2b.MatchesSurvived);
        Assert.AreEqual("abc", i2b.PreviousCombatantsString);
        Assert.AreEqual(1, i2b.PreviousCombatants.Count);
        Assert.AreEqual("abc", i2b.PreviousCombatants.First());
    }

    [Test]
    public void SaveNewGeneration_SavesNewGeneration()
    {
        //TODO make sure the rows don't exist before running this test
        Generation gen = new Generation();
        gen.Individuals.Add(new Individual("abc")
        {
            MatchesSurvived = 5,
            MatchesAsLastSurvivor = 4,
            MatchesPlayed = 7,
            PreviousCombatants = new List<string>
            {
                "6","10"
            },
            Score = 35
        });
        gen.Individuals.Add(new Individual("def"));

        _handler.SaveNewGeneration(gen, 3, 4);

        Generation generation = _handler.ReadGeneration(3, 4);

        Assert.IsNotNull(generation);
        Assert.AreEqual(2, generation.Individuals.Count);

        var i1 = generation.Individuals.First();

        Assert.AreEqual("abc", i1.Genome);
        Assert.AreEqual(35, i1.Score);
        Assert.AreEqual(4, i1.MatchesAsLastSurvivor);
        Assert.AreEqual(5, i1.MatchesSurvived);
        Assert.AreEqual(7, i1.MatchesPlayed);
        Assert.AreEqual("6,10", i1.PreviousCombatantsString);
        Assert.AreEqual(2, i1.PreviousCombatants.Count);
        Assert.AreEqual("6", i1.PreviousCombatants.First());
        Assert.AreEqual("10", i1.PreviousCombatants[1]);
    }

    #endregion


}
