using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Controllers
{
    public interface ICameraOrientator
    {
        Vector3 ParentLocationTarget { get; }
        Vector3 ReferenceVelocity { get; }
        Vector3 CameraLocationTarget { get; }
        Quaternion ParentOrientationTarget { get; }
        Quaternion CameraOrientationTarget { get; }
        float CameraFieldOfView { get; }

        bool HasTargets { get; }
    }
}
