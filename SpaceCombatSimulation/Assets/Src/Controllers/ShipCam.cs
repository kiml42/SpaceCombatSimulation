using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using System.Linq;
using System;
using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using Assets.Src.ObjectManagement;

public class ShipCam : MonoBehaviour, IKnowsCurrentTarget
{
    /// <summary>
    /// tag of a child object of a fhing to watch or follow.
    /// </summary>
    public List<string> MainTags = new List<string>{ "SpaceShip"};
    public List<string> SecondaryTags = new List<string>{ "Projectile" };
    private List<string> _tags = new List<string> { "SpaceShip", "Projectile" };

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

    public float MinShowDistanceDistance = 20;

    private Rigidbody _rigidbody;
    private ITargetDetector _detector;

    public Rigidbody FollowedTarget;
    public Rigidbody TargetToWatch;

    private ITargetPicker _watchPicker;
    private ITargetPicker _followPicker;

    private HasTagTargetPicker _tagPicker;
    private PreviousTargetPicker _currentlyFollowingPicker;
    public float DefaultFocusDistance = 200;
    public float IdleRotationSpeed = -0.05f;
    
    public Texture ReticleTexture;
    public Texture HealthFGTexture;
    public Texture HealthBGTexture;

    public ReticleState ShowReticles = ReticleState.ALL;

    public Target CurrentTarget
    {
        get
        {
            return new Target(FollowedTarget);
        }

        set
        {
            FollowedTarget = value.Rigidbody;
        }
    }

    // Use this for initialization
    void Start () {
        _rigidbody = GetComponent<Rigidbody>();
        _detector = new ChildTagTargetDetector
        {
            Tags = _tags
        };

        _tagPicker = new HasTagTargetPicker(null);
        _currentlyFollowingPicker = new PreviousTargetPicker(this)
        {
            AdditionalScore = AdditionalScoreForSameTagOrCurrentlyFllowed
        };

        var watchPickers = new List<ITargetPicker>
        {
            _tagPicker,
            _currentlyFollowingPicker,
            new ProximityTargetPicker(transform)
            {
                KullInvalidTargets = false
            }
        };

        if(_rigidbody != null)
        {
            watchPickers.Add(new LookingAtTargetPicker(_rigidbody)
            {
                KullInvalidTargets = false
            });
        }

        if (MinimumMass > 0)
        {
            watchPickers.Add(new MassTargetPicker{
                MinMass = MinimumMass,
                KullInvalidTargets = false
            });
        }

        _watchPicker = new CombinedTargetPicker(watchPickers);
        
        var followPickers = new List<ITargetPicker>
        {
            new ProximityTargetPicker(transform)
            {
                KullInvalidTargets = false
            }
        };

        if (_rigidbody != null)
        {
            followPickers.Add(new ApproachingTargetPicker(_rigidbody, ApproachTargetPickerWeighting));
        }

        if (MinimumMass > 0)
        {
            followPickers.Add(new MassTargetPicker
            {
                MinMass = MinimumMass,
                KullInvalidTargets = false
            });
        }
        _followPicker = new CombinedTargetPicker(followPickers);
    }
	
