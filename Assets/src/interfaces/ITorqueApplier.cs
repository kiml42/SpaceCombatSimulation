using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Interfaces
{
    public interface ITorqueApplier
    {
        void TurnToVectorInWorldSpace(Vector3 vector);
        void AddTorquer(Rigidbody torquer);
        void Activate();
        void Deactivate();
    }
}
