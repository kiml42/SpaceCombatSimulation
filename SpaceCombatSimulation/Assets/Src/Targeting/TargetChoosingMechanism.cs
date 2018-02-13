﻿using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using System;
using Assets.Src.Evolution;

public class TargetChoosingMechanism : MonoBehaviour, IDeactivateableTargetPicker, IGeneticConfigurable
{

    private ITargetDetector _detector;
    private ITargetPicker _targetPicker;
    private Rigidbody _rigidbody;

    [Tooltip("Check for best targets every frame if true, otherwise only on target loss")]
    public bool ContinuallyCheckForTargets = false;

    [Tooltip("If set to true a target will be aquired once only, once lost the rocket will deactivate." +
        " Emulates rockets being told their target by their launcher at launch.")]
    public bool NeverRetarget = false;

    [Tooltip("Set to true to kull invalid targets rather than simply giving them much lower scores." +
        " Targets will not be kulled if there are no valid targets (so invalid targets will be tracked in case they become valid later)")]
    public bool DropInvalidTargetsWhenTereAreValidTargets = false;

    [Tooltip("time to wait between polling for better targets (seconds).")]
    public float PollInterval = 0;
    private float _pollCountdonwn = 0;


    #region EnemyTags
    void IKnowsEnemyTags.AddEnemyTag(string newTag)
    {
        var tags = EnemyTags.ToList();
        tags.Add(newTag);
        EnemyTags = tags.Distinct().ToList();
    }

    List<string> IKnowsEnemyTags.EnemyTags
    {
        get
        {
            return EnemyTags;
        }
        set
        {
            EnemyTags = value;
        }
    }

    public List<string> EnemyTags;
    #endregion

    [Header("TargetPickerVariables")]
    #region TargetPickerVariables
    [Header("TargetTypes")]
    [Tooltip("Ship Types to always ignore")]
    public List<ShipType> DisalowedTypes = new List<ShipType>
        {
            ShipType.TinyMunitions
        };
    [Tooltip("ShipTypes to grant a score bonus to")]
    public List<ShipType> PreferdTypes = new List<ShipType>
        {
            ShipType.LargeMunitions,
            ShipType.Fighter,
            ShipType.Corvette,
            ShipType.Turret,
            ShipType.Capital,
            ShipType.SuperCapital
        };
    public float PreferedTypeBonus = 100;

    [Header("CorrectHemisphere")]
    [Tooltip("Targets in the +y hemisphere of this object get the InCorrectHemisphereBonus")]
    public Transform HemisphereFilterObject;
    public float InCorrectHemisphereBonus = 1000;

    [Header("Mass")]
    public float PickerMassMultiplier = 1;
    public float MinimumMass = 0;
    public float PickerOverMinMassBonus = 10000;

    [Header("Distance")]
    public float PickerDistanceMultiplier = 1;
    public float PickerRange = 500;
    public float PickerInRangeBonus = 0;

    [Header("LineOfSight")]
    public float LineOfSightBonus = 1000;
    public float MinLineOfSightDetectionDistance = 2;

    [Header("AimedAt")]
    public float PickerAimedAtMultiplier = 100;
    [Tooltip("defaults to this object")]
    public Rigidbody PickerAimingObject;

    [Header("Approaching")]
    public float PickerApproachWeighting = 20;

    [Header("Approaching")]
    public float PreviousTargetBonus = 500;
    #endregion

    #region knowsCurrentTarget
    public Target CurrentTarget { get; set; }
    #endregion
    
    private bool _active = true;

    // Use this for initialization
    void Start ()
    {
        var speedKnower = GetComponent<IKnowsProjectileSpeed>();
        var projectileSpeed = speedKnower != null ? speedKnower.ProjectileSpeed : null;
        _rigidbody = GetComponent<Rigidbody>();
        PickerAimingObject = PickerAimingObject ?? _rigidbody;

        _detector = new RepositoryTargetDetector()
        {
            EnemyTags = EnemyTags
        };

        var pickers = new List<ITargetPicker>
        {
            new ShipTypeTagetPicker
            {
                DisalowedTypes = DisalowedTypes,
                PreferdTypes = PreferdTypes,
                PreferedTypeBonus = PreferedTypeBonus
            }
        };
        

        if(HemisphereFilterObject != null && InCorrectHemisphereBonus != 0)
        {
            pickers.Add(new InCorrectHemisphereTargetPicker(HemisphereFilterObject)
            {
                ExtraScoreForValidTargets = InCorrectHemisphereBonus,
                KullInvalidTargets = DropInvalidTargetsWhenTereAreValidTargets
            });
        }

        if (MinimumMass > 0 || PickerMassMultiplier != 0)
        {
            pickers.Add(new MassTargetPicker
            {
                MinMass = MinimumMass,
                MassMultiplier = PickerMassMultiplier,
                OverMinMassBonus = PickerOverMinMassBonus,
                KullInvalidTargets = DropInvalidTargetsWhenTereAreValidTargets
            });
        }

        if(PickerDistanceMultiplier != 0 || (PickerInRangeBonus != 0 && PickerRange > 0))
        {
            pickers.Add(new ProximityTargetPicker(_rigidbody)
            {
                DistanceMultiplier = PickerDistanceMultiplier,
                InRangeBonus = PickerInRangeBonus,
                Range = PickerRange,
                KullInvalidTargets = DropInvalidTargetsWhenTereAreValidTargets
            });
        }
        
        if(LineOfSightBonus != 0)
        {
            pickers.Add(new LineOfSightTargetPicker(transform)
            {
                BonusForCorrectObject = LineOfSightBonus,
                KullInvalidTargets = DropInvalidTargetsWhenTereAreValidTargets,
                MinDetectionDistance = MinLineOfSightDetectionDistance
            });
        }
        
        if(PickerAimedAtMultiplier != 0)
        {
            pickers.Add(new LookingAtTargetPicker(PickerAimingObject)
            {
                Multiplier = PickerAimedAtMultiplier,
                ProjectileSpeed = projectileSpeed
            });
        }

        if(PickerApproachWeighting != 0)
        {
            pickers.Add(new ApproachingTargetPicker(_rigidbody, PickerApproachWeighting));
        }

        if(PreviousTargetBonus != 0)
        {
            pickers.Add(new PreviousTargetPicker(this, PreviousTargetBonus ));
        }

        _targetPicker = new CombinedTargetPicker(pickers);
    }
	
