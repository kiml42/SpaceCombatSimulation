using UnityEngine;

namespace Assets.Src.Interfaces
{
    public interface ITorquerManager : IDeactivatable
    {
        void TurnToOrientationInWorldSpace(Quaternion targetOrientation, float multiplier);
        void TurnToVectorInWorldSpace(Vector3 lookVector, Vector3? upVector = null);
        void Activate();
    }

    public interface ITorquer : IDeactivatable
    {
        bool IsActiveTorquer { get; }

        /// <summary>
        /// Applies the given pilot space torque.
        /// </summary>
        /// <param name="pilotSpaceTorque"></param>
        void SetTorque(Vector3? pilotSpaceTorque);

        void Activate();
    }
}
