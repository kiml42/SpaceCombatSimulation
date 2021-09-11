using Assets.Src.ShipCamera;
using UnityEngine;

namespace Assets.Src.Interfaces
{
    public interface ICameraOrientator
    {
        bool HasTargets { get; }
        ShipCamTargetValues CalculateTargets();
    }
}
