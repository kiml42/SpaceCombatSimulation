using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Controllers
{
    public class WeightedCameraOrientator : ICameraOrientator
    {
        private List<BaseCameraOrientator> _orientators;

        public WeightedCameraOrientator(List<BaseCameraOrientator> orientators)
        {
            _orientators = orientators;
        }

        public Vector3 ParentLocationTarget
        {
            get
            {
                return _orientators.First().ParentLocationTarget;
            }
        }

        public Vector3 CameraLocationTarget
        {
            get {
                return _orientators.First().CameraLocationTarget;
            }
        }

        public Quaternion ParentOrientationTarget
        {
            get
            {
                return _orientators.First().ParentOrientationTarget;
            }
        }

        public Quaternion CameraOrientationTarget
        {
            get
            {
                return _orientators.First().CameraOrientationTarget;
            }
        }

        public float CameraFieldOfView
        {
            get
            {
                return _orientators.First().CameraFieldOfView;
            }
        }

        public bool HasTargets
        {
            get
            {
                return _orientators.First().HasTargets;
            }
        }
    }
}