	// Update is called once per frame
	void FixedUpdate () {

        if (Input.GetKeyUp(KeyCode.R))
        {
            CycleReticleState();
        }
        if (Input.GetKeyUp(KeyCode.Z))
        {
            PickRandomToFollow();
        }
        else if(FollowedTarget == null)
        {
            PickBestTargetToFollow();
        }

        if (FollowedTarget != null)
        {
            //Debug.Log("following " + _followedTarget.Transform);
            var totalTranslateSpeed = TranslateSpeed;
            if (FollowedTarget != null && FollowedObjectTranslateSpeedMultiplier != 0)
            {
                totalTranslateSpeed += FollowedObjectTranslateSpeedMultiplier * FollowedTarget.velocity.magnitude;
            }
            transform.position = Vector3.Slerp(transform.position, FollowedTarget.position, Time.deltaTime * totalTranslateSpeed);

            PickTargetToWatch();
            if (TargetToWatch != null && FollowedTarget != TargetToWatch)
            {
                //Debug.Log("Following " + _followedTarget.Transform.name + ", Watching " + _targetToWatch.Transform.name);
                //rotate enpty parent
                var direction = (TargetToWatch.position - transform.position).normalized;
                var lookRotation = Quaternion.LookRotation(direction);
                transform.rotation = Quaternion.Slerp(transform.rotation, lookRotation, Time.deltaTime * RotationSpeed);

                //move the focus
                _focusDistance = Mathf.Lerp(_focusDistance, Vector3.Distance(transform.position, TargetToWatch.position), Time.deltaTime * FocusMoveSpeed);

                if (Quaternion.Angle(lookRotation, transform.rotation) < NearlyAimedAngle)
                {
                    //rotate the camera itself - only if the parent is looking in vaguely the right direction.
                    direction = (TargetToWatch.position - Camera.transform.position).normalized;
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

    public void OnGUI()
    {
        DrawHealthBars();
    }

    private void DrawHealthBars()
    {
        if(ShowReticles != ReticleState.NONE)
        {
            var targets = _detector.DetectTargets();

            foreach (var target in targets)
            {
                DrawSingleLable(target);
            }
        }
    }

    private void DrawSingleLable(PotentialTarget target)
    {
        // Find the 2D position of the object using the main camera
        Vector3 boxPosition = Camera.main.WorldToScreenPoint(target.Transform.position);
        if (boxPosition.z > 0)
        {
            var distance = Vector3.Distance(transform.position, target.Transform.position);

            // "Flip" it into screen coordinates
            boxPosition.y = Screen.height - boxPosition.y;

            //Draw the distance from the followed object to this object - only if it's suitably distant, and has no parent.
            if (distance > MinShowDistanceDistance && target.Transform.parent == null)
            {
                GUI.Box(new Rect(boxPosition.x - 20, boxPosition.y + 25, 40, 40), Math.Round(distance).ToString());
            }

            var rect = new Rect(boxPosition.x - 50, boxPosition.y - 50, 100, 100);
            if (ReticleTexture != null)
                GUI.DrawTexture(rect, ReticleTexture);

            var healthControler = target.Transform.GetComponent<HealthControler>();
            if (healthControler != null && healthControler.IsDamaged)
            {
                if (HealthBGTexture != null)
                    GUI.DrawTexture(rect, HealthBGTexture);
                if (HealthFGTexture != null)
                {
                    rect.width *= healthControler.HealthProportion;
                    GUI.DrawTexture(rect, HealthFGTexture);
                }
                //Debug.Log(boxPosition.z + "--x--" + boxPosition.x + "----y--" + boxPosition.y);
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
        var knower = FollowedTarget.GetComponent<IKnowsCurrentTarget>();
        if (knower != null && knower.CurrentTarget != null)
        {
            TargetToWatch = knower.CurrentTarget.Rigidbody;
            //Debug.Log("Watching followed object's target: " + _targetToWatch.Transform.name);
        } else
        {
            var targets = _detector.DetectTargets()
                .Where(t => t.Transform.parent == null);  //Don't watch anything that still has a parent.
            targets = _watchPicker.FilterTargets(targets)
                .OrderByDescending(s => s.Score);
            //foreach (var item in targets)
            //{
            //    Debug.Log(item.Transform.name + ": " + item.Score);
            //}

            TargetToWatch = targets.Any()
                ? targets
                .FirstOrDefault()
                .Rigidbody
                : null;
            //Debug.Log("Watching picked target: " + _targetToWatch.Transform.name);
        }
    }

    private void PickBestTargetToFollow()
    {
        //Debug.Log("To Follow");
        var targets = _detector.DetectTargets()
            .Where(t => t.Transform.parent == null);  //Don't follow anything that still has a parent.
        targets = _followPicker.FilterTargets(targets)
            .OrderByDescending(s => s.Score);
        //foreach (var item in targets)
        //{
        //    Debug.Log(item.Transform.name + ": " + item.Score);
        //}

        FollowedTarget = targets.Any()
            ? targets
            .FirstOrDefault()
            .Rigidbody
            : null;

        if (FollowedTarget != null)
        {
            _tagPicker.Tag = FollowedTarget.tag;
        }
    }

    private void PickRandomToFollow()
    {
        var tagrgetToFollow = _detector
            .DetectTargets()
            .Where(s => s.Transform.parent == null && s.Rigidbody != FollowedTarget)
            .OrderBy(s => UnityEngine.Random.value)
            .FirstOrDefault();
        FollowedTarget = tagrgetToFollow != null ? tagrgetToFollow.Rigidbody : null;
    }

    public static float Clamp(float value, float min, float max)
    {
        return (value < min) ? min : (value > max) ? max : value;
    }
    
    private void CycleReticleState()
    {
        switch (ShowReticles)
        {
            case ReticleState.NONE:
                ShowReticles = ReticleState.ALL;
                _tags = new List<string>();
                _tags.AddRange(MainTags);
                _tags.AddRange(SecondaryTags);
                _detector = new ChildTagTargetDetector
                {
                    Tags = _tags
                };
                break;
            case ReticleState.ALL:
                ShowReticles = ReticleState.MAIN;
                _tags = MainTags;
                _detector = new ChildTagTargetDetector
                {
                    Tags = _tags
                };
                break;
            case ReticleState.MAIN:
                ShowReticles = ReticleState.NONE;
                break;
        }
        Debug.Log(ShowReticles);
    }

    public enum ReticleState
    {
        NONE,MAIN,ALL
    }
}
