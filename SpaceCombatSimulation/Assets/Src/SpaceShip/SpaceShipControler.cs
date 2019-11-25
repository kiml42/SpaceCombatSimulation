using Assets.Src.Controllers;
using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.Pilots;
using System.Collections.Generic;
using UnityEngine;

public class SpaceShipController : AbstractDeactivatableController
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

    public EngineController Engine;
    public Rigidbody Torquer;
    private readonly List<EngineController> _engines = new List<EngineController>();
    private readonly List<Rigidbody> _torquers = new List<Rigidbody>();

    public float AngularDragForTorquers = 20;

    private const float Fuel = Mathf.Infinity;
    private Rigidbody _thisSpaceship;

    private IPilot _pilot;

    public Transform VectorArrow;

    // Use this for initialization
    private void Start()
    {
        _thisSpaceship = GetComponent<Rigidbody>();
        _targetChoosingMechanism = GetComponent<IKnowsCurrentTarget>();

        if (Engine != null)
        {
            _engines.Add(Engine);
        }
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

        _pilot = new SpaceshipPilot(torqueApplier, _thisSpaceship, _engines, ShootAngle, Fuel)
        {
            StartDelay = StartDelay,
            SlowdownWeighting = SlowdownWeighting,
            TangentialSpeedWeighting = TangentialSpeedWeighting,
            LocationAimWeighting = LocationAimWeighting,
            VectorArrow = VectorArrow,
            MaxRange = MaxRange,
            MinRange = MinRange,
            MaxTangentialSpeed = MaxTangentialVelocity,
            MinTangentialSpeed = MinTangentialVelocity,
            RadialSpeedThreshold = RadialSpeedThreshold
        };
    }

    // Update is called once per frame
    private void FixedUpdate()
    {
        if (_active && _pilot != null)
            _pilot.Fly(_targetChoosingMechanism.CurrentTarget);
    }

    public void RegisterEngine(EngineController engine)
    {
        //Debug.Log("Registering engine");
        _engines.Add(engine);
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
        const float MaxVelocityTolerance = 100;
        const float DefaultVelocityToleranceProportion = 0.1f;

        ShootAngle = genomeWrapper.GetScaledNumber(180);
        LocationAimWeighting = genomeWrapper.GetScaledNumber(2);
        SlowdownWeighting = genomeWrapper.GetScaledNumber(70);
        MaxRange = genomeWrapper.GetScaledNumber(5000, 0, 0.1f);
        MinRange = genomeWrapper.GetScaledNumber(1000, 0, 0.1f);
        MaxTangentialVelocity = genomeWrapper.GetScaledNumber(MaxVelocityTolerance, 0, DefaultVelocityToleranceProportion);
        MinTangentialVelocity = genomeWrapper.GetScaledNumber(MaxVelocityTolerance, 0, DefaultVelocityToleranceProportion);
        TangentialSpeedWeighting = genomeWrapper.GetScaledNumber(70);
        AngularDragForTorquers = genomeWrapper.GetScaledNumber(2, 0, 0.2f);
        RadialSpeedThreshold = genomeWrapper.GetScaledNumber(MaxVelocityTolerance, 0, DefaultVelocityToleranceProportion);

        return genomeWrapper;
    }
}
