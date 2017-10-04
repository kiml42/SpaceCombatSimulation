using Assets.Src.Targeting;
using UnityEngine;

namespace Assets.Src.Interfaces
{
    public interface IKnowsCurrentTarget
    {
        Target CurrentTarget { get; set; }
    }
}
