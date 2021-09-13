using Assets.Src.Controllers;
using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class TargetChoosingMechanism : AbstractDeactivatableController, IDeactivateableTargetKnower
{
    public ITargetDetector Detector;

    [Tooltip("Check for best targets every frame if true, otherwise only on target loss")]
    public bool ContinuallyCheckForTargets = false;

    [Tooltip("If set to true a target will be acquired once only, once lost the rocket will deactivate." +
        " Emulates rockets being told their target by their launcher at launch.")]
    public bool NeverRetarget = false;
    
    [Tooltip("time to wait between polling for better targets (seconds).")]
    public float PollInterval = 0;
    private float _pollCountdown = 0;

    #region knowsCurrentTarget
    public ITarget CurrentTarget { get; private set; }
    public IEnumerable<ITarget> FilteredTargets { get; private set; }
    #endregion

    public IKnowsEnemyTags EnemyTagKnower;
    public CombinedTargetPicker TargetPicker;

    public bool IncludeNavigationTargets = false;
    public bool IncludeAtackTargets = true;

    public bool Log = false;

    // Use this for initialization
    public void Start ()
    {
        if(TargetPicker == null)
        {
            Debug.LogError(name + " Has no target picker");
            _active = false;
            return;
        }
        if(Detector == null)
        {
            EnemyTagKnower = EnemyTagKnower ?? GetComponentInParent<IKnowsEnemyTags>();
            if(EnemyTagKnower == null)
            {
                Debug.LogWarning(name + " Could not find enemy tag source for target picker while configuring the detector.");
            } else
            {
                Detector = new RepositoryTargetDetector(EnemyTagKnower);
            }
        }
        FilteredTargets = new List<ITarget>();//ensure that this isn't null.
    }
	
	void FixedUpdate () {
        //Debug.Log("TCM.FixedUpdate - active: " + _active);
        if (_active)
        {
            var targetIsInvalid = CurrentTarget == null || CurrentTarget.Transform.IsInvalid();

            if (targetIsInvalid || (ContinuallyCheckForTargets && _pollCountdown <= 0))
            {
                //either the target is invalid, or the poll interval has elapsed and the ContinuallyCheckForTargets boolean is true, so a new poll should be made.
                if (Detector == null)
                {
                    Debug.LogWarning(name + " Target Choosing mechanism has no detector.");
                    return;
                }
                //Debug.Log(name + " aquiring new target");
                var allTargets = Detector.DetectTargets(IncludeNavigationTargets, IncludeAtackTargets);
                var allTargetsList = allTargets.ToList();
                var filteredPotentialTargets = TargetPicker.FilterTargets(allTargets).OrderByDescending(t => t.Score);
                FilteredTargets = filteredPotentialTargets.Select(t => t.Target);
                var bestTarget = FilteredTargets.FirstOrDefault();
                //Debug.Log("Count of targets: " + allTargets.Count());
                if(TargetHasChanged(bestTarget, CurrentTarget))
                {
                    if(Log)
                        LogTargetChange(CurrentTarget, filteredPotentialTargets.FirstOrDefault(), targetIsInvalid);

                    CurrentTarget = bestTarget;
                }
                if (CurrentTarget != null && NeverRetarget)
                {
                    Deactivate();   //never try to find a new target, so deactivate
                }
                _pollCountdown = PollInterval;
            } else
            {
                //there was no poll this frame, so decrement the countdown.
                _pollCountdown -= Time.fixedDeltaTime;
            }
        }
    }

    private bool TargetHasChanged(ITarget old, ITarget newTarget)
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

    private void LogTargetChange(ITarget old, PotentialTarget newTarget, bool oldWasInvalid)
    {
        var log = transform.name + " has started targeting ";
        if (newTarget != null)
        {
            log += newTarget.Target.Transform.name + " (score=" + newTarget.Score + ") at " + newTarget.Target.Transform.position;
        } else
        {
            log += "nothing";
        }
        if (oldWasInvalid)
        {
            log += $" because the previous target {old} was invalid";
        } else if (old != null)
        {
            log += ". Previously " + old.Transform.name + " at " + old.Transform.position;
            return;
        }
        Debug.Log(log);
    }

    protected override GenomeWrapper SubConfigure(GenomeWrapper genomeWrapper)
    {
        PollInterval = genomeWrapper.GetScaledNumber(10, 1);

        return genomeWrapper;
    }
}
