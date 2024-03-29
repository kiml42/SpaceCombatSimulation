﻿using Assets.Src.Interfaces;
using Assets.Src.Rocket;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using System.Collections.Generic;
using UnityEngine;
using System.Linq;
using Assets.Src.Pilots;
using Assets.Src.ObjectManagement;
using System;
using Assets.Src.Evolution;
using Assets.Src.ModuleSystem;

public class RocketController : GeneticConfigurableMonobehaviour
{
    public TargetChoosingMechanism TargetChoosingMechanism;
    public float ShootAngle = 10;
    public float AccelerateTowardsTargetWeighting = 3f;

    [Tooltip("Delay until engines (including RCS) will start and warhead will arm")]
    public float StartDelay = 0.2f;

    [Tooltip("Delay until non-engine torquers will start")]
    public float TurningStartDelay = 0.1f;

    public float TimeToTargetForDetonation = 0.5f;
    public Rigidbody Shrapnel;
    public Rigidbody ExplosionEffect;
    public int ShrapnelCount = 10;
    
    public float ShrapnelSpeed = 100;
        
    private IRocketRunner _runner;
    private IDetonator _detonator;
    public bool TagShrapnel = false;
    public bool SetEnemyTagOnShrapnel = false;
    public Transform VectorArrow;
    public Transform TorqueVectorArrow;

    public List<EngineControler> Engines;

    [Tooltip("Check for best targets every frame if true, otherwise only on target loss")]
    public bool ContinuallyCheckForTargets = false;

    [Tooltip("If set to true a target will be aquired once only, once lost the rocket will deactivate." +
        " Emulates rockets being told their target by their launcher at launch.")]
    public bool NeverRetarget = false;
    
    /// <summary>
    /// Rocket with detonate after this time.
    /// </summary>
    /// 
    [Tooltip("Time for the rocket to live in seconds.")]
    public float TimeToLive = Mathf.Infinity;

    [Tooltip("Time to friendly collision to activate maximum evasion")]
    public float TimeThresholdForMaximumEvasion = 2;

    [Tooltip("Time to friendly collision to activate medium evasion")]
    public float TimeThresholdForMediumEvasion = 4;

    [Tooltip("Time to friendly collision to activate minimal evasion")]
    public float TimeThresholdForMinimalEvasion = 6;

    [Tooltip("Frames to stay in evasion mode after no longer being on a collision course with a friendly.")]
    public float EvasionModeTime = 30;

    [Tooltip("Distance in front of the rocket to start looking for friendlies on a collision cource - useful to avoid detecting itself.")]
    public float MinimumFriendlyDetectionDistance = 4;

    [Tooltip("Weighting for canceling out the objects current angular velocity instead of torquing towards the target orientation.")]
    public float CancelRotationWeight = 5;

    public bool Log = false;

    // Use this for initialization
    void Start()
    {
        var rigidbody = GetComponent<Rigidbody>();
        if (rigidbody == null)
        {
            Debug.LogError($"{this} doesn't have a rigidbody.");
        }

        var torqueApplier = new TorquerManager(rigidbody, CancelRotationWeight, TorqueVectorArrow)
        {
            Log = Log
        };

        //TODO make this work again!
        var pilot = new RocketPilot(torqueApplier, rigidbody, Engines, StartDelay)
        {
            RadialSpeedWeighting = AccelerateTowardsTargetWeighting,
            TurningStartDelay = TurningStartDelay,
            OrientationVectorArrow = VectorArrow,
            TimeThresholdForMaximumEvasion = TimeThresholdForMaximumEvasion,
            TimeThresholdForMediumEvasion = TimeThresholdForMediumEvasion,
            TimeThresholdForMinimalEvasion = TimeThresholdForMinimalEvasion,
            EvasionModeTime = EvasionModeTime,
            MinimumFriendlyDetectionDistance = MinimumFriendlyDetectionDistance
        };

        var exploder = new ShrapnelExploder(rigidbody, Shrapnel, ExplosionEffect, ShrapnelCount)
        {
            EnemyTags = TargetChoosingMechanism.EnemyTagKnower?.KnownEnemyTags,
            TagShrapnel = TagShrapnel,
            SetEnemyTagOnShrapnel = SetEnemyTagOnShrapnel,
            ShrapnelSpeed = ShrapnelSpeed
        };

        _detonator = new ProximityApproachDetonator(exploder, rigidbody, TimeToTargetForDetonation, ShrapnelSpeed);

        var tank = GetComponentInChildren<FuelTank>();

        _runner = new RocketRunner(TargetChoosingMechanism, pilot, _detonator, tank)
        {
            name = transform.name
        };
    }

    // Update is called once per frame
    void FixedUpdate()
    {
        if(_runner != null)
        {
            _runner.RunRocket();
        } else
        {
            Debug.Log("Runner is null! " + transform.name);
        }

        if(TimeToLive < 0)
        {
            _detonator.DetonateNow();
        }
        TimeToLive -= Time.fixedDeltaTime;
    }
    
    protected override GenomeWrapper SubConfigure(GenomeWrapper genomeWrapper)
    {
        ShootAngle = genomeWrapper.GetScaledNumber(180);
        AccelerateTowardsTargetWeighting = genomeWrapper.GetScaledNumber(16);
        TimeToTargetForDetonation = genomeWrapper.GetScaledNumber(2, 0 , 0.1f);
         return genomeWrapper;
    }
}
