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

    [Tooltip("If set to true a target will be aquired once only, once lost the rocket will deactivate." +
        " Emulates rockets being told their target by their launcher at launch.")]
    public bool NeverRetarget = false;
    
    [Tooltip("time to wait between polling for better targets (seconds).")]
    public float PollInterval = 0;
    private float _pollCountdonwn = 0;

    #region knowsCurrentTarget
    public ITarget CurrentTarget { get; private set; }
    public IEnumerable<ITarget> FilteredTargets { get; private set; }
    #endregion

    public IKnowsEnemyTags EnemyTagKnower;
    public CombinedTargetPicker TargetPicker;

    public bool IncludeNavigationTargets = false;
    public bool IncludeAtackTargets = true;

    // Use this for initialization
    void Start ()
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
	
	// Update is called once per frame
	void FixedUpdate () {
        if (_active)
        {
            var targetIsInvalid = CurrentTarget == null || CurrentTarget.Transform.IsInvalid();

            if (targetIsInvalid || (ContinuallyCheckForTargets && _pollCountdonwn <= 0))
            {
                //either the target is invalid, or the poll interval has elapsed and the ContinuallyCheckForTargets boolean is true, so a new poll should be made.
                if (Detector == null)
                {
                    Debug.LogWarning(name + " has no detector.");
                    return;
                }
                //Debug.Log(name + " aquiring new target");
                var allTargets = Detector.DetectTargets(IncludeNavigationTargets, IncludeAtackTargets);
                var allTargetsList = allTargets.ToList();
                FilteredTargets = TargetPicker.FilterTargets(allTargets).OrderByDescending(t => t.Score).Select(t => t.Target);
                var bestTarget = FilteredTargets.FirstOrDefault();
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
                _pollCountdonwn -= Time.fixedDeltaTime;
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

    //private void LogTargetChange(Target old, PotentialTarget newTarget, bool oldWasInvalid)
    //{
    //    var log = transform.name + " has started targeting ";
    //    if (newTarget != null)
    //    {
    //        log += newTarget.Transform.name + " (score=" + newTarget.Score + ") at " + newTarget.Transform.position;
    //    } else
    //    {
    //        log += "nothing";
    //    }
    //    if (oldWasInvalid)
    //    {
    //        log += " because the previous target was invalid";
    //    } else if (old != null)
    //    {
    //        log += ". Previously " + old.Transform.name + " at " + old.Transform.position;
    //        Debug.Log(log); //log only retargets.
    //        return;
    //    }
    //    //Debug.Log(log);
    //}

    protected override GenomeWrapper SubConfigure(GenomeWrapper genomeWrapper)
    {
        PollInterval = genomeWrapper.GetScaledNumber(10, 1);

        return genomeWrapper;
    }
}
