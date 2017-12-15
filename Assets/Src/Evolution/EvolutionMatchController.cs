using Assets.Src.Evolution;
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class EvolutionMatchController : MonoBehaviour {
    public MatchConfig Config = new MatchConfig();

    [Tooltip("for display only")]
    public float MatchTimeout;
    public float MatchRunTime = 0;
    
    private float _scoreUpdatePollCountdown = 0;

    // Use this for initialization
    void Start () {
        MatchRunTime = 0;
    }
	
	// Update is called once per frame
	void Update () {
        MatchTimeout = Config.MatchTimeout;
        MatchRunTime += Time.deltaTime;
        _scoreUpdatePollCountdown -= Time.deltaTime;
    }

    public bool IsOutOfTime()
    {
        return Config.MatchTimeout <= MatchRunTime;
    }

    public float RemainingTime()
    {
        return Math.Max(Config.MatchTimeout - MatchRunTime, 0);
    }

    public bool ShouldPollForWinners()
    {
        var shouldPoll = _scoreUpdatePollCountdown <= 0;
        if(shouldPoll)
            _scoreUpdatePollCountdown = Config.WinnerPollPeriod;

        return shouldPoll || IsOutOfTime();
    }
}
