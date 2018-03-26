using System.Collections.Generic;
using UnityEngine;
using System.Linq;
using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using Assets.Src.ObjectManagement;

namespace Assets.Src.ShipCamera
{
    public class ShipCam : MonoBehaviour, IKnowsCurrentTarget
    {
        private IEnumerable<BaseCameraOrientator> _cameraModes;

        /// <summary>
        /// tag of a child object of a fhing to watch or follow.
        /// </summary>
        public List<string> Tags = new List<string> { "SpaceShip", "Projectile" };

        /// <summary>
        /// Rotation speed multiplier
        /// </summary>
        public float RotationSpeed = 5;

        /// <summary>
        /// transtlation speed multiplier. Higher values will be able to track faster objects, but may move from object to object too fast.
        /// </summary>
        public float TranslateSpeed = 1.5f;

        /// <summary>
        /// This value times the speed of the followed object is added to the translate speed.
        /// </summary>
        public float FollowedObjectTranslateSpeedMultiplier = 1;

        public Camera Camera;
        
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

        public float WatchTargetsScoreProportion = 0.4f;

        private Rigidbody _rigidbody;
        private ITargetDetector _detector;

        public Rigidbody FollowedTarget { get; set; }
        public Rigidbody TargetToWatch { get; set; }
        public List<Rigidbody> TargetsToWatch { get; set; }

        private ITargetPicker _watchPicker;
        private ITargetPicker _followPicker;

        private HasTagTargetPicker _tagPicker;
        private PreviousTargetPicker _currentlyFollowingPicker;
        
        private ICameraOrientator _orientator;
        public float ZoomSpeed = 2;
        public bool UseFollowedTargetsTarget = true;
        public CameraPickerMode cameraPickerMode = CameraPickerMode.Priority;
        public float CameraModeCyclePeriod = 30;

        public float UserPriorityTime = 10;

        public Target CurrentTarget
        {
            get
            {
                return FollowedTarget == null ? null : new Target(FollowedTarget);
            }

            set
            {
                FollowedTarget = value.Rigidbody;
            }
        }

        private int _calls = 0;
        public bool OnlyUseRootParents = true;
        public int SelectTargetButtonIndex = 0;
        
