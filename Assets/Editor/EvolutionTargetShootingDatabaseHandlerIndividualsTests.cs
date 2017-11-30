using UnityEngine;
using UnityEditor;
using UnityEngine.TestTools;
using NUnit.Framework;
using System.Collections;
using Assets.src.Evolution;
using Assets.Src.Database;

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
        GenerationTargetShooting generation = _handler.ReadCurrentGeneration();
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
