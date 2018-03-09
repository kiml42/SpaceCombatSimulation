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
    public InputField AllowedModules;
    public InputField Budget;

    private MatchConfig _loaded;

    public void LoadConfig(MatchConfig config, bool isPreExisting)
    {
        _loaded = config;

        MatchTimeout.text = config.MatchTimeout.ToString();
        WinnerPollPeriod.text = config.WinnerPollPeriod.ToString();
        InitialRange.text = config.InitialRange.ToString();
        InitialSpeed.text = config.InitialSpeed.ToString();
        RandomInitialSpeed.text = config.RandomInitialSpeed.ToString();
        CompetitorsPerTeam.text = config.CompetitorsPerTeam.ToString();
        AllowedModules.text = config.AllowedModulesString;
        Budget.text = config.Budget.ToString();
    }

    public MatchConfig ReadFromControls()
    {
        _loaded = _loaded ?? new MatchConfig();

        _loaded.MatchTimeout = float.Parse(MatchTimeout.text);
        _loaded.WinnerPollPeriod = float.Parse(WinnerPollPeriod.text);
        _loaded.InitialRange = float.Parse(InitialRange.text);
        _loaded.InitialSpeed = float.Parse(InitialSpeed.text);
        _loaded.RandomInitialSpeed = float.Parse(RandomInitialSpeed.text);
        _loaded.CompetitorsPerTeam = int.Parse(CompetitorsPerTeam.text);
        _loaded.AllowedModulesString = AllowedModules.text;
        _loaded.Budget = float.Parse(Budget.text);
        
        return _loaded;
    }
}