        // Use this for initialization
        void Start()
        {
            _cameraModes = GetComponents<BaseCameraOrientator>();

            switch (cameraPickerMode)
            {
                case CameraPickerMode.Priority:
                    _orientator = new PriorityCameraOrientator(_cameraModes.ToList(), UserPriorityTime);
                    break;
                case CameraPickerMode.Weighted:
                    _orientator = new WeightedCameraOrientator(_cameraModes.ToList());
                    break;
                case CameraPickerMode.Cycle:
                    _orientator = new CyclingCameraOrientator(_cameraModes.ToList(), CameraModeCyclePeriod);
                    break;
            }

            foreach (var cam in _cameraModes)
            {
                cam.RegisterOwner(this);
            }

            _rigidbody = GetComponent<Rigidbody>();
            _detector = new ChildTagTargetDetector
            {
                Tags = Tags
            };

            _tagPicker = new HasTagTargetPicker(null);
            _currentlyFollowingPicker = new PreviousTargetPicker(this)
            {
                FlatBoost = AdditionalScoreForSameTagOrCurrentlyFllowed
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

            if (_rigidbody != null)
            {
                watchPickers.Add(new LookingAtTargetPicker(_rigidbody)
                {
                    KullInvalidTargets = false
                });
            }

            if (MinimumMass > 0)
            {
                watchPickers.Add(new MassTargetPicker
                {
                    Threshold = MinimumMass,
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
                followPickers.Add(new ApproachingTargetPicker(_rigidbody)
                {
                    Multiplier = ApproachTargetPickerWeighting
                });
            }

            if (MinimumMass > 0)
            {
                followPickers.Add(new MassTargetPicker
                {
                    Threshold = MinimumMass,
                    KullInvalidTargets = false
                });
            }
            _followPicker = new CombinedTargetPicker(followPickers);
        }
        
        // Update is called once per frame
        void FixedUpdate()
        {

            if (Input.GetKeyUp(KeyCode.Z))
            {
                PickRandomToFollow();
            }

            else if (FollowedTarget == null)
            {
                PickBestTargetToFollow();
            }

            if(Input.GetMouseButtonUp(SelectTargetButtonIndex))
            {
                var clicked = BodyUnderPointer() ?? TargetToWatch;
                if (clicked != null && clicked != FollowedTarget)
                {
                    TargetToWatch = BodyUnderPointer();
                }
            }

            if(TargetToWatch == null)
            {
                PickTargetToWatch();
            }

            var totalTranslateSpeed = TranslateSpeed + (FollowedObjectTranslateSpeedMultiplier * Time.deltaTime);
            
            if (_orientator.HasTargets)
            {
                var targets = _orientator.CalculateTargets();

                if (_calls < 10)
                {
                    transform.position = targets.ParentLocationTarget;

                    transform.rotation = targets.ParentOrientationTarget;
                    Camera.transform.rotation = targets.CameraOrientationTarget;
                    Camera.fieldOfView = targets.CameraFieldOfView;
                    Camera.transform.position = targets.CameraLocationTarget;
                } else
                {
                    transform.position += FollowedObjectTranslateSpeedMultiplier * Time.deltaTime * targets.ReferenceVelocity;
                    transform.position = Vector3.Slerp(transform.position, targets.ParentLocationTarget, Time.deltaTime * TranslateSpeed);

                    transform.rotation = Quaternion.Slerp(transform.rotation, targets.ParentOrientationTarget, Time.deltaTime * RotationSpeed);
                    Camera.transform.rotation = Quaternion.Slerp(Camera.transform.rotation, targets.CameraOrientationTarget, Time.deltaTime * RotationSpeed * 0.3f);
                    Camera.fieldOfView = Mathf.LerpAngle(Camera.fieldOfView, targets.CameraFieldOfView, Time.deltaTime * ZoomSpeed * 0.3f);
                    Camera.transform.position = Vector3.Slerp(Camera.transform.position, targets.CameraLocationTarget, Time.deltaTime * totalTranslateSpeed);
                }

                _calls++;
            }
        }

        private Rigidbody BodyUnderPointer()
        {
            Ray ray = Camera.main.ScreenPointToRay(Input.mousePosition);

            RaycastHit hit;

            if (Physics.Raycast(ray, out hit))
            {
                return hit.transform.GetComponent<Rigidbody>();
            }
            return null;
        } 
        
        private void PickTargetToWatch()
        {
            //Debug.Log("to watch");
            IKnowsCurrentTarget knower = null;
            if(UseFollowedTargetsTarget && FollowedTarget != null) {
                knower = FollowedTarget.GetComponent<IKnowsCurrentTarget>();
            }
            var targets = _detector.DetectTargets()
                .Where(t => t.Transform.IsValid() && t.Transform.parent == null);  //Don't watch anything that still has a parent.
            targets = _watchPicker.FilterTargets(targets)
                .OrderByDescending(s => s.Score);
            //foreach (var item in targets)
            //{
            //    Debug.Log(item.Transform.name + ": " + item.Score);
            //}
            TargetsToWatch = new List<Rigidbody>();
            if (targets.Any())
            {
                var bestScore = targets.First().Score;

                //Debug.Log("ShipCam: " + string.Join(",", targets.Select(t => t.Transform.name).ToArray()));
                //TargetsToWatch = targets.Where(t => t.Score > bestScore * WatchTargetsScoreProportion).Select(t => t.Rigidbody).ToList();
                TargetsToWatch = targets.Select(t => t.Rigidbody).ToList();

                TargetToWatch = targets.First().Rigidbody;
            }
            if (knower != null && knower.CurrentTarget != null)
            {
                TargetToWatch = knower.CurrentTarget.Rigidbody;
                if (!TargetsToWatch.Contains(TargetToWatch))
                {
                    TargetsToWatch.Add(TargetToWatch);
                }
            }
            TargetToWatch = GetActualTarget(TargetToWatch);
            //Debug.Log("Watching picked target: " + _targetToWatch.Transform.name);
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

            FollowedTarget = GetActualTarget(FollowedTarget);

            if (FollowedTarget != null)
            {
                _tagPicker.Tag = FollowedTarget.tag;
            }
        }

        private Rigidbody GetActualTarget(Rigidbody target)
        {
            if (OnlyUseRootParents && target != null && target.transform.IsValid() && target.transform.parent != null)
            {
                var oldest = target.transform.FindOldestParent();
                var rb = oldest.GetComponent<Rigidbody>();
                if (rb != null)
                {
                    return rb;
                }
            }
            return target;
        }

        private void PickRandomToFollow()
        {
            var tagrgetToFollow = _detector.DetectTargets()
                .Where(s => s.Transform.parent == null && s.Rigidbody != FollowedTarget)
                .OrderBy(s => UnityEngine.Random.value)
                .FirstOrDefault();

            FollowedTarget = tagrgetToFollow != null ? GetActualTarget(tagrgetToFollow.Rigidbody) : null;
        }
    }

    public enum CameraPickerMode
    {
        Priority, Weighted, Cycle
    }
}