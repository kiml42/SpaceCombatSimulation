using Assets.Src.Interfaces;
using Assets.Src.Rocket;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System;
using Assets.src.targeting;
using System.Linq;

public class RocketController : MonoBehaviour, IKnowsEnemyTagAndtag
{
    public float ShootAngle = 10;
    public float TorqueMultiplier = 1f;
    public float LocationAimWeighting = 3f;
    public float Fuel = 200f;
    public int StartDelay = 10;
    public int TurningStartDelay = 2;
    public float MinimumMass = 0;    

    public float TimeToTargetForDetonation = 0.5f;
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

    private Rigidbody _rigidbody;
    
    private IRocketRunner _runner;
    private IDetonator _detonator;
    public bool TagShrapnel = false;
    public bool SetEnemyTagOnShrapnel = false;
    public Transform VectorArrow;

    #region EnemyTags
    public void AddEnemyTag(string newTag)
    {
        var tags = EnemyTags.ToList();
        tags.Add(newTag);
        EnemyTags = tags.Distinct().ToList();
    }

    public string GetFirstEnemyTag()
    {
        return EnemyTags.FirstOrDefault();
    }

    public void SetEnemyTags(List<string> allEnemyTags)
    {
        EnemyTags = allEnemyTags;
    }

    public List<string> GetEnemyTags()
    {
        return EnemyTags;
    }

    public List<string> EnemyTags;
    #endregion

    // Use this for initialization
    void Start()
    {
        _rigidbody = GetComponent<Rigidbody>();

        _detector = new UnityTargetDetector()
        {
            EnemyTags = EnemyTags
        };

        var pickers = new List<ITargetPicker>
        {
            new ProximityTargetPicker(_rigidbody),
            new LookingAtTargetPicker(_rigidbody)
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
            TurningStartDelay = TurningStartDelay,
            VectorArrow = VectorArrow
        };

        var exploder = new ShrapnelAndDamageExploder(_rigidbody, Shrapnel, ExplosionEffect, ShrapnelCount)
        {
            ExplosionForce = ExplosionForce,
            EnemyTags = EnemyTags,
            TagShrapnel = TagShrapnel,
            SetEnemyTagOnShrapnel = SetEnemyTagOnShrapnel,
            ExplosionBaseDamage = ExplosionDamage,
            ShrapnelSpeed = ShrapnelSpeed,
            ExplosionRadius = ExplosionRadius
        };

        _detonator = new ProximityApproachDetonator(exploder, _rigidbody, TimeToTargetForDetonation, ShrapnelSpeed);

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
