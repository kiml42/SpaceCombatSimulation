using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using Assets.Src.Evolution;

public class EditMatchConfig : MonoBehaviour {
    public MatchConfig Config = new MatchConfig();
    
    public InputField MatchTimeout;
    public InputField WinnerPollPeriod;
    public InputField InitialRange;
    public InputField InitialSpeed;
    public InputField RandomInitialSpeed;
    public InputField CompetitorsPerTeam;

    // Use this for initialization
    void Start () {
		
	}
	
	// Update is called once per frame
	void Update () {
		
	}
    
    public void LoadConfig(MatchConfig config)
    {
        MatchTimeout.text = config.MatchTimeout.ToString();
        WinnerPollPeriod.text = config.WinnerPollPeriod.ToString();
        InitialRange.text = config.InitialRange.ToString();
        InitialSpeed.text = config.InitialSpeed.ToString();
        RandomInitialSpeed.text = config.RandomInitialSpeed.ToString();
        CompetitorsPerTeam.text = config.CompetitorsPerTeam.ToString();
    }
}
