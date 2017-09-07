using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System.Linq;
using System;
using Assets.src.interfaces;
using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using Assets.Src.ObjectManagement;

public class ShipCam : MonoBehaviour, IKnowsCurrentTarget
{

    public string SpaceShipTag = "SpaceShip";
    public List<string> TagsToFollow = new List<string>
    {
        "Team1",
        "Team2",
        "Team3",
        "Team4",
        "Team5",
        "Enemy",
    };
    public float RotationSpeed = 0.5f;
    public float TranslateSpeed = 2;
    public float FocusMoveSpeed = 1;
    public Camera Camera;
    private Rigidbody _rigidbody;

    public float FocusAnglePower = -0.67f;
    public float FocusAngleMultiplier = 1000;
    public float SetbackIntercept = -70;
    public float SetBackMultiplier = 0.5f;

    private ITargetDetector _detector;

    private PotentialTarget _followedTarget;
    private PotentialTarget _targetToWatch;

    private ITargetPicker _watchPicker;
    private ITargetPicker _followPicker;

    private HasTagTargetPicker _tagPicker;
    private PreviousTargetPicker _currentlyFollowingPicker;

    public float ApproachTargetPickerWeighting = 20;
    public float MinimumMass = 0;
    public float AdditionalScoreForSameTagOrCurrentlyFllowed = -100000;
    public float _focusDistance = 0;

    public PotentialTarget CurrentTarget
    {
        get
        {
            return _followedTarget;
        }

        set
        {
            _followedTarget = value;
        }
    }

    // Use this for initialization
    void Start () {
        _rigidbody = GetComponent("Rigidbody") as Rigidbody;
        _detector = new ChildTagTargetDetector
        {
            Tag = SpaceShipTag
        };

        _tagPicker = new HasTagTargetPicker(SpaceShipTag);
        _currentlyFollowingPicker = new PreviousTargetPicker(this)
        {
            AdditionalScore = AdditionalScoreForSameTagOrCurrentlyFllowed
        };

        var watchPickers = new List<ITargetPicker>
        {
            _tagPicker,
            _currentlyFollowingPicker,
            new ProximityTargetPicker(transform)
        };

        if(_rigidbody != null)
        {
            watchPickers.Add(new LookingAtTargetPicker(_rigidbody));
        }

        if (MinimumMass > 0)
        {
            watchPickers.Add(new MinimumMassTargetPicker(MinimumMass));
        }

        _watchPicker = new CombinedTargetPicker(watchPickers);
        
        var followPickers = new List<ITargetPicker>
        {
            new ProximityTargetPicker(transform)
        };

        if (_rigidbody != null)
        {
            followPickers.Add(new ApproachingTargetPicker(_rigidbody, ApproachTargetPickerWeighting));
        }

        if (MinimumMass > 0)
        {
            followPickers.Add(new MinimumMassTargetPicker(MinimumMass));
        }
        _followPicker = new CombinedTargetPicker(followPickers);
    }
	
	// Update is called once per frame
	void Update () {
        if (Input.GetKeyUp(KeyCode.Z))
        {
            PickRandomToFollow();
        }
        else if(_followedTarget == null || _followedTarget.TargetTransform.IsInvalid())
        {
            PickBestTargetToFollow();
        }

        if (_followedTarget != null)
        {
            transform.position = Vector3.Slerp(transform.position, _followedTarget.TargetTransform.position, Time.deltaTime * TranslateSpeed);

            PickTargetToWatch();
            if (_targetToWatch != null)
            {
                //Debug.Log("Following " + _followedTarget.TargetTransform.name + ", Watching " + _targetToWatch.TargetTransform.name);
                //rotate enpty parent
                var _direction = (_targetToWatch.TargetTransform.position - transform.position).normalized;
                var _lookRotation = Quaternion.LookRotation(_direction);
                transform.rotation = Quaternion.Slerp(transform.rotation, _lookRotation, Time.deltaTime * RotationSpeed);

                //move the focus
                _focusDistance = Mathf.Lerp(_focusDistance, Vector3.Distance(transform.position, _targetToWatch.TargetTransform.position), Time.deltaTime * FocusMoveSpeed);

                ////rotate the camera itself - Doesn't look quite right.
                //_direction = (target.transform.position - Camera.transform.position).normalized;
                //_lookRotation = Quaternion.LookRotation(_direction);
                //Camera.transform.rotation = Quaternion.Lerp(Camera.transform.rotation, _lookRotation, Time.deltaTime * RotationSpeed);
            }
            if(Camera != null)
            {
                var angle = Clamp((float)(FocusAngleMultiplier * Math.Pow (_focusDistance, FocusAnglePower)), 1, 90);
                Camera.fieldOfView = angle;
                var setBack = SetbackIntercept - _focusDistance * SetBackMultiplier;
                var camPosition = Camera.transform.localPosition;
                camPosition.z = setBack;
                Camera.transform.localPosition = camPosition;
            }
        }

    }

    private void PickTargetToWatch()
    {
        //Debug.Log("To Watch");
        var targets = _detector.DetectTargets();
        targets = _watchPicker.FilterTargets(targets)
            .OrderByDescending(s => s.Score);
        //foreach (var item in targets)
        //{
        //    Debug.Log(item.TargetTransform.name + ": " + item.Score);
        //}
        
        _targetToWatch = targets
            .FirstOrDefault();
    }

    private void PickBestTargetToFollow()
    {
        //Debug.Log("To Follow");
        var targets = _detector.DetectTargets();
        targets = _followPicker.FilterTargets(targets)
            .OrderByDescending(s => s.Score);
        //foreach (var item in targets)
        //{
        //    Debug.Log(item.TargetTransform.name + ": " + item.Score);
        //}

        _followedTarget = targets
            .FirstOrDefault();

        _tagPicker.Tag = _followedTarget.TargetTransform.tag;
    }

    private void PickRandomToFollow()
    {
        _followedTarget = _detector
            .DetectTargets()
            .Where(s => s.TargetTransform != _followedTarget.TargetTransform)
            .OrderBy(s => UnityEngine.Random.value)
            .FirstOrDefault();
    }

    public static float Clamp(float value, float min, float max)
    {
        return (value < min) ? min : (value > max) ? max : value;
    }
}
