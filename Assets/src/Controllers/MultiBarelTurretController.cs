using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class MultiBarelTurretController : MonoBehaviour, IKnowsEnemyTagAndtag, ITurretController, IDeactivatable
{
    public Transform RestTarget;
    public Rigidbody Projectile;
    public int LoadTime = 200;
    public float ProjectileSpeed = 10f;
    public float ShootAngle = 10;
    public float RandomSpeed = 0.1f;

    public Transform TurnTable;
    public Transform ElevationHub;
    public Transform EmitterParent;
    private List<Transform> _emitters;
    private int _nextEmitterToShoot = 0;
    private bool _active = true;
    public float MinimumMass = 0;
    
    public bool TagChildren = false;

    private ITargetDetector _detector;
    private ITargetPicker _targetPicker;
    private ITurretTurner _turner;
    private IFireControl _fireControl;

    private Transform _thisTurret;

    private string InactiveTag = "Untagged";


    #region EnemyTags
    public void AddEnemyTag(string newTag)
    {
        var tags = EnemyTags.ToList();
        tags.Add(newTag);
        EnemyTags = tags.Distinct();
    }

    public string GetFirstEnemyTag()
    {
        return EnemyTags.FirstOrDefault();
    }

    public void SetEnemyTags(IEnumerable<string> allEnemyTags)
    {
        EnemyTags = allEnemyTags;
    }

    public IEnumerable<string> GetEnemyTags()
    {
        return EnemyTags;
    }

    public IEnumerable<string> EnemyTags;
    #endregion

    private int _reload = 0;

    private ITurretRunner _runner;

    public bool SetChildrensEnemy = false;


    // Use this for initialization
    void Start()
    {
        var emitterCount = EmitterParent.childCount;

        _emitters = new List<Transform>();
        for(int i=0; i<emitterCount; i++)
        {
            _emitters.Add(EmitterParent.GetChild(i));
        }
        
        _reload = LoadTime;

        _thisTurret = transform;

        _detector = new UnityTargetDetector()
        {
            ProjectileSpeed = ProjectileSpeed,
            EnemyTags = EnemyTags
        };

        var pickers = new List<ITargetPicker>
        {
            new AboveTurnTableTargetPicker(_thisTurret),
            new ProximityTargetPicker(_thisTurret),
            new LookingAtTargetPicker(_thisTurret, ElevationHub)
        };

        if (MinimumMass > 0)
        {
            pickers.Add(new MinimumMassTargetPicker(MinimumMass));
        }

        _targetPicker = new CombinedTargetPicker(pickers);

        _turner = new UnityTurretTurner(_thisTurret, TurnTable, ElevationHub, RestTarget);

        _fireControl = new UnityFireControl(this, ElevationHub, ShootAngle);

        _runner = new TurretRunner(_detector, _targetPicker, _turner, _fireControl);
    }

    // Update is called once per frame
    void Update()
    {
        if (_active)
            _runner.RunTurret();
    }


    public void Shoot(bool shouldShoot)
    {
        if(_active && TurnTable.IsValid() && ElevationHub.IsValid())
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
                emitter.parent.parent.GetComponent<Rigidbody>().AddForce(100 * (-emitter.forward));

                if (SetChildrensEnemy) { projectile.SendMessage("SetEnemyTags", EnemyTags); }
                if (TagChildren) { projectile.tag = tag; }
            }
            else
            {
                _reload--;
            }
    }

    public void Deactivate()
    {
        _active = false;
        tag = InactiveTag;
    }
}
