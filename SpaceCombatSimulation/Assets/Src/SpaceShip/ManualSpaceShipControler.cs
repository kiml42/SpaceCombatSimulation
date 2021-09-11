﻿using Assets.Src.Controllers;
using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.Pilots;
using System.Collections.Generic;
using UnityEngine;

public class ManualSpaceShipControler : AbstractDeactivatableController
{
    private IKnowsCurrentTarget _targetChoosingMechanism;

    public float ShootAngle = 30;
    public float TorqueMultiplier = 9;
    public int StartDelay = 2;

    public float SlowdownWeighting = 10;
    public float RadialSpeedThreshold = 10;
    public float MaxRange = 100;
    public float MinRange = 20;
    public float LocationAimWeighting = 1;
    public float MaxTangentialVelocity = 10;
    public float MinTangentialVelocity = 0;
    public float TangentialSpeedWeighting = 1;
    
    public Rigidbody Torquer;
    public List<EngineControler> Engines = new List<EngineControler>();
    private readonly List<Rigidbody> _torquers = new List<Rigidbody>();

    public float AngularDragForTorquers = 20;

    private const float Fuel = Mathf.Infinity;
    private Rigidbody _thisSpaceship;

    //private IPilot _autoPilot;
    private IPilot _manualPilot;

    public Transform VectorArrow;

    // Use this for initialization
    void Start()
    {
        _thisSpaceship = GetComponent<Rigidbody>();
        _targetChoosingMechanism = GetComponent<IKnowsCurrentTarget>();
        
        if (Torquer != null)
        {
            _torquers.Add(Torquer);
        }
        Initialise();
    }

    private void Initialise()
    {
        var torqueApplier = new MultiTorquerTorqueAplier(_thisSpaceship, _torquers, TorqueMultiplier, AngularDragForTorquers);

        //ensure this starts active.
        torqueApplier.Activate();

        //_autoPilot = new SpaceshipPilot(torqueApplier, _thisSpaceship, Engines, ShootAngle, Fuel)
        //{
        //    StartDelay = StartDelay,
        //    SlowdownWeighting = SlowdownWeighting,
        //    TangentialSpeedWeighting = TangentialSpeedWeighting,
        //    LocationAimWeighting = LocationAimWeighting,
        //    VectorArrow = VectorArrow,
        //    MaxRange = MaxRange,
        //    MinRange = MinRange,
        //    MaxTangentialSpeed = MaxTangentialVelocity,
        //    MinTangentialSpeed = MinTangentialVelocity,
        //    RadialSpeedThreshold = RadialSpeedThreshold
        //};

        _manualPilot = new ManualSpaceshipPilot(torqueApplier, _thisSpaceship, Engines, Fuel);
    }

    // Update is called once per frame
    void FixedUpdate()
    {
        if (_active && _manualPilot != null)
            _manualPilot.Fly(_targetChoosingMechanism.CurrentTarget);
    }

    public void RegisterEngine(EngineControler engine)
    {
        //Debug.Log("Registering engine");
        Engines.Add(engine);
        Initialise();
        //_engineControl.SetEngine(Engine);

    }

    public void RegisterTorquer(Transform torquer)
    {
        _torquers.Add(torquer.GetComponent<Rigidbody>());
        Initialise();
        //_engineControl.SetEngine(Engine);
    }
   

    protected override GenomeWrapper SubConfigure(GenomeWrapper genomeWrapper)
    {
        const float MaxShootAngle = 180;
        const float DefaultShootAngleProportion = 0.5f;
        const float MaxLocationAimWeighting = 2;
        const float DefaultLocationAimWeightingProportion = 0.5f;
        const float MaxSlowdownWeighting = 70;
        const float DefaultSlowdownWeightingProportion = 0.5f;
        const float MaxTangentialVelosityWeighting = 70;
        const float DefaultTangentialVelosityWeightingProportion = 0.5f;
        const float MaxMaxAndMinRange = 1000;
        const float DefaultMaxAndMinRangeProportion = 0.1f;
        const float MaxVelociyTollerance = 100;
        const float DefaultVelociyTolleranceProportion = 0.1f;
        const float MaxAngularDragForTorquers = 2;
        const float DefaultAngularDragForTorquersProportion = 0.2f;

        ShootAngle =
                genomeWrapper.GetScaledNumber(MaxShootAngle, 0, DefaultShootAngleProportion);
        LocationAimWeighting =
            genomeWrapper.GetScaledNumber(MaxLocationAimWeighting, 0, DefaultLocationAimWeightingProportion);
        SlowdownWeighting =
            genomeWrapper.GetScaledNumber(MaxSlowdownWeighting, 0, DefaultSlowdownWeightingProportion);
        MaxRange =
            genomeWrapper.GetScaledNumber(MaxMaxAndMinRange, 0, DefaultMaxAndMinRangeProportion);
        MinRange =
            genomeWrapper.GetScaledNumber(MaxMaxAndMinRange, 0, DefaultMaxAndMinRangeProportion);
        MaxTangentialVelocity =
            genomeWrapper.GetScaledNumber(MaxVelociyTollerance, 0, DefaultVelociyTolleranceProportion);
        MinTangentialVelocity =
            genomeWrapper.GetScaledNumber(MaxVelociyTollerance, 0, DefaultVelociyTolleranceProportion);
        TangentialSpeedWeighting =
            genomeWrapper.GetScaledNumber(MaxTangentialVelosityWeighting, 0, DefaultTangentialVelosityWeightingProportion);
        AngularDragForTorquers =
            genomeWrapper.GetScaledNumber(MaxAngularDragForTorquers, 0, DefaultAngularDragForTorquersProportion);
        RadialSpeedThreshold =
            genomeWrapper.GetScaledNumber(MaxVelociyTollerance, 0, DefaultVelociyTolleranceProportion);
       
        return genomeWrapper;
    }
}
