using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using Assets.Src.Evolution;

public class EditMatchConfig : MonoBehaviour {
    private int LoadedId;
    private bool _hasLoadedExisting = false;

    public InputField MatchTimeout;
    public InputField WinnerPollPeriod;
    public InputField InitialRange;
    public InputField InitialSpeed;
    public InputField RandomInitialSpeed;
    public InputField CompetitorsPerTeam;
  
    public void LoadConfig(MatchConfig config, bool isPreExisting)
    {
        MatchTimeout.text = config.MatchTimeout.ToString();
        WinnerPollPeriod.text = config.WinnerPollPeriod.ToString();
        InitialRange.text = config.InitialRange.ToString();
        InitialSpeed.text = config.InitialSpeed.ToString();
        RandomInitialSpeed.text = config.RandomInitialSpeed.ToString();
        CompetitorsPerTeam.text = config.CompetitorsPerTeam.ToString();

        LoadedId = config.Id;
        _hasLoadedExisting = isPreExisting;
    }

    public MatchConfig ReadFromControls()
    {
        var config = new MatchConfig()
        {
            MatchTimeout = float.Parse(MatchTimeout.text),
            WinnerPollPeriod = float.Parse(WinnerPollPeriod.text),
            InitialRange = float.Parse(InitialRange.text),
            InitialSpeed = float.Parse(InitialSpeed.text),
            RandomInitialSpeed = float.Parse(RandomInitialSpeed.text),
            CompetitorsPerTeam = int.Parse(CompetitorsPerTeam.text)
        };
        if (_hasLoadedExisting)
        {
            config.Id = LoadedId;
        }

        return config;
    }
}
