using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Camera
{
    public class ShipCamTargetValues
    {
        public Vector3 ParentLocationTarget { get; private set; }
        public Vector3 ParentPollTarget { get; private set; }
        public Quaternion ParentOrientationTarget { get; private set; }

        public Vector3 CameraLocationTarget { get; private set; }
        public Vector3 CameraPollTarget { get; private set; }
        public Quaternion CameraOrientationTarget { get; private set; }

        public Vector3 UpTarget { get; private set; }

        public float CameraFieldOfView { get; private set; }

        public bool HasTargets { get; private set; }

        public Vector3 ReferenceVelocity { get; private set; }

        public ShipCamTargetValues(
            Vector3 parentLoc, Vector3 parentPole,
            Vector3 camLoc, Vector3 camPole,
            float camFov, bool hasTargets, Vector3 vRef,
            Vector3? up = null
            )
        {
            UpTarget = up ?? Vector3.up;

            ParentLocationTarget = parentLoc;
            ParentPollTarget = parentPole;
            ParentOrientationTarget = Quaternion.LookRotation(ParentPollTarget, UpTarget);

            CameraLocationTarget = camLoc;
            CameraPollTarget = camPole;
            CameraOrientationTarget = Quaternion.LookRotation(CameraPollTarget, UpTarget);

            CameraFieldOfView = camFov;

            HasTargets = hasTargets;

            ReferenceVelocity = vRef;
        }

        public ShipCamTargetValues(
           Vector3 parentLoc, Quaternion parentOrientation,
           Vector3 camLoc, Quaternion camOrientation,
           float camFov, bool hasTargets, Vector3 vRef
           )
        {
            ParentLocationTarget = parentLoc;
            ParentOrientationTarget = parentOrientation;
            ParentPollTarget = ParentOrientationTarget * Vector3.forward;

            UpTarget = ParentOrientationTarget * Vector3.up;

            CameraLocationTarget = camLoc;
            CameraOrientationTarget = camOrientation;
            CameraPollTarget = CameraOrientationTarget * Vector3.forward;

            CameraFieldOfView = camFov;

            HasTargets = hasTargets;

            ReferenceVelocity = vRef;
        }
    }
}
