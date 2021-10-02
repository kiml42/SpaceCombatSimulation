using UnityEngine;

namespace Assets.Src.Interfaces
{
    public interface ITorquerManager : IDeactivatable
    {
        void TurnToVectorInWorldSpace(Vector3 lookVector, Vector3? upVector = null);
        void Activate();
    }

    public interface ITorquer : IDeactivatable
    {
        /// <summary>
        /// Applies the given worlds space torque.
        /// </summary>
        /// <param name="torque"></param>
        void SetTorque(Vector3? torque);

        void Activate();
    }
}
