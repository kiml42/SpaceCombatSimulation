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

public class SpaceShipControler : MonoBehaviour, IKnowsEnemyTagAndtag, IDeactivatable
{
    public float TanShootAngle = 0.3f;
    public float EngineForce = 800;
    public float TorqueMultiplier = 9;
    public float LocationAimWeighting = 1;
    public int StartDelay = 2;
    public float SlowdownWeighting = 10;
    public Rigidbody TargetMarker;
    public Rigidbody DeathExplosion;
    public float LocationTollerance = 20;
    public float VelociyTollerance = 1;
    public Rigidbody Engine;
    private List<Rigidbody> _engines = new List<Rigidbody>();

    public float AngularDragForTorquers = 20;

    private const float Fuel = Mathf.Infinity;
    private Rigidbody _marker;
    private SpaceshipRunner _runner;
    private Rigidbody _thisRocket;
    private bool _active = true;

    private IDestroyer _destroyer;

    public string EnemyTag = "Enemy";
    private IRocketEngineControl _engineControl;

    public string GetEnemyTag()
    {
        return EnemyTag;
    }

    public void SetEnemyTag(string newTag)
    {
        EnemyTag = newTag;
    }

    // Use this for initialization
    void Start()
    {
        if(Engine != null)
        {
            _engines.Add(Engine);
        }
        Initialise();
    }

    private void Initialise()
    {
        var _detector = new UnityTargetDetector()
        {
            EnemyTag = EnemyTag
        };

        var torqueApplier = new MultiTorquerTorqueAplier(Engine, TorqueMultiplier, AngularDragForTorquers);
        
        _engineControl = new RocketEngineControl(torqueApplier, _engines, TanShootAngle, EngineForce, Fuel, StartDelay)
        {
            LocationAimWeighting = LocationAimWeighting,
            SlowdownWeighting = SlowdownWeighting,
        };

        _marker = Instantiate(TargetMarker);
        var chooser = new AverageTargetLocationDestinationChooser(_detector, _marker);

        _runner = new SpaceshipRunner(chooser, _engineControl, _marker)
        {
            LocationTollerance = LocationTollerance,
            VelociyTollerance = VelociyTollerance
        };

        _destroyer = new WithChildrenDestroyer()
        {
            ExplosionEffect =
            DeathExplosion
        };
    }

    // Update is called once per frame
    void Update()
    {
        if (_active && _runner != null)
            _runner.RunSpaceship();

        if (Input.GetKeyDown("space"))
        {
            Debug.Log("spacePushed");
            _destroyer.Destroy(gameObject, true);
        }
    }
    
    public void Deactivate()
    {
        _active = false;
    }

    public void RegisterEngine(Transform engine)
    {
        //Debug.Log("Registering engine");
        _engines.Add(engine.GetComponent<Rigidbody>());
        Initialise();
        //_engineControl.SetEngine(Engine);

    }
}
