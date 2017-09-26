using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class TargetChoosingMechanism : MonoBehaviour, IKnowsEnemyTagAndtag, IKnowsCurrentTarget
{

    private ITargetDetector _detector;
    private ITargetPicker _targetPicker;
    private Rigidbody _rigidbody;

    [Tooltip("Check for best targets every frame if true, otherwise only on target loss")]
    public bool ContinuallyCheckForTargets = false;

    [Tooltip("If set to true a target will be aquired once only, once lost the rocket will deactivate." +
        " Emulates rockets being told their target by their launcher at launch.")]
    public bool NeverRetarget = false;

    #region TargetPickerVariables
    public float PickerDistanceMultiplier = 1;
    public float PickerRange = 500;
    public float PickerInRangeBonus = 0;
    
    public float PickerMassMultiplier = 1;
    public float MinimumMass = 0;
    public float PickerOverMinMassBonus = 10000;

    public float PickerAimedAtMultiplier = 100;

    public float PickerApproachWeighting = 20;
    #endregion

    #region knowsCurrentTarget
    public Target CurrentTarget { get; set; }
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

    public List<string> EnemyTags = new List<string> { "Enemy" };
    #endregion

    private bool _hasHadTarget = false;

    // Use this for initialization
    void Start () {
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

        if (MinimumMass > 0 || PickerMassMultiplier != 0)
        {
            pickers.Add(new MassTargetPicker
            {
                MinMass = MinimumMass,
                MassMultiplier = PickerMassMultiplier,
                OverMinMassBonus = PickerOverMinMassBonus
            });
        }

        _targetPicker = new CombinedTargetPicker(pickers);

    }
	
	// Update is called once per frame
	void Update () {
        if (!NeverRetarget || !_hasHadTarget)
        {
            var targetIsInvalid = CurrentTarget == null || CurrentTarget.Transform.IsInvalid();

            if (ContinuallyCheckForTargets || targetIsInvalid)
            {
                //Debug.Log(name + " aquiring new target");
                var allTargets = _detector.DetectTargets();
                var bestTarget = _targetPicker.FilterTargets(allTargets).OrderByDescending(t => t.Score).FirstOrDefault();
                CurrentTarget = bestTarget;
                if (bestTarget != null)
                {
                    _hasHadTarget = true;
                }
            }
        }
    }
}
