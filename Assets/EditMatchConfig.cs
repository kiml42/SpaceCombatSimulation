using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using Assets.Src.Evolution;

public class EditMatchConfig : MonoBehaviour {
    
    public InputField MatchTimeout;
    public InputField WinnerPollPeriod;
    public InputField InitialRange;
    public InputField InitialSpeed;
    public InputField RandomInitialSpeed;
    public InputField CompetitorsPerTeam;
  
    public void LoadConfig(MatchConfig config)
    {
        MatchTimeout.text = config.MatchTimeout.ToString();
        WinnerPollPeriod.text = config.WinnerPollPeriod.ToString();
        InitialRange.text = config.InitialRange.ToString();
        InitialSpeed.text = config.InitialSpeed.ToString();
        RandomInitialSpeed.text = config.RandomInitialSpeed.ToString();
        CompetitorsPerTeam.text = config.CompetitorsPerTeam.ToString();
    }

    public MutationConfig ReadFromControls()
    {
        var config = new MatchConfig();

        config.MatchTimeout = MatchTimeout.text;
        config.WinnerPollPeriod = WinnerPollPeriod.text;
        config.InitialRange = InitialRange.text;
        config.InitialSpeed = InitialSpeed.text;
        config.RandomInitialSpeed = RandomInitialSpeed.text;
        config.CompetitorsPerTeam = CompetitorsPerTeam.text;

        return config;
    }
}
