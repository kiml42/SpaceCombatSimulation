using UnityEngine;
using UnityEditor;
using UnityEngine.TestTools;
using NUnit.Framework;
using System.Collections;
using Assets.src.Evolution;
using Assets.Src.Database;

public class EvolutionTargetShootingDatabaseHandlerTests
{
    private string _dbPath = "/../Test/TestDB/SpaceCombatSimulationDB.s3db";
    [Test]
    public void ReadDroneConfig_ReadsConfig()
    {
        var go = new GameObject();

        EvolutionTargetShootingControler toConfigure = go.AddComponent<EvolutionTargetShootingControler>();

        toConfigure.ShipConfig = go.AddComponent<EvolutionShipConfig>();
        toConfigure.FileManager = go.AddComponent<EvolutionFileManager>();
        toConfigure.MutationControl = go.AddComponent<EvolutionMutationController>();
        toConfigure.MatchControl = go.AddComponent<EvolutionMatchController>();
        
        var handler = new EvolutionTargetShootingDatabaseHandler(toConfigure)
        {
            DatabasePath = _dbPath
        };

        handler.ReadDroneConfig(0);

        Assert.AreEqual(0, toConfigure.DatabaseId);
        Assert.AreEqual("Unnamed", toConfigure.Name);
    }
}
