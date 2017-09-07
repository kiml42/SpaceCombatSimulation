using Assets.Src.Targeting;
using UnityEngine;

namespace Assets.src.interfaces
{
    public interface IKnowsCurrentTarget
    {
        PotentialTarget CurrentTarget { get; set; }
    }
}
