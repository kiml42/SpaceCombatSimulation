using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Rocket;
using Assets.Src.SpaceShip;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System;
using System.Linq;
using Assets.Src.Pilots;

public class SpaceShipControler : MonoBehaviour, IDeactivatable
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
}
