using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using System.Linq;
using System;
using Assets.src.interfaces;
using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using Assets.Src.ObjectManagement;

public class ShipCam : MonoBehaviour, IKnowsCurrentTarget
{
    /// <summary>
    /// tag of a child object of a fhing to watch or follow.
    /// </summary>
    public string SpaceShipTag = "SpaceShip";
    
    /// <summary>
    /// Rotation speed multiplier
    /// </summary>
    public float RotationSpeed = 0.5f;

    /// <summary>
    /// transtlation speed multiplier. Higher values will be able to track faster objects, but may move from object to object too fast.
    /// </summary>
    public float TranslateSpeed = 2;

    /// <summary>
    /// This value times the speed of the followed object is added to the translate speed.
    /// </summary>
    public float FollowedObjectTranslateSpeedMultiplier = 0;

    /// <summary>
    /// rate at which the camera will zoom in and out.
    /// </summary>
    public float FocusMoveSpeed = 1;

    public Camera Camera;

    public float FocusAnglePower = -0.67f;
    public float FocusAngleMultiplier = 1000;
    public float SetbackIntercept = -70;
    public float SetBackMultiplier = 0.5f;
    
    public float ApproachTargetPickerWeighting = 20;

    /// <summary>
    /// Minimum mass of objects to follow or look at.
    /// </summary>
    public float MinimumMass = 0;

    /// <summary>
    /// added to the score of the currently followed object and other objectes with the same tag.
    /// Used when picking a target to look at, if the object being followed doensn't have its own target.
    /// </summary>
    public float AdditionalScoreForSameTagOrCurrentlyFllowed = -100000;

    /// <summary>
    /// The distance the camera is trying to zoom in to to see well.
    /// Should be private, but exposed for debuging reasons.
    /// </summary>
    public float _focusDistance = 0;

    /// <summary>
    /// when the parent is within this angle of looking at the watched object, the camera tself starts tracking.
    /// </summary>
    public float NearlyAimedAngle = 3;

    private Rigidbody _rigidbody;
    private ITargetDetector _detector;

    private PotentialTarget _followedTarget;
    private PotentialTarget _targetToWatch;

    private ITargetPicker _watchPicker;
    private ITargetPicker _followPicker;

    private HasTagTargetPicker _tagPicker;
    private PreviousTargetPicker _currentlyFollowingPicker;
    public float DefaultFocusDistance = 200;
    public float IdleRotationSpeed = -0.05f;

    public Canvas Canvas;
    //public Image HealthBarPrefab;
    public GameObject ReticlePrefab;

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
            //Debug.Log("following " + _followedTarget.TargetTransform);
            var totalTranslateSpeed = TranslateSpeed;
            if (_followedTarget.TargetRigidbody != null && FollowedObjectTranslateSpeedMultiplier != 0)
            {
                totalTranslateSpeed += FollowedObjectTranslateSpeedMultiplier * _followedTarget.TargetRigidbody.velocity.magnitude;
            }
            transform.position = Vector3.Slerp(transform.position, _followedTarget.TargetTransform.position, Time.deltaTime * totalTranslateSpeed);

