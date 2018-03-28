using Assets.Src.Targeting;
using System.Collections.Generic;

namespace Assets.Src.Interfaces
{
    public interface IKnowsCurrentTarget
    {
        Target CurrentTarget { get; }
        IEnumerable<Target> FilteredTargets { get; }
    }
}
