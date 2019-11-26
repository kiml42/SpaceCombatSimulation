using Assets.Src.Targeting;
using System.Collections.Generic;

namespace Assets.Src.Interfaces
{
    public interface ITargetDetector
    {
        IEnumerable<PotentialTarget> DetectTargets(bool includeNavigationTarets = false);
    }
}