            PickTargetToWatch();
            if (_targetToWatch != null && _followedTarget.TargetTransform != _targetToWatch.TargetTransform)
            {
                //Debug.Log("Following " + _followedTarget.TargetTransform.name + ", Watching " + _targetToWatch.TargetTransform.name);
                //rotate enpty parent
                var direction = (_targetToWatch.TargetTransform.position - transform.position).normalized;
                var lookRotation = Quaternion.LookRotation(direction);
                transform.rotation = Quaternion.Slerp(transform.rotation, lookRotation, Time.deltaTime * RotationSpeed);

                //move the focus
                _focusDistance = Mathf.Lerp(_focusDistance, Vector3.Distance(transform.position, _targetToWatch.TargetTransform.position), Time.deltaTime * FocusMoveSpeed);

                if (Quaternion.Angle(lookRotation, transform.rotation) < NearlyAimedAngle)
                {
                    //rotate the camera itself - only if the parent is looking in vaguely the right direction.
                    direction = (_targetToWatch.TargetTransform.position - Camera.transform.position).normalized;
                    lookRotation = Quaternion.LookRotation(direction);
                    Camera.transform.rotation = Quaternion.Slerp(Camera.transform.rotation, lookRotation, Time.deltaTime * RotationSpeed * 0.3f);
                }
            }
            else
            {
                //Debug.Log("Nothing to watch");
                IdleRotation();
            }
        } else {
            //Debug.Log("Nothing to follow");
            IdleRotation();
        }
        var angle = Clamp((float)(FocusAngleMultiplier * Math.Pow(_focusDistance, FocusAnglePower)), 1, 90);
        Camera.fieldOfView = angle;
        var setBack = SetbackIntercept - _focusDistance * SetBackMultiplier;
        var camPosition = Camera.transform.localPosition;
        camPosition.z = setBack;
        Camera.transform.localPosition = camPosition;


        //DrawHealthBars();
    }

    private void DrawHealthBars()
    {
        if(ReticlePrefab != null && Canvas!=null)
        {
            for (int i = 0; i < Canvas.transform.childCount; i++)
            {
                Debug.Log("Destroying " + Canvas.transform.GetChild(i));
                Destroy(Canvas.transform.GetChild(i).gameObject);
            }
            var targets = _detector.DetectTargets();

            foreach (var target in targets)
            {
                Debug.Log(target.TargetTransform.name);
                var coords = this.Camera.WorldToScreenPoint(target.TargetTransform.position);
                Debug.Log(coords);

                Debug.Log(Screen.width);
                coords.x = -coords.x;
                coords.y = -coords.y;

                var reticle = Instantiate(ReticlePrefab);
                reticle.transform.SetParent(Canvas.transform);

                RectTransform CanvasRect = Canvas.GetComponent<RectTransform>();

                var rect = reticle.GetComponent<RectTransform>();

                Vector2 WorldObject_ScreenPosition = new Vector2(
                     ((coords.x * CanvasRect.sizeDelta.x) - (CanvasRect.sizeDelta.x * 0.5f)),
                     ((coords.y * CanvasRect.sizeDelta.y) - (CanvasRect.sizeDelta.y * 0.5f)));

                rect.anchoredPosition = coords;



                //rect.localPosition = coords;
                //Debug.Log(rect.localPosition);
                //rect.anchorMin = new Vector2(0.5f, 0.5f);
                //rect.anchorMax = new Vector2(0.5f, 0.5f);
                //rect.pivot = new Vector2(0.5f, 0.5f);
            }
        }
    }

    private void IdleRotation()
    {
        //Debug.Log("IdleRotation");
        transform.rotation *= Quaternion.Euler(transform.up * IdleRotationSpeed);
        _focusDistance = Mathf.Lerp(_focusDistance, DefaultFocusDistance, Time.deltaTime * FocusMoveSpeed);
    }

    private void PickTargetToWatch()
    {
        //Debug.Log("to watch");
        var knower = _followedTarget.TargetTransform.GetComponent("IKnowsCurrentTarget") as IKnowsCurrentTarget;
        if (knower != null && knower.CurrentTarget != null)
        {
            _targetToWatch = knower.CurrentTarget;
            //Debug.Log("Watching followed object's target: " + _targetToWatch.TargetTransform.name);
        } else
        {
            var targets = _detector.DetectTargets();
            targets = _watchPicker.FilterTargets(targets)
                .OrderByDescending(s => s.Score);
            //foreach (var item in targets)
            //{
            //    Debug.Log(item.TargetTransform.name + ": " + item.Score);
            //}
        
            _targetToWatch = targets
                .FirstOrDefault();
            //Debug.Log("Watching picked target: " + _targetToWatch.TargetTransform.name);
        }
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

        if(_followedTarget != null)
        {
            _tagPicker.Tag = _followedTarget.TargetTransform.tag;
        }
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
