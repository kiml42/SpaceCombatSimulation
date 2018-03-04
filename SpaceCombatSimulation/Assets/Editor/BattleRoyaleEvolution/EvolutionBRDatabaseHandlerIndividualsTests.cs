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

public class EvolutionBRDatabaseHandlerIndividualsTests
{
    private string _dbPathStart = "/../tmp/TestDB/";
    private string _dbPathExtension = ".s3db";
    private string _dbPath;
    private string _createCommandPath = "/../Test/TestDB/CreateTestDB.sql";
    Evolution1v1DatabaseHandler _handler;
    DatabaseInitialiser _initialiser;
    
    [SetUp]
    public void Setup()
    {
        _dbPath = _dbPathStart + Guid.NewGuid().ToString() + _dbPathExtension;
        
        _initialiser = new DatabaseInitialiser
        {
            DatabasePath = _dbPath
        };
        
        _handler = new Evolution1v1DatabaseHandler(_dbPath, _createCommandPath);
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
        GenerationBr generation = _handler.ReadGeneration(2, 0);

        Assert.NotNull(generation);
        Assert.AreEqual(2, generation.Individuals.Count);

        var i1 = generation.Individuals.First();

        Assert.AreEqual("123", i1.Genome);
        Assert.AreEqual(3, i1.Wins);
        Assert.AreEqual(1, i1.Draws);
        Assert.AreEqual(0, i1.Loses);
        
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
        GenerationBr gen = new GenerationBr();
        gen.Individuals.Add(new IndividualBr("abc"));
        gen.Individuals.Add(new IndividualBr("def"));

        _handler.SaveNewGeneration(gen, 3, 4);

        GenerationBr RetrievedGen1 = _handler.ReadGeneration(3, 4);

        Assert.NotNull(RetrievedGen1);
        Assert.AreEqual(2, RetrievedGen1.Individuals.Count);

        var i1 = RetrievedGen1.Individuals.First();

        Assert.AreEqual("abc", i1.Genome);
        Assert.AreEqual(0, i1.Score);
        Assert.AreEqual(0, i1.Wins);
        Assert.AreEqual(0, i1.Draws);
        Assert.AreEqual(0, i1.Loses);
        Assert.AreEqual("", i1.PreviousCombatantsString);
        Assert.AreEqual(0, i1.PreviousCombatants.Count);

        var i2 = RetrievedGen1.Individuals[1];

        Assert.AreEqual("def", i2.Genome);
        Assert.AreEqual(0, i2.Score);
        Assert.AreEqual(0, i2.Wins);
        Assert.AreEqual(0, i2.Draws);
        Assert.AreEqual(0, i2.Loses);
        Assert.AreEqual("", i2.PreviousCombatantsString);
        Assert.AreEqual(0, i2.PreviousCombatants.Count);

        var gwA = new GenomeWrapper("abc")
        {
            Budget = 59
        };
        
        gen.RecordMatch(gwA, new GenomeWrapper("def"), "abc", 5, 15, 7);

        _handler.UpdateGeneration(gen, 3, 4);

        GenerationBr RetrievedGen2 = _handler.ReadGeneration(3, 4);

        Assert.NotNull(RetrievedGen2);
        Assert.AreEqual(2, RetrievedGen2.Individuals.Count);

        var i1b = RetrievedGen2.Individuals.First();

        Assert.AreEqual("abc", i1b.Genome);
        Assert.AreEqual(5, i1b.Score);
        Assert.AreEqual(1, i1b.Wins);
        Assert.AreEqual(0, i1b.Draws);
        Assert.AreEqual(0, i1b.Loses);
        Assert.AreEqual("def", i1b.PreviousCombatantsString);
        Assert.AreEqual(1, i1b.PreviousCombatants.Count);
        Assert.AreEqual("def", i1b.PreviousCombatants.First());

        var i2b = RetrievedGen2.Individuals[1];

        Assert.AreEqual("def", i2b.Genome);
        Assert.AreEqual(15, i2b.Score);
        Assert.AreEqual(0, i2b.Wins);
        Assert.AreEqual(0, i2b.Draws);
        Assert.AreEqual(1, i2b.Loses);
        Assert.AreEqual("abc", i2b.PreviousCombatantsString);
        Assert.AreEqual(1, i2b.PreviousCombatants.Count);
        Assert.AreEqual("abc", i2b.PreviousCombatants.First());
    }

