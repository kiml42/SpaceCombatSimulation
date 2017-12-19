using UnityEngine;
using UnityEditor;
using UnityEngine.TestTools;
using NUnit.Framework;
using System.Collections;
using Assets.src.Evolution;
using Assets.Src.Database;
using System;

public class EvolutionTargetShootingDatabaseHandlerReadTests
{
    private string _dbPath = "/../tmp/TestDB/SpaceCombatSimulationDB2.s3db";
    private string _createCommandPath = "/../Test/TestDB/CreateTestDB.sql";
    EvolutionTargetShootingDatabaseHandler _handler;

    public EvolutionTargetShootingDatabaseHandlerReadTests()
    {
        var initialiser = new DatabaseInitialiser
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
        

        _handler = new EvolutionTargetShootingDatabaseHandler(_dbPath);
    }

    #region top level
    [Test]
    public void ReadDroneConfig_ReadsID()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(0, config.DatabaseId);
    }

    [Test]
    public void ReadDroneConfig_ReadsDifferentID()
    {
        var config = _handler.ReadConfig(1);
        Assert.AreEqual(1, config.DatabaseId);
    }

    [Test]
    public void ReadDroneConfig_ReadsName()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual("Run0", config.RunName);
    }

    [Test]
    public void ReadDroneConfig_ReadsDifferentName()
    {
        var config = _handler.ReadConfig(1);
        Assert.AreEqual("Run1", config.RunName);
    }

    [Test]
    public void ReadDroneConfig_GenerationNumber()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(1, config.GenerationNumber);
    }

    [Test]
    public void ReadDroneConfig_MinMatchesPerIndividual()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(5, config.MinMatchesPerIndividual);
    }

    [Test]
    public void ReadDroneConfig_WinnersFromEachGeneration()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(14, config.WinnersFromEachGeneration);
    }

    [Test]
    public void ReadDroneConfig_MinDronesToSpawn()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(10, config.MinDronesToSpawn);
    }

    [Test]
    public void ReadDroneConfig_ExtraDromnesPerGeneration()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(3, config.ExtraDromnesPerGeneration);
    }

    [Test]
    public void ReadDroneConfig_MaxDronesToSpawn()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(15, config.MaxDronesToSpawn);
    }

    [Test]
    public void ReadDroneConfig_KillScoreMultiplier()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(-4, config.KillScoreMultiplier);
    }

    [Test]
    public void ReadDroneConfig_FlatKillBonus()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(-6, config.FlatKillBonus);
    }

    [Test]
    public void ReadDroneConfig_CompletionBonus()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(-8, config.CompletionBonus);
    }

    [Test]
    public void ReadDroneConfig_DeathPenalty()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(-20, config.DeathPenalty);
    }

    [Test]
    public void ReadDroneConfig_Drones()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual("0;2;1;3;1;1;3;1;5;1;1;1;6;1;1", config.DronesString);
    }
    #endregion

    #region MatchControl
    [Test]
    public void ReadDroneConfig_MatchControl_Id()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(5, config.MatchConfig.Id);
    }

    [Test]
    public void ReadDroneConfig_MatchControl_MatchTimeout()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(25, config.MatchConfig.MatchTimeout);
    }

    [Test]
    public void ReadDroneConfig_MatchControl_WinnerPollPeriod()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(2, config.MatchConfig.WinnerPollPeriod);
    }

    [Test]
    public void ReadConfig_MatchControl_InitialRange()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(6005, config.MatchConfig.InitialRange);
    }

    [Test]
    public void ReadConfig_MatchControl_InitialSpeed()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(5, config.MatchConfig.InitialSpeed);
    }

    [Test]
    public void ReadConfig_MatchControl_RandomInitialSpeed()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(5, config.MatchConfig.RandomInitialSpeed);
    }

    [Test]
    public void ReadConfig_MatchControl_CompetitorsPerTeam()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(6, config.MatchConfig.CompetitorsPerTeam);
    }

    [Test]
    public void ReadConfig_MatchControl_StepForwardProportion()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(0.5f, config.MatchConfig.StepForwardProportion);
    }

    [Test]
    public void ReadConfig_MatchControl_LocationRandomisationRadiai()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual("3;6", config.MatchConfig.LocationRandomisationRadiaiString);
        Assert.AreEqual(3, config.MatchConfig.LocationRandomisationRadiai[0]);
        Assert.AreEqual(6, config.MatchConfig.LocationRandomisationRadiai[1]);
    }

    [Test]
    public void ReadConfig_MatchControl_RandomiseRotation()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(true, config.MatchConfig.RandomiseRotation);
    }
    #endregion

    #region MutationControl
    [Test]
    public void ReadDroneConfig_MutationControl_Id()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(6, config.MutationConfig.Id);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_Mutations()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(7, config.MutationConfig.Mutations);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_AllowedCharacters()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(" xyz ", config.MutationConfig.AllowedCharacters);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_MaxMutationLength()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(4, config.MutationConfig.MaxMutationLength);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_GenomeLength()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(91, config.MutationConfig.GenomeLength);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_GenerationSize()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(27, config.MutationConfig.GenerationSize);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_UseCompletelyRandomDefaultGenome()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(true, config.MutationConfig.UseCompletelyRandomDefaultGenome);
    }

    [Test]
    public void ReadDroneConfig_MutationControl_DefaultGenome()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual("abc", config.MutationConfig.DefaultGenome);
    }
    #endregion
}
