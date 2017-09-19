using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class MultiBarelTurretController : MonoBehaviour, IKnowsEnemyTagAndtag, ITurretController, IDeactivatable, IKnowsCurrentTarget
{
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

    #region knowsCurrentTarget
    public PotentialTarget CurrentTarget { get; set; }
    #endregion

    private int _reload = 0;

    private ITurretRunner _runner;

    public bool SetChildrensEnemy = false;
    public float RecoilForce = 0;


    #region TargetPickerVariables
    public float PickerDistanceMultiplier = 1;
    public float PickerInRangeBonus = 0;
    public float PickerRange = 500;
    public float PickerAimedAtMultiplier = 100;
    public float PickerMinimumMass = 10;
    public float PickerMasMultiplier = 1;
    public float PickerOverMinMassBonus = 10000;
    public float PickerApproachWeighting = 20;
    #endregion


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

        _detector = new MultiTagTargetDetector()
        {
            ProjectileSpeed = ProjectileSpeed,
            EnemyTags = EnemyTags
        };

        var pickers = new List<ITargetPicker>
        {
            new AboveTurnTableTargetPicker(rigidbody),
            new ProximityTargetPicker(rigidbody){
                DistanceMultiplier = PickerDistanceMultiplier,
                InRangeBonus = PickerInRangeBonus,
                Range = PickerRange
            },
            new LookingAtTargetPicker(ElevationHub)
            {
                ProjectileSpeed = ProjectileSpeed,
                Multiplier = PickerAimedAtMultiplier
            },
            new ApproachingTargetPicker(rigidbody, PickerApproachWeighting)
        };

        if (PickerMinimumMass > 0 || PickerMasMultiplier != 0)
        {
            pickers.Add(new MassTargetPicker
            {
                MinMass = PickerMinimumMass,
                MassMultiplier = PickerMasMultiplier,
                OverMinMassBonus = PickerOverMinMassBonus
            });
        }

        _targetPicker = new CombinedTargetPicker(pickers);

        _turner = new UnityTurretTurner(rigidbody, TurnTable, ElevationHub, RestTarget, ProjectileSpeed);

        _fireControl = new UnityFireControl(this, ElevationHub.transform, ShootAngle);

        _runner = new TurretRunner(_detector, _targetPicker, _turner, _fireControl, this)
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
        //Debug.Log("Deactivating " + name);
        _active = false;
        tag = InactiveTag;
    }
}
