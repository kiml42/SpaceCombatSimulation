﻿using System.Collections.Generic;
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

        private BaseCameraOrientator _bestOrientator
        {
            get
            {
                var active = _orientators.Where(o => o.HasTargets);
                active = active.Any() ? active : _orientators;
                //Debug.Log(string.Join(",", active.OrderByDescending(o => o.Priority).Select(o => o.ToString() + o.Priority).ToArray()));
                return active.OrderByDescending(o => o.Priority).FirstOrDefault();
            }
        }

        public Vector3 ParentLocationTarget
        {
            get
            {
                return _bestOrientator.ParentLocationTarget;
            }
        }

        public Vector3 CameraLocationTarget
        {
            get {
                return _bestOrientator.CameraLocationTarget;
            }
        }

        public Quaternion ParentOrientationTarget
        {
            get
            {
                return _bestOrientator.ParentOrientationTarget;
            }
        }

        public Quaternion CameraOrientationTarget
        {
            get
            {
                return _bestOrientator.CameraOrientationTarget;
            }
        }

        public float CameraFieldOfView
        {
            get
            {
                return _bestOrientator.CameraFieldOfView;
            }
        }

        public bool HasTargets
        {
            get
            {
                return _bestOrientator.HasTargets;
            }
        }
    }
}