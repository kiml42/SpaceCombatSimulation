using Assets.Src.Interfaces;
using Assets.Src.Rocket;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using System.Collections.Generic;
using UnityEngine;
using System.Linq;
using Assets.Src.Pilots;
using Assets.Src.ObjectManagement;
using System;

public class RocketController : MonoBehaviour, IKnowsEnemyTagAndtag, IKnowsCurrentTarget
{
    public float ShootAngle = 10;
    public float TorqueMultiplier = 1f;
    public float LocationAimWeighting = 3f;

    [Tooltip("Delay until engines (including RCS) will start and warhead will arm")]
    public int StartDelay = 10;

    [Tooltip("Delay until non-engine torquers will start")]
    public int TurningStartDelay = 2;

    public float TimeToTargetForDetonation = 0.5f;
    public Rigidbody Shrapnel;
    public Rigidbody ExplosionEffect;
    public int ShrapnelCount = 10;
    
    public float ShrapnelSpeed = 100;
    
    private ITargetDetector _detector;
    private ITargetPicker _targetPicker;
    private IPilot _pilot;

    private Rigidbody _rigidbody;
    
    private IRocketRunner _runner;
    private IDetonator _detonator;
    public bool TagShrapnel = false;
    public bool SetEnemyTagOnShrapnel = false;
    public Transform VectorArrow;
    
    public List<EngineControler> Engines;

    [Tooltip("Check for best targets every frame if true, otherwise only on target loss")]
    public bool ContinuallyCheckForTargets = false;

    [Tooltip("If set to true a target will be aquired once only, once lost the rocket will deactivate." +
        " Emulates rockets being told their target by their launcher at launch.")]
    public bool NeverRetarget = false;

    #region TargetPickerVariables
    public float PickerDistanceMultiplier = 1;
    public float PickerInRangeBonus = 0;
    public float PickerRange = 500;
    public float PickerAimedAtMultiplier = 100;
    public float MinimumMass = 0;
    public float PickerMasMultiplier = 1;
    public float PickerOverMinMassBonus = 10000;
    public float PickerApproachWeighting = 20;
    #endregion

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

    /// <summary>
    /// Rocket with detonate after this time.
    /// </summary>
    public float TimeToLive = Mathf.Infinity;
    #endregion
    
    #region knowsCurrentTarget
    public Target CurrentTarget { get; set; }
    #endregion

    [Tooltip("Time to friendly collision to activate maximum evasion")]
    public float TimeThresholdForMaximumEvasion = 2;

    [Tooltip("Time to friendly collision to activate medium evasion")]
    public float TimeThresholdForMediumEvasion = 4;

    [Tooltip("Time to friendly collision to activate minimal evasion")]
    public float TimeThresholdForMinimalEvasion = 6;

    [Tooltip("Frames to stay in evasion mode after no longer being on a collision course with a friendly.")]
    public int EvasionModeTime = 30;

    // Use this for initialization
    void Start()
    {
        _rigidbody = GetComponent<Rigidbody>();

        _detector = new RepositoryTargetDetector()
        {
            EnemyTags = EnemyTags
        };

        var pickers = new List<ITargetPicker>
        {
            new ProximityTargetPicker(_rigidbody){
                DistanceMultiplier = PickerDistanceMultiplier,
                InRangeBonus = PickerInRangeBonus,
                Range = PickerRange
            },
            new LookingAtTargetPicker(_rigidbody)
            {
                Multiplier = PickerAimedAtMultiplier
            },
            new ApproachingTargetPicker(_rigidbody, PickerApproachWeighting)
        };

        if (MinimumMass > 0 || PickerMasMultiplier != 0)
        {
            pickers.Add(new MassTargetPicker
            {
                MinMass = MinimumMass,
                MassMultiplier = PickerMasMultiplier,
                OverMinMassBonus = PickerOverMinMassBonus
            });
        }

        _targetPicker = new CombinedTargetPicker(pickers);

        var initialAngularDrag = _rigidbody.angularDrag;
        var torqueApplier = new MultiTorquerTorqueAplier(_rigidbody, TorqueMultiplier, initialAngularDrag);

        _pilot = new RocketPilot(torqueApplier, _rigidbody, Engines, ShootAngle, StartDelay)
        {
            LocationAimWeighting = LocationAimWeighting,
            TurningStartDelay = TurningStartDelay,
            VectorArrow = VectorArrow,
            TimeThresholdForMaximumEvasion = TimeThresholdForMaximumEvasion,
            TimeThresholdForMediumEvasion = TimeThresholdForMediumEvasion,
            TimeThresholdForMinimalEvasion = TimeThresholdForMinimalEvasion,
            EvasionModeTime = EvasionModeTime
        };

        var exploder = new ShrapnelExploder(_rigidbody, Shrapnel, ExplosionEffect, ShrapnelCount)
        {
            EnemyTags = EnemyTags,
            TagShrapnel = TagShrapnel,
            SetEnemyTagOnShrapnel = SetEnemyTagOnShrapnel,
            ShrapnelSpeed = ShrapnelSpeed
        };

        _detonator = new ProximityApproachDetonator(exploder, _rigidbody, TimeToTargetForDetonation, ShrapnelSpeed);

        _runner = new RocketRunner(_detector, _targetPicker, _pilot, _detonator, this)
        {
            name = transform.name,
            ContinuallyCheckForTargets = ContinuallyCheckForTargets
        };
        
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

        if(TimeToLive < 0)
        {
            _detonator.DetonateNow();
        }
        TimeToLive--;
    }
}