    [Test]
    public void UpdateGeneration_SavesADraw()
    {
        GenerationBr gen = new GenerationBr();
        gen.Individuals.Add(new IndividualBr("abc"));
        gen.Individuals.Add(new IndividualBr("def"));

        _handler.SaveNewGeneration(gen, 3, 4);

        GenerationBr RetrievedGen1 = _handler.ReadGeneration(3, 4);

        Assert.NotNull(RetrievedGen1);
        Assert.AreEqual(2, RetrievedGen1.Individuals.Count);

        var i1 = RetrievedGen1.Individuals.First();

        Assert.AreEqual("abc", i1.Genome);
        Assert.AreEqual(0, i1.Score);
        Assert.AreEqual(0, i1.Wins);
        Assert.AreEqual(0, i1.Draws);
        Assert.AreEqual(0, i1.Loses);
        Assert.AreEqual("", i1.PreviousCombatantsString);
        Assert.AreEqual(0, i1.PreviousCombatants.Count);

        var i2 = RetrievedGen1.Individuals[1];

        Assert.AreEqual("def", i2.Genome);
        Assert.AreEqual(0, i2.Score);
        Assert.AreEqual(0, i2.Wins);
        Assert.AreEqual(0, i2.Draws);
        Assert.AreEqual(0, i2.Loses);
        Assert.AreEqual("", i2.PreviousCombatantsString);
        Assert.AreEqual(0, i2.PreviousCombatants.Count);

        gen.RecordMatch(new GenomeWrapper("abc"), new GenomeWrapper("def"), null, 5, 15, 7);

        _handler.UpdateGeneration(gen, 3, 4);

        GenerationBr RetrievedGen2 = _handler.ReadGeneration(3, 4);

        Assert.NotNull(RetrievedGen2);
        Assert.AreEqual(2, RetrievedGen2.Individuals.Count);

        var i1b = RetrievedGen2.Individuals.First();

        Assert.AreEqual("abc", i1b.Genome);
        Assert.AreEqual(7, i1b.Score);
        Assert.AreEqual(0, i1b.Wins);
        Assert.AreEqual(1, i1b.Draws);
        Assert.AreEqual(0, i1b.Loses);
        Assert.AreEqual("def", i1b.PreviousCombatantsString);
        Assert.AreEqual(1, i1b.PreviousCombatants.Count);
        Assert.AreEqual("def", i1b.PreviousCombatants.First());

        var i2b = RetrievedGen2.Individuals[1];

        Assert.AreEqual("def", i2b.Genome);
        Assert.AreEqual(7, i2b.Score);
        Assert.AreEqual(0, i2b.Wins);
        Assert.AreEqual(1, i2b.Draws);
        Assert.AreEqual(0, i2b.Loses);
        Assert.AreEqual("abc", i2b.PreviousCombatantsString);
        Assert.AreEqual(1, i2b.PreviousCombatants.Count);
        Assert.AreEqual("abc", i2b.PreviousCombatants.First());
    }

    [Test]
    public void SaveNewGeneration_SavesNewGeneration()
    {
        //TODO make sure the rows don't exist before running this test
        GenerationBr gen = new GenerationBr();
        gen.Individuals.Add(new IndividualBr("abc")
        {
            Loses = 2,
            Wins = 4,
            Draws = 1,
            PreviousCombatants = new List<string>
            {
                "6","10"
            },
            Score = 35
        });
        gen.Individuals.Add(new IndividualBr("def"));

        _handler.SaveNewGeneration(gen, 3, 4);

        GenerationBr generation = _handler.ReadGeneration(3, 4);

        Assert.NotNull(generation);
        Assert.AreEqual(2, generation.Individuals.Count);

        var i1 = generation.Individuals.First();

        Assert.AreEqual("abc", i1.Genome);
        Assert.AreEqual(35, i1.Score);
        Assert.AreEqual(4, i1.Wins);
        Assert.AreEqual(1, i1.Draws);
        Assert.AreEqual(2, i1.Loses);
        Assert.AreEqual("6,10", i1.PreviousCombatantsString);
        Assert.AreEqual(2, i1.PreviousCombatants.Count);
        Assert.AreEqual("6", i1.PreviousCombatants.First());
        Assert.AreEqual("10", i1.PreviousCombatants[1]);
    }

    #endregion


}
