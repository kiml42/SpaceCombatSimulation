﻿using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class MultiBarelTurretController : MonoBehaviour, ITurretController, IDeactivatable, IKnowsProjectileSpeed
{
    private IKnowsEnemyTagsAndCurrentTarget _targetChoosingMechanism;
    public Rigidbody Projectile;
    public Rigidbody MuzzleFlash;
    public float LoadTime = 200;
    public float ProjectileSpeed = 10f;
    public float RandomSpeed = 0.1f;
    
    public Rigidbody ElevationHub;
    public Transform EmitterParent;
    private List<Transform> _emitters;
    private int _nextEmitterToShoot = 0;
    private bool _active = true;
    
    public bool TagChildren = false;
    
    private IFireControl _fireControl;

    private string InactiveTag = "Untagged";
    
    private float _reload = 0;

    public bool SetChildrensEnemy = false;
    public float RecoilForce = 0;

    private ColourSetter _colerer;
    
    float? IKnowsProjectileSpeed.ProjectileSpeed
    {
        get
        {
            return ProjectileSpeed;
        }
    }

    // Use this for initialization
    void Start()
    {
        _colerer = GetComponent<ColourSetter>();
        _targetChoosingMechanism = GetComponent<IKnowsEnemyTagsAndCurrentTarget>();
        var emitterCount = EmitterParent.childCount;

        _emitters = new List<Transform>();
        for(int i=0; i<emitterCount; i++)
        {
            _emitters.Add(EmitterParent.GetChild(i));
        }
        
        _reload = LoadTime;
        
        _fireControl = GetComponent<IFireControl>();
    }

    // Update is called once per frame
    void FixedUpdate()
    {
        if (_active && _fireControl != null)
        {
            Shoot(_fireControl.ShouldShoot(_targetChoosingMechanism.CurrentTarget));
        }
    }


    public void Shoot(bool shouldShoot)
    {
        if(_active && ElevationHub != null)
            if (shouldShoot && _reload <= 0)
            {
                var emitter = _emitters[_nextEmitterToShoot];
                _nextEmitterToShoot++;
                _nextEmitterToShoot = _nextEmitterToShoot % (_emitters.Count);
                var projectile = Instantiate(Projectile, emitter.transform.position, emitter.transform.rotation);
                projectile.velocity = (projectile.transform.forward * ProjectileSpeed) +
                    ElevationHub.velocity +
                    (RandomSpeed * UnityEngine.Random.insideUnitSphere);

                if(MuzzleFlash != null)
                {
                    var flash /*a-ah*/ = Instantiate(MuzzleFlash, emitter.transform.position, emitter.transform.rotation);
                    flash.velocity = ElevationHub.velocity;
                }

                _reload = LoadTime;
                ElevationHub.AddForceAtPosition(RecoilForce * (-emitter.forward), emitter.position, ForceMode.Impulse);

                if (SetChildrensEnemy && _targetChoosingMechanism != null)
                {
                    projectile.GetComponent<IKnowsEnemyTags>().EnemyTags = _targetChoosingMechanism.EnemyTags;
                }
                if (_colerer != null)
                {
                    //Debug.Log("has renderer");
                    projectile.transform.SetColor(_colerer.Colour);
                }
                if (TagChildren) { projectile.tag = tag; }
            }
            else
            {
                _reload-=Time.deltaTime;
            }
    }

    public void Deactivate()
    {
        //Debug.Log("Deactivating " + name);
        _active = false;
        tag = InactiveTag;
    }
}