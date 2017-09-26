using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class MultiBarelTurretController : MonoBehaviour, ITurretController, IDeactivatable
{
    public TargetChoosingMechanism TargetChoosingMechanism;
    public Transform RestTarget;
    public Rigidbody Projectile;
    public int LoadTime = 200;
    public float ProjectileSpeed = 10f;
    public float ShootAngle = 10;
    public float RandomSpeed = 0.1f;

    public Rigidbody TurnTable;
    public Rigidbody ElevationHub;
    public Transform EmitterParent;
    private List<Transform> _emitters;
    private int _nextEmitterToShoot = 0;
    private bool _active = true;
    
    public bool TagChildren = false;
    
    private ITurretTurner _turner;
    private IFireControl _fireControl;

    private Transform _thisTurret;

    private string InactiveTag = "Untagged";
    
    private int _reload = 0;

    private ITurretRunner _runner;

    public bool SetChildrensEnemy = false;
    public float RecoilForce = 0;
    
    // Use this for initialization
    void Start()
    {
        var rigidbody = GetComponent<Rigidbody>();
        var emitterCount = EmitterParent.childCount;

        _emitters = new List<Transform>();
        for(int i=0; i<emitterCount; i++)
        {
            _emitters.Add(EmitterParent.GetChild(i));
        }
        
        _reload = LoadTime;
        
        _turner = new UnityTurretTurner(rigidbody, TurnTable, ElevationHub, RestTarget, ProjectileSpeed);

        _fireControl = new UnityFireControl(this, ElevationHub.transform, ShootAngle);

        _runner = new TurretRunner(TargetChoosingMechanism, _turner, _fireControl)
        {
            name = transform.name
        };
    }

    // Update is called once per frame
    void Update()
    {
        if (_active)
            _runner.RunTurret();
    }


    public void Shoot(bool shouldShoot)
    {
        if(_active && TurnTable != null && ElevationHub != null)
            if (shouldShoot && _reload <= 0)
            {
                var emitter = _emitters[_nextEmitterToShoot];
                _nextEmitterToShoot++;
                _nextEmitterToShoot = _nextEmitterToShoot % (_emitters.Count);
                var projectile = Instantiate(Projectile, emitter.transform.position, emitter.transform.rotation);
                projectile.velocity = (projectile.transform.forward * ProjectileSpeed) +
                    ElevationHub.GetComponent<Rigidbody>().velocity +
                    (RandomSpeed * UnityEngine.Random.insideUnitSphere);

                _reload = LoadTime;
                ElevationHub.AddForceAtPosition(RecoilForce * (-emitter.forward), emitter.position, ForceMode.Impulse);

                if (SetChildrensEnemy) { projectile.SendMessage("SetEnemyTags", TargetChoosingMechanism.EnemyTags); }
                if (TagChildren) { projectile.tag = tag; }
            }
            else
            {
                _reload--;
            }
    }

    public void Deactivate()
    {
        //Debug.Log("Deactivating " + name);
        _active = false;
        tag = InactiveTag;
    }

    public void DieNow()
    {
        Deactivate();
        DestroyJoint(ElevationHub);
        DestroyJoint(TurnTable);
        //Don't remove the turret itself, that will be done by the thing calling DieNow (which can't tell that DieNow exists)
    }

    private void DestroyJoint(Rigidbody jointedObject)
    {
        if (jointedObject != null)
        {
            var hinge = jointedObject.GetComponent("HingeJoint") as HingeJoint;
            if (hinge != null)
            {
                GameObject.Destroy(hinge);
            }
            jointedObject.transform.parent = null;
        }
    }
}
