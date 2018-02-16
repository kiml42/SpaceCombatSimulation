﻿using UnityEngine;

namespace Assets.Src.Controllers
{
    public abstract class BaseCameraOrientator : MonoBehaviour, ICameraOrientator
    {
        protected ShipCam _shipCam;

        public abstract Vector3 ParentLocationTarget { get; }
        public abstract Vector3 ReferenceVelocity { get; }
        public abstract Vector3 CameraLocationTarget { get; }
        public abstract Quaternion ParentOrientationTarget { get; }
        public abstract Quaternion CameraOrientationTarget { get; }
        public abstract float CameraFieldOfView { get; }
        public float PriorityMultiplier = 1;
        public abstract float Priority { get; }

        public abstract bool HasTargets { get; }

        public void RegisterOwner(ShipCam shipcam)
        {
            _shipCam = shipcam;
        }

        public static float Clamp(float value, float min, float max)
        {
            return (value < min) ? min : (value > max) ? max : value;
        }
    }
}