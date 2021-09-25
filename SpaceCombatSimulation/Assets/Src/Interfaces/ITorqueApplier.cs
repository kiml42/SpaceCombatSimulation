using UnityEngine;

namespace Assets.Src.Interfaces
{
    public interface ITorqueApplier
    {
        void TurnToVectorInWorldSpace(Vector3 lookVector, Vector3? upVector = null);
        void AddTorquer(Rigidbody torquer);
        void Activate();
        void Deactivate();
    }
}
