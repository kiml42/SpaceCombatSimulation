using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class TurretController : MonoBehaviour, IKnowsEnemyTagAndtag, ITurretController, IDeactivatable
{
    public Transform RestTarget;
    public Rigidbody Projectile;
    public int LoadTime = 200;
    public float ProjectileSpeed = 10f;
    public float TanShootAngle = 0.1f;
    public float RandomSpeed = 0.1f;
    public float RandomStartTime = 30;

    public Transform TurnTable;
    public Transform ElevationHub;
    public Transform Emitter;

    public bool TagChildren = false;

    private ITargetDetector _detector;
    private ITargetPicker _targetPicker;
    private ITurretTurner _turner;
    private IFireControl _fireControl;

    private Transform _thisTurret;
    private bool _active = true;


    public string EnemyTag = "Enemy";
    public string GetEnemyTag()
    {
        return EnemyTag;
    }

    public void SetEnemyTag(string newTag)
    {
        EnemyTag = newTag;
    }

    private int _reload = 0;

    private ITurretRunner _runner;
    
    public bool SetChildrensEnemy = false;


    // Use this for initialization
    void Start()
    {
        RandomStartTime = RandomStartTime * UnityEngine.Random.value;
        ElevationHub = ElevationHub ?? _thisTurret.transform.Find("ElevationHub");
        TurnTable = TurnTable ?? _thisTurret.transform.Find("TurnTable");
        Emitter = Emitter ?? ElevationHub.Find("Barrel").Find("Emitter");
        _reload = LoadTime;

        _thisTurret = transform;

        _detector = new UnityTargetDetector()
        {
            ProjectileSpeed = ProjectileSpeed,
            EnemyTag = EnemyTag
        };
        
        _targetPicker = new CombinedTargetPicker(new List<ITargetPicker>
        {
            new AboveTurnTableTargetPicker(_thisTurret),
            new ProximityTargetPicker(_thisTurret),
            new LookingAtTargetPicker(_thisTurret, ElevationHub)
        });

        _turner = new UnityTurretTurner(_thisTurret, TurnTable, ElevationHub, RestTarget);

        _fireControl = new UnityFireControl(this, _thisTurret, ElevationHub, TanShootAngle);

        _runner = new TurretRunner(_detector, _targetPicker, _turner, _fireControl);
    }

    // Update is called once per frame
    void Update()
    {
        if(_active)
            _runner.RunTurret();
    }


    public void Shoot(bool shouldShoot)
    {
        if(_active)
        if (RandomStartTime < 0)
        {
            if (shouldShoot && _reload <= 0)
            {
                var projectile = Instantiate(Projectile, Emitter.transform.position, Emitter.transform.rotation);
                projectile.velocity = (projectile.transform.forward * ProjectileSpeed) +
                    ElevationHub.GetComponent<Rigidbody>().velocity +
                    (RandomSpeed * UnityEngine.Random.insideUnitSphere);

                _reload = LoadTime;
                Emitter.parent.parent.GetComponent<Rigidbody>().AddForce(100 * (-Emitter.forward));

                if (SetChildrensEnemy) { projectile.SendMessage("SetEnemyTag", EnemyTag); }
                if (TagChildren) { projectile.tag = tag; }
            }
            else
            {
                _reload--;
            }
        } else
        {
            RandomStartTime--;
        }
    }
    
    public void Deactivate()
    {
        _active = false;
    }
}
