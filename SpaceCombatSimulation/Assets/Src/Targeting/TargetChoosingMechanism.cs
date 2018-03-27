using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using System.Linq;
using UnityEngine;

public class TargetChoosingMechanism : MonoBehaviour, IDeactivateableTargetKnower
{
    private ITargetDetector _detector;
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
    
    #region knowsCurrentTarget
    public Target CurrentTarget { get; set; }
    #endregion

    public IKnowsEnemyTags EnemyTagKnower;
    public CombinedTargetPicker TargetPicker;
    
    private bool _active = true;

    // Use this for initialization
    void Start ()
    {
        EnemyTagKnower = EnemyTagKnower ?? GetComponentInParent<IKnowsEnemyTags>();
        if(EnemyTagKnower == null)
        {
            Debug.LogError("Could not find enemy tag source for target picker");
            _active = false;
            return;
        }
        _rigidbody = GetComponent<Rigidbody>();
        _detector = new RepositoryTargetDetector(EnemyTagKnower);
    }
	
	// Update is called once per frame
	void Update () {
        if (_active)
        {
            var targetIsInvalid = CurrentTarget == null || CurrentTarget.Transform.IsInvalid();

            if (targetIsInvalid || (ContinuallyCheckForTargets && _pollCountdonwn <= 0))
            {
                //either the target is invalid, or the poll interval has elapsed and the ContinuallyCheckForTargets boolean is true, so a new poll should be made.
                if (EnemyTagKnower.KnownEnemyTags == null || !EnemyTagKnower.KnownEnemyTags.Any())
                {
                    Debug.LogWarning(name + " has no enemy tags configured.");
                }
                //Debug.Log(name + " aquiring new target");
                var allTargets = _detector.DetectTargets();
                var bestTarget = TargetPicker.FilterTargets(allTargets).OrderByDescending(t => t.Score).FirstOrDefault();
                if(TargetHasChanged(bestTarget, CurrentTarget))
                {
                    //LogTargetChange(CurrentTarget, bestTarget, targetIsInvalid);
                    
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
}
