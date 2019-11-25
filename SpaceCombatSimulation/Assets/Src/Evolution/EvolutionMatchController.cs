using Assets.Src.Evolution;
using System;
using UnityEngine;

public class EvolutionMatchController : MonoBehaviour
{
    public MatchConfig Config = new MatchConfig();
    
    public float MatchRunTime = 0;

    private float _scoreUpdatePollCountdown = 0;

    // Use this for initialization
    void Start()
    {
        MatchRunTime = 0;
    }

    // Update is called once per frame
    void FixedUpdate()
    {
        MatchRunTime += Time.fixedDeltaTime;
        _scoreUpdatePollCountdown -= Time.fixedDeltaTime;
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
        if (shouldPoll)
            _scoreUpdatePollCountdown = Config.WinnerPollPeriod;

        return shouldPoll || IsOutOfTime();
    }
}
