using UnityEngine;

namespace Assets.Src.Interfaces
{
    public interface IDestroyer
    {
        void Destroy(GameObject toDestroy, bool useExplosion, Vector3? velocityOverride = null);
    }
}
