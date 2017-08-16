using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using Assets.Src.Turret;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class BeamTurretController : MonoBehaviour, IKnowsEnemyTagAndtag, ITurretController, IDeactivatable
{
    public Transform RestTarget;
    public int LoadTime = 50;
    public int ShootTime = 200;
    public int StartOffset = 10;
    public float TanShootAngle = 0.1f;
    public int RandomStartTime = 30;
    public float BeamForce = 0;
    public float BeamDamage = 10;
    public Transform HitEffect;

    public Transform TurnTable;
    public Transform ElevationHub;
    public Transform BeamsParent;
    private List<Beam> _beams;

    private ITargetDetector _detector;
    private ITargetPicker _targetPicker;
    private ITurretTurner _turner;
    private IFireControl _fireControl;

    private bool _onInPrevFrame = false;
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

    private ITurretRunner _runner;

    // Use this for initialization
    void Start()
    {
        RandomStartTime = (int)(RandomStartTime * UnityEngine.Random.value);
        var emitterCount = BeamsParent.childCount;

        _beams = new List<Beam>();
        for (int i = 0; i < emitterCount; i++)
        {
            var beam = BeamsParent.GetChild(i);
            beam.localScale = Vector3.zero;
            _beams.Add(new Beam(beam, ShootTime, LoadTime)
            {
                BeamForce = BeamForce,
                HitEffect = HitEffect,
                BeamDamage = BeamDamage,
                FriendlyTag = tag
            });
        }

        _detector = new UnityTargetDetector()
        {
            ProjectileSpeed = 0,
            EnemyTag = EnemyTag
        };

        _targetPicker = new CombinedTargetPicker(new List<ITargetPicker>
        {
            new AboveTurnTableTargetPicker(transform),
            new ProximityTargetPicker(transform),
            new LookingAtTargetPicker(transform, ElevationHub)
        });

        _turner = new UnityTurretTurner(transform, TurnTable, ElevationHub, RestTarget);

        _fireControl = new UnityFireControl(this, transform, ElevationHub, TanShootAngle);

        _runner = new TurretRunner(_detector, _targetPicker, _turner, _fireControl);
    }

    // Update is called once per frame
    void Update()
    {
        if (_active && _runner != null)
        {
            _runner.RunTurret();
        } else
        {
            foreach (var beam in _beams)
            {
                beam.TurnOff();
            }
            //scrub the list now they've all been turned off.
            _beams = new List<Beam>();
        }
    }

    public void Shoot(bool shouldShoot)
    {
        if (_active)
        {
            var shouldTurnOn = shouldShoot & TurnTable.IsValid() && ElevationHub.IsValid();
            var i = 0;
            foreach (var beam in _beams)
            {
                if (shouldTurnOn)
                {
                    if (!_onInPrevFrame)
                    {
                        beam.ForceReload(i * StartOffset);
                    }
                    beam.TurnOn();
                }
                else
                {
                    beam.TurnOff();
                }
                i++;
            }
            _onInPrevFrame = shouldTurnOn;
        }
    }

    public void Deactivate()
    {
        _active = false;
        foreach (var beam in _beams)
        {
            beam.TurnOff();
        }
        //scrub the list now they've all been turned off.
        _beams = new List<Beam>();
    }
}