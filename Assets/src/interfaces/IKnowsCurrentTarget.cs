using Assets.Src.Targeting;
using UnityEngine;

namespace Assets.Src.Interfaces
{
    public interface IKnowsCurrentTarget
    {
        PotentialTarget CurrentTarget { get; set; }
    }
}
