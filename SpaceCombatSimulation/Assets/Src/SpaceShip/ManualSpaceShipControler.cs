using Assets.Src.Controllers;
using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.Pilots;
using System.Collections.Generic;
using UnityEngine;

public class ManualSpaceShipControler : AbstractDeactivatableController
{
    private IKnowsCurrentTarget _targetChoosingMechanism;

    public float ShootAngle = 30;
    public int StartDelay = 2;

    public float SlowdownWeighting = 10;
    public float RadialSpeedThreshold = 10;
    public float MaxRange = 100;
    public float MinRange = 20;
    public float LocationAimWeighting = 1;
    public float MaxTangentialVelocity = 10;
    public float MinTangentialVelocity = 0;
    public float TangentialSpeedWeighting = 1;

    [Tooltip("Weighting for canceling out the objects current angular velocity instead of torquing towards the target orientation.")]
    public float CancelRotationWeight = 5;

    public List<EngineControler> Engines = new List<EngineControler>();

    private const float Fuel = Mathf.Infinity;
    private Rigidbody _thisSpaceship;

    //private IPilot _autoPilot;
    private IPilot _manualPilot;

    public Transform VectorArrow;

    // Use this for initialization
    void Start()
    {
        _thisSpaceship = GetComponent<Rigidbody>();
        if (_thisSpaceship == null)
        {
            Debug.LogError($"{this} doesn't have a rigidbody.");
        }
        _targetChoosingMechanism = GetComponent<IKnowsCurrentTarget>();
        
        Initialise();
    }

    private void Initialise()
    {
        var torqueApplier = new TorquerManager(_thisSpaceship, CancelRotationWeight);

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

    void FixedUpdate()
    {
        if (_active && _manualPilot != null)
            _manualPilot.Fly(_targetChoosingMechanism.CurrentTarget);
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
        RadialSpeedThreshold =
            genomeWrapper.GetScaledNumber(MaxVelociyTollerance, 0, DefaultVelociyTolleranceProportion);
       
        return genomeWrapper;
    }
}
