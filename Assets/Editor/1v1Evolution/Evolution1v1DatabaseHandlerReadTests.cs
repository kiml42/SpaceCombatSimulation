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
    Evolution1v1Controler _toConfigure;
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

        var go = new GameObject();

        _toConfigure = go.AddComponent<Evolution1v1Controler>();

        _toConfigure.ShipConfig = go.AddComponent<EvolutionShipConfig>();
        _toConfigure.MutationControl = go.AddComponent<EvolutionMutationController>();
        _toConfigure.MatchControl = go.AddComponent<EvolutionMatchController>();

        _handler = new Evolution1v1DatabaseHandler(_toConfigure, _dbPath);
    }

    #region top level
    [Test]
    public void ReadConfig_ReadsID()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual(0, _toConfigure.DatabaseId);
    }

    [Test]
    public void ReadConfig_ReadsDifferentID()
    {
        _handler.ReadConfig(1);
        Assert.AreEqual(1, _toConfigure.DatabaseId);
    }

    [Test]
    public void ReadConfig_ReadsName()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual("Default1v1", _toConfigure.RunName);
    }

    [Test]
    public void ReadConfig_ReadsDifferentName()
    {
        _handler.ReadConfig(1);
        Assert.AreEqual("Default1v1b", _toConfigure.RunName);
    }

    [Test]
    public void ReadConfig_GenerationNumber()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual(2, _toConfigure.GenerationNumber);
    }

    [Test]
    public void ReadConfig_MinMatchesPerIndividual()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual(3, _toConfigure.MinMatchesPerIndividual);
    }

    [Test]
    public void ReadConfig_WinnersFromEachGeneration()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual(5, _toConfigure.WinnersFromEachGeneration);
    }

    [Test]
    public void ReadConfig_SuddenDeathDamage()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual(1, _toConfigure.SuddenDeathDamage);
    }

    [Test]
    public void ReadConfig_SuddenDeathReloadTime()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual(5, _toConfigure.SuddenDeathReloadTime);
    }
    #endregion

    #region MatchControl
    [Test]
    public void ReadConfig_MatchControl_Id()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual(2, _toConfigure.MatchControl.Id);
    }

    [Test]
    public void ReadConfig_MatchControl_MatchTimeout()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual(26, _toConfigure.MatchControl.MatchTimeout);
    }

    [Test]
    public void ReadConfig_MatchControl_WinnerPollPeriod()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual(3, _toConfigure.MatchControl.WinnerPollPeriod);
    }
    #endregion

    #region MutationControl
    [Test]
    public void ReadConfig_MutationControl_Id()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual(2, _toConfigure.MutationControl.Id);
    }

    [Test]
    public void ReadConfig_MutationControl_Mutations()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual(17, _toConfigure.MutationControl.Mutations);
    }

    [Test]
    public void ReadConfig_MutationControl_AllowedCharacters()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual(" xyzq ", _toConfigure.MutationControl.AllowedCharacters);
    }

    [Test]
    public void ReadConfig_MutationControl_MaxMutationLength()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual(14, _toConfigure.MutationControl.MaxMutationLength);
    }

    [Test]
    public void ReadConfig_MutationControl_GenomeLength()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual(191, _toConfigure.MutationControl.GenomeLength);
    }

    [Test]
    public void ReadConfig_MutationControl_GenerationSize()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual(127, _toConfigure.MutationControl.GenerationSize);
    }

    [Test]
    public void ReadConfig_MutationControl_UseCompletelyRandomDefaultGenome()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual(true, _toConfigure.MutationControl.UseCompletelyRandomDefaultGenome);
    }

    [Test]
    public void ReadConfig_MutationControl_DefaultGenome()
    {
        _handler.ReadConfig(0);
        Assert.AreEqual("abc1", _toConfigure.MutationControl.DefaultGenome);
    }
    #endregion
}
