using UnityEngine;
using UnityEditor;
using UnityEngine.TestTools;
using NUnit.Framework;
using System.Collections;
using Assets.src.Evolution;
using Assets.Src.Database;
using System.Linq;

public class EvolutionTargetShootingDatabaseHandlerIndividualsTests
{
    private string _dbPath = "/../Test/TestDB/SpaceCombatSimulationDB.s3db";
    EvolutionTargetShootingControler _toConfigure;
    EvolutionTargetShootingDatabaseHandler _handler;

    public EvolutionTargetShootingDatabaseHandlerIndividualsTests()
    {
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
        GenerationTargetShooting generation = _handler.ReadGeneration(0,0);

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
        GenerationTargetShooting gen = new GenerationTargetShooting();
        var generation = _handler.SaveCurrentGeneration(gen);
    }

    [Test]
    public void SetCurrentGeneration_SavesNewGeneration()
    {
        GenerationTargetShooting gen = new GenerationTargetShooting();
        var generation = _handler.SaveNewGeneration(gen, 4);
    }

    #endregion
}
