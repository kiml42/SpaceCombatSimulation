using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;
using Assets.Src.Pilots;
using System.Collections.Generic;
using UnityEngine;

public class SpaceShipControler : GeneticConfigurableMonobehaviour, IDeactivatable
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

    public EngineControler Engine;
    public Rigidbody Torquer;
    private List<EngineControler> _engines = new List<EngineControler>();
    private List<Rigidbody> _torquers = new List<Rigidbody>();

    public float AngularDragForTorquers = 20;

    private const float Fuel = Mathf.Infinity;
    private Rigidbody _thisSpaceship;
    private bool _active = true;

    private IPilot _pilot;

    private string InactiveTag = "Untagged";
    public Transform VectorArrow;

    // Use this for initialization
    void Start()
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
    void FixedUpdate()
    {
        if (_active && _pilot != null)
            _pilot.Fly(_targetChoosingMechanism.CurrentTarget);
    }

    public void Deactivate()
    {
        //Debug.Log("Deactivating " + name);
        _active = false;
        tag = InactiveTag;
    }

    public void RegisterEngine(EngineControler engine)
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
        const float MaxVelociyTollerance = 100;
        const float DefaultVelociyTolleranceProportion = 0.1f;

        ShootAngle = genomeWrapper.GetScaledNumber(180);
        LocationAimWeighting = genomeWrapper.GetScaledNumber(2);
        SlowdownWeighting = genomeWrapper.GetScaledNumber(70);
        MaxRange = genomeWrapper.GetScaledNumber(5000, 0, 0.1f);
        MinRange = genomeWrapper.GetScaledNumber(1000, 0, 0.1f);
        MaxTangentialVelocity = genomeWrapper.GetScaledNumber(MaxVelociyTollerance, 0, DefaultVelociyTolleranceProportion);
        MinTangentialVelocity = genomeWrapper.GetScaledNumber(MaxVelociyTollerance, 0, DefaultVelociyTolleranceProportion);
        TangentialSpeedWeighting = genomeWrapper.GetScaledNumber(70);
        AngularDragForTorquers = genomeWrapper.GetScaledNumber(2, 0, 0.2f);
        RadialSpeedThreshold = genomeWrapper.GetScaledNumber(MaxVelociyTollerance, 0, DefaultVelociyTolleranceProportion);

        return genomeWrapper;
    }
}
