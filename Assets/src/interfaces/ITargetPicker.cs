using Assets.Src.Targeting;
using System.Collections.Generic;

namespace Assets.Src.Interfaces
{
    public interface ITargetPicker
    {
        IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets);
    }
}
