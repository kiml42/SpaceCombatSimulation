using Assets.Src.Targeting;
using UnityEngine;

namespace Assets.Src.Interfaces
{
    public interface ITarget
    {
        string Team { get; set; }
        Transform Transform { get; }
        Rigidbody Rigidbody { get; }
        ShipType Type { get; }
    }
}