	// Update is called once per frame
	void Update () {
        if (_active)
        {
            var targetIsInvalid = CurrentTarget == null || CurrentTarget.Transform.IsInvalid();

            if (targetIsInvalid || (ContinuallyCheckForTargets && _pollCountdonwn <= 0))
            {
                //either the target is invalid, or the poll interval has elapsed and the ContinuallyCheckForTargets boolean is true, so a new poll should be made.
                if (EnemyTags == null || !EnemyTags.Any())
                {
                    Debug.LogWarning(name + " has no enemy tags configured.");
                }
                //Debug.Log(name + " aquiring new target");
                var allTargets = _detector.DetectTargets();
                var bestTarget = _targetPicker.FilterTargets(allTargets).OrderByDescending(t => t.Score).FirstOrDefault();
                if(TargetHasChanged(bestTarget, CurrentTarget))
                {
                    LogTargetChange(CurrentTarget, bestTarget, targetIsInvalid);
                    
                    CurrentTarget = bestTarget;
                }
                if (CurrentTarget != null && NeverRetarget)
                {
                    Deactivate();   //never try to find a new target, so deactivate
                }
                _pollCountdonwn = PollInterval;
            } else
            {
                //there was no poll this frame, so decrement the countdown.
                _pollCountdonwn -= Time.deltaTime;
            }
        }
    }

    private bool TargetHasChanged(Target old, Target newTarget)
    {
        if(old == newTarget)
        {
            //covers both are null
            return false;
        }
        if(old == null && newTarget != null || old != null && newTarget == null)
        {
            return true;
        }
        return old.Transform != newTarget.Transform;
    }

    private void LogTargetChange(Target old, PotentialTarget newTarget, bool oldWasInvalid)
    {
        var log = transform.name + " has started targeting ";
        if (newTarget != null)
        {
            log += newTarget.Transform.name + " (score=" + newTarget.Score + ") at " + newTarget.Transform.position;
        } else
        {
            log += "nothing";
        }
        if (oldWasInvalid)
        {
            log += " because the previous target was invalid";
        } else if (old != null)
        {
            log += ". Previously " + old.Transform.name + " at " + old.Transform.position;
            Debug.Log(log); //log only retargets.
            return;
        }
        //Debug.Log(log);
    }

    public void Deactivate()
    {
        _active = false;
    }

    public bool GetConfigFromGenome = true;

    private float MaxBonus = 1800;
    private float MaxMultiplier = 100;

    public GenomeWrapper Configure(GenomeWrapper genomeWrapper)
    {
        if (GetConfigFromGenome)
        {
            PreferedTypeBonus = genomeWrapper.GetScaledNumber(MaxBonus);
            InCorrectHemisphereBonus = genomeWrapper.GetScaledNumber(MaxBonus);
            PickerMassMultiplier = genomeWrapper.GetScaledNumber(MaxMultiplier);
            MinimumMass = genomeWrapper.GetScaledNumber(200);
            PickerOverMinMassBonus = genomeWrapper.GetScaledNumber(MaxBonus);
            PickerDistanceMultiplier = genomeWrapper.GetScaledNumber(MaxMultiplier);
            PickerRange = genomeWrapper.GetScaledNumber(2000);
            PickerInRangeBonus = genomeWrapper.GetScaledNumber(MaxBonus);
            LineOfSightBonus = genomeWrapper.GetScaledNumber(MaxBonus);
            MinLineOfSightDetectionDistance = genomeWrapper.GetScaledNumber(10);
            PickerAimedAtMultiplier = genomeWrapper.GetScaledNumber(MaxMultiplier);
            PickerApproachWeighting = genomeWrapper.GetScaledNumber(15);
            PreviousTargetBonus = genomeWrapper.GetScaledNumber(MaxBonus);

            EnemyTags = genomeWrapper.EnemyTags;
            _detector = new RepositoryTargetDetector()
            {
                EnemyTags = EnemyTags
            };
        }

        return genomeWrapper;
    }
}
