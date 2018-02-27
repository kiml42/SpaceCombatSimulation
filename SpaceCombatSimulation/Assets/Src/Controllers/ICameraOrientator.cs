using Assets.Src.ShipCamera;
using UnityEngine;

namespace Assets.Src.Interfaces
{
    public interface ICameraOrientator
    {
        Vector3 ParentLocationTarget { get; }
        Vector3 ReferenceVelocity { get; }
        Vector3 CameraLocationTarget { get; }

        /// <summary>
        /// World space vector for the parent to point its forward axis at.
        /// </summary>
        Vector3 ParentPollTarget { get; }

        /// <summary>
        /// World space vector for the camera to point its forward axis at.
        /// </summary>
        Vector3 CameraPollTarget { get; }

        Quaternion ParentOrientationTarget { get; }
        Quaternion CameraOrientationTarget { get; }
        float CameraFieldOfView { get; }

        bool HasTargets { get; }

        ShipCamTargetValues CalculateTargets();
    }
}
