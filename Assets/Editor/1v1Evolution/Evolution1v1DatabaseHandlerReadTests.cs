using UnityEngine;
using UnityEditor;
using UnityEngine.TestTools;
using NUnit.Framework;
using System.Collections;
using Assets.src.Evolution;
using Assets.Src.Database;
using System;

public class Evolution1v1DatabaseHandlerReadTests
{
    private string _dbPath = "/../tmp/TestDB/SpaceCombatSimulationDB2.s3db";
    private string _createCommandPath = "/../Test/TestDB/CreateTestDB.sql";
    Evolution1v1DatabaseHandler _handler;

    public Evolution1v1DatabaseHandlerReadTests()
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

        _handler = new Evolution1v1DatabaseHandler(_dbPath);
    }

    #region top level
    [Test]
    public void ReadConfig_ReadsID()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(0, config.DatabaseId);
    }

    [Test]
    public void ReadConfig_ReadsDifferentID()
    {
        var config = _handler.ReadConfig(1);
        Assert.AreEqual(1, config.DatabaseId);
    }

    [Test]
    public void ReadConfig_ReadsName()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual("Default1v1", config.RunName);
    }

    [Test]
    public void ReadConfig_ReadsDifferentName()
    {
        var config = _handler.ReadConfig(1);
        Assert.AreEqual("Default1v1b", config.RunName);
    }

    [Test]
    public void ReadConfig_GenerationNumber()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(2, config.GenerationNumber);
    }

    [Test]
    public void ReadConfig_MinMatchesPerIndividual()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(3, config.MinMatchesPerIndividual);
    }

    [Test]
    public void ReadConfig_WinnersFromEachGeneration()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(5, config.WinnersFromEachGeneration);
    }

    [Test]
    public void ReadConfig_SuddenDeathDamage()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(1, config.SuddenDeathDamage);
    }

    [Test]
    public void ReadConfig_SuddenDeathReloadTime()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(5, config.SuddenDeathReloadTime);
    }
    #endregion

    #region MatchControl
    [Test]
    public void ReadConfig_MatchControl_Id()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(2, config.MatchConfig.Id);
    }

    [Test]
    public void ReadConfig_MatchControl_MatchTimeout()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(26, config.MatchConfig.MatchTimeout);
    }

    [Test]
    public void ReadConfig_MatchControl_WinnerPollPeriod()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(3, config.MatchConfig.WinnerPollPeriod);
    }

    [Test]
    public void ReadConfig_MatchControl_InitialRange()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(6002, config.MatchConfig.InitialRange);
    }

    [Test]
    public void ReadConfig_MatchControl_InitialSpeed()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(2, config.MatchConfig.InitialSpeed);
    }

    [Test]
    public void ReadConfig_MatchControl_RandomInitialSpeed()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(2, config.MatchConfig.RandomInitialSpeed);
    }

    [Test]
    public void ReadConfig_MatchControl_CompetitorsPerTeam()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(3, config.MatchConfig.CompetitorsPerTeam);
    }

    [Test]
    public void ReadConfig_MatchControl_StepForwardProportion()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(0.2f, config.MatchConfig.StepForwardProportion);
    }

    [Test]
    public void ReadConfig_MatchControl_LocationRandomisationRadiai()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual("7,342", config.MatchConfig.LocationRandomisationRadiaiString);
        Assert.AreEqual(7, config.MatchConfig.LocationRandomisationRadiai[0]);
        Assert.AreEqual(342, config.MatchConfig.LocationRandomisationRadiai[1]);
    }

    [Test]
    public void ReadConfig_MatchControl_RandomiseRotation()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(false, config.MatchConfig.RandomiseRotation);
    }
    #endregion

    #region MutationControl
    [Test]
    public void ReadConfig_MutationControl_Id()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(2, config.MutationConfig.Id);
    }

    [Test]
    public void ReadConfig_MutationControl_Mutations()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(17, config.MutationConfig.Mutations);
    }

    [Test]
    public void ReadConfig_MutationControl_AllowedCharacters()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(" xyzq ", config.MutationConfig.AllowedCharacters);
    }

    [Test]
    public void ReadConfig_MutationControl_MaxMutationLength()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(14, config.MutationConfig.MaxMutationLength);
    }

    [Test]
    public void ReadConfig_MutationControl_GenomeLength()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(191, config.MutationConfig.GenomeLength);
    }

    [Test]
    public void ReadConfig_MutationControl_GenerationSize()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(127, config.MutationConfig.GenerationSize);
    }

    [Test]
    public void ReadConfig_MutationControl_UseCompletelyRandomDefaultGenome()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual(true, config.MutationConfig.UseCompletelyRandomDefaultGenome);
    }

    [Test]
    public void ReadConfig_MutationControl_DefaultGenome()
    {
        var config = _handler.ReadConfig(0);
        Assert.AreEqual("abc1", config.MutationConfig.DefaultGenome);
    }
    #endregion
}
