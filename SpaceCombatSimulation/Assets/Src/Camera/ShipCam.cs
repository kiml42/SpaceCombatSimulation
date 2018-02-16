using System.Collections.Generic;
using UnityEngine;
using System.Linq;
using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using Assets.Src.ObjectManagement;

namespace Assets.Src.Controllers
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
        void Start()
        {
            _cameraModes = GetComponents<BaseCameraOrientator>();

            _orientator = new PriorityCameraOrientator(_cameraModes.ToList());

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
                BonusScore = AdditionalScoreForSameTagOrCurrentlyFllowed
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

            PickTargetToWatch();

            var totalTranslateSpeed = TranslateSpeed + (FollowedObjectTranslateSpeedMultiplier * Time.deltaTime);
            
            if (_orientator.HasTargets)
            {
                transform.position += FollowedObjectTranslateSpeedMultiplier * Time.deltaTime * _orientator.ReferenceVelocity;
                transform.position = Vector3.Slerp(transform.position, _orientator.ParentLocationTarget, Time.deltaTime * TranslateSpeed);

                transform.rotation = Quaternion.Slerp(transform.rotation, _orientator.ParentOrientationTarget, Time.deltaTime * RotationSpeed);
                Camera.transform.rotation = Quaternion.Slerp(Camera.transform.rotation, _orientator.CameraOrientationTarget, Time.deltaTime * RotationSpeed * 0.3f);
                Camera.fieldOfView = Mathf.LerpAngle(Camera.fieldOfView, _orientator.CameraFieldOfView, Time.deltaTime * ZoomSpeed * 0.3f);
                Camera.transform.position = Vector3.Slerp(Camera.transform.position, _orientator.CameraLocationTarget, Time.deltaTime * totalTranslateSpeed);
            }
        }
        
        private void PickTargetToWatch()
        {
            //Debug.Log("to watch");
            IKnowsCurrentTarget knower = null;
            if(FollowedTarget != null) {
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

            if (FollowedTarget != null)
            {
                _tagPicker.Tag = FollowedTarget.tag;
            }
        }

        private void PickRandomToFollow()
        {
            var tagrgetToFollow = _detector.DetectTargets()
                .Where(s => s.Transform.parent == null && s.Rigidbody != FollowedTarget)
                .OrderBy(s => UnityEngine.Random.value)
                .FirstOrDefault();
            FollowedTarget = tagrgetToFollow != null ? tagrgetToFollow.Rigidbody : null;
        }
    }
}