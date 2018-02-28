using Assets.Src.Controllers;
using Assets.Src.Interfaces;
using UnityEngine;

namespace Assets.Src.ShipCamera
{
    public abstract class BaseCameraOrientator : MonoBehaviour, ICameraOrientator
    {
        protected ShipCam _shipCam;
        
        public float PriorityMultiplier = 1;
        public abstract float Priority { get; }
        public abstract string Description { get; }

        public abstract bool HasTargets { get; }

        public void RegisterOwner(ShipCam shipcam)
        {
            _shipCam = shipcam;
        }

        public abstract ShipCamTargetValues CalculateTargets();

        public static float Clamp(float value, float min, float max)
        {
            return (value < min) ? min : (value > max) ? max : value;
        }
    }
}
