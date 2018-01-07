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
    public InputField LocationRandomisationRadiai;

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
        LocationRandomisationRadiai.text = config.LocationRandomisationRadiaiString;

        LoadedId = config.Id;
        _hasLoadedExisting = isPreExisting;
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
        _loaded.LocationRandomisationRadiaiString = LocationRandomisationRadiai.text;
        
        if (_hasLoadedExisting)
        {
            _loaded.Id = LoadedId;
        }

        return _loaded;
    }
}
