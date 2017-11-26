using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class EvolutionMatchController : MonoBehaviour {
    public float MatchTimeout = 10000;
    public float MatchRunTime = 0;
    
    public float WinnerPollPeriod = 1;
    private float _scoreUpdatePollCountdown = 0;
    public int? Id;

    // Use this for initialization
    void Start () {
        MatchRunTime = 0;
    }
	
	// Update is called once per frame
	void Update () {
        MatchRunTime += Time.deltaTime;
        _scoreUpdatePollCountdown -= Time.deltaTime;
    }

    public bool IsOutOfTime()
    {
        return MatchTimeout <= MatchRunTime;
    }

    public float RemainingTime()
    {
        return Math.Max(MatchTimeout - MatchRunTime, 0);
    }

    public bool ShouldPollForWinners()
    {
        var shouldPoll = _scoreUpdatePollCountdown <= 0;
        if(shouldPoll)
            _scoreUpdatePollCountdown = WinnerPollPeriod;

        return shouldPoll || IsOutOfTime();
    }
}
