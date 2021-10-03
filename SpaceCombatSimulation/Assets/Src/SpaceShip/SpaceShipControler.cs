using Assets.Src.Controllers;
using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.Pilots;
using System.Collections.Generic;
using UnityEngine;

public class SpaceShipControler : AbstractDeactivatableController
{
    private IKnowsCurrentTarget _targetChoosingMechanism;

    public bool Log = false;

    public int StartDelay = 2;

    public float MaxRange = 100;
    public float MinRange = 20;
    public float SpeedMultiplier = 20;
    public float RadialSpeedWeighting = 1;
    public float MaxTangentialVelocity = 10;
    public float MinTangentialVelocity = 0;
    public float TangentialSpeedWeighting = 1;

    public EngineControler Engine;
    private readonly List<EngineControler> _engines = new List<EngineControler>();

    private Rigidbody _thisSpaceship;

    private IPilot _pilot;

    public Transform OrientationVectorArrow;
    public Transform AccelerationVectorArrow;

    // Use this for initialization
    public void Start()
    {

        Initialise();
    }

    private void Initialise()
    {
        _thisSpaceship = _thisSpaceship ?? GetComponent<Rigidbody>();
        if (_thisSpaceship == null)
        {
            Debug.LogError($"{this} doesn't have a rigidbody.");
            Deactivate();
            return;
        }
        _targetChoosingMechanism = _targetChoosingMechanism ?? GetComponent<IKnowsCurrentTarget>();

        if (Engine != null)
        {
            _engines.Add(Engine);
        }
        var torqueApplier = new MultiTorquerTorqueAplier(_thisSpaceship);

        //ensure this starts active.
        torqueApplier.Activate();

        _pilot = new SpaceshipPilot(torqueApplier, _thisSpaceship, _engines)
        {
            StartDelay = StartDelay,
            TangentialSpeedWeighting = TangentialSpeedWeighting,
            RadialSpeedWeighting = RadialSpeedWeighting,
            OrientationVectorArrow = OrientationVectorArrow,
            AccelerationVectorArrow = AccelerationVectorArrow,
            MaxRange = MaxRange,
            MinRange = MinRange,
            SpeedMultiplier = SpeedMultiplier,
            MaxTangentialSpeed = MaxTangentialVelocity,
            MinTangentialSpeed = MinTangentialVelocity,
            Log = Log
        };
    }

    // Update is called once per frame
    public void FixedUpdate()
    {
        if (_active && _pilot != null)
        {
            _pilot.Fly(_targetChoosingMechanism.CurrentTarget);
        }
    }

    public void RegisterEngine(EngineControler engine)
    {
        //Debug.Log("Registering engine");
        _engines.Add(engine);
        Initialise();   //TODO - this sometimes fires before this has hit Start.
        //_engineControl.SetEngine(Engine);
    }

    protected override GenomeWrapper SubConfigure(GenomeWrapper genomeWrapper)
    {
        const float MaxVelocityTolerance = 100;
        const float DefaultVelocityToleranceProportion = 0.1f;

        RadialSpeedWeighting = genomeWrapper.GetScaledNumber(70);
        TangentialSpeedWeighting = genomeWrapper.GetScaledNumber(70);
        SpeedMultiplier = genomeWrapper.GetScaledNumber(70);
        MaxRange = genomeWrapper.GetScaledNumber(5000, 0, 0.1f);
        MinRange = genomeWrapper.GetScaledNumber(1000, 0, 0.1f);
        MaxTangentialVelocity = genomeWrapper.GetScaledNumber(MaxVelocityTolerance, 0, DefaultVelocityToleranceProportion);
        MinTangentialVelocity = genomeWrapper.GetScaledNumber(MaxVelocityTolerance, 0, DefaultVelocityToleranceProportion);

        return genomeWrapper;
    }
}
