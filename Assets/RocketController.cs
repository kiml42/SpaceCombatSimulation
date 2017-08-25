using Assets.Src.Interfaces;
using Assets.Src.Rocket;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System;
using Assets.src.targeting;

public class RocketController : MonoBehaviour, IKnowsEnemyTagAndtag
{
    public float ShootAngle = 10;
    public float TorqueMultiplier = 1f;
    public float LocationAimWeighting = 3f;
    public float Fuel = 200f;
    public int StartDelay = 10;
    public int TurningStartDelay = 2;
    public float MinimumMass = 0;

    public string EnemyTag = "Enemy";
    

    public float DetonationDistance = 20f;
    public Rigidbody Shrapnel;
    public Rigidbody ExplosionEffect;
    public int ShrapnelCount = 10;
    public float ExplosionForce = 1;
    public float ShrapnelSpeed = 100;
    public float ExplosionDamage = 10000;
    public float ExplosionRadius = 20;
    //public bool ExplodeOnAnyCollision = true;

    private ITargetDetector _detector;
    private ITargetPicker _targetPicker;
    private IRocketEngineControl _engineControl;
    private IFireControl _fireControl;

    private Rigidbody _rigidbody;
    
    private IRocketRunner _runner;
    private ProximityDetonator _detonator;
    public bool TagShrapnel = false;
    public bool SetEnemyTagOnShrapnel = false;

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
        _rigidbody = GetComponent<Rigidbody>();

        _detector = new UnityTargetDetector()
        {
            EnemyTag = EnemyTag
        };

        var pickers = new List<ITargetPicker>
        {
            new ProximityTargetPicker(transform),
            new LookingAtTargetPicker(transform, null)
        };

        if(MinimumMass > 0)
        {
            pickers.Add(new MinimumMassTargetPicker(MinimumMass));
        }

        _targetPicker = new CombinedTargetPicker(pickers);

        var initialAngularDrag = _rigidbody.angularDrag;
        var torqueApplier = new MultiTorquerTorqueAplier(_rigidbody, TorqueMultiplier, initialAngularDrag);
        _engineControl = new RocketEngineControl(torqueApplier, _rigidbody, ShootAngle, Fuel, StartDelay)
        {
            LocationAimWeighting = LocationAimWeighting,
            TurningStartDelay = TurningStartDelay
        };

        var exploder = new ShrapnelAndDamageExploder(_rigidbody, Shrapnel, ExplosionEffect, ShrapnelCount)
        {
            ExplosionForce = ExplosionForce,
            EnemyTag = EnemyTag,
            TagShrapnel = TagShrapnel,
            SetEnemyTagOnShrapnel = SetEnemyTagOnShrapnel,
            ExplosionBaseDamage = ExplosionDamage,
            ShrapnelSpeed = ShrapnelSpeed,
            ExplosionRadius = ExplosionRadius
        };

        _detonator = new ProximityDetonator(exploder, _rigidbody, DetonationDistance);

        _runner = new RocketRunner(_detector, _targetPicker, _engineControl, _detonator);
        
        //Debug.Log("starting");
    }

    // Update is called once per frame
    void Update()
    {
        if(_runner != null)
        {
            _runner.RunRocket();
        } else
        {
            Debug.Log("Runner is null! " + transform.name);
        }
    }

    //void OnCollisionEnter(Collision colision)
    //{
    //    if (ExplodeOnAnyCollision)
    //    {
    //        colision.rigidbody.AddExplosionForce(ExplosionForce, transform.position, 100);
    //        _detonator.DetonateNow();
    //    }
    //}
}
