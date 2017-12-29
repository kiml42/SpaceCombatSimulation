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

    public MatchConfig ReadFromControls()
    {
        var config = new MatchConfig();

        config.MatchTimeout = float.Parse(MatchTimeout.text);
        config.WinnerPollPeriod = float.Parse(WinnerPollPeriod.text);
        config.InitialRange = float.Parse(InitialRange.text);
        config.InitialSpeed = float.Parse(InitialSpeed.text);
        config.RandomInitialSpeed = float.Parse(RandomInitialSpeed.text);
        config.CompetitorsPerTeam = int.Parse(CompetitorsPerTeam.text);

        return config;
    }
}
