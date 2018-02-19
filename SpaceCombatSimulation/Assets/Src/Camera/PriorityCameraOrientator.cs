using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Controllers
{
    public class PriorityCameraOrientator : ICameraOrientator
    {
        private List<BaseCameraOrientator> _orientators;

        public PriorityCameraOrientator(List<BaseCameraOrientator> orientators)
        {
            _orientators = orientators;
        }

        private BaseCameraOrientator _bestOrientator;

        public Vector3 ReferenceVelocity { get { return _bestOrientator.ReferenceVelocity; } }

        public Vector3 ParentLocationTarget { get { return _bestOrientator.ParentLocationTarget; } }

        public Vector3 CameraLocationTarget { get { return _bestOrientator.CameraLocationTarget; } }

        public Quaternion ParentOrientationTarget { get { return _bestOrientator.ParentOrientationTarget; } }

        public Quaternion CameraOrientationTarget { get { return _bestOrientator.CameraOrientationTarget; } }

        public Vector3 ParentPollTarget { get { return _bestOrientator.ParentPollTarget; } }

        public Vector3 CameraPollTarget { get { return _bestOrientator.CameraPollTarget; } }

        public float CameraFieldOfView { get { return _bestOrientator.CameraFieldOfView; } }

        public bool HasTargets { get { return _orientators.Any(o => o.HasTargets); } }

        public void CalculateTargets()
        {
            var active = _orientators.Where(o => o.HasTargets);
            active = active.Any() ? active : _orientators;

            //Debug.Log(string.Join(", ", active.OrderByDescending(o => o.Priority).Select(o => o.ToString() + o.Priority).ToArray()));

            _bestOrientator = active.OrderByDescending(o => o.Priority).FirstOrDefault();

            _bestOrientator.CalculateTargets();
        }
    }
}
